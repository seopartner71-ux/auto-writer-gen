import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STYLE_PRESETS: Record<string, string> = {
  photorealistic:
    "Professional business photograph, high-end DSLR camera, natural lighting, shallow depth of field, crisp details, corporate business style, clean modern composition, realistic textures, no text or watermarks, editorial quality, 8k resolution",
};

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

// Parse H2 sections from markdown content
function parseH2Sections(content: string): { heading: string; text: string }[] {
  const lines = content.split("\n");
  const sections: { heading: string; text: string }[] = [];
  let currentHeading = "";
  let currentText: string[] = [];

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) {
      if (currentHeading) {
        sections.push({ heading: currentHeading, text: currentText.join(" ").slice(0, 200) });
      }
      currentHeading = h2Match[1];
      currentText = [];
    } else if (currentHeading) {
      const cleaned = line.replace(/^#+\s+/, "").replace(/[*_`]/g, "").trim();
      if (cleaned) currentText.push(cleaned);
    }
  }
  if (currentHeading) {
    sections.push({ heading: currentHeading, text: currentText.join(" ").slice(0, 200) });
  }
  return sections;
}

async function generateVisualPrompt(
  openRouterKey: string,
  context: string,
  stylePrompt: string
): Promise<string> {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert at creating image generation prompts. Convert the given context into a concise, vivid visual prompt in English. The image MUST directly illustrate the specific topic described in the context — not a generic stock photo. Focus on the concrete subject matter. Do NOT include any text/words in the image. Output ONLY the visual description, nothing else.`,
        },
        {
          role: "user",
          content: `Context: "${context}"\n\nStyle requirements: ${stylePrompt}\n\nGenerate a visual prompt:`,
        },
      ],
      max_tokens: 200,
    }),
  });
  if (!resp.ok) throw new Error("Failed to generate visual prompt");
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function generateImage(falKey: string, prompt: string): Promise<string> {
  const resp = await fetch("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_size: "landscape_16_9",
      num_images: 1,
      enable_safety_checker: true,
    }),
  });
  if (!resp.ok) throw new Error("Failed to generate image");
  const data = await resp.json();
  return data.images?.[0]?.url || "";
}

async function generateAltText(
  openRouterKey: string,
  title: string,
  keyword: string,
  visualPrompt: string
): Promise<string> {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
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
          content: `Article title: "${title}"\nKeyword: "${keyword}"\nImage description: "${visualPrompt}"`,
        },
      ],
      max_tokens: 60,
    }),
  });
  if (!resp.ok) return `Изображение для: ${title}`;
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || `Изображение для: ${title}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) throw new Error("No auth token");

    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    const userId = payload.sub;
    if (!userId) throw new Error("Invalid token");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Read API keys from admin vault
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

    const body = await req.json();
    const { title, summary, style, keyword, mode, content, max_images } = body;
    if (!title) throw new Error("Title is required");

    const stylePrompt = STYLE_PRESETS[style] || STYLE_PRESETS["modern-tech"];

    // Check plan
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

    // Count usage this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count } = await supabaseAdmin
      .from("usage_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", "pro_image_generation")
      .gte("created_at", startOfMonth.toISOString());

    const used = count || 0;

    // ===== MULTI-IMAGE MODE =====
    if (mode === "multi" && content) {
      const sections = parseH2Sections(content);
      if (sections.length === 0) {
        return new Response(
          JSON.stringify({ error: "Не найдены H2-секции в статье" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Pick evenly distributed sections, skip FAQ
      const nonFaqSections = sections.filter(s => 
        !s.heading.toLowerCase().includes("faq") && 
        !s.heading.toLowerCase().includes("часто задаваемые")
      );
      const pool = nonFaqSections.length > 0 ? nonFaqSections : sections;
      const desiredCount = Math.min(pool.length, max_images || 3);
      if (used + desiredCount > 100) {
        return new Response(
          JSON.stringify({ error: `Недостаточно лимита. Нужно: ${desiredCount}, осталось: ${100 - used}` }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Evenly spread across article
      const step = Math.max(1, Math.floor(pool.length / desiredCount));
      const selectedSections: typeof sections = [];
      for (let i = 0; selectedSections.length < desiredCount && i < pool.length; i += step) {
        selectedSections.push(pool[i]);
      }
      const images: { heading: string; url: string; alt: string; filename: string }[] = [];

      // Process sections sequentially to avoid rate limits
      for (const section of selectedSections) {
        const context = `Article topic: "${title}". This section is titled: "${section.heading}". Section content summary: ${section.text}. Generate an image that directly illustrates the concept described in the section heading "${section.heading}".`;
        const visualPrompt = await generateVisualPrompt(OPENROUTER_API_KEY, context, stylePrompt);
        console.log(`Visual prompt for "${section.heading}":`, visualPrompt);

        const imageUrl = await generateImage(FAL_AI_API_KEY, visualPrompt);
        if (!imageUrl) continue;

        // Download and upload
        const imgResp = await fetch(imageUrl);
        if (!imgResp.ok) continue;
        const imgBuffer = await imgResp.arrayBuffer();

        const seoFilename = transliterate(section.heading) || "section-image";
        const filePath = `${userId}/${seoFilename}-${Date.now()}.webp`;

        const { error: uploadError } = await supabaseAdmin.storage
          .from("article-images")
          .upload(filePath, imgBuffer, { contentType: "image/webp", upsert: true });

        if (uploadError) {
          console.error("Upload error:", uploadError);
          continue;
        }

        const { data: publicUrlData } = supabaseAdmin.storage
          .from("article-images")
          .getPublicUrl(filePath);

        const alt = await generateAltText(OPENROUTER_API_KEY, section.heading, keyword || title, visualPrompt);

        images.push({
          heading: section.heading,
          url: publicUrlData.publicUrl,
          alt,
          filename: `${seoFilename}.webp`,
        });

        // Log each generation
        await supabaseAdmin.from("usage_logs").insert({
          user_id: userId,
          action: "pro_image_generation",
          model_used: "fal-ai/flux-schnell",
          tokens_used: 0,
        });
      }

      return new Response(
        JSON.stringify({
          images,
          remaining: 100 - (used + images.length),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== SINGLE IMAGE MODE (original) =====
    if (used >= 100) {
      return new Response(
        JSON.stringify({ error: "Лимит Pro-генераций исчерпан (100/мес)" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const visualPrompt = await generateVisualPrompt(
      OPENROUTER_API_KEY,
      `Article title: "${title}"\nSummary: "${summary || title}"`,
      stylePrompt
    );
    console.log("Visual prompt:", visualPrompt);

    const imageUrl = await generateImage(FAL_AI_API_KEY, visualPrompt);
    if (!imageUrl) throw new Error("No image URL in response");

    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) throw new Error("Failed to download generated image");
    const imgBuffer = await imgResp.arrayBuffer();

    const seoFilename = transliterate(title) || "article-cover";
    const filePath = `${userId}/${seoFilename}-${Date.now()}.webp`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("article-images")
      .upload(filePath, imgBuffer, { contentType: "image/webp", upsert: true });

    if (uploadError) throw new Error("Failed to upload image");

    const { data: publicUrlData } = supabaseAdmin.storage
      .from("article-images")
      .getPublicUrl(filePath);

    const altText = await generateAltText(OPENROUTER_API_KEY, title, keyword || title, visualPrompt);

    await supabaseAdmin.from("usage_logs").insert({
      user_id: userId,
      action: "pro_image_generation",
      model_used: "fal-ai/flux-schnell",
      tokens_used: 0,
    });

    return new Response(
      JSON.stringify({
        url: publicUrlData.publicUrl,
        alt: altText,
        filename: `${seoFilename}.webp`,
        prompt: visualPrompt,
        remaining: 100 - (used + 1),
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
