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
const LOVABLE_AI_KEY = (Deno.env.get("LOVABLE_API_KEY") || "").trim();
const BUCKET = "article-images";
const FAL_PRICE: Record<string, { endpoint: string; usd: number }> = {
  fast: { endpoint: "fal-ai/flux/schnell", usd: 0.003 },
  high: { endpoint: "fal-ai/flux/dev", usd: 0.025 },
};

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
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`,
 "HTTP-Referer": "https://seo-modul.pro",
 "X-Title": "SEO-Modul generate-pro-image", "Content-Type": "application/json" },
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

async function falGenerate(prompt: string, numImages = 1, quality: "fast" | "high" = "fast"): Promise<string[]> {
  const tier = FAL_PRICE[quality] || FAL_PRICE.fast;
  const r = await fetch(`https://fal.run/${tier.endpoint}`, {
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

/** Upload a raw base64 data URL (data:image/png;base64,...) to bucket as PNG. */
async function uploadDataUrl(admin: any, userId: string, dataUrl: string): Promise<{ url: string; filename: string }> {
  const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!m) throw new Error("Invalid data URL from edit model");
  const mime = m[1];
  const ext = mime.split("/")[1].replace("jpeg", "jpg");
  const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  const filename = `pro/${userId}/edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await admin.storage.from(BUCKET).upload(filename, bin, { contentType: mime, upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data } = admin.storage.from(BUCKET).getPublicUrl(filename);
  return { url: data.publicUrl, filename };
}

/** Edit an existing image via Lovable AI Gateway (nano-banana). */
async function editImage(sourceUrl: string, prompt: string): Promise<string> {
  if (!LOVABLE_AI_KEY) throw new Error("LOVABLE_API_KEY not configured");
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_AI_KEY}`,
 "HTTP-Referer": "https://seo-modul.pro",
 "X-Title": "SEO-Modul generate-pro-image", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `${prompt}. No text, no letters, no logos, no watermarks.` },
          { type: "image_url", image_url: { url: sourceUrl } },
        ],
      }],
      modalities: ["image", "text"],
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Lovable AI edit ${r.status}: ${t.slice(0, 200)}`);
  }
  const d = await r.json();
  const out = d?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!out) throw new Error("Edit model returned no image");
  return out;
}

/** Best-effort insert into article_images so the gallery sees this asset. */
async function linkToArticle(admin: any, opts: {
  userId: string;
  articleId?: string | null;
  storagePath: string;
  publicUrl: string;
  prompt?: string;
  visualPrompt?: string;
  model: string;
  style?: string;
  mode?: string;
}) {
  try {
    await admin.from("article_images").insert({
      user_id: opts.userId,
      article_id: opts.articleId || null,
      storage_path: opts.storagePath,
      public_url: opts.publicUrl,
      prompt: opts.prompt?.slice(0, 1000) || null,
      visual_prompt: opts.visualPrompt?.slice(0, 1000) || null,
      model: opts.model,
      aspect_ratio: "16:9",
      style: opts.style || null,
      mode: opts.mode || "generate",
    });
  } catch (e) {
    console.warn("[link-article] insert failed:", (e as Error).message);
  }
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

async function generateOne(admin: any, userId: string, context: string, alt: string, style: string, variations: number, quality: "fast" | "high", articleId?: string | null) {
  const prompt = await buildVisualPrompt(context, style);
  const falUrls = await falGenerate(prompt, variations, quality);
  const uploaded = await Promise.all(falUrls.map((u) => uploadToBucket(admin, userId, u)));
  const tier = FAL_PRICE[quality] || FAL_PRICE.fast;
  void logCost(admin, {
    operation_type: "fal_ai_photo",
    model: tier.endpoint,
    cost_usd: tier.usd * uploaded.length,
    metadata: { source: "generate-pro-image", user_id: userId, style, quality, variations: uploaded.length },
  });
  for (const u of uploaded) {
    void linkToArticle(admin, {
      userId, articleId, storagePath: u.filename, publicUrl: u.url,
      prompt: alt, visualPrompt: prompt, model: tier.endpoint, style, mode: "generate",
    });
  }
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
  const quality: "fast" | "high" = body?.quality === "high" ? "high" : "fast";
  const articleId = body?.article_id ? String(body.article_id) : null;
  const sourceUrl = String(body?.source_url || "").trim();
  const editPrompt = String(body?.edit_prompt || "").trim();

  if (mode !== "edit" && !title) return errorResponse("title is required", 400);

  const admin = adminClient();

  try {
    if (mode === "edit") {
      if (!sourceUrl || !editPrompt) return errorResponse("source_url and edit_prompt are required", 400);
      const dataUrl = await editImage(sourceUrl, editPrompt);
      const up = await uploadDataUrl(admin, userId, dataUrl);
      void logCost(admin, {
        operation_type: "fal_ai_photo",
        model: "nano-banana-edit",
        cost_usd: 0.005,
        metadata: { source: "generate-pro-image", user_id: userId, mode: "edit" },
      });
      void linkToArticle(admin, {
        userId, articleId, storagePath: up.filename, publicUrl: up.url,
        prompt: editPrompt, visualPrompt: editPrompt, model: "nano-banana-edit", style, mode: "edit",
      });
      return jsonResponse({ url: up.url, alt: title || editPrompt.slice(0, 80), filename: up.filename, variants: [], remaining: 999 });
    }

    if (mode === "multi") {
      const sections = extractH2Sections(content).slice(0, 5);
      if (sections.length === 0) return errorResponse("No H2 sections found", 400);
      const images: { heading: string; url: string; alt: string }[] = [];
      for (const heading of sections) {
        try {
          const ctx = `${keyword}: ${heading}`;
          const imgs = await generateOne(admin, userId, ctx, heading, style, 1, quality, articleId);
          if (imgs[0]) images.push({ heading, url: imgs[0].url, alt: imgs[0].alt });
        } catch (e) {
          console.warn("[generate-pro-image] section failed:", heading, (e as Error).message);
        }
      }
      return jsonResponse({ images, remaining: 999 });
    }

    // Single cover
    const ctx = summary ? `${keyword}. ${summary}` : keyword;
    const items = await generateOne(admin, userId, ctx, title, style, variations, quality, articleId);
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