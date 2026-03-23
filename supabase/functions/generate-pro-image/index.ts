import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Style presets for prompt engineering
const STYLE_PRESETS: Record<string, string> = {
  "modern-tech":
    "Professional 3D render, minimalist design, clean geometric shapes, purple and cyan neon accent lighting, dark background, high resolution, 8k, studio lighting",
  photorealistic:
    "Professional photograph, high-end DSLR, natural studio lighting, shallow depth of field, crisp details, corporate style, clean composition, 8k resolution",
  "minimalist-vector":
    "Flat vector illustration, clean minimalist style, pastel color palette, simple geometric shapes, modern infographic style, white background, no shadows",
  "abstract-art":
    "Abstract digital art, flowing gradients, metaphorical imagery, vibrant colors, artistic composition, premium quality, conceptual visualization, 4k",
};

// Transliterate Cyrillic to Latin for SEO file naming
function transliterate(text: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
    з: "z", и: "i", й: "j", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
    ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
    я: "ya",
  };
  return text
    .toLowerCase()
    .split("")
    .map((c) => map[c] || c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) throw new Error("No auth token");

    // Decode JWT manually
    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    const userId = payload.sub;
    if (!userId) throw new Error("Invalid token");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Read API keys from admin vault (api_keys table)
    const { data: apiKeys, error: keysError } = await supabaseAdmin
      .from("api_keys")
      .select("provider, api_key")
      .in("provider", ["fal_ai", "openrouter"]);

    if (keysError) throw new Error("Failed to read API keys from vault");

    const keyMap = Object.fromEntries((apiKeys || []).map((k: any) => [k.provider, k.api_key]));
    const FAL_AI_API_KEY = keyMap["fal_ai"];
    if (!FAL_AI_API_KEY) throw new Error("Ключ Fal.ai не настроен в админ-панели (API Vault)");

    const OPENROUTER_API_KEY = keyMap["openrouter"] || Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) throw new Error("Ключ OpenRouter не настроен");

    const { title, summary, style, keyword } = await req.json();
    if (!title) throw new Error("Title is required");

    const stylePrompt = STYLE_PRESETS[style] || STYLE_PRESETS["modern-tech"];

    // Check plan & usage limits
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("plan")
      .eq("id", userId)
      .single();

    if (profile?.plan !== "pro") {
      return new Response(
        JSON.stringify({ error: "Pro Image Generation доступна только на тарифе PRO" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Count generations this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count } = await supabaseAdmin
      .from("usage_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", "pro_image_generation")
      .gte("created_at", startOfMonth.toISOString());

    if ((count || 0) >= 100) {
      return new Response(
        JSON.stringify({ error: "Лимит Pro-генераций исчерпан (100/мес)" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1: Generate visual prompt via OpenRouter
    const promptResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an expert at creating image generation prompts. Convert the given article title and summary into a concise, vivid visual prompt in English. The prompt should describe a single compelling image that represents the article's topic. Do NOT include any text in the image. Output ONLY the visual description, nothing else.`,
          },
          {
            role: "user",
            content: `Article title: "${title}"\nSummary: "${summary || title}"\n\nStyle requirements: ${stylePrompt}\n\nGenerate a visual prompt:`,
          },
        ],
        max_tokens: 200,
      }),
    });

    if (!promptResp.ok) {
      const errText = await promptResp.text();
      console.error("OpenRouter error:", promptResp.status, errText);
      throw new Error("Failed to generate visual prompt");
    }

    const promptData = await promptResp.json();
    const visualPrompt = promptData.choices?.[0]?.message?.content?.trim();
    if (!visualPrompt) throw new Error("Empty visual prompt");

    console.log("Visual prompt:", visualPrompt);

    // Step 2: Generate image via Fal.ai (Flux schnell)
    const falResp = await fetch("https://fal.run/fal-ai/flux/schnell", {
      method: "POST",
      headers: {
        Authorization: `Key ${FAL_AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: visualPrompt,
        image_size: "landscape_16_9",
        num_images: 1,
        enable_safety_checker: true,
      }),
    });

    if (!falResp.ok) {
      const errText = await falResp.text();
      console.error("Fal.ai error:", falResp.status, errText);
      throw new Error("Failed to generate image");
    }

    const falData = await falResp.json();
    const imageUrl = falData.images?.[0]?.url;
    if (!imageUrl) throw new Error("No image URL in response");

    // Step 3: Download image
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) throw new Error("Failed to download generated image");
    const imgBuffer = await imgResp.arrayBuffer();

    // Step 4: Generate SEO filename
    const seoFilename = transliterate(title) || "article-cover";
    const filePath = `${userId}/${seoFilename}-${Date.now()}.webp`;

    // Step 5: Upload to Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from("article-images")
      .upload(filePath, imgBuffer, {
        contentType: "image/webp",
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw new Error("Failed to upload image");
    }

    const { data: publicUrlData } = supabaseAdmin.storage
      .from("article-images")
      .getPublicUrl(filePath);

    const publicUrl = publicUrlData.publicUrl;

    // Step 6: Generate alt text via OpenRouter
    const altResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Generate a concise, SEO-optimized alt text for an image. The alt text must: 1) Be in the same language as the article title, 2) Contain the target keyword naturally, 3) Be 10-20 words. Output ONLY the alt text, nothing else.`,
          },
          {
            role: "user",
            content: `Article title: "${title}"\nKeyword: "${keyword || title}"\nImage description: "${visualPrompt}"`,
          },
        ],
        max_tokens: 60,
      }),
    });

    let altText = `Изображение для статьи: ${title}`;
    if (altResp.ok) {
      const altData = await altResp.json();
      const generatedAlt = altData.choices?.[0]?.message?.content?.trim();
      if (generatedAlt) altText = generatedAlt;
    }

    // Step 7: Log usage
    await supabaseAdmin.from("usage_logs").insert({
      user_id: userId,
      action: "pro_image_generation",
      model_used: "fal-ai/flux-schnell",
      tokens_used: 0,
    });

    return new Response(
      JSON.stringify({
        url: publicUrl,
        alt: altText,
        filename: `${seoFilename}.webp`,
        prompt: visualPrompt,
        remaining: 100 - ((count || 0) + 1),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-pro-image error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
