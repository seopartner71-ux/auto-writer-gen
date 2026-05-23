// Image Generator — multi-mode (prompt / h2 / cover) via FAL flux/schnell or flux-pro.
// Reuses _shared helpers. Credits are deducted upfront and refunded on failure.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdminOrStaff } from "../_shared/auth.ts";
import { withErrorHandler, HttpError } from "../_shared/errorHandler.ts";
import { fetchWithTimeout } from "../_shared/withTimeout.ts";

const FAL_KEY = (Deno.env.get("FAL_AI_API_KEY") || Deno.env.get("FAL_API_KEY") || "").trim();
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") || "").trim();
const BUCKET = "article-images";

const ASPECT_MAP: Record<string, string> = {
  "16:9": "landscape_16_9",
  "4:3": "landscape_4_3",
  "1:1": "square_hd",
  "9:16": "portrait_16_9",
  "3:2": "landscape_4_3",
};

const STYLE_SUFFIX: Record<string, string> = {
  "Реалистичный бизнес": ", realistic business photo, professional lighting, 4K",
  "Редакционный": ", editorial photography, magazine style, natural light",
  "Инфографика": ", clean infographic, flat design, white background",
  "Flat-иллюстрация": ", flat vector illustration, minimal, colorful",
};

async function openrouterPrompt(system: string, user: string): Promise<string> {
  if (!OPENROUTER_KEY) return user;
  try {
    const r = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "SEO-Module Image Generator",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        max_tokens: 150,
        temperature: 0.5,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user.slice(0, 500) },
        ],
      }),
    }, 20_000);
    if (!r.ok) return user;
    const d = await r.json();
    return String(d?.choices?.[0]?.message?.content || user).trim();
  } catch {
    return user;
  }
}

// PROMPT ENHANCER — rewrites any short/vague user input into a production-quality FAL prompt.
async function enhancePrompt(rawPrompt: string, style: string, mood?: string): Promise<string> {
  if (!OPENROUTER_KEY) return rawPrompt;
  const system = `You are an expert image prompt engineer for the Flux image generation model.
Your job: take any short or vague user description and rewrite it into a detailed, high-quality image generation prompt in English.

Rules:
- Output ONLY the final prompt. No explanations, no comments, no quotes.
- Always specify: subject, environment/background, lighting, camera style, mood, quality tags.
- Style context: ${style}${mood ? `. Mood: ${mood}` : ""}.
- Never include: text overlays, watermarks, logos, AI-art aesthetics, cartoon style (unless requested).
- End every prompt with: photorealistic, sharp focus, 4K, professional photography.
- Maximum 120 words.

IMPORTANT — APPEARANCE RULE:
If the prompt includes any people, they must ALWAYS have Slavic appearance:
light skin, light or dark straight hair, blue, grey or green eyes,
soft European facial features. Never generate people of Asian, African,
Middle Eastern or Latin appearance. Apply this rule silently — never mention
it in the output prompt explicitly, just describe the person accordingly.
Example: instead of "a woman" write "a woman with fair skin, light brown hair and grey eyes".

Examples of good output:
"A focused female entrepreneur reviewing analytics on a laptop in a modern co-working space, warm natural window light, shallow depth of field, confident professional atmosphere, photorealistic, sharp focus, 4K, professional photography."

"Close-up of hands typing on a keyboard with blurred dual monitors showing graphs in background, cool office lighting, corporate productivity mood, photorealistic, sharp focus, 4K, professional photography."`;
  try {
    const r = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "SEO-Module Prompt Enhancer",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        max_tokens: 250,
        temperature: 0.6,
        messages: [
          { role: "system", content: system },
          { role: "user", content: rawPrompt.slice(0, 800) },
        ],
      }),
    }, 20_000);
    if (!r.ok) return rawPrompt;
    const d = await r.json();
    const out = String(d?.choices?.[0]?.message?.content || "").trim().replace(/^"|"$/g, "");
    return out || rawPrompt;
  } catch {
    return rawPrompt;
  }
}

async function falGenerate(model: "schnell" | "flux-pro", prompt: string, imageSize: string, negativePrompt?: string): Promise<string> {
  const endpoint = model === "flux-pro" ? "https://fal.run/fal-ai/flux-pro" : "https://fal.run/fal-ai/flux/schnell";
  const payload: Record<string, unknown> = {
    prompt,
    image_size: imageSize,
    num_images: 1,
    enable_safety_checker: true,
  };
  // flux-pro supports negative_prompt; schnell ignores unknown fields safely.
  if (negativePrompt) payload.negative_prompt = negativePrompt;
  const r = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 60_000);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`FAL ${r.status}: ${t.slice(0, 200)}`);
  }
  const d = await r.json();
  const url = d?.images?.[0]?.url as string | undefined;
  if (!url) throw new Error("FAL returned no image");
  return url;
}

async function uploadToBucket(admin: any, userId: string, sourceUrl: string, idx: number) {
  const resp = await fetch(sourceUrl);
  if (!resp.ok) throw new Error(`Failed to fetch FAL image: ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());

  // Convert JPEG -> WebP (smaller files, same visual quality).
  // Fallback: if conversion fails for any reason, keep original JPEG.
  let bytes: Uint8Array = buf;
  let ext = "jpg";
  let contentType = "image/jpeg";
  try {
    const [{ default: decodeJpeg }, { default: encodeWebp }] = await Promise.all([
      import("npm:@jsquash/jpeg@1.5.0/decode.js"),
      import("npm:@jsquash/webp@1.4.0/encode.js"),
    ]);
    const imageData = await decodeJpeg(buf);
    const webp = await encodeWebp(imageData, { quality: 85 });
    bytes = new Uint8Array(webp);
    ext = "webp";
    contentType = "image/webp";
  } catch (e) {
    console.warn("[generate-image] WebP conversion failed, falling back to JPEG:", (e as Error)?.message);
  }

  const path = `${userId}/${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

Deno.serve(withErrorHandler("generate-image", async (req) => {
  if (req.method !== "POST") throw new HttpError("Method not allowed", 405);
  if (!FAL_KEY) throw new HttpError("FAL API key not configured", 500);

  const auth = await verifyAuth(req);
  if (auth instanceof Response) return auth;
  const forbidden = await requireAdminOrStaff(auth);
  if (forbidden) return forbidden;
  const { userId } = auth;

  let body: any = {};
  try { body = await req.json(); } catch { throw new HttpError("Invalid JSON body", 400); }

  const mode = String(body?.mode || "prompt");
  const aspectRatio = String(body?.aspect_ratio || "16:9");
  const style = String(body?.style || "Реалистичный бизнес");
  const count = Math.min(6, Math.max(1, Number(body?.count) || 1));
  const model = (body?.model === "flux-pro" ? "flux-pro" : "schnell") as "schnell" | "flux-pro";
  const articleId = body?.article_id || null;

  const admin = adminClient();

  // Plan check for flux-pro
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, credits_amount")
    .eq("id", userId)
    .maybeSingle();
  const plan = profile?.plan || "basic";
  const isPriv = await admin.rpc("has_role", { _user_id: userId, _role: "admin" }).then((r: any) => !!r.data)
    .catch(() => false);

  if (model === "flux-pro" && !isPriv && plan !== "pro" && plan !== "factory") {
    throw new HttpError("Flux Pro доступен на тарифе PRO и выше", 403);
  }

  if ((profile?.credits_amount ?? 0) < count && !isPriv) {
    throw new HttpError("Insufficient credits", 402);
  }

  // Deduct upfront
  const deduct = await admin.rpc("deduct_credits_v2", {
    p_user_id: userId,
    p_amount: count,
    p_reason: `image_generation:${mode}`,
    p_model_key: model,
    p_article_id: articleId,
    p_metadata: { source: "generate-image", mode, model },
  });
  if (deduct.error || !deduct.data?.ok) {
    const reason = deduct.data?.reason || deduct.error?.message || "credit_error";
    throw new HttpError(`Credit error: ${reason}`, 402);
  }

  const refund = async () => {
    try {
      await admin.rpc("refund_credits", {
        p_user_id: userId,
        p_amount: count,
        p_reason: `image_generation_refund:${mode}`,
        p_article_id: articleId,
        p_metadata: { source: "generate-image" },
      });
    } catch (e) {
      console.error("[generate-image] refund failed:", e);
    }
  };

  try {
    // Build prompts
    let prompts: string[] = [];
    let labels: string[] = [];

    if (mode === "h2") {
      const headings = Array.isArray(body?.h2_headings) ? body.h2_headings.filter(Boolean) : [];
      if (headings.length === 0) throw new HttpError("h2_headings required", 400);
      const visualPrompts = await Promise.all(
        headings.map((h: string) => openrouterPrompt(
          "Convert this article section heading into a concise visual image prompt in English. Style: realistic business photography, no AI art, no text in image, no watermarks. Output only the prompt, nothing else.",
          h,
        )),
      );
      // Cycle to fill count
      for (let i = 0; i < count; i++) {
        prompts.push(visualPrompts[i % visualPrompts.length]);
        labels.push(headings[i % headings.length]);
      }
    } else if (mode === "cover") {
      const topic = String(body?.topic || "").trim();
      const keyword = String(body?.keyword || "").trim();
      const mood = String(body?.mood || "Деловое").trim();
      if (!topic) throw new HttpError("topic required", 400);
      const visual = await openrouterPrompt(
        "Generate a single hero image prompt in English for a blog article cover photo. Style: realistic business photography, cinematic, no text overlay, no watermarks. Output only the prompt.",
        `Topic: ${topic}. Keyword: ${keyword}. Mood: ${mood}`,
      );
      prompts = Array(count).fill(visual);
      labels = Array(count).fill(topic);
    } else {
      const p = String(body?.prompt || "").trim();
      if (!p) throw new HttpError("prompt required", 400);
      prompts = Array(count).fill(p);
      labels = Array(count).fill(p.slice(0, 80));
    }

    const suffix = STYLE_SUFFIX[style] || "";
    const imageSize = ASPECT_MAP[aspectRatio] || "landscape_16_9";

    // Hard ban on any text/letters/captions/watermarks on the image
    const NO_TEXT_SUFFIX =
      ", absolutely no text, no letters, no words, no captions, no typography, " +
      "no watermarks, no logos, no signs, no labels, no UI overlays, " +
      "no signatures, no numbers, clean image without any writing";
    const NO_TEXT_NEGATIVE =
      "text, letters, words, captions, typography, watermark, logo, signature, " +
      "labels, signs, numbers, writing, subtitles, ui, lorem ipsum";

    // PROMPT ENHANCER — applies to ALL modes before FAL call
    const moodForEnh = mode === "cover" ? String(body?.mood || "").trim() : undefined;
    const enhancedPrompts = await Promise.all(
      prompts.map((p) => enhancePrompt(p, style, moodForEnh)),
    );

    // Generate concurrently
    const results = await Promise.all(
      enhancedPrompts.map(async (enhanced, idx) => {
        const finalPrompt = enhanced + suffix + NO_TEXT_SUFFIX;
        const falUrl = await falGenerate(model, finalPrompt, imageSize, NO_TEXT_NEGATIVE);
        const { path, publicUrl } = await uploadToBucket(admin, userId, falUrl, idx);
        return { idx, rawPrompt: prompts[idx], enhanced, finalPrompt, path, publicUrl, label: labels[idx] };
      }),
    );

    // Insert DB rows
    const rows = results.map((r) => ({
      user_id: userId,
      article_id: articleId,
      storage_path: r.path,
      public_url: r.publicUrl,
      prompt: labels[r.idx],
      visual_prompt: r.finalPrompt,
      model,
      aspect_ratio: aspectRatio,
      style,
      mode,
    }));
    await admin.from("article_images").insert(rows);

    return jsonResponse({
      images: results.map((r) => ({
        url: r.publicUrl,
        storage_path: r.path,
        label: r.label,
        prompt: r.finalPrompt,
        enhanced_prompt: r.enhanced,
        raw_prompt: r.rawPrompt,
        index: r.idx,
      })),
    });
  } catch (e: any) {
    await refund();
    throw e instanceof HttpError ? e : new HttpError(e?.message || "Generation failed", 500);
  }
}));