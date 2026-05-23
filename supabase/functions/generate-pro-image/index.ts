// Pro Visual Synthesis — generates realistic business cover/section images
// via FAL flux/schnell, uploads to the public `article-images` bucket and
// returns Public URLs. Auth via standard end-user JWT.
//
// POST body:
//   { title, summary?, content?, keyword?, style?, mode? }
//   mode === "multi"  → generate up to 5 images for H2 sections in `content`
//   default           → single cover image

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { logCost } from "../_shared/costLogger.ts";

const FAL_KEY = (Deno.env.get("FAL_AI_API_KEY") || "").trim();
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") || "").trim();
const BUCKET = "article-images";
const FAL_COST_USD = 0.003;

interface FalImage { url: string }

async function buildVisualPrompt(context: string): Promise<string> {
  const fallback = `Photorealistic business photo: ${context}. Natural lighting, professional, clean composition, no text, no logos, no watermarks.`;
  if (!OPENROUTER_KEY) return fallback;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "Convert the topic into a concise English visual prompt for a photorealistic business stock photo. Focus on a concrete visible subject and setting. Do NOT include any text, logos, watermarks, or letters in the image. Output ONLY the visual description, max 40 words." },
          { role: "user", content: context.slice(0, 400) },
        ],
        max_tokens: 120,
        temperature: 0.4,
      }),
    });
    if (!r.ok) return fallback;
    const d = await r.json();
    const out = String(d?.choices?.[0]?.message?.content || "").trim();
    return out ? `${out}. Photorealistic, natural lighting, no text, no logos, no watermarks.` : fallback;
  } catch {
    return fallback;
  }
}

async function falGenerate(prompt: string): Promise<string> {
  const r = await fetch("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      image_size: "landscape_16_9",
      num_images: 1,
      enable_safety_checker: true,
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`FAL ${r.status}: ${t.slice(0, 200)}`);
  }
  const d = await r.json();
  const url = (d?.images?.[0] as FalImage | undefined)?.url || "";
  if (!url) throw new Error("FAL returned no image");
  return url;
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

async function generateOne(admin: any, userId: string, context: string, alt: string) {
  const prompt = await buildVisualPrompt(context);
  const falUrl = await falGenerate(prompt);
  const uploaded = await uploadToBucket(admin, userId, falUrl);
  void logCost(admin, {
    operation_type: "fal_ai_photo",
    model: "fal-ai/flux/schnell",
    cost_usd: FAL_COST_USD,
    metadata: { source: "generate-pro-image", user_id: userId },
  });
  return { url: uploaded.url, filename: uploaded.filename, alt };
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  if (!FAL_KEY) return errorResponse("FAL_AI_API_KEY is not configured", 500);

  const auth = await verifyAuth(req);
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  let body: any = {};
  try { body = await req.json(); } catch { return errorResponse("Invalid JSON body", 400); }

  const title = String(body?.title || "").trim();
  const keyword = String(body?.keyword || title).trim();
  const summary = String(body?.summary || "").trim();
  const content = String(body?.content || "").trim();
  const mode = String(body?.mode || "single");

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
          const img = await generateOne(admin, userId, ctx, heading);
          images.push({ heading, url: img.url, alt: img.alt });
        } catch (e) {
          console.warn("[generate-pro-image] section failed:", heading, (e as Error).message);
        }
      }
      return jsonResponse({ images, remaining: 999 });
    }

    // Single cover
    const ctx = summary ? `${keyword}. ${summary}` : keyword;
    const single = await generateOne(admin, userId, ctx, title);
    return jsonResponse({
      url: single.url,
      alt: single.alt,
      filename: single.filename,
      remaining: 999,
    });
  } catch (e: any) {
    console.error("[generate-pro-image] error:", e?.message);
    return errorResponse(e?.message || "Generation failed", 500);
  }
});