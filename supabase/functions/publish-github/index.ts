import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EXPERTS = [
  "Алексей Петров",
  "Мария Козлова",
  "Дмитрий Волков",
  "Елена Смирнова",
  "Иван Новиков",
];

// ── helpers ──

function transliterate(text: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
    з: "z", и: "i", й: "j", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
    ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return text
    .toLowerCase()
    .split("")
    .map((c) => map[c] ?? c)
    .join("")
    .replace(/[^a-z0-9\s-]/gi, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 80);
}

function parseH2Sections(content: string): { heading: string; text: string }[] {
  const lines = content.split("\n");
  const sections: { heading: string; text: string }[] = [];
  let cur = "";
  let buf: string[] = [];
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)/);
    if (m) {
      if (cur) sections.push({ heading: cur, text: buf.join(" ").slice(0, 200) });
      cur = m[1];
      buf = [];
    } else if (cur) {
      const c = line.replace(/^#+\s+/, "").replace(/[*_`]/g, "").trim();
      if (c) buf.push(c);
    }
  }
  if (cur) sections.push({ heading: cur, text: buf.join(" ").slice(0, 200) });
  return sections;
}

async function generateVisualPrompt(apiKey: string, context: string): Promise<string> {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [
        { role: "system", content: "Convert the context into a concise, vivid visual prompt in English for image generation. Focus on the concrete subject. Do NOT include any text in the image. Output ONLY the visual description." },
        { role: "user", content: context },
      ],
      max_tokens: 200,
    }),
  });
  if (!r.ok) throw new Error("Failed to generate visual prompt");
  const d = await r.json();
  return d.choices?.[0]?.message?.content?.trim() || "";
}

async function generateImage(falKey: string, prompt: string): Promise<string> {
  const r = await fetch("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, image_size: "landscape_16_9", num_images: 1, enable_safety_checker: true }),
  });
  if (!r.ok) throw new Error("Image generation failed");
  const d = await r.json();
  return d.images?.[0]?.url || "";
}

async function uploadImageToGitHub(
  token: string,
  repo: string,
  filePath: string,
  imageUrl: string,
  commitMsg: string
): Promise<string | null> {
  // Download image
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) return null;
  const buf = new Uint8Array(await imgRes.arrayBuffer());
  const b64 = btoa(String.fromCharCode(...buf));

  // Check if exists
  let sha: string | undefined;
  try {
    const check = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
    });
    if (check.ok) {
      const existing = await check.json();
      sha = existing.sha;
    }
  } catch { /* doesn't exist */ }

  const body: Record<string, unknown> = {
    message: commitMsg,
    content: b64,
    branch: "main",
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
    method: "PUT",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error("Failed to upload image to GitHub:", await res.text());
    return null;
  }
  return filePath;
}

async function checkFileExists(token: string, repo: string, path: string): Promise<boolean> {
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ── main ──

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { article_id, project_id, generate_images, image_count } = await req.json();
    if (!article_id || !project_id) {
      return new Response(JSON.stringify({ error: "Missing article_id or project_id" }), { status: 400, headers: corsHeaders });
    }

    // Get article
    const { data: article, error: artErr } = await supabase
      .from("articles")
      .select("title, content, meta_description, keywords")
      .eq("id", article_id)
      .eq("user_id", user.id)
      .single();
    if (artErr || !article) {
      return new Response(JSON.stringify({ error: "Article not found" }), { status: 404, headers: corsHeaders });
    }

    // Get GitHub config
    const { data: config } = await supabase.rpc("get_project_github_config", { p_project_id: project_id });
    if (!config || !config.configured) {
      return new Response(JSON.stringify({ error: "GitHub not configured for this project" }), { status: 400, headers: corsHeaders });
    }

    const { github_token, github_repo } = config;

    // Build slug
    const slug = transliterate(article.title || "untitled");
    const date = new Date().toISOString().split("T")[0];
    const filename = `src/content/blog/${slug}.md`;

    // Pick random author
    const author = EXPERTS[Math.floor(Math.random() * EXPERTS.length)];

    // Strip duplicate H1
    let cleanContent = (article.content || "").replace(/^#\s+.+\n?/m, "").trim();

    // ═══ IMAGE GENERATION ═══
    let heroImagePath = "";
    const generatedImagePaths: { heading: string; path: string }[] = [];

    if (generate_images) {
      // Read API keys from vault
      const { data: apiKeys } = await supabase
        .from("api_keys")
        .select("provider, api_key")
        .in("provider", ["fal_ai", "openrouter"]);

      const keyMap = Object.fromEntries((apiKeys || []).map((k: any) => [k.provider, k.api_key]));
      const falKey = keyMap["fal_ai"];
      const openrouterKey = keyMap["openrouter"] || Deno.env.get("OPENROUTER_API_KEY");

      if (falKey && openrouterKey) {
        const desiredCount = Math.min(image_count || 3, 5);

        // ── 1. Check if site header exists; if not, generate it ──
        const headerExists = await checkFileExists(github_token, github_repo, "public/images/header.webp");
        if (!headerExists) {
          try {
            console.log("[publish-github] Generating site header image...");
            const { data: proj } = await supabase.from("projects").select("name, domain").eq("id", project_id).single();
            const headerPrompt = await generateVisualPrompt(
              openrouterKey,
              `Website header banner for a professional SEO blog called "${proj?.name || "SEO Blog"}". Domain: ${proj?.domain || "blog"}. Modern, sleek, abstract technology background with subtle gradient, no text.`
            );
            const headerUrl = await generateImage(falKey, headerPrompt);
            if (headerUrl) {
              await uploadImageToGitHub(github_token, github_repo, "public/images/header.webp", headerUrl, "[SEO-Factor] Add site header image");
              console.log("[publish-github] Site header uploaded successfully");
            }
          } catch (e) {
            console.error("[publish-github] Header generation error:", e);
          }
        }

        // ── 2. Generate article hero image ──
        try {
          const heroPrompt = await generateVisualPrompt(
            openrouterKey,
            `Article cover for: "${article.title}". Professional, relevant, business photo style. No text.`
          );
          const heroUrl = await generateImage(falKey, heroPrompt);
          if (heroUrl) {
            const heroPath = `public/images/${slug}-hero.webp`;
            const uploaded = await uploadImageToGitHub(github_token, github_repo, heroPath, heroUrl, `[SEO-Factor] Hero image: ${article.title}`);
            if (uploaded) heroImagePath = `/images/${slug}-hero.webp`;
          }
        } catch (e) {
          console.error("[publish-github] Hero image error:", e);
        }

        // ── 3. Generate inline images for H2 sections ──
        if (desiredCount > 0) {
          const sections = parseH2Sections(cleanContent).filter(
            (s) => !s.heading.toLowerCase().includes("faq") && !s.heading.toLowerCase().includes("часто задаваемые")
          );
          const step = Math.max(1, Math.floor(sections.length / desiredCount));
          const selected: typeof sections = [];
          for (let i = 0; selected.length < desiredCount && i < sections.length; i += step) {
            selected.push(sections[i]);
          }

          for (const section of selected) {
            try {
              const prompt = await generateVisualPrompt(
                openrouterKey,
                `Section illustration for article "${article.title}", section: "${section.heading}". Content: ${section.text}. Directly illustrate the concept.`
              );
              const imgUrl = await generateImage(falKey, prompt);
              if (!imgUrl) continue;

              const imgSlug = transliterate(section.heading) || "section";
              const imgPath = `public/images/${slug}-${imgSlug}.webp`;
              const uploaded = await uploadImageToGitHub(github_token, github_repo, imgPath, imgUrl, `[SEO-Factor] Image: ${section.heading}`);
              if (uploaded) {
                generatedImagePaths.push({ heading: section.heading, path: `/images/${slug}-${imgSlug}.webp` });
              }
            } catch (e) {
              console.error(`[publish-github] Section image error for "${section.heading}":`, e);
            }
          }

          // Insert images into content after their respective H2
          for (const img of generatedImagePaths) {
            const h2Pattern = new RegExp(`(## ${img.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\n]*)`, "m");
            cleanContent = cleanContent.replace(h2Pattern, `$1\n\n![${img.heading}](${img.path})\n`);
          }
        }
      } else {
        console.warn("[publish-github] Missing fal_ai or openrouter keys, skipping image generation");
      }
    }

    // ═══ BUILD FRONTMATTER ═══
    const frontmatter = [
      "---",
      `title: "${(article.title || "").replace(/"/g, '\\"')}"`,
      `description: "${(article.meta_description || "").replace(/"/g, '\\"')}"`,
      `pubDate: "${date}"`,
      article.keywords?.length ? `keywords: [${article.keywords.map((k: string) => `"${k}"`).join(", ")}]` : "",
      `author: "${author}"`,
      heroImagePath ? `heroImage: "${heroImagePath}"` : "",
      "---",
      "",
    ].filter(Boolean).join("\n");

    const fileContent = frontmatter + cleanContent;
    const encodedContent = btoa(unescape(encodeURIComponent(fileContent)));

    // Check if file exists (for update)
    let sha: string | undefined;
    try {
      const checkRes = await fetch(`https://api.github.com/repos/${github_repo}/contents/${filename}`, {
        headers: { Authorization: `token ${github_token}`, Accept: "application/vnd.github.v3+json" },
      });
      if (checkRes.ok) {
        const existing = await checkRes.json();
        sha = existing.sha;
      }
    } catch { /* file doesn't exist */ }

    // Create/update file via GitHub API
    const body: Record<string, unknown> = {
      message: `[SEO-Factor] ${sha ? "Update" : "Publish"}: ${article.title || slug}`,
      content: encodedContent,
      branch: "main",
    };
    if (sha) body.sha = sha;

    const ghRes = await fetch(`https://api.github.com/repos/${github_repo}/contents/${filename}`, {
      method: "PUT",
      headers: {
        Authorization: `token ${github_token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!ghRes.ok) {
      const errBody = await ghRes.text();
      console.error("GitHub API error:", errBody);
      return new Response(JSON.stringify({ error: `GitHub API error: ${ghRes.status}` }), { status: 500, headers: corsHeaders });
    }

    const ghData = await ghRes.json();

    // Get project domain for URL
    const { data: project } = await supabase.from("projects").select("domain").eq("id", project_id).single();
    const siteUrl = project?.domain
      ? `https://${project.domain.replace(/^https?:\/\//, "")}/blog/${slug}`
      : ghData.content?.html_url || "";

    // Update article status
    await supabase
      .from("articles")
      .update({ status: "published", published_url: siteUrl })
      .eq("id", article_id);

    return new Response(
      JSON.stringify({
        success: true,
        url: siteUrl,
        github_url: ghData.content?.html_url,
        images_generated: generatedImagePaths.length + (heroImagePath ? 1 : 0),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("publish-github error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: corsHeaders });
  }
});
