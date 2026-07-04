// Cloudflare Pages Direct Upload deployment
// Replaces the GitHub-based deploy-cloudflare flow for site-grid generation.
// Reverse-engineered wrangler flow:
//  1. Create empty Pages project (no source.type) -> "Direct Upload" mode
//  2. GET /pages/projects/{name}/upload-token -> JWT
//  3. POST /pages/assets/check-missing { hashes }   (with JWT)
//  4. POST /pages/assets/upload  [{key, value(base64), metadata}]   (with JWT)
//  5. POST /pages/assets/upsert-hashes { hashes }  (with JWT)
//  6. POST /accounts/{id}/pages/projects/{name}/deployments multipart with manifest = {path: hash}

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hash as blake3 } from "npm:blake3-wasm@2.1.5";
import { renderTemplate } from "./templates.ts";
import { ACCENT_COLORS, FONT_PAIRS, pickRandom, type TemplateType } from "./styles.ts";
import { renderDbTemplate, type DbTemplate } from "./dbTemplate.ts";
import { generateLandingContent, renderLandingHtml, pickSkin, ensureLandingImages, ensureSiteIcon, ensureUnsplashImages } from "./landingPage.ts";
import { headerHtml as chromeHeaderHtml, footerHtml as chromeFooterHtml, chromeStyles, build404Page, pickAuthor } from "./seoChrome.ts";
import { renderMagazineHome, renderMagazineArticle, magazineExtraCss } from "./magazinePage.ts";
import { renderNewsHome, renderNewsArticle, newsExtraCss } from "./newsPage.ts";
import { renderMinimalHome, renderMinimalArticle, minimalExtraCss } from "./minimalPage.ts";
import { renderDarkHome, renderDarkArticle, darkExtraCss } from "./darkPage.ts";
import { renderLocalHome, renderLocalArticle, localExtraCss } from "./localPage.ts";
import { renderExpertHome, renderExpertArticle, expertExtraCss } from "./expertPage.ts";
import { applyAntiFingerprint } from "./antiFingerprint.ts";
import { applyWordPressEmulation } from "./wordpressEmulation.ts";
import { validateHeadings, summarizeReport } from "./headingValidator.ts";
import { logCost } from "../_shared/costLogger.ts";
import { aiTranslateToPhotoQuery, fetchPexelsPhotos, fetchUnsplashPhotos, getUnsplashKey, hashImageContent, hashKey, normalizeImageKey } from "../_shared/unsplash.ts";
import { verifyAuth } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMPLATES: TemplateType[] = ["minimal", "magazine", "news", "landing"];

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".xml":  "application/xml; charset=utf-8",
  ".txt":  "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".php":  "text/html; charset=utf-8",
};
function mimeOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return MIME[path.slice(dot).toLowerCase()] || "application/octet-stream";
}
function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
}

function transliterate(text: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "j",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
    ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return text.toLowerCase().split("").map((c) => map[c] ?? c).join("");
}
function sanitizeProjectName(name: string): string {
  return transliterate(name)
    .replace(/[^a-z0-9\s-]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .substring(0, 50) || "site";
}

// Slugify any title to filesystem-safe slug
function slugify(text: string): string {
  return transliterate(text)
    .replace(/[^a-z0-9\s-]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .substring(0, 80) || "post";
}

// HTML-escape (also used inside markdown converter for inline text)
function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Lightweight markdown → HTML converter (handles headings, lists, paragraphs,
// bold/italic/code/links, blockquotes, fenced code blocks). No deps.
function markdownToHtml(md: string): string {
  if (!md) return "";
  // Pre-extract raw HTML blocks that must NOT be markdown-escaped:
  //  - <script type="application/ld+json">...</script>  (FAQ / Article schema)
  //  - <table>...</table>                               (raw HTML tables)
  // Replace each with an opaque placeholder, restore at the end.
  const rawBlocks: string[] = [];
  const stash = (re: RegExp, src: string): string => src.replace(re, (m) => {
    const idx = rawBlocks.push(m) - 1;
    return `\n\nLOVRAW${idx}LOVRAW\n\n`;
  });
  let work = String(md);
  work = stash(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, work);
  work = stash(/<table\b[\s\S]*?<\/table>/gi, work);

  // If content already looks like HTML (has tags), restore placeholders and return.
  if (/<\s*(h[1-6]|p|ul|ol|div|article|section)\b/i.test(work)) {
    return work.replace(/LOVRAW(\d+)LOVRAW/g, (_m, n) => rawBlocks[Number(n)] || "");
  }

  const lines = work.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let inList: "ul" | "ol" | null = null;
  let inCode = false;
  let codeBuf: string[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (inList) { out.push(`</${inList}>`); inList = null; }
  };

  function inline(text: string): string {
    let t = escHtml(text);
    // code spans
    t = t.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
    // images ![alt](url)
    t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, a, u) => `<img alt="${a}" src="${u}">`);
    // links [text](url)
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, l, u) => `<a href="${u}">${l}</a>`);
    // bold **x**
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // italic *x* (avoid bold collision)
    t = t.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
    return t;
  }

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // fenced code
    if (/^```/.test(line)) {
      if (inCode) {
        out.push(`<pre><code>${escHtml(codeBuf.join("\n"))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushPara(); flushList();
        inCode = true;
      }
      i++; continue;
    }
    if (inCode) { codeBuf.push(raw); i++; continue; }

    // blank line
    if (!line.trim()) { flushPara(); flushList(); i++; continue; }

    // GFM table: header row | --- | --- | ... followed by body rows.
    // Detect when current line has at least one "|" AND next line is a
    // separator like "| --- | :---: | ---: |" (dashes optionally with colons).
    if (line.includes("|") && i + 1 < lines.length) {
      const sep = lines[i + 1].trim();
      const isSep = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(sep);
      if (isSep) {
        flushPara(); flushList();
        const splitRow = (s: string): string[] => {
          let r = s.trim();
          if (r.startsWith("|")) r = r.slice(1);
          if (r.endsWith("|"))   r = r.slice(0, -1);
          return r.split("|").map((c) => c.trim());
        };
        const headers = splitRow(line);
        i += 2; // skip header + separator
        const rows: string[][] = [];
        while (i < lines.length) {
          const r = lines[i].trim();
          if (!r || !r.includes("|")) break;
          rows.push(splitRow(lines[i]));
          i++;
        }
        const thead = `<thead><tr>${headers.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead>`;
        const tbody = `<tbody>${rows.map((r) =>
          `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`
        ).join("")}</tbody>`;
        out.push(`<table class="md-table">${thead}${tbody}</table>`);
        continue;
      }
    }

    // headings
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      flushPara(); flushList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++; continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      flushPara(); flushList();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // ordered list
    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      flushPara();
      if (inList !== "ol") { flushList(); out.push("<ol>"); inList = "ol"; }
      out.push(`<li>${inline(ol[1])}</li>`);
      i++; continue;
    }
    // unordered list
    const ul = line.match(/^[-*+]\s+(.+)$/);
    if (ul) {
      flushPara();
      if (inList !== "ul") { flushList(); out.push("<ul>"); inList = "ul"; }
      out.push(`<li>${inline(ul[1])}</li>`);
      i++; continue;
    }

    // paragraph accumulator
    flushList();
    para.push(line);
    i++;
  }
  flushPara(); flushList();
  let html = out.join("\n");
  // Detect "fake" tables: consecutive paragraph lines that look like
  // multi-column rows separated by 2+ spaces or tabs, with a consistent
  // column count (>=2) over 2+ rows. Convert them to a real <table>.
  html = convertSpacedTables(html);
  // Restore raw HTML blocks (JSON-LD, raw tables).
  html = html.replace(/LOVRAW(\d+)LOVRAW/g, (_m, n) => rawBlocks[Number(n)] || "");
  return html;
}

// Detect runs of <p>...</p> blocks where each paragraph contains 2+ columns
// separated by 2+ spaces or tabs, and convert them to a single <table>.
function convertSpacedTables(html: string): string {
  const splitRow = (s: string): string[] =>
    s.split(/\t|\s{2,}/).map((c) => c.trim()).filter(Boolean);
  // Match runs of 3+ <p> blocks (header + 2 data rows minimum).
  return html.replace(/(?:<p>[^<]*<\/p>\s*){3,}/g, (block) => {
    const paras = Array.from(block.matchAll(/<p>([^<]*)<\/p>/g)).map((m) => m[1]);
    const rows = paras.map(splitRow);
    const colCount = rows[0].length;
    if (colCount < 2) return block;
    // Require all rows to share the column count (allow last row off by one).
    const consistent = rows.every((r) => r.length === colCount);
    if (!consistent) return block;
    const [header, ...body] = rows;
    const thead = `<thead><tr>${header.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;
    const tbody = `<tbody>${body.map((r) =>
      `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`
    ).join("")}</tbody>`;
    return `<table class="md-table">${thead}${tbody}</table>`;
  });
}

function plainExcerpt(md: string, maxLen = 180): string {
  const stripped = (md || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#>*_`~\-]+/g, " ")
    .replace(/\!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > maxLen ? stripped.slice(0, maxLen - 1) + "…" : stripped;
}

// Wrangler hash: blake3(base64(content) + extension).slice(0, 32)
function hashFile(content: string, path: string): string {
  const bytes = new TextEncoder().encode(content);
  // base64 encode
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const ext = extOf(path);
  const input = new TextEncoder().encode(b64 + ext);
  const out = blake3(input); // Uint8Array
  return Array.from(out).map((b: number) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function toBase64(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function tryParseJson(res: Response): Promise<{ ok: boolean; data: any; status: number; text: string }> {
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }
  return { ok: res.ok, data, status: res.status, text };
}

function cfErr(payload: any, fallback: string, status: number): string {
  if (payload?.errors?.length) return payload.errors.map((e: any) => e.message).join("; ");
  if (payload?.message) return String(payload.message);
  return fallback.trim() || `HTTP ${status}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    console.log("[deploy-cloudflare-direct] started");
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    console.log("[deploy-cloudflare-direct] env SUPABASE_URL:", supabaseUrl ? "set" : "missing",
                "SUPABASE_ANON_KEY:", supabaseKey ? "set" : "missing",
                "SERVICE_ROLE:", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ? "set" : "missing");
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const __auth = await verifyAuth(req);
    if (__auth instanceof Response) return __auth;
    const user = { id: __auth.userId };
    console.log("[deploy-cloudflare-direct] auth user:", user.id);

    const body = await req.json();
    console.log("[deploy-cloudflare-direct] body:", JSON.stringify(body));
    const projectId: string = body.project_id;
    const generateImages: boolean = body.generate_images !== false; // default true
    const imageCount: number = Math.max(1, Math.min(10, Number(body.image_count) || 1));
    // build_only mode: render the site files and short-circuit BEFORE any
    // Cloudflare API calls. Used by deploy-github-pages (and possibly other
    // hosting backends) to reuse the same site renderer without deploying
    // to Cloudflare.
    const buildOnly: boolean = body.build_only === true;
    const domainOverride: string | undefined = typeof body.domain_override === "string" && body.domain_override.trim()
      ? body.domain_override.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "")
      : undefined;
    console.log("[deploy-cloudflare-direct] image opts:", { generateImages, imageCount, buildOnly, domainOverride });
    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing project_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try to load active DB templates (preferred); fall back to built-in renderer.
    const { data: dbTemplates } = await supabaseAdmin
      .from("pbn_templates")
      .select("template_key, name, html_structure, css_styles, font_pairs")
      .eq("is_active", true);
    const activeDb: DbTemplate[] = (dbTemplates || []) as any;
    console.log("[deploy-cloudflare-direct] db templates:", activeDb.length);

    // Load existing visual identity for this project so subsequent "Redeploy"
    // calls keep the exact same template/accent/font (only content changes).
    const { data: lockedRow } = await supabaseAdmin
      .from("projects")
      .select("template_key, template_type, accent_color, template_font_pair")
      .eq("id", projectId)
      .maybeSingle();
    const lockedKey: string | null =
      (lockedRow?.template_key as string | null) ||
      (lockedRow?.template_type as string | null) ||
      null;
    const lockedAccent: string | null = (lockedRow?.accent_color as string | null) || null;
    const lockedFontPair: [string, string] | null = (() => {
      const raw = lockedRow?.template_font_pair as string | null | undefined;
      if (!raw || typeof raw !== "string") return null;
      const parts = raw.split("|");
      return parts.length === 2 ? [parts[0], parts[1]] as [string, string] : null;
    })();

    let dbTpl: DbTemplate | null = null;
    if (activeDb.length > 0) {
      // Priority: locked -> explicit body -> random (only on first deploy).
      if (lockedKey) {
        dbTpl = activeDb.find((t) => t.template_key === lockedKey) || null;
      }
      if (!dbTpl && body.template_key) {
        dbTpl = activeDb.find((t) => t.template_key === body.template_key) || null;
      }
      if (!dbTpl && body.template) {
        dbTpl = activeDb.find((t) => t.template_key === body.template) || null;
      }
      if (!dbTpl && !lockedKey) dbTpl = pickRandom(activeDb);
    }

    // Built-in fallback values — also locked once chosen.
    const builtinTemplate: TemplateType = (() => {
      if (lockedKey && TEMPLATES.includes(lockedKey as TemplateType)) return lockedKey as TemplateType;
      if (TEMPLATES.includes(body.template)) return body.template;
      return pickRandom(TEMPLATES);
    })();
    const accent: string = lockedAccent || body.accent_color || pickRandom(ACCENT_COLORS);
    const fontPair: [string, string] = (() => {
      if (lockedFontPair) return lockedFontPair;
      if (Array.isArray(body.font_pair) && body.font_pair.length === 2) return body.font_pair;
      if (dbTpl && Array.isArray(dbTpl.font_pairs) && dbTpl.font_pairs.length > 0) {
        return pickRandom(dbTpl.font_pairs as [string, string][]);
      }
      return pickRandom(FONT_PAIRS[builtinTemplate]);
    })();
    const templateKey = dbTpl?.template_key || builtinTemplate;
    console.log("[deploy-cloudflare-direct] template:", templateKey,
                "locked:", !!lockedKey, "source:", dbTpl ? "db" : "builtin",
                "accent:", accent, "fontPair:", fontPair);

    const { data: project, error: projErr } = await supabaseAdmin
      .from("projects")
      .select("name, domain, custom_domain, site_name, site_about, hosting_platform, language, company_name, company_address, company_phone, company_email, founding_year, team_members, site_contacts, site_privacy, site_terms, og_image_url, footer_link, injection_links, legal_address, work_hours, juridical_inn, whatsapp_url, telegram_url, vk_url, youtube_url, instagram_url, clients_count_text, authors, business_pages, homepage_style, indexnow_key, google_verification_file, google_verification")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();
    console.log("[deploy-cloudflare-direct] project lookup:", project ? "found" : "missing", "err:", projErr?.message || "none");
    if (projErr) {
      return new Response(JSON.stringify({ error: "Project lookup failed", message: projErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Safety net for first site generation: the UI calls seed-starter-articles
    // before deploy, but if that request times out or is skipped, never publish
    // an empty site. Ensure at least 5 starter posts exist before rendering.
    if (body.skip_starter_seed !== true) {
      const { count: existingCount, error: countErr } = await supabaseAdmin
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .in("status", ["completed", "published"]);

      if (countErr) {
        console.warn("[deploy-cloudflare-direct] starter article count failed:", countErr.message);
      } else if ((existingCount || 0) < 5) {
        const starterCount = Math.max(5, Math.min(10, Number(body.starter_article_count) || 5));
        console.log("[deploy-cloudflare-direct] seeding starter articles:", starterCount, "existing:", existingCount || 0);
        const seedRes = await fetch(`${supabaseUrl}/functions/v1/seed-starter-articles`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
            "x-queue-user-id": user.id,
          },
          body: JSON.stringify({
            project_id: projectId,
            topic: body.topic || project.site_about || project.name,
            count: starterCount,
            language: project.language,
          }),
        });
        const seedJson = await seedRes.json().catch(() => ({}));
        console.log("[deploy-cloudflare-direct] starter seed result:", seedRes.status, JSON.stringify(seedJson));
        if (!seedRes.ok || Number(seedJson?.created_count || 0) === 0) {
          return new Response(JSON.stringify({
            error: "Starter articles failed",
            message: seedJson?.error || "Не удалось добавить стартовые статьи",
          }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Strip HTML tags and collapse whitespace — topic/about must be plain text,
    // otherwise raw <p> tags leak into hero <h1> and meta tags.
    const stripHtml = (s: string): string =>
      String(s || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, " ")
        .trim();
    // Topic must be a SHORT niche keyword, not a brand/domain and not a long
    // welcome paragraph. Prefer explicit body.topic > site_about > article
    // titles; project.name is only a last resort because it is often the brand.
    const firstClause = (s: string) => stripHtml(s).split(/[.!?\n«»]/)[0]?.trim() || "";
    const articleTopicSeed = (await supabaseAdmin
      .from("articles")
      .select("title, keywords")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .in("status", ["completed", "published"])
      .order("created_at", { ascending: false })
      .limit(3)
    ).data || [];
    const firstArticleKeywords = articleTopicSeed
      .flatMap((a: any) => Array.isArray(a?.keywords) ? a.keywords : [])
      .map((k: any) => String(k || "").trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" ");
    const firstArticleTitles = articleTopicSeed.map((a: any) => String(a?.title || "").trim()).filter(Boolean).join(" ");
    const rawTopic = body.topic
      || firstClause(project.site_about || "")
      || firstArticleKeywords
      || firstArticleTitles
      || project.name
      || "блог";
    const rawSiteName = body.site_name || project.site_name || project.name || "Сайт";
    const rawSiteAbout = body.site_about || project.site_about || `Блог про ${rawTopic}`;
    // Hard-cap topic at 60 chars so hero h1 like "{site} — решения по теме «{topic}»" stays compact.
    const topicRaw = stripHtml(rawTopic);
    const topic: string = (topicRaw.length > 60
      ? (topicRaw.slice(0, 60).split(" ").slice(0, -1).join(" ") || topicRaw.slice(0, 60))
      : topicRaw) || "блог";
    const siteName: string = stripHtml(rawSiteName).slice(0, 120) || "Сайт";
    const siteAbout: string = stripHtml(rawSiteAbout).slice(0, 600) || `Блог про ${topic}`;
    console.log("[deploy-cloudflare-direct] siteName:", siteName, "topic:", topic);
    const sitePhotoQuery = await aiTranslateToPhotoQuery(`${topic} ${firstArticleKeywords} ${firstArticleTitles}`.slice(0, 220));
    console.log("[deploy-cloudflare-direct] sitePhotoQuery:", sitePhotoQuery);
    const isAutoGeneratedStarterCover = (url: string): boolean => {
      try {
        const host = new URL(String(url || "")).hostname.toLowerCase();
        return host.includes("fal.media") || host.includes("fal.run") || host.includes("fal.ai");
      } catch {
        return false;
      }
    };

    // Fetch real articles for this project (completed or published, with content)
    const { data: articles, error: articlesErr } = await supabase
      .from("articles")
      .select("id, title, content, meta_description, status, created_at, featured_image_url")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .in("status", ["completed", "published"])
      .not("content", "is", null)
      .order("created_at", { ascending: false })
      .limit(100);
    console.log("[deploy-cloudflare-direct] articles fetched:", articles?.length ?? 0,
                "err:", articlesErr?.message || "none");
    // ---- Backdating (deterministic from projectId+articleId) ----------------
    // Each post gets its OWN published date 3-18 months in the past with a
    // 3-14 day cadence between consecutive posts (newest first), stable per
    // (project, article) so re-deploys keep the same timeline.
    const now = Date.now();
    function fnv1a32(s: string): number {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      return h >>> 0;
    }
    const usedSlugs = new Set<string>();
    const totalArticles = (articles || []).length;
    // Newest post starts at 3 months ago, then we walk older with a
    // deterministic 3-14 day gap per article. If we'd exceed 18 months
    // we clamp the gap so the oldest post stays within the window.
    const MIN_AGE_DAYS = 90;   // ~3 months
    const MAX_AGE_DAYS = 540;  // ~18 months
    const ONE_DAY = 24 * 3600 * 1000;
    let cursorMs = now - MIN_AGE_DAYS * ONE_DAY;
    const publishedDates: Date[] = [];
    for (let idx = 0; idx < totalArticles; idx++) {
      const a: any = (articles || [])[idx];
      const seed = `${projectId}:${a?.id || idx}`;
      const h = fnv1a32(seed);
      // Gap 3..14 days between consecutive posts.
      const gapDays = idx === 0 ? 0 : (3 + ((h >>> 0) % 12));
      // Time of day 8..21h (working blog hours).
      const hour = 8 + ((h >>> 8) % 14);
      const minute = (h >>> 16) % 60;
      cursorMs -= gapDays * ONE_DAY;
      // Clamp to the 18-month window: if we ran out of room, redistribute.
      const oldestAllowedMs = now - MAX_AGE_DAYS * ONE_DAY;
      if (cursorMs < oldestAllowedMs) cursorMs = oldestAllowedMs;
      const d = new Date(cursorMs);
      // Skip weekends to look like an editorial schedule.
      const day = d.getDay();
      if (day === 0) d.setDate(d.getDate() - 2);
      else if (day === 6) d.setDate(d.getDate() - 1);
      d.setHours(hour, minute, 0, 0);
      publishedDates.push(d);
    }
    // Provide a `modifiedAt` slightly later than published (1..30 days).
    function modifiedFor(d: Date, seed: string): Date {
      const h = fnv1a32(seed + ":mod");
      const offsetDays = 1 + (h % 30);
      const m = new Date(d.getTime() + offsetDays * ONE_DAY);
      // Don't go past "now".
      return m.getTime() > now ? new Date(now) : m;
    }
    const posts = (articles || []).map((a: any, idx: number) => {
      const baseSlug = slugify(a.title || a.id);
      let slug = baseSlug;
      let n = 2;
      while (usedSlugs.has(slug)) { slug = `${baseSlug}-${n++}`; }
      usedSlugs.add(slug);
      const contentHtml = markdownToHtml(a.content || "");
      const excerpt = a.meta_description || plainExcerpt(a.content || "", 180);
      const pubDate = publishedDates[idx];
      const modDate = modifiedFor(pubDate, `${projectId}:${a?.id || idx}`);
      return {
        title: a.title || "Без названия",
        slug, contentHtml, excerpt,
        publishedAt: pubDate.toISOString(),
        modifiedAt: modDate.toISOString(),
        featuredImageUrl: a.featured_image_url || undefined,
      };
    });
    console.log("[deploy-cloudflare-direct] posts prepared:", posts.length);

    // Ensure each post has a topical cover photo. If the article already has a
    // user-set featured_image_url, keep it. Otherwise translate the title to
    // an English visual query and pull a matching photo from Pexels (fallback
    // Unsplash). Results are cached in `site_image_cache` per post slug so
    // re-deploys are stable.
    try {
      const pexelsKey = (Deno.env.get("PEXELS_API_KEY") || "").trim();
      const unsplashKey = await getUnsplashKey(supabaseAdmin);
      if (!generateImages) {
        console.log("[post-cover] skipped — generate_images=false");
      } else if (pexelsKey || unsplashKey) {
        // Load existing cached covers for this project's posts.
        const slotKeys = posts.map((p: any) => `post_cover_${p.slug}`);
        const { data: cached } = await supabaseAdmin
          .from("site_image_cache")
          .select("slot, image_url, prompt")
          .eq("project_id", projectId)
          .in("slot", slotKeys);
        const cacheMap = new Map<string, { url: string; query: string }>();
        for (const row of (cached || [])) {
          let q = "";
          try { q = String(JSON.parse(String(row.prompt || "{}"))?.query || ""); } catch { /* ignore */ }
          if (row.image_url) cacheMap.set(String(row.slot), { url: String(row.image_url), query: q });
        }
        const usedHashes = new Set<string>();
        const identityFor = (ph: { url?: string; photoUrl?: string }) => normalizeImageKey(String(ph?.url || ""), String(ph?.photoUrl || ""));
        const markUsed = async (ph: { url?: string; photoUrl?: string }) => {
          const k = identityFor(ph);
          if (k) usedHashes.add(hashKey(k));
          const contentHash = await hashImageContent(String(ph?.url || ""));
          if (contentHash) usedHashes.add(`content:${contentHash}`);
        };
        const isUsed = async (ph: { url?: string; photoUrl?: string }) => {
          const k = identityFor(ph);
          if (k && usedHashes.has(hashKey(k))) return true;
          const contentHash = await hashImageContent(String(ph?.url || ""));
          return contentHash ? usedHashes.has(`content:${contentHash}`) : false;
        };
        // Process posts sequentially to preserve cross-post dedup.
        for (const p of posts as any[]) {
          const hasHttpCover = p.featuredImageUrl && /^https?:\/\//.test(p.featuredImageUrl);
          const shouldReplaceAutoCover = hasHttpCover && isAutoGeneratedStarterCover(p.featuredImageUrl);
          if (hasHttpCover && !shouldReplaceAutoCover) {
            // keep user/external cover, but still fetch extras for inline if needed
            await markUsed({ url: p.featuredImageUrl });
          }
          const slot = `post_cover_${p.slug}`;
          const query = await aiTranslateToPhotoQuery(`${topic} ${p.title || ""}`.slice(0, 180));
          // Fetch one cover plus the requested number of inline images.
          const wantedPhotoCount = imageCount + 1;
          // Fetch a larger pool so we can skip already-used photos.
          const poolSize = Math.max(wantedPhotoCount * 4, 12);
          let pool = pexelsKey ? await fetchPexelsPhotos(pexelsKey, query, poolSize) : [];
          if (pool.length < poolSize && unsplashKey) {
            const extra = await fetchUnsplashPhotos(unsplashKey, query, poolSize - pool.length);
            pool = [...pool, ...extra];
          }
          if (pool.length === 0) continue;
          // Prefer unused photos; fall back to the full pool if we exhausted it.
          // Dedup pool itself first (same photo can appear from Pexels+Unsplash
          // or as different sizes within a single provider response).
          const seenInPool = new Set<string>();
          const dedupedPool = [] as typeof pool;
          for (const ph of pool) {
            const semanticHash = hashKey(identityFor(ph));
            const contentHash = await hashImageContent(ph.url);
            const keys = [semanticHash, contentHash ? `content:${contentHash}` : ""].filter(Boolean);
            if (keys.length === 0 || keys.some((k) => seenInPool.has(k))) continue;
            keys.forEach((k) => seenInPool.add(k));
            dedupedPool.push(ph);
          }
          const fresh = [] as typeof pool;
          const reused = [] as typeof pool;
          for (const ph of dedupedPool) (await isUsed(ph) ? reused : fresh).push(ph);
          const photos = (fresh.length >= wantedPhotoCount ? fresh : [...fresh, ...reused]).slice(0, wantedPhotoCount);
          const cover = photos[0];
          for (const ph of photos) await markUsed(ph);
          const cachedRow = cacheMap.get(slot);
          if (!hasHttpCover || shouldReplaceAutoCover) {
            if (cachedRow && cachedRow.query === query && !(await isUsed({ url: cachedRow.url }))) {
              p.featuredImageUrl = cachedRow.url;
              await markUsed({ url: cachedRow.url });
            } else {
              p.featuredImageUrl = cover.url;
              p.featuredImageAlt = cover.alt || "";
            }
          }
          // Extras for inline injection (beyond the cover).
          p.extraPhotos = photos.slice(1).map((ph) => ({ url: ph.url, alt: ph.alt || "" }));
          try {
            await supabaseAdmin.from("site_image_cache").upsert({
              project_id: projectId,
              slot,
              prompt: JSON.stringify({
                query,
                authorName: cover.authorName,
                authorUrl: cover.authorUrl,
                photoUrl: cover.photoUrl,
                alt: cover.alt,
              }).slice(0, 1000),
              image_url: cover.url,
              source: "pexels",
            }, { onConflict: "project_id,slot" });
          } catch (e: any) {
            console.warn("[post-cover] cache write failed:", slot, e?.message);
          }
        }
      } else {
        console.warn("[post-cover] no PEXELS_API_KEY and no unsplash key — using picsum fallback");
      }
    } catch (e: any) {
      console.warn("[post-cover] enrichment failed:", e?.message);
    }

    // Inject up to imageCount topical inline photos into each article body.
    // Cover image is rendered by the article template and must not be duplicated.
    try {
     if (!generateImages) {
       console.log("[post-inline-image] skipped — generate_images=false");
     } else {
      const escAttr = (s: string) =>
        String(s || "")
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      const escText = (s: string) =>
        String(s || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      for (const p of posts as any[]) {
        if (!p.contentHtml) continue;
        if (/<img[^>]+src=/i.test(p.contentHtml)) continue; // already has an image
        const titleClean = String(p.title || "").trim();
        const photoAlt = String(p.featuredImageAlt || "").trim();
        const buildFigure = (imgUrl: string, altOverride?: string, withCaption = true) => {
          const altText = altOverride || titleClean || photoAlt || "Иллюстрация к статье";
          const captionRaw = withCaption && titleClean.length > 0 ? titleClean : "";
          const bodyText = String(p.contentHtml || "").replace(/<[^>]+>/g, " ");
          const captionDup = captionRaw && bodyText.toLowerCase().includes(captionRaw.toLowerCase());
          const captionHtml = captionRaw && !captionDup
            ? `<figcaption style="margin-top:.5rem;font-size:.875rem;color:#6b7280;font-style:italic">${escText(captionRaw)}</figcaption>`
            : "";
          return `\n<figure class="article-inline-image" style="margin:1.5rem 0;text-align:center"><img src="${escAttr(imgUrl)}" alt="${escAttr(altText)}" loading="lazy" decoding="async" style="max-width:100%;height:auto;border-radius:12px" />${captionHtml}</figure>\n`;
        };
        // Build inline images, capped at imageCount. Do not inject the featured
        // image here: article templates already render it as a hero/cover, so
        // adding it again caused the visible duplicate image.
        const inlineImgs: { url: string; alt: string }[] = [];
        for (const ex of (p.extraPhotos || [])) {
          if (inlineImgs.length >= imageCount) break;
          inlineImgs.push(ex);
        }
        if (inlineImgs.length === 0) continue;
        // Find all </h2> insertion points.
        const h2Idxs: number[] = [];
        const h2Re = /<\/h2>/gi;
        let m: RegExpExecArray | null;
        while ((m = h2Re.exec(p.contentHtml)) !== null) h2Idxs.push(m.index + m[0].length);
        // If no h2's, fall back to first </p>.
        if (h2Idxs.length === 0) {
          const pm = p.contentHtml.match(/<\/p>/i);
          if (pm && typeof pm.index === "number") h2Idxs.push(pm.index + pm[0].length);
        }
        // If still nothing, prepend everything.
        if (h2Idxs.length === 0) {
          p.contentHtml = inlineImgs.map((im, i) => buildFigure(im.url, im.alt, i === 0)).join("") + p.contentHtml;
          continue;
        }
        // Distribute images across available h2 points. For a single image
        // we place it in the MIDDLE of the article (middle </h2>). For more
        // than one, we centre them around the middle so they don't pile up
        // at the top.
        const slots = inlineImgs.slice(0, Math.min(inlineImgs.length, h2Idxs.length));
        const insertions: { idx: number; html: string }[] = [];
        if (slots.length === 1) {
          const mid = Math.floor(h2Idxs.length / 2);
          insertions.push({ idx: h2Idxs[mid], html: buildFigure(slots[0].url, slots[0].alt, true) });
        } else {
          // Spread evenly across the middle 80% of the article.
          const startFrac = 0.1, endFrac = 0.9;
          for (let i = 0; i < slots.length; i++) {
            const frac = startFrac + ((endFrac - startFrac) * (i + 0.5)) / slots.length;
            const h2Idx = h2Idxs[Math.min(h2Idxs.length - 1, Math.floor(frac * h2Idxs.length))];
            insertions.push({ idx: h2Idx, html: buildFigure(slots[i].url, slots[i].alt, i === 0) });
          }
        }
        insertions.sort((a, b) => b.idx - a.idx);
        for (const ins of insertions) {
          p.contentHtml = p.contentHtml.slice(0, ins.idx) + ins.html + p.contentHtml.slice(ins.idx);
        }
      }
     }
    } catch (e: any) {
      console.warn("[post-inline-image] failed:", e?.message);
    }

    // Cloudflare credentials + project create — only when NOT in build_only mode.
    let accountId = "";
    let apiToken = "";
    let cfHeadersJson: Record<string, string> = {};
    let cfBaseUrl = "";
    let cfProjectName = "";
    let pagesDevUrl = "";
    let domain = "";

    if (!buildOnly) {
      const { data: apiKeys, error: keysErr } = await supabaseAdmin
        .from("api_keys")
        .select("provider, api_key")
        .in("provider", ["cloudflare_account_id", "cloudflare_api_token"]);
      console.log("[deploy-cloudflare-direct] api_keys rows:", apiKeys?.length ?? 0, "err:", keysErr?.message || "none");
      const keyMap = Object.fromEntries((apiKeys || []).map((k: any) => [k.provider, k.api_key]));
      accountId = keyMap["cloudflare_account_id"];
      apiToken = keyMap["cloudflare_api_token"];
      if (!accountId || !apiToken) {
        return new Response(JSON.stringify({
          error: "Cloudflare credentials not configured. Add cloudflare_account_id and cloudflare_api_token in Admin.",
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      cfHeadersJson = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };
      cfBaseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`;

      const baseName = sanitizeProjectName(siteName);
      const idShort = projectId.replace(/-/g, "");
      const candidates = [baseName, `${baseName}-${idShort.slice(0, 6)}`, `${baseName}-${idShort.slice(0, 12)}`];
      let lastErr = "";
      const existingHost = (project.domain || "").replace(/^https?:\/\//, "").split("/")[0];
      const existingMatch = existingHost.match(/^([a-z0-9-]+)\.pages\.dev$/i);
      if (existingMatch) {
        const checkRes = await fetch(`${cfBaseUrl}/${existingMatch[1]}`, { headers: cfHeadersJson });
        if (checkRes.ok) cfProjectName = existingMatch[1];
      }
      if (!cfProjectName) {
        for (const candidate of candidates) {
          const createRes = await fetch(cfBaseUrl, {
            method: "POST",
            headers: cfHeadersJson,
            body: JSON.stringify({ name: candidate, production_branch: "main" }),
          });
          const parsed = await tryParseJson(createRes);
          if (parsed.ok) { cfProjectName = candidate; break; }
          const msg = cfErr(parsed.data, parsed.text, parsed.status);
          lastErr = msg;
          const isConflict = parsed.status === 409 || /already (exists|been taken)/i.test(msg);
          if (!isConflict) {
            return new Response(JSON.stringify({ error: `Cloudflare create failed: ${msg}` }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
        if (!cfProjectName) {
          return new Response(JSON.stringify({ error: "name_conflict", message: lastErr, tried: candidates }), {
            status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      pagesDevUrl = `https://${cfProjectName}.pages.dev`;
      domain = `${cfProjectName}.pages.dev`;
    } else {
      // build_only: domain comes from caller (e.g. GitHub Pages function).
      domain = domainOverride || (project.domain || "").replace(/^https?:\/\//, "").replace(/\/+$/, "") || "example.com";
      pagesDevUrl = `https://${domain}`;
      cfProjectName = sanitizeProjectName(siteName);
      console.log("[deploy-cloudflare-direct] build_only domain:", domain);
    }

    // 2. Render files (DB template takes priority)
    const trackerBase = `${Deno.env.get("SUPABASE_URL")}/functions/v1/track-visit`;
    // Multi-language: deploy templates currently support ru/en chrome.
    // For other languages we still pass through the generated content (which is in
    // the project's language) but use "en" as the chrome locale to avoid Russian UI.
    const rawLang = String((project as any).language || "ru").toLowerCase().slice(0, 2);
    const lang: "ru" | "en" = rawLang === "ru" ? "ru" : "en";
    // Read global "Back to top" button position (configurable from admin).
    // Defaults to "left-bottom" so it never overlaps the right-side chat.
    let totopPosition: "left-bottom" | "right-bottom" | "left-top" | "right-top" | "hidden" = "left-bottom";
    try {
      const { data: posRow } = await supabaseAdmin
        .from("app_settings").select("value")
        .eq("key", "pbn_totop_position").maybeSingle();
      const v = String(posRow?.value || "").trim().toLowerCase();
      if (v === "right-bottom" || v === "left-top" || v === "right-top" || v === "hidden" || v === "left-bottom") {
        totopPosition = v as typeof totopPosition;
      }
    } catch { /* keep default */ }

    // Resolve FAL.ai key (api_keys table > env). Used for both the brand
    // icon (here) and the landing photo set (below).
    let falKey: string | null = null;
    try {
      const { data: falRow } = await supabaseAdmin
        .from("api_keys").select("api_key")
        .eq("provider", "fal_ai").eq("is_valid", true).limit(1).maybeSingle();
      falKey = (falRow?.api_key as string) || Deno.env.get("FAL_AI_API_KEY") || null;
    } catch {
      falKey = Deno.env.get("FAL_AI_API_KEY") || null;
    }

    // Brand ICON (FAL flux/schnell, NO text). Cached per project — generated
    // once and reused on every redeploy. Text part is rendered via HTML next
    // to the icon (FAL is bad at typography). Falls back to the SVG-letter
    // favicon when FAL is unavailable.
    let iconUrl: string | undefined;
    try {
      const generatedIcon = await ensureSiteIcon(
        supabaseAdmin,
        projectId,
        falKey,
        topic,
        accent,
      );
      iconUrl = generatedIcon || undefined;
    } catch (e) {
      console.warn("[deploy-cloudflare-direct] icon gen skipped:", (e as Error).message);
    }

    const commonOpts = {
      lang,
      companyName:    (project as any).company_name || undefined,
      companyAddress: (project as any).company_address || undefined,
      companyPhone:   (project as any).company_phone || undefined,
      companyEmail:   (project as any).company_email || undefined,
      foundingYear:   (project as any).founding_year || undefined,
      teamMembers:    (project as any).team_members || undefined,
      ogImageUrl:     (project as any).og_image_url || undefined,
      aboutHtml:      (project as any).site_about || undefined,
      contactsHtml:   (project as any).site_contacts || undefined,
      privacyHtml:    (project as any).site_privacy || undefined,
      termsHtml:      (project as any).site_terms || undefined,
      footerLinkUrl:  (project as any).footer_link?.url || undefined,
      footerLinkText: (project as any).footer_link?.text || undefined,
      // Only links whose target is "post" (or omitted) AND placement is "auto"
      // (or omitted) flow into the per-article inline injector. The remaining
      // links are processed by the global post-build pass below.
      injectionLinks: Array.isArray((project as any).injection_links)
        ? ((project as any).injection_links as any[]).filter((l: any) => {
            const t = String(l?.target || "post").toLowerCase();
            const p = String(l?.placement || "auto").toLowerCase();
            return t === "post" && p === "auto";
          })
        : undefined,
      legalAddress:   (project as any).legal_address || undefined,
      workHours:      (project as any).work_hours || undefined,
      juridicalInn:   (project as any).juridical_inn || undefined,
      whatsappUrl:    (project as any).whatsapp_url || undefined,
      telegramUrl:    (project as any).telegram_url || undefined,
      vkUrl:          (project as any).vk_url || undefined,
      youtubeUrl:     (project as any).youtube_url || undefined,
      instagramUrl:   (project as any).instagram_url || undefined,
      clientsCountText: (project as any).clients_count_text || undefined,
      authors:        (project as any).authors || undefined,
      businessPages:  (project as any).business_pages || undefined,
      totopPosition,
      iconUrl,
    };
    // BUG 4 fix: ensure the company email matches the actual site domain.
    // If the stored company_email uses a placeholder host like "site.ru" or
    // doesn't match the live domain, replace its host with the real domain
    // (custom_domain preferred over the .pages.dev fallback).
    try {
      const { domainMatchedEmail } = await import("./phrasePools.ts");
      const liveHost = String((project as any).custom_domain || domain || "")
        .replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim().toLowerCase();
      const stored = String((project as any).company_email || "").trim();
      const emailMatch = stored.match(/^([^@\s]+)@([^@\s]+)$/);
      const placeholderHosts = /(^|\.)(site|example|test|sample|demo|domain)\.(ru|com|net|org)$/i;
      const needsFix = !emailMatch || (liveHost && emailMatch[2].toLowerCase() !== liveHost) || placeholderHosts.test(emailMatch?.[2] || "");
      if (liveHost && needsFix) {
        const local = (emailMatch && !placeholderHosts.test(emailMatch[2])) ? emailMatch[1] : null;
        (commonOpts as any).companyEmail = local
          ? `${local}@${liveHost}`
          : domainMatchedEmail(liveHost, String(projectId || liveHost));
      }
    } catch (e) {
      console.warn("[deploy-cloudflare-direct] email-domain fix skipped:", (e as Error).message);
    }
    // Deterministic per-project tagline (rendered under siteName in header).
    try {
      const { pickPhrase: _pp } = await import("./phrasePools.ts");
      (commonOpts as any).tagline = _pp("brandTagline", lang, String(projectId || domain || siteName));
    } catch (_) { /* ignore */ }
    const files = dbTpl
      ? renderDbTemplate({
          tpl: dbTpl, siteName, siteAbout, topic,
          accent, headingFont: fontPair[0], bodyFont: fontPair[1],
          domain, posts,
          projectId, trackerUrl: trackerBase,
          ...commonOpts,
        })
      : renderTemplate({
          siteName, siteAbout, topic,
          accent, headingFont: fontPair[0], bodyFont: fontPair[1],
          template: builtinTemplate, domain, posts,
          projectId, trackerUrl: trackerBase,
          ...commonOpts,
        });
    console.log("[deploy-cloudflare-direct] rendered files:", Object.keys(files));

    // ---- Replace home page with the new professional landing -----------------
    const homepageStyle: "landing" | "magazine" | "news" | "minimal" | "dark" | "local" | "expert" =
      ((project as any).homepage_style === "magazine"
        ? "magazine"
        : (project as any).homepage_style === "news"
        ? "news"
        : (project as any).homepage_style === "minimal"
        ? "minimal"
        : (project as any).homepage_style === "dark"
        ? "dark"
        : (project as any).homepage_style === "local"
        ? "local"
        : (project as any).homepage_style === "expert"
        ? "expert"
        : "landing");
    console.log("[deploy-cloudflare-direct] homepage_style:", homepageStyle);

    if (homepageStyle === "minimal" || homepageStyle === "dark" || homepageStyle === "local" || homepageStyle === "expert") {
      try {
        // Reuse the same content+image pipeline as the landing template so
        // ALL features (FAL hero/team photos, brand icon, cost logging,
        // backdating, smart-interlinking, WP emulation, antiFingerprint, etc.)
        // work transparently. Only the home page + article page HTML differ.
        const skin = pickSkin(templateKey + "::" + projectId);
        const tplContent = await generateLandingContent(
          topic, siteName, lang as "ru" | "en",
          {
            phone: (project as any).company_phone || undefined,
            email: (project as any).company_email || undefined,
            address: (project as any).company_address || undefined,
            workHours: (project as any).work_hours || undefined,
          } as any,
          {
            region:       String(body.region       || (project as any).region || "").slice(0, 120),
            services:     String(body.services     || "").slice(0, 300),
            audience:     String(body.audience     || "").slice(0, 200),
            businessType: String(body.business_type|| "").slice(0, 80),
          },
          String(projectId || ""),
        );
        const generatedImages = await ensureLandingImages(
          supabaseAdmin, projectId, falKey,
          {
            niche: topic,
            photoQuery: sitePhotoQuery,
            region: String(body.region || (project as any).region || ""),
            audience: String(body.audience || ""),
            team: tplContent.team || [],
            posts: posts.slice(0, 3).map((p) => ({ title: p.title, slug: p.slug })),
          },
        );
        // Backfill any missing slots from Unsplash. If the Unsplash key is not
        // configured, this is a no-op and we keep the existing fallbacks.
        let unsplashAttribution = false;
        {
          const r = await ensureUnsplashImages(
            supabaseAdmin, projectId, sitePhotoQuery || topic, generatedImages,
            posts.slice(0, 3).map((p: any) => String(p.title || "")),
          );
          unsplashAttribution = r.attributions.length > 0;
        }
        let authorPhotos: string[] = [];
        try {
          const { data: cached } = await supabaseAdmin
            .from("site_image_cache")
            .select("slot, image_url")
            .eq("project_id", projectId)
            .like("slot", "team_%");
          authorPhotos = (cached || [])
            .sort((a: any, b: any) => String(a.slot).localeCompare(String(b.slot)))
            .map((r: any) => r.image_url)
            .filter((u: string) => /^https?:\/\//.test(u));
        } catch (_) { /* ignore */ }
        const enrichedAuthors = ((project as any).authors || []).map((a: any, i: number) => ({
          ...a, photo_url: a?.photo_url || authorPhotos[i % Math.max(1, authorPhotos.length)] || undefined,
        }));
        const chromeTpl: any = {
          domain, siteName, siteAbout, topic, lang,
          accent, headingFont: fontPair[0], bodyFont: fontPair[1],
          ...commonOpts,
          authors: enrichedAuthors,
          unsplashAttribution,
        };
        const allPosts = posts.map((p: any) => ({
          title: p.title, slug: p.slug, excerpt: p.excerpt || "",
          contentHtml: p.contentHtml || "",
          publishedAt: p.publishedAt, modifiedAt: p.modifiedAt,
          featuredImageUrl: p.featuredImageUrl,
        }));
        for (let i = 0; i < allPosts.length; i++) {
          const p = allPosts[i];
          const related = allPosts.filter((x) => x.slug !== p.slug).slice(0, 3);
          files[`posts/${p.slug}.html`] = homepageStyle === "dark"
            ? renderDarkArticle({ chrome: chromeTpl, post: p, related, postIndex: i })
            : homepageStyle === "local"
            ? renderLocalArticle({ chrome: chromeTpl, post: p, related, postIndex: i })
            : homepageStyle === "expert"
            ? renderExpertArticle({ chrome: chromeTpl, post: p, related, postIndex: i })
            : renderMinimalArticle({ chrome: chromeTpl, post: p, related, postIndex: i });
        }
        if (files["index.html"]) files["blog/index.html"] = files["index.html"];
        if (homepageStyle === "dark") {
          files["index.html"] = renderDarkHome({
            chrome: chromeTpl, posts: allPosts, content: tplContent,
            generatedImages, expertAuthor: enrichedAuthors[0] || null,
          });
          files["style.css"] = (files["style.css"] || "") + "\n" + darkExtraCss(chromeTpl);
        } else if (homepageStyle === "local") {
          files["index.html"] = renderLocalHome({
            chrome: chromeTpl, posts: allPosts, content: tplContent,
            generatedImages, expertAuthor: enrichedAuthors[0] || null,
          });
          files["style.css"] = (files["style.css"] || "") + "\n" + localExtraCss(chromeTpl);
        } else if (homepageStyle === "expert") {
          files["index.html"] = renderExpertHome({
            chrome: chromeTpl, posts: allPosts, content: tplContent,
            generatedImages, expertAuthor: enrichedAuthors[0] || null,
          });
          files["style.css"] = (files["style.css"] || "") + "\n" + expertExtraCss(chromeTpl);
        } else {
          files["index.html"] = renderMinimalHome({
            chrome: chromeTpl, posts: allPosts, content: tplContent,
            generatedImages, expertAuthor: enrichedAuthors[0] || null,
          });
          files["style.css"] = (files["style.css"] || "") + "\n" + minimalExtraCss(chromeTpl);
        }
        console.log("[deploy-cloudflare-direct]", homepageStyle, "homepage applied (skin", skin, ")");
      } catch (e) {
        console.warn("[deploy-cloudflare-direct]", homepageStyle, "gen failed:", (e as Error).message);
      }
    } else if (homepageStyle === "news") {
      try {
        let authorPhotos: string[] = [];
        try {
          const { data: cached } = await supabaseAdmin
            .from("site_image_cache")
            .select("slot, image_url")
            .eq("project_id", projectId)
            .like("slot", "team_%");
          authorPhotos = (cached || [])
            .sort((a: any, b: any) => String(a.slot).localeCompare(String(b.slot)))
            .map((r: any) => r.image_url)
            .filter((u: string) => /^https?:\/\//.test(u));
        } catch (_) { /* ignore */ }
        const enrichedAuthors = ((project as any).authors || []).map((a: any, i: number) => ({
          ...a, photo_url: a?.photo_url || authorPhotos[i % Math.max(1, authorPhotos.length)] || undefined,
        }));
        const chromeNews: any = {
          domain, siteName, siteAbout, topic, lang,
          accent, headingFont: fontPair[0], bodyFont: fontPair[1],
          ...commonOpts,
          authors: enrichedAuthors,
        };
        const allPosts = posts.map((p: any) => ({
          title: p.title, slug: p.slug, excerpt: p.excerpt || "",
          contentHtml: p.contentHtml || "",
          publishedAt: p.publishedAt, modifiedAt: p.modifiedAt,
          featuredImageUrl: p.featuredImageUrl,
        }));
        for (let i = 0; i < allPosts.length; i++) {
          const p = allPosts[i];
          const related = allPosts.filter((x) => x.slug !== p.slug).slice(0, 4);
          files[`posts/${p.slug}.html`] = renderNewsArticle({
            chrome: chromeNews, post: p, related, popular: allPosts.slice(0, 5),
            postIndex: i,
          });
        }
        if (files["index.html"]) files["blog/index.html"] = files["index.html"];
        files["index.html"] = renderNewsHome({
          chrome: chromeNews, posts: allPosts,
          expertAuthor: enrichedAuthors[0] || null,
        });
        files["style.css"] = (files["style.css"] || "") + "\n" + newsExtraCss(chromeNews);
        console.log("[deploy-cloudflare-direct] news homepage applied");
      } catch (e) {
        console.warn("[deploy-cloudflare-direct] news gen failed:", (e as Error).message);
      }
    } else if (homepageStyle === "magazine") {
      try {
        // Reuse FAL portraits from team_X slots; map to authors[i] in order.
        let authorPhotos: string[] = [];
        try {
          const { data: cached } = await supabaseAdmin
            .from("site_image_cache")
            .select("slot, image_url")
            .eq("project_id", projectId)
            .like("slot", "team_%");
          authorPhotos = (cached || [])
            .sort((a: any, b: any) => String(a.slot).localeCompare(String(b.slot)))
            .map((r: any) => r.image_url)
            .filter((u: string) => /^https?:\/\//.test(u));
        } catch (_) { /* ignore */ }
        const enrichedAuthors = ((project as any).authors || []).map((a: any, i: number) => ({
          ...a, photo_url: a?.photo_url || authorPhotos[i % Math.max(1, authorPhotos.length)] || undefined,
        }));
        const chromeMag: any = {
          domain, siteName, siteAbout, topic, lang,
          accent, headingFont: fontPair[0], bodyFont: fontPair[1],
          ...commonOpts,
          authors: enrichedAuthors,
        };
        // Re-render every post with the magazine layout (sticky sidebar etc.)
        const allPosts = posts.map((p: any) => ({
          title: p.title, slug: p.slug, excerpt: p.excerpt || "",
          contentHtml: p.contentHtml || "",
          publishedAt: p.publishedAt, modifiedAt: p.modifiedAt,
          featuredImageUrl: p.featuredImageUrl,
        }));
        for (let i = 0; i < allPosts.length; i++) {
          const p = allPosts[i];
          const related = allPosts.filter((x) => x.slug !== p.slug).slice(0, 3);
          files[`posts/${p.slug}.html`] = renderMagazineArticle({
            chrome: chromeMag, post: p, related, popular: allPosts.slice(0, 5),
            postIndex: i,
          });
        }
        // Magazine homepage replaces /index.html; keep simple list at /blog/.
        if (files["index.html"]) files["blog/index.html"] = files["index.html"];
        files["index.html"] = renderMagazineHome({
          chrome: chromeMag, posts: allPosts,
          expertAuthor: enrichedAuthors[0] || null,
        });
        // Append magazine CSS to global stylesheet.
        files["style.css"] = (files["style.css"] || "") + "\n" + magazineExtraCss(chromeMag);
        console.log("[deploy-cloudflare-direct] magazine homepage applied");
      } catch (e) {
        console.warn("[deploy-cloudflare-direct] magazine gen failed:", (e as Error).message);
      }
    } else {
    try {
      const heroImage = posts[0]?.featuredImageUrl;
      const skin = pickSkin(templateKey + "::" + projectId);
      const landingContent = await generateLandingContent(
        topic,
        siteName,
        lang as "ru" | "en",
        {
          phone: (project as any).company_phone || undefined,
          email: (project as any).company_email || undefined,
          address: (project as any).company_address || undefined,
          workHours: (project as any).work_hours || undefined,
        } as any,
        {
          region:       String(body.region       || (project as any).region || "").slice(0, 120),
          services:     String(body.services     || "").slice(0, 300),
          audience:     String(body.audience     || "").slice(0, 200),
          businessType: String(body.business_type|| "").slice(0, 80),
        },
        String(projectId || ""),
      );
      // Resolve FAL.ai key (api_keys table > env) and generate (or reuse) all
      // landing images via FAL flux/schnell. Cached per (project_id, slot) so
      // subsequent re-deploys never regenerate the same picture.
      const generatedImages = await ensureLandingImages(
        supabaseAdmin,
        projectId,
        falKey,
        {
          niche: topic,
          photoQuery: sitePhotoQuery,
          region: String(body.region || (project as any).region || ""),
          audience: String(body.audience || ""),
          team: landingContent.team || [],
          posts: posts.slice(0, 3).map((p) => ({ title: p.title, slug: p.slug })),
        },
      );
      // Backfill remaining slots from Unsplash (if access key is configured).
      let landingUnsplashAttribution = false;
      {
        const r = await ensureUnsplashImages(
          supabaseAdmin, projectId, sitePhotoQuery || topic, generatedImages,
          posts.slice(0, 3).map((p: any) => String(p.title || "")),
        );
        landingUnsplashAttribution = r.attributions.length > 0;
      }
      const landingHtml = renderLandingHtml(
        {
          siteName, topic, lang: lang as "ru" | "en",
          accent, headingFont: fontPair[0], bodyFont: fontPair[1],
          domain, skin,
          projectId,
          posts: posts.slice(0, 3).map((p) => ({
            title: p.title, slug: p.slug, excerpt: p.excerpt,
            featuredImageUrl: p.featuredImageUrl,
          })),
          companyName: (project as any).company_name || undefined,
          companyPhone: (project as any).company_phone || undefined,
          companyEmail: (project as any).company_email || undefined,
          companyAddress: (project as any).company_address || undefined,
          workHours: (project as any).work_hours || undefined,
          heroImageUrl: heroImage,
          generatedImages,
          totopPosition,
          iconUrl,
        },
        landingContent,
        "", // nav: not used when chromeOverride provided
        (() => {
          const chrome: any = {
            domain, siteName, siteAbout, topic, lang,
            accent, headingFont: fontPair[0], bodyFont: fontPair[1],
            ...commonOpts,
            unsplashAttribution: landingUnsplashAttribution,
          };
          return {
            headerHtml: chromeHeaderHtml(chrome),
            footerHtml: chromeFooterHtml(chrome),
            chromeCss: chromeStyles(chrome),
          };
        })(),
      );
      // Move the original "list of posts" page to /blog/index.html so the menu works.
      if (files["index.html"]) files["blog/index.html"] = files["index.html"];
      files["index.html"] = landingHtml;
      console.log("[deploy-cloudflare-direct] landing applied (skin", skin, ")");
    } catch (e) {
      console.warn("[deploy-cloudflare-direct] landing gen failed, keeping default index:", (e as Error).message);
    }
    }

    // ---- Custom 404 page ----------------------------------------------------
    // Cloudflare Pages serves /404.html for unknown routes. Each site renders
    // a unique copy (subtitle from a deterministic pool, accent color, top 3
    // posts) so visitors stay instead of bouncing.
    try {
      const chrome404: any = {
        domain, siteName, siteAbout, topic, lang,
        accent, headingFont: fontPair[0], bodyFont: fontPair[1],
        ...commonOpts,
      };
      files["404.html"] = build404Page(chrome404, posts.slice(0, 3).map((p: any) => ({
        title: p.title, slug: p.slug, excerpt: p.excerpt || "", contentHtml: "",
      })));
      console.log("[deploy-cloudflare-direct] 404.html generated");
    } catch (e) {
      console.warn("[deploy-cloudflare-direct] 404 gen failed:", (e as Error).message);
    }

    // ---- Anti-fingerprint pass (Stage 1) ------------------------------------
    // Deterministic obfuscation of CSS classes, permutation of homepage
    // sections and og:/twitter: meta order. Seeded by projectId so re-deploys
    // are byte-identical and different sites in the same PBN look distinct
    // to fingerprint scanners.
    try {
      const before = Object.keys(files).length;
      const seed = String(projectId || domain || siteName);
      const r = applyAntiFingerprint(files, seed);
      Object.assign(files, r.files);
      console.log(
        "[deploy-cloudflare-direct] anti-fp applied: files=", before,
        "renamedClasses=", r.classMap.size,
      );
    } catch (e) {
      console.warn("[deploy-cloudflare-direct] anti-fp skipped:", (e as Error).message);
    }

    // ---- WordPress emulation (Stage 2) --------------------------------------
    // Inject WP signatures (generator meta, RSD/wlwmanifest links, body/article
    // CSS classes), create wp-content/wp-json/wp-includes/xmlrpc/wp-login
    // assets, generate /feed/ + /comments/feed/ RSS, and replace robots.txt
    // with a WP-flavoured version. All deterministic from projectId.
    try {
      const seed = String(projectId || domain || siteName);
      applyWordPressEmulation(files, {
        seed,
        domain,
        siteName,
        siteAbout: siteAbout || topic || siteName,
        // Pass the project's full language code (e.g. "de", "es") rather than
        // the chrome-locale fallback so wp-json/index.html and the RSS feed
        // expose the real site language to crawlers.
        lang: rawLang,
        posts: posts.map((p: any) => ({
          title: p.title,
          slug: p.slug,
          excerpt: p.excerpt,
          contentHtml: p.contentHtml,
          publishedAt: p.publishedAt,
        })),
      });
      console.log("[deploy-cloudflare-direct] wp-emulation applied; total files:", Object.keys(files).length);
    } catch (e) {
      console.warn("[deploy-cloudflare-direct] wp-emulation skipped:", (e as Error).message);
    }

    // ---- Extended Link Injection -------------------------------------------
    // Inject user-configured links into ANY page of the deployed site based on
    // per-link `target` (which pages) and `placement` (where on the page).
    // Links with target="post" + placement="auto" were already handled inline
    // by the per-article injector above — they are skipped here.
    try {
      const rawLinks = Array.isArray((project as any).injection_links)
        ? ((project as any).injection_links as any[])
        : [];
      const extLinks = rawLinks
        .map((l) => ({
          url: String(l?.url || "").trim(),
          anchor: String(l?.anchor || "").trim(),
          target: String(l?.target || "post").toLowerCase(),
          placement: String(l?.placement || "auto").toLowerCase(),
        }))
        .filter((l) => l.url && l.anchor && !(l.target === "post" && l.placement === "auto"));

      if (extLinks.length > 0) {
        const escHtmlAttr = (s: string) =>
          s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const escHtmlText = (s: string) =>
          s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        function pageMatches(pathKey: string, target: string): boolean {
          // pathKey is like "index.html", "posts/foo.html", "promo.html".
          if (!pathKey.endsWith(".html")) return false;
          if (pathKey === "404.html") return false;
          if (target === "all") return true;
          if (target === "post") return pathKey.startsWith("posts/");
          if (target === "home") return pathKey === "index.html" || pathKey === "blog/index.html";
          // Treat anything else as an explicit path. Accept "/promo.html",
          // "promo.html", "/promo", "promo" — all map to the same file.
          const norm = target.replace(/^\/+/, "");
          const candidates = [norm, `${norm}.html`, `${norm}/index.html`];
          return candidates.includes(pathKey);
        }

        function buildLinkHtml(link: { url: string; anchor: string }): string {
          return `<a href="${escHtmlAttr(link.url)}" rel="nofollow noopener" target="_blank">${escHtmlText(link.anchor)}</a>`;
        }

        function insertAt(html: string, placement: string, snippet: string): string {
          const block = `\n<p class="ext-injected-link" style="margin:1rem 0">${snippet}</p>\n`;
          switch (placement) {
            case "header": {
              const m = html.match(/<\/h1>/i);
              if (m && typeof m.index === "number") {
                const idx = m.index + m[0].length;
                return html.slice(0, idx) + block + html.slice(idx);
              }
              const main = html.match(/<main[^>]*>/i);
              if (main && typeof main.index === "number") {
                const idx = main.index + main[0].length;
                return html.slice(0, idx) + block + html.slice(idx);
              }
              const body = html.match(/<body[^>]*>/i);
              if (body && typeof body.index === "number") {
                const idx = body.index + body[0].length;
                return html.slice(0, idx) + block + html.slice(idx);
              }
              return block + html;
            }
            case "before-content": {
              const m = html.match(/<(?:article|main|section)\b[^>]*>/i);
              if (m && typeof m.index === "number") {
                return html.slice(0, m.index) + block + html.slice(m.index);
              }
              return insertAt(html, "header", snippet);
            }
            case "after-content": {
              const m = html.match(/<\/(?:article|main)>/i);
              if (m && typeof m.index === "number") {
                const idx = m.index + m[0].length;
                return html.slice(0, idx) + block + html.slice(idx);
              }
              return insertAt(html, "footer", snippet);
            }
            case "footer": {
              const m = html.match(/<\/footer>/i);
              if (m && typeof m.index === "number") {
                return html.slice(0, m.index) + block + html.slice(m.index);
              }
              const body = html.match(/<\/body>/i);
              if (body && typeof body.index === "number") {
                return html.slice(0, body.index) + block + html.slice(body.index);
              }
              return html + block;
            }
            case "auto":
            default: {
              // For non-post pages, "auto" defaults to footer placement.
              return insertAt(html, "footer", snippet);
            }
          }
        }

        let touched = 0;
        for (const [pathKey, content] of Object.entries(files)) {
          if (!pathKey.endsWith(".html")) continue;
          let html = String(content);
          let changed = false;
          for (const link of extLinks) {
            if (!pageMatches(pathKey, link.target)) continue;
            // Avoid duplicates: skip if this exact URL already linked on the page.
            const dup = new RegExp(`<a[^>]+href=["']${link.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i");
            if (dup.test(html)) continue;
            html = insertAt(html, link.placement, buildLinkHtml(link));
            changed = true;
          }
          if (changed) {
            files[pathKey] = html;
            touched++;
          }
        }
        console.log("[ext-links] injected on", touched, "page(s) from", extLinks.length, "rule(s)");
      }
    } catch (e: any) {
      console.warn("[ext-links] skipped:", e?.message);
    }

    // ---- Cookie consent banner (GDPR/152-ФЗ friendly) -----------------------
    // Injected on EVERY generated .html page right before </body>. Pure HTML +
    // inline CSS + tiny vanilla JS, no external requests. Consent is stored
    // in localStorage so the banner disappears after the user accepts.
    try {
      const cookieTexts = lang === "ru"
        ? {
            msg: "Мы используем файлы cookie для корректной работы сайта и анализа посещаемости. Продолжая использовать сайт, вы соглашаетесь с обработкой cookie.",
            accept: "Принять",
            decline: "Отклонить",
          }
        : {
            msg: "We use cookies to make the site work properly and to analyse traffic. By continuing to use this site, you agree to our use of cookies.",
            accept: "Accept",
            decline: "Decline",
          };
      const cookieHtml = `
<div id="cookie-consent" role="dialog" aria-live="polite" aria-label="${lang === "ru" ? "Уведомление о cookie" : "Cookie notice"}" style="position:fixed;left:16px;right:16px;bottom:16px;max-width:880px;margin:0 auto;background:rgba(15,23,42,0.96);color:#f8fafc;padding:14px 18px;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.35);font:14px/1.5 system-ui,-apple-system,sans-serif;z-index:2147483646;display:none;backdrop-filter:blur(8px)">
  <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;justify-content:space-between">
    <span style="flex:1 1 280px;min-width:240px">${cookieTexts.msg}</span>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" id="cookie-decline" style="background:transparent;color:#cbd5e1;border:1px solid rgba(203,213,225,.4);padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px">${cookieTexts.decline}</button>
      <button type="button" id="cookie-accept" style="background:${accent};color:#fff;border:0;padding:9px 16px;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px">${cookieTexts.accept}</button>
    </div>
  </div>
</div>
<script>(function(){try{var k='cc_consent_v1';if(localStorage.getItem(k))return;var el=document.getElementById('cookie-consent');if(!el)return;el.style.display='block';function set(v){try{localStorage.setItem(k,v);}catch(e){}el.style.display='none';}document.getElementById('cookie-accept').addEventListener('click',function(){set('accept');});document.getElementById('cookie-decline').addEventListener('click',function(){set('decline');});}catch(e){}})();</script>`;
      let ccTouched = 0;
      for (const [pathKey, content] of Object.entries(files)) {
        if (!pathKey.endsWith(".html")) continue;
        const html = String(content);
        if (html.includes('id="cookie-consent"')) continue;
        if (/<\/body>/i.test(html)) {
          files[pathKey] = html.replace(/<\/body>/i, `${cookieHtml}\n</body>`);
        } else {
          files[pathKey] = html + cookieHtml;
        }
        ccTouched++;
      }
      console.log("[cookie-banner] injected on", ccTouched, "page(s)");
    } catch (e: any) {
      console.warn("[cookie-banner] skipped:", e?.message);
    }

    // ---- Heading hygiene QA (Stage 3) ---------------------------------------
    // Catch SEO-damaging structural mistakes in templates BEFORE the bundle is
    // shipped to Cloudflare Pages: missing/multiple <h1>, broken h1->h3 jumps,
    // and exact-duplicate heading text within a single page. We log only —
    // never block deploy — because false positives in regex-based HTML parsing
    // are real and a flagged site is still better than a missed one.
    let headingQa: ReturnType<typeof summarizeReport> | null = null;
    try {
      const report = validateHeadings(files);
      headingQa = summarizeReport(report);
      if (headingQa.ok) {
        console.log(
          "[deploy-cloudflare-direct] heading-qa OK; pages=", headingQa.filesChecked,
        );
      } else {
        console.warn(
          "[deploy-cloudflare-direct] heading-qa issues=", headingQa.totalIssues,
          "byKind=", JSON.stringify(headingQa.byKind),
          "sample=", JSON.stringify(headingQa.sample),
        );
      }
    } catch (e) {
      console.warn("[deploy-cloudflare-direct] heading-qa skipped:", (e as Error).message);
    }

    // 3. Compute manifest { "/path": hash }
    // Inject IndexNow verification key file (required for IndexNow API).
    // Without this file at /{key}.txt the API rejects pings with 403.
    {
      let inKey = (project as any).indexnow_key as string | undefined;
      if (!inKey) {
        inKey = crypto.randomUUID().replace(/-/g, "");
        try {
          await supabaseAdmin.from("projects").update({ indexnow_key: inKey }).eq("id", projectId);
        } catch (_e) { /* ignore */ }
      }
      files[`${inKey}.txt`] = inKey;
    }
    // Inject Google Search Console verification HTML file (if configured).
    // Must live at site root (not /blog) and must NOT be listed in sitemap.
    // File is re-injected on every deploy because Cloudflare Pages deploys
    // are atomic — otherwise the file disappears on the next deploy and
    // Google revokes the verification.
    let gscFileInjected = false;
    {
      const configuredFile = String((project as any).google_verification_file || "").trim();
      const legacyValue = String((project as any).google_verification || "").trim();
      const legacyFile = legacyValue.match(/google[A-Za-z0-9_-]+\.html/)?.[0] || "";
      const gvFile = configuredFile || legacyFile;
      if (gvFile && /^google[A-Za-z0-9_-]+\.html$/.test(gvFile)) {
        files[gvFile] = `google-site-verification: ${gvFile}`;
        gscFileInjected = true;
      }
    }
    // Short-circuit for build_only callers (e.g. deploy-github-pages).
    if (buildOnly) {
      console.log("[deploy-cloudflare-direct] build_only: returning", Object.keys(files).length, "files");
      return new Response(JSON.stringify({
        success: true,
        build_only: true,
        files,
        domain,
        site_name: siteName,
        topic,
        template: templateKey,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const manifest: Record<string, string> = {};
    const fileByHash: Record<string, { path: string; content: string }> = {};
    for (const [path, content] of Object.entries(files)) {
      const h = hashFile(content, path);
      manifest[`/${path}`] = h;
      fileByHash[h] = { path, content };
    }
    console.log("[deploy-cloudflare-direct] manifest:", JSON.stringify(manifest));

    // 4. Get upload JWT
    const tokenRes = await fetch(`${cfBaseUrl}/${cfProjectName}/upload-token`, { headers: cfHeadersJson });
    const tokenParsed = await tryParseJson(tokenRes);
    console.log("[deploy-cloudflare-direct] upload-token status:", tokenParsed.status, "hasJwt:", !!tokenParsed.data?.result?.jwt);
    if (!tokenParsed.ok || !tokenParsed.data?.result?.jwt) {
      return new Response(JSON.stringify({
        error: `upload-token failed: ${cfErr(tokenParsed.data, tokenParsed.text, tokenParsed.status)}`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const jwt: string = tokenParsed.data.result.jwt;
    const assetsHeaders = { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };

    // 5. check-missing
    const allHashes = Object.values(manifest);
    const checkRes = await fetch("https://api.cloudflare.com/client/v4/pages/assets/check-missing", {
      method: "POST",
      headers: assetsHeaders,
      body: JSON.stringify({ hashes: allHashes }),
    });
    const checkParsed = await tryParseJson(checkRes);
    console.log("[deploy-cloudflare-direct] check-missing status:", checkParsed.status, "missing:", checkParsed.data?.result?.length);
    if (!checkParsed.ok) {
      return new Response(JSON.stringify({
        error: `check-missing failed: ${cfErr(checkParsed.data, checkParsed.text, checkParsed.status)}`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const missing: string[] = checkParsed.data?.result || allHashes;

    // 6. upload missing files
    if (missing.length > 0) {
      const payload = missing.map((h) => {
        const f = fileByHash[h];
        return {
          key: h,
          value: toBase64(f.content),
          metadata: { contentType: mimeOf(f.path) },
          base64: true,
        };
      });
      const upRes = await fetch("https://api.cloudflare.com/client/v4/pages/assets/upload", {
        method: "POST",
        headers: assetsHeaders,
        body: JSON.stringify(payload),
      });
      const upParsed = await tryParseJson(upRes);
      console.log("[deploy-cloudflare-direct] assets/upload status:", upParsed.status, "ok:", upParsed.ok);
      if (!upParsed.ok) {
        console.log("[deploy-cloudflare-direct] upload err body:", upParsed.text.slice(0, 500));
        return new Response(JSON.stringify({
          error: `assets/upload failed: ${cfErr(upParsed.data, upParsed.text, upParsed.status)}`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // 7. upsert-hashes (registers all hashes for this deployment)
    const upsertRes = await fetch("https://api.cloudflare.com/client/v4/pages/assets/upsert-hashes", {
      method: "POST",
      headers: assetsHeaders,
      body: JSON.stringify({ hashes: allHashes }),
    });
    const upsertParsed = await tryParseJson(upsertRes);
    console.log("[deploy-cloudflare-direct] upsert-hashes status:", upsertParsed.status, "ok:", upsertParsed.ok);
    if (!upsertParsed.ok) {
      console.warn("[direct] upsert-hashes failed (continuing):", cfErr(upsertParsed.data, upsertParsed.text, upsertParsed.status));
    }

    // 8. Create deployment
    const fd = new FormData();
    fd.append("manifest", JSON.stringify(manifest));
    fd.append("branch", "main");

    const deployRes = await fetch(`${cfBaseUrl}/${cfProjectName}/deployments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` }, // let runtime set multipart boundary
      body: fd,
    });
    const deployParsed = await tryParseJson(deployRes);
    console.log("[deploy-cloudflare-direct] deployments status:", deployParsed.status, "ok:", deployParsed.ok);
    if (!deployParsed.ok) {
      console.log("[deploy-cloudflare-direct] deploy err body:", deployParsed.text.slice(0, 500));
      return new Response(JSON.stringify({
        error: `deployments failed: ${cfErr(deployParsed.data, deployParsed.text, deployParsed.status)}`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 9. Persist project state
    await supabase.from("projects").update({
      domain,
      hosting_platform: "cloudflare",
      template_key: templateKey,
      template_type: templateKey,
      accent_color: accent,
      template_font_pair: `${fontPair[0]}|${fontPair[1]}`,
      last_deploy_at: new Date().toISOString(),
      last_ping_status: "online",
      last_ping_at: new Date().toISOString(),
      ...(gscFileInjected
        ? { google_verification_file_deployed_at: new Date().toISOString() }
        : {}),
    }).eq("id", projectId);
    console.log("[deploy-cloudflare-direct] success ->", pagesDevUrl);

    // Log deploy as a zero-cost operation (counter only).
    void logCost(supabaseAdmin, {
      project_id: projectId,
      user_id: user.id,
      operation_type: "cloudflare_deploy",
      model: "cloudflare-pages",
      cost_usd: 0,
      metadata: { template: templateKey, url: pagesDevUrl, heading_qa: headingQa },
    });

    // Fire-and-forget: notify search engines (sitemap ping + IndexNow).
    // Don't await — deploy must return fast even if pings stall.
    try {
      void fetch(`${supabaseUrl}/functions/v1/notify-search-engines`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify({ project_id: projectId, reason: "deploy" }),
      });
    } catch (_e) { /* ignore */ }

    return new Response(JSON.stringify({
      success: true,
      project_name: cfProjectName,
      url: pagesDevUrl,
      template: templateKey, accent_color: accent, font_pair: fontPair,
      deploy_id: deployParsed.data?.result?.id || null,
      heading_qa: headingQa,
      message: `Direct Upload deployed: ${pagesDevUrl}`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[deploy-cloudflare-direct] ERROR:", err?.message, err?.stack);
    return new Response(JSON.stringify({ error: err?.message || String(err), stack: err?.stack }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});