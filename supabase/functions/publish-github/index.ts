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

async function searchUnsplashImage(query: string, unsplashKey: string): Promise<string | null> {
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape&content_filter=high`;
    const r = await fetch(url, {
      headers: { Authorization: `Client-ID ${unsplashKey}` },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const photo = d.results?.[0];
    if (!photo) return null;
    return `${photo.urls?.regular}&w=1200&h=600&fit=crop`;
  } catch {
    return null;
  }
}

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

/** Sanitize a YAML frontmatter string value: remove inner quotes, newlines */
function sanitizeYamlValue(val: string): string {
  return val
    .replace(/[\r\n]+/g, " ")  // no newlines
    .replace(/"/g, "'")         // double quotes -> single
    .replace(/\\/g, "")         // remove stray backslashes
    .trim();
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

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
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

// ── GitHub Trees API helpers for batch commits ──

async function getLatestCommitSha(token: string, repo: string, branch = "main"): Promise<{ commitSha: string; treeSha: string }> {
  const r = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/${branch}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!r.ok) throw new Error(`Failed to get ref: ${r.status}`);
  const ref = await r.json();
  const commitSha = ref.object.sha;

  const cr = await fetch(`https://api.github.com/repos/${repo}/git/commits/${commitSha}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!cr.ok) throw new Error(`Failed to get commit: ${cr.status}`);
  const commit = await cr.json();
  return { commitSha, treeSha: commit.tree.sha };
}

async function createBlob(token: string, repo: string, content: string, encoding: "utf-8" | "base64" = "utf-8"): Promise<string> {
  const r = await fetch(`https://api.github.com/repos/${repo}/git/blobs`, {
    method: "POST",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ content, encoding }),
  });
  if (!r.ok) throw new Error(`Failed to create blob: ${r.status}`);
  const d = await r.json();
  return d.sha;
}

async function createTree(token: string, repo: string, baseTreeSha: string, items: { path: string; sha: string; mode?: string }[]): Promise<string> {
  const tree = items.map((i) => ({ path: i.path, mode: i.mode || "100644", type: "blob" as const, sha: i.sha }));
  const r = await fetch(`https://api.github.com/repos/${repo}/git/trees`, {
    method: "POST",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree }),
  });
  if (!r.ok) throw new Error(`Failed to create tree: ${r.status} ${await r.text()}`);
  const d = await r.json();
  return d.sha;
}

async function createCommit(token: string, repo: string, message: string, treeSha: string, parentSha: string): Promise<string> {
  const r = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
    method: "POST",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
  if (!r.ok) throw new Error(`Failed to create commit: ${r.status}`);
  const d = await r.json();
  return d.sha;
}

async function updateRef(token: string, repo: string, commitSha: string, branch = "main"): Promise<void> {
  const r = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ sha: commitSha }),
  });
  if (!r.ok) throw new Error(`Failed to update ref: ${r.status}`);
}

// ── Build article content (frontmatter + body) ──

interface PreparedArticle {
  slug: string;
  filename: string;
  fileContent: string;
  articleId: string;
  title: string;
  imageBlobs: { path: string; base64: string }[];
}

async function prepareArticle(
  supabase: any,
  article: any,
  projectId: string,
  authorProfileIdOverride: string | null,
  generateImagesFlag: boolean,
  imageCount: number,
  githubToken: string,
  githubRepo: string,
): Promise<PreparedArticle> {
  const title = article.title || "Untitled";
  const slug = transliterate(title) || "untitled";
  const date = new Date().toISOString().split("T")[0];
  const filename = `src/content/blog/${slug}.md`;

  // Resolve author
  const { data: projInfo } = await supabase.from("projects").select("author_name, author_bio").eq("id", projectId).single();
  let author = projInfo?.author_name || EXPERTS[Math.floor(Math.random() * EXPERTS.length)];
  const profileId = authorProfileIdOverride || article.author_profile_id;
  if (profileId) {
    const { data: profile } = await supabase.from("author_profiles").select("name").eq("id", profileId).single();
    if (profile?.name) author = profile.name;
  }

  // Strip duplicate H1
  let cleanContent = (article.content || "").replace(/^#\s+.+\n?/m, "").trim();

  // Image blobs to include in the tree commit
  const imageBlobs: { path: string; base64: string }[] = [];
  let heroImagePath = "";
  const generatedImagePaths: { heading: string; path: string }[] = [];

  if (generateImagesFlag) {
    const { data: apiKeys } = await supabase
      .from("api_keys")
      .select("provider, api_key")
      .in("provider", ["fal_ai", "openrouter", "unsplash"]);

    const keyMap = Object.fromEntries((apiKeys || []).map((k: any) => [k.provider, k.api_key]));
    const falKey = keyMap["fal_ai"];
    const openrouterKey = keyMap["openrouter"] || Deno.env.get("OPENROUTER_API_KEY");
    const unsplashKey = keyMap["unsplash"] || "";

    if (falKey && openrouterKey) {
      const desiredCount = Math.min(imageCount || 3, 5);

      // Hero image
      try {
        const heroPrompt = await generateVisualPrompt(
          openrouterKey,
          `Article cover for: "${title}". Professional, relevant, business photo style. No text.`
        );
        const heroUrl = await generateImage(falKey, heroPrompt);
        if (heroUrl) {
          const heroPath = `public/images/${slug}-hero.webp`;
          const imgRes = await fetch(heroUrl);
          if (imgRes.ok) {
            const buf = new Uint8Array(await imgRes.arrayBuffer());
            imageBlobs.push({ path: heroPath, base64: uint8ToBase64(buf) });
            heroImagePath = `/images/${slug}-hero.webp`;
          }
        }
      } catch (e) {
        console.error("[publish-github] Hero image error:", e);
      }

      // Inline images
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
              `Section illustration for article "${title}", section: "${section.heading}". Content: ${section.text}. Directly illustrate the concept.`
            );
            const imgUrl = await generateImage(falKey, prompt);
            if (!imgUrl) continue;

            const imgSlug = transliterate(section.heading) || "section";
            const imgPath = `public/images/${slug}-${imgSlug}.webp`;
            const imgRes = await fetch(imgUrl);
            if (imgRes.ok) {
              const buf = new Uint8Array(await imgRes.arrayBuffer());
              imageBlobs.push({ path: imgPath, base64: uint8ToBase64(buf) });
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
      // Lovable AI or fallback
      const lovableKey = Deno.env.get("LOVABLE_API_KEY");
      if (lovableKey) {
        const generateLovableImage = async (prompt: string): Promise<string | null> => {
          try {
            const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash-image",
                messages: [{ role: "user", content: prompt }],
                modalities: ["image", "text"],
              }),
            });
            if (!r.ok) return null;
            const d = await r.json();
            const imgData = d.choices?.[0]?.message?.images?.[0]?.image_url?.url;
            if (!imgData) return null;
            return imgData.replace(/^data:image\/\w+;base64,/, "");
          } catch {
            return null;
          }
        };

        // Hero
        try {
          const heroBase64 = await generateLovableImage(
            `Generate a professional, high-quality photo for an article titled "${title}". The image should directly illustrate the topic. No text, no watermarks. Photorealistic business style.`
          );
          if (heroBase64) {
            const heroPath = `public/images/${slug}-hero.webp`;
            imageBlobs.push({ path: heroPath, base64: heroBase64 });
            heroImagePath = `/images/${slug}-hero.webp`;
          }
        } catch (e) { console.error("[publish-github] Hero via Lovable AI error:", e); }

        // Inline
        const desiredCount = Math.min(imageCount || 3, 5);
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
            const imgBase64 = await generateLovableImage(
              `Generate a professional illustration for an article section: "${section.heading}". Context: ${section.text}. Photorealistic, no text, no watermarks.`
            );
            if (!imgBase64) continue;
            const imgSlug = transliterate(section.heading) || "section";
            const imgPath = `public/images/${slug}-${imgSlug}.webp`;
            imageBlobs.push({ path: imgPath, base64: imgBase64 });
            generatedImagePaths.push({ heading: section.heading, path: `/images/${slug}-${imgSlug}.webp` });
          } catch (e) { console.error(`[publish-github] Section image via Lovable AI error:`, e); }
        }
        for (const img of generatedImagePaths) {
          const h2Pattern = new RegExp(`(## ${img.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\n]*)`, "m");
          cleanContent = cleanContent.replace(h2Pattern, `$1\n\n![${img.heading}](${img.path})\n`);
        }
      } else {
        // Unsplash / picsum fallback
        const keyword = (article.keywords?.[0] || title || "business").replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s]/g, "").substring(0, 50);
        if (unsplashKey) {
          const unsplashHero = await searchUnsplashImage(keyword, unsplashKey);
          if (unsplashHero) heroImagePath = unsplashHero;
        }
        if (!heroImagePath) heroImagePath = `https://picsum.photos/seed/${encodeURIComponent(slug)}/1600/900`;

        const sections = parseH2Sections(cleanContent).filter(
          (s) => !s.heading.toLowerCase().includes("faq") && !s.heading.toLowerCase().includes("часто задаваемые")
        );
        const desiredCount = Math.min(imageCount || 3, 5);
        const step2 = Math.max(1, Math.floor(sections.length / desiredCount));
        const selected2: typeof sections = [];
        for (let i = 0; selected2.length < desiredCount && i < sections.length; i += step2) {
          selected2.push(sections[i]);
        }
        for (const section of selected2) {
          const seedSlug = transliterate(section.heading) || "img";
          let inlineUrl = `https://picsum.photos/seed/${encodeURIComponent(seedSlug)}/800/450`;
          if (unsplashKey) {
            const u = await searchUnsplashImage(section.heading, unsplashKey);
            if (u) inlineUrl = u;
          }
          const imgMarkdown = `\n\n![${section.heading}](${inlineUrl})\n`;
          const h2Pattern = new RegExp(`(## ${section.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\n]*)`, "m");
          cleanContent = cleanContent.replace(h2Pattern, `$1${imgMarkdown}`);
        }
      }
    }
  } else {
    // Images OFF - add placeholders
    const { data: unsplashRow } = await supabase.from("api_keys").select("api_key").eq("provider", "unsplash").maybeSingle();
    const unsplashKey = unsplashRow?.api_key || "";
    const keyword = (article.keywords?.[0] || title || "business").replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s]/g, "").substring(0, 50);
    if (unsplashKey) {
      const unsplashHero = await searchUnsplashImage(keyword, unsplashKey);
      if (unsplashHero) heroImagePath = unsplashHero;
    }
    if (!heroImagePath) heroImagePath = `https://picsum.photos/seed/${encodeURIComponent(slug)}/1600/900`;

    const sections = parseH2Sections(cleanContent).filter(
      (s) => !s.heading.toLowerCase().includes("faq") && !s.heading.toLowerCase().includes("часто задаваемые")
    );
    const fallbackCount = Math.min(3, sections.length);
    const step3 = Math.max(1, Math.floor(sections.length / fallbackCount));
    const selected3: typeof sections = [];
    for (let i = 0; selected3.length < fallbackCount && i < sections.length; i += step3) {
      selected3.push(sections[i]);
    }
    for (const section of selected3) {
      const seedSlug = transliterate(section.heading) || "img";
      let inlineUrl = `https://picsum.photos/seed/${encodeURIComponent(seedSlug)}/800/450`;
      if (unsplashKey) {
        const u = await searchUnsplashImage(section.heading, unsplashKey);
        if (u) inlineUrl = u;
      }
      const imgMarkdown = `\n\n![${section.heading}](${inlineUrl})\n`;
      const h2Pattern = new RegExp(`(## ${section.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\n]*)`, "m");
      cleanContent = cleanContent.replace(h2Pattern, `$1${imgMarkdown}`);
    }
  }

  // ═══ BUILD FRONTMATTER (sanitized YAML) ═══
  const safeTitle = sanitizeYamlValue(title);
  const safeDesc = sanitizeYamlValue(article.meta_description || "");
  const safeAuthor = sanitizeYamlValue(author);

  const frontmatter = [
    "---",
    `title: "${safeTitle}"`,
    `description: "${safeDesc}"`,
    `pubDate: "${date}"`,
    article.keywords?.length ? `keywords: [${article.keywords.map((k: string) => `"${sanitizeYamlValue(k)}"`).join(", ")}]` : "",
    `author: "${safeAuthor}"`,
    heroImagePath ? `heroImage: "${heroImagePath}"` : "",
    "---",
    "",
  ].filter(Boolean).join("\n");

  const fileContent = frontmatter + cleanContent;

  return {
    slug,
    filename,
    fileContent,
    articleId: article.id,
    title,
    imageBlobs,
  };
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

    const body = await req.json();
    const { article_id, article_ids, project_id, generate_images, image_count, author_profile_id } = body;

    // ═══ BATCH MODE ═══
    if (article_ids && Array.isArray(article_ids) && article_ids.length > 0 && project_id) {
      console.log(`[publish-github] Batch mode: ${article_ids.length} articles`);

      // Validate
      if (article_ids.length > 100) {
        return new Response(JSON.stringify({ error: "Max 100 articles per batch" }), { status: 400, headers: corsHeaders });
      }

      // Get GitHub config
      const { data: config } = await supabase.rpc("get_project_github_config", { p_project_id: project_id });
      if (!config || !config.configured) {
        return new Response(JSON.stringify({ error: "GitHub not configured" }), { status: 400, headers: corsHeaders });
      }
      const { github_token, github_repo } = config;

      // Check if site header exists; if not, generate it (once)
      if (generate_images) {
        const { data: apiKeys } = await supabase
          .from("api_keys")
          .select("provider, api_key")
          .in("provider", ["fal_ai", "openrouter"]);
        const keyMap = Object.fromEntries((apiKeys || []).map((k: any) => [k.provider, k.api_key]));
        const falKey = keyMap["fal_ai"];
        const openrouterKey = keyMap["openrouter"] || Deno.env.get("OPENROUTER_API_KEY");

        if (falKey && openrouterKey) {
          const headerExists = await checkFileExists(github_token, github_repo, "public/images/header.webp");
          if (!headerExists) {
            try {
              const { data: proj } = await supabase.from("projects").select("name, domain").eq("id", project_id).single();
              const headerPrompt = await generateVisualPrompt(openrouterKey,
                `Website header banner for a professional SEO blog called "${proj?.name || "SEO Blog"}". Modern, sleek, abstract technology background with subtle gradient, no text.`
              );
              const headerUrl = await generateImage(falKey, headerPrompt);
              if (headerUrl) {
                // Upload header separately (one-time setup)
                const imgRes = await fetch(headerUrl);
                if (imgRes.ok) {
                  const buf = new Uint8Array(await imgRes.arrayBuffer());
                  const b64 = uint8ToBase64(buf);
                  const res = await fetch(`https://api.github.com/repos/${github_repo}/contents/public/images/header.webp`, {
                    method: "PUT",
                    headers: { Authorization: `token ${github_token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
                    body: JSON.stringify({ message: "[SEO-Module] Add site header image", content: b64, branch: "main" }),
                  });
                  if (!res.ok) console.error("[publish-github] Failed to upload header");
                }
              }
            } catch (e) {
              console.error("[publish-github] Header generation error:", e);
            }
          }
        }
      }

      // Fetch all articles
      const { data: articlesData, error: artErr } = await supabase
        .from("articles")
        .select("id, title, content, meta_description, keywords, author_profile_id")
        .in("id", article_ids)
        .eq("user_id", user.id);

      if (artErr || !articlesData?.length) {
        return new Response(JSON.stringify({ error: "No articles found" }), { status: 404, headers: corsHeaders });
      }

      // Filter out articles with empty titles or content
      const validArticles = articlesData.filter((a: any) => a.title?.trim() && a.content?.trim());
      if (validArticles.length === 0) {
        return new Response(JSON.stringify({ error: "All articles have empty titles or content" }), { status: 400, headers: corsHeaders });
      }

      // Prepare all articles
      const prepared: PreparedArticle[] = [];
      const errors: { articleId: string; error: string }[] = [];

      for (const art of validArticles) {
        try {
          const p = await prepareArticle(supabase, art, project_id, author_profile_id, generate_images, image_count || 3, github_token, github_repo);
          prepared.push(p);
        } catch (e: any) {
          errors.push({ articleId: art.id, error: e?.message || String(e) });
          console.error(`[publish-github] Error preparing article ${art.id}:`, e);
        }
      }

      if (prepared.length === 0) {
        return new Response(JSON.stringify({ error: "Failed to prepare any articles", errors }), { status: 500, headers: corsHeaders });
      }

      // Create single commit via Trees API
      const { commitSha, treeSha } = await getLatestCommitSha(github_token, github_repo);

      // Create blobs for all files
      const treeItems: { path: string; sha: string }[] = [];

      for (const p of prepared) {
        // MD file blob
        const mdBlob = await createBlob(github_token, github_repo, p.fileContent, "utf-8");
        treeItems.push({ path: p.filename, sha: mdBlob });

        // Image blobs
        for (const img of p.imageBlobs) {
          const imgBlobSha = await createBlob(github_token, github_repo, img.base64, "base64");
          treeItems.push({ path: img.path, sha: imgBlobSha });
        }
      }

      // Create tree, commit, and update ref
      const newTreeSha = await createTree(github_token, github_repo, treeSha, treeItems);
      const titles = prepared.map(p => p.title).slice(0, 3).join(", ");
      const commitMsg = `[SEO-Module] Batch publish: ${prepared.length} articles (${titles}${prepared.length > 3 ? "..." : ""})`;
      const newCommitSha = await createCommit(github_token, github_repo, commitMsg, newTreeSha, commitSha);
      await updateRef(github_token, github_repo, newCommitSha);

      // Update article statuses
      const { data: project } = await supabase.from("projects").select("domain").eq("id", project_id).single();
      const rawDomain = (project?.domain || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
      const domainBase = rawDomain.replace(/\/blog\/?$/, "");

      const results: { articleId: string; url: string }[] = [];
      for (const p of prepared) {
        const siteUrl = domainBase ? `https://${domainBase}/blog/${p.slug}` : "";
        await supabase.from("articles").update({ status: "published", published_url: siteUrl }).eq("id", p.articleId);
        results.push({ articleId: p.articleId, url: siteUrl });
      }

      return new Response(JSON.stringify({
        success: true,
        published: results.length,
        results,
        errors: errors.length > 0 ? errors : undefined,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ═══ SINGLE ARTICLE MODE (legacy) ═══
    if (!article_id || !project_id) {
      return new Response(JSON.stringify({ error: "Missing article_id or project_id" }), { status: 400, headers: corsHeaders });
    }

    // Get article
    const { data: article, error: artErr } = await supabase
      .from("articles")
      .select("id, title, content, meta_description, keywords, author_profile_id")
      .eq("id", article_id)
      .eq("user_id", user.id)
      .single();
    if (artErr || !article) {
      return new Response(JSON.stringify({ error: "Article not found" }), { status: 404, headers: corsHeaders });
    }

    // Validate title
    if (!article.title?.trim()) {
      return new Response(JSON.stringify({ error: "Article title is empty" }), { status: 400, headers: corsHeaders });
    }

    // Get GitHub config
    const { data: config } = await supabase.rpc("get_project_github_config", { p_project_id: project_id });
    if (!config || !config.configured) {
      return new Response(JSON.stringify({ error: "GitHub not configured for this project" }), { status: 400, headers: corsHeaders });
    }
    const { github_token, github_repo } = config;

    // Check site header (for single mode with image generation)
    if (generate_images) {
      const { data: apiKeys } = await supabase
        .from("api_keys")
        .select("provider, api_key")
        .in("provider", ["fal_ai", "openrouter"]);
      const keyMap = Object.fromEntries((apiKeys || []).map((k: any) => [k.provider, k.api_key]));
      const falKey = keyMap["fal_ai"];
      const openrouterKey = keyMap["openrouter"] || Deno.env.get("OPENROUTER_API_KEY");
      if (falKey && openrouterKey) {
        const headerExists = await checkFileExists(github_token, github_repo, "public/images/header.webp");
        if (!headerExists) {
          try {
            const { data: proj } = await supabase.from("projects").select("name, domain").eq("id", project_id).single();
            const headerPrompt = await generateVisualPrompt(openrouterKey,
              `Website header banner for a professional SEO blog called "${proj?.name || "SEO Blog"}". Modern, sleek, abstract technology background with subtle gradient, no text.`
            );
            const headerUrl = await generateImage(falKey, headerPrompt);
            if (headerUrl) {
              const imgRes = await fetch(headerUrl);
              if (imgRes.ok) {
                const buf = new Uint8Array(await imgRes.arrayBuffer());
                const b64 = uint8ToBase64(buf);
                await fetch(`https://api.github.com/repos/${github_repo}/contents/public/images/header.webp`, {
                  method: "PUT",
                  headers: { Authorization: `token ${github_token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
                  body: JSON.stringify({ message: "[SEO-Module] Add site header image", content: b64, branch: "main" }),
                });
              }
            }
          } catch (e) { console.error("[publish-github] Header generation error:", e); }
        }
      }
    }

    // Prepare the article
    const prepared = await prepareArticle(supabase, article, project_id, author_profile_id, generate_images, image_count || 3, github_token, github_repo);

    // For single mode, use Trees API too (single commit for md + images)
    const { commitSha, treeSha } = await getLatestCommitSha(github_token, github_repo);
    const treeItems: { path: string; sha: string }[] = [];

    // MD blob
    const mdBlob = await createBlob(github_token, github_repo, prepared.fileContent, "utf-8");
    treeItems.push({ path: prepared.filename, sha: mdBlob });

    // Image blobs
    for (const img of prepared.imageBlobs) {
      const imgBlobSha = await createBlob(github_token, github_repo, img.base64, "base64");
      treeItems.push({ path: img.path, sha: imgBlobSha });
    }

    const newTreeSha = await createTree(github_token, github_repo, treeSha, treeItems);
    const commitMsg = `[SEO-Module] ${article.status === "published" ? "Update" : "Publish"}: ${prepared.title}`;
    const newCommitSha = await createCommit(github_token, github_repo, commitMsg, newTreeSha, commitSha);
    await updateRef(github_token, github_repo, newCommitSha);

    // Get project domain for URL
    const { data: project } = await supabase.from("projects").select("domain").eq("id", project_id).single();
    const rawDomain = (project?.domain || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const domainBase = rawDomain.replace(/\/blog\/?$/, "");
    const siteUrl = domainBase ? `https://${domainBase}/blog/${prepared.slug}` : "";

    // Update article status
    await supabase.from("articles").update({ status: "published", published_url: siteUrl }).eq("id", article_id);

    return new Response(
      JSON.stringify({
        success: true,
        url: siteUrl,
        images_generated: prepared.imageBlobs.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("publish-github error:", err);
    return new Response(JSON.stringify({ error: "Internal error", details: String(err) }), { status: 500, headers: corsHeaders });
  }
});
