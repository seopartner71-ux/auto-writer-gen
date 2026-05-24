// Pro Visual Synthesis — generates realistic business cover/section images
// via FAL flux/schnell, uploads to the public `article-images` bucket and
// returns Public URLs. Auth via standard end-user JWT.
//
// POST body:
//   { title, summary?, content?, keyword?, style?, mode? }
//   mode === "multi"  → generate up to 5 images for H2 sections in `content`
//   default           → single cover image

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdminOrStaff } from "../_shared/auth.ts";
import { logCost } from "../_shared/costLogger.ts";

const FAL_KEY = (Deno.env.get("FAL_AI_API_KEY") || "").trim();
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") || "").trim();
const BUCKET = "article-images";
const FAL_COST_USD = 0.003;

interface FalImage { url: string }

const STYLE_HINTS: Record<string, string> = {
  photorealistic:
    "Photorealistic business photo. Natural lighting, shallow depth of field, professional, clean composition.",
  product:
    "Studio product shot on a clean white seamless background. Soft even lighting, sharp focus, centered, e-commerce catalog style.",
  lifestyle:
    "Lifestyle photo: real people using the product/service in a natural everyday environment. Warm authentic light, candid feel.",
  flatlay:
    "Top-down flat lay composition on a neutral surface. Objects arranged with whitespace, balanced symmetry, soft daylight.",
};

const NEGATIVE = "No text, no letters, no captions, no logos, no watermarks, no signage, no distorted hands or faces, no extra fingers.";

async function buildVisualPrompt(context: string, style: string): Promise<string> {
  const styleHint = STYLE_HINTS[style] || STYLE_HINTS.photorealistic;
  const fallback = `${styleHint} Subject: ${context}. ${NEGATIVE}`;
  if (!OPENROUTER_KEY) return fallback;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: `Convert the topic into a concise English visual prompt for a ${style} image. Focus on ONE concrete visible subject and setting. Do NOT include any text, logos, watermarks, or letters in the image. Output ONLY the visual description, max 40 words.` },
          { role: "user", content: context.slice(0, 400) },
        ],
        max_tokens: 120,
        temperature: 0.4,
      }),
    });
    if (!r.ok) return fallback;
    const d = await r.json();
    const out = String(d?.choices?.[0]?.message?.content || "").trim();
    return out ? `${styleHint} ${out}. ${NEGATIVE}` : fallback;
  } catch {
    return fallback;
  }
}

async function falGenerate(prompt: string, numImages = 1): Promise<string[]> {
  const r = await fetch("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      image_size: "landscape_16_9",
      num_images: Math.max(1, Math.min(4, numImages)),
      enable_safety_checker: true,
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`FAL ${r.status}: ${t.slice(0, 200)}`);
  }
  const d = await r.json();
  const urls = (d?.images || []).map((im: FalImage) => im?.url).filter(Boolean) as string[];
  if (urls.length === 0) throw new Error("FAL returned no image");
  return urls;
}

async function uploadToBucket(admin: any, userId: string, sourceUrl: string): Promise<{ url: string; filename: string }> {
  const resp = await fetch(sourceUrl);
  if (!resp.ok) throw new Error(`Failed to fetch FAL image: ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  const filename = `pro/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await admin.storage.from(BUCKET).upload(filename, buf, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data } = admin.storage.from(BUCKET).getPublicUrl(filename);
  return { url: data.publicUrl, filename };
}

function extractH2Sections(content: string): string[] {
  const lines = (content || "").split("\n");
  const out: string[] = [];
  for (const ln of lines) {
    const m = ln.match(/^##\s+(.+?)\s*$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

async function generateOne(admin: any, userId: string, context: string, alt: string, style: string, variations: number) {
  const prompt = await buildVisualPrompt(context, style);
  const falUrls = await falGenerate(prompt, variations);
  const uploaded = await Promise.all(falUrls.map((u) => uploadToBucket(admin, userId, u)));
  void logCost(admin, {
    operation_type: "fal_ai_photo",
    model: "fal-ai/flux/schnell",
    cost_usd: FAL_COST_USD * uploaded.length,
    metadata: { source: "generate-pro-image", user_id: userId, style, variations: uploaded.length },
  });
  return uploaded.map((u) => ({ url: u.url, filename: u.filename, alt }));
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  if (!FAL_KEY) return errorResponse("FAL_AI_API_KEY is not configured", 500);

  const auth = await verifyAuth(req);
  if (auth instanceof Response) return auth;
  const forbidden = await requireAdminOrStaff(auth);
  if (forbidden) return forbidden;
  const { userId } = auth;

  let body: any = {};
  try { body = await req.json(); } catch { return errorResponse("Invalid JSON body", 400); }

  const title = String(body?.title || "").trim();
  const keyword = String(body?.keyword || title).trim();
  const summary = String(body?.summary || "").trim();
  const content = String(body?.content || "").trim();
  const mode = String(body?.mode || "single");
  const style = String(body?.style || "photorealistic");
  const variations = Math.max(1, Math.min(4, Number(body?.variations) || 1));

  if (!title) return errorResponse("title is required", 400);

  const admin = adminClient();

  try {
    if (mode === "multi") {
      const sections = extractH2Sections(content).slice(0, 5);
      if (sections.length === 0) return errorResponse("No H2 sections found", 400);
      const images: { heading: string; url: string; alt: string }[] = [];
      for (const heading of sections) {
        try {
          const ctx = `${keyword}: ${heading}`;
          const imgs = await generateOne(admin, userId, ctx, heading, style, 1);
          if (imgs[0]) images.push({ heading, url: imgs[0].url, alt: imgs[0].alt });
        } catch (e) {
          console.warn("[generate-pro-image] section failed:", heading, (e as Error).message);
        }
      }
      return jsonResponse({ images, remaining: 999 });
    }

    // Single cover
    const ctx = summary ? `${keyword}. ${summary}` : keyword;
    const items = await generateOne(admin, userId, ctx, title, style, variations);
    const first = items[0];
    return jsonResponse({
      url: first.url,
      alt: first.alt,
      filename: first.filename,
      variants: items.map((i) => ({ url: i.url, alt: i.alt, filename: i.filename })),
      remaining: 999,
    });
  } catch (e: any) {
    console.error("[generate-pro-image] error:", e?.message);
    return errorResponse(e?.message || "Generation failed", 500);
  }
});