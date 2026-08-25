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
import { publishBundle, tryParseJson, cfErr } from "./publish.ts";
import { saveBundle, computeSharedHash } from "./bundleCache.ts";
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
// POC flag state: set when the template-driven home replaced the renderer output.
let templateHomeApplied = false;
import { validateHeadings, summarizeReport } from "./headingValidator.ts";
import { logCost } from "../_shared/costLogger.ts";
import { aiTranslateToPhotoQuery, fetchPexelsPhotos, fetchUnsplashPhotos, getUnsplashKey, hashImageContent, hashKey, normalizeImageKey } from "../_shared/unsplash.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { truncateAtWord, buildHomeTitle, buildMetaDescription } from "./metaTitles.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMPLATES: TemplateType[] = ["minimal", "magazine", "news", "landing"];

// ---------- SEO artifact validation ----------
// Guards against regressions:
//  - robots.txt must not carry `Disallow: /` under `User-agent: *`
//  - robots.txt must not mention WordPress-only paths (`wp-`)
//  - Sitemap: directive must match the build domain (absolute URL)
//  - sitemap.xml must start strictly with `<?xml` (no BOM/leading whitespace)
//    and declare UTF-8 encoding
function validateSeoArtifacts(files: Record<string, string>, domain: string): void {
  const robots = files["robots.txt"];
  if (robots !== undefined) {
    // Parse per-user-agent blocks (blank line = new block).
    const lines = robots.split(/\r?\n/);
    let currentAgents: string[] = [];
    let sawStarBlock = false;
    let starBlockHasDisallowRoot = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { currentAgents = []; continue; }
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") {
        currentAgents.push(value);
        if (value === "*") sawStarBlock = true;
      } else if (key === "disallow" && currentAgents.includes("*") && value === "/") {
        starBlockHasDisallowRoot = true;
      }
    }
    if (sawStarBlock && starBlockHasDisallowRoot) {
      throw new Error("robots.txt validation: `Disallow: /` under `User-agent: *` blocks all crawlers");
    }
    if (/\bwp-[a-z]/i.test(robots)) {
      throw new Error("robots.txt validation: contains WordPress-only rules (wp-*) on a static site");
    }
    const sitemapMatch = robots.match(/^\s*Sitemap:\s*(\S+)\s*$/im);
    if (!sitemapMatch) {
      throw new Error("robots.txt validation: missing Sitemap: directive");
    }
    const sitemapUrl = sitemapMatch[1];
    const expected = `https://${domain}/sitemap.xml`;
    if (sitemapUrl !== expected) {
      throw new Error(`robots.txt validation: Sitemap URL ${sitemapUrl} does not match build domain ${expected}`);
    }
  }
  const sitemap = files["sitemap.xml"];
  if (sitemap !== undefined) {
    // Must start strictly with `<?xml` — no BOM, no whitespace, no stray chars.
    if (!sitemap.startsWith("<?xml")) {
      const first = sitemap.charCodeAt(0);
      throw new Error(`sitemap.xml validation: must start with <?xml, got char code ${first}`);
    }
    if (!/^<\?xml[^>]*encoding=["']UTF-8["']/i.test(sitemap)) {
      throw new Error("sitemap.xml validation: XML declaration must specify UTF-8 encoding");
    }
  }
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
// Convert **bold** / *italic* that survive inside HTML text nodes.
// Skips tag internals (attributes) and <pre>/<code> blocks.
export function inlineEmphasisInHtml(html: string): string {
  const src = String(html || "");
  const protectedBlocks: string[] = [];
  const guarded = src.replace(/<(pre|code)\b[\s\S]*?<\/\1>/gi, (m) => {
    const i = protectedBlocks.push(m) - 1;
    return `LOVCODE${i}LOVCODE`;
  });
  // Split into tags and text; only text nodes get emphasis conversion.
  const converted = guarded.replace(/(<[^>]+>)|([^<]+)/g, (_m, tag: string, text: string) => {
    if (tag) return tag;
    let t = text;
    t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    return t;
  });
  return converted.replace(/LOVCODE(\d+)LOVCODE/g, (_m, n) => protectedBlocks[Number(n)] || "");
}

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
    // Generators sometimes leave markdown emphasis inside HTML text nodes
    // (**bold**, *italic*). Convert it so no literal asterisks reach the page.
    return inlineEmphasisInHtml(work)
      .replace(/LOVRAW(\d+)LOVRAW/g, (_m, n) => rawBlocks[Number(n)] || "");
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
  return stripped.length > maxLen ? truncateAtWord(stripped, maxLen - 1) + "…" : stripped;
}

function articleLead(md: string): string {
  const plain = String(md || "")
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block && !/^#{1,6}\s+/u.test(block))
    .join(" ")
    // Strip markdown/HTML leftovers: bold, italic, links, images, inline code.
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";
  // Keep only the first whole sentences, so cards get a short lead instead of
  // the entire article (which blows up the layout).
  const sentences = plain.match(/[^.!?…]+[.!?…]+(\s|$)/gu) || [plain];
  let out = "";
  for (const s of sentences) {
    if (out.length >= 130) break;
    out += s;
    if (out.length >= 220) break;
  }
  out = out.trim() || plain;
  return out.length > 240 ? truncateAtWord(out, 240) : out;
}

function descriptionSource(metaDescription: unknown, content: unknown): string {
  const stored = String(metaDescription || "").trim();
  // Older generation paths persisted a raw 160-character substring. Once the
  // final word has already been destroyed ("ломат"), no downstream truncator
  // can recover it, so rebuild the snippet from the article lead instead.
  const hardClipped = stored.length >= 160 && !/[.!?…][\]})"']?$/u.test(stored);
  return hardClipped ? articleLead(String(content || "")) : (stored || articleLead(String(content || "")));
}

// ── Fix 1.8 — internal link routing guard ──────────────────────────────────
// The model sometimes guesses a WordPress-ish URL convention (/blog/{slug},
// no .html). The Factory exports static files at /posts/{slug}.html. This
// shared post-processor rewrites every internal link in an article body to the
// real convention and drops links whose slug does not match a real article of
// this site (anchor text is preserved as plain text).
const SITE_URL_PATTERN = "/posts/{slug}.html";

function normalizeInternalLinks(
  html: string,
  validSlugs: Set<string>,
  slugAliases: Map<string, string>,
): { html: string; rewritten: number; dropped: number } {
  let rewritten = 0;
  let dropped = 0;
  const out = String(html || "").replace(
    /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi,
    (match, pre: string, href: string, post: string, inner: string) => {
      const url = href.trim();
      // External / anchors / mail / tel — untouched.
      if (/^(https?:|mailto:|tel:|#|\/\/)/i.test(url)) return match;
      if (!url.startsWith("/")) return match;
      const [pathOnly, query = ""] = url.split(/(?=[?#])/, 2);
      // Keep non-article site paths (/blog/, /about.html, /contacts.html …).
      const m = pathOnly.match(/^\/(?:posts|blog|articles|post|news)\/([^/]+?)(?:\.html?)?\/?$/i);
      if (!m) return match;
      let slug = decodeURIComponent(m[1]).toLowerCase();
      if (!validSlugs.has(slug)) {
        const alias = slugAliases.get(slug) || slugAliases.get(slug.replace(/-/g, ""));
        if (alias) slug = alias;
      }
      if (!validSlugs.has(slug)) {
        dropped++;
        return inner; // keep the anchor text, remove the broken link
      }
      const target = SITE_URL_PATTERN.replace("{slug}", slug) + (query || "");
      if (target !== url) rewritten++;
      return `<a${pre}href="${target}"${post}>${inner}</a>`;
    },
  );
  return { html: out, rewritten, dropped };
}

serve(async (req) => {
  templateHomeApplied = false; // POC flag is per-request state
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
      .select("name, domain, custom_domain, site_name, site_about, site_positioning, hosting_platform, language, company_name, company_address, company_phone, company_email, founding_year, team_members, site_contacts, site_privacy, site_terms, og_image_url, footer_link, injection_links, legal_address, work_hours, juridical_inn, whatsapp_url, telegram_url, vk_url, youtube_url, instagram_url, clients_count_text, authors, business_pages, homepage_style, indexnow_key, google_verification_file, google_verification, url_scheme, commercial_profile, template_engine, site_template_id")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();
    console.log("[deploy-cloudflare-direct] project lookup:", project ? "found" : "missing", "err:", projErr?.message || "none");
    if (projErr) {
      return new Response(JSON.stringify({ error: "Project lookup failed", message: projErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- TEMPLATE IMPORT V1: single engine switch -------------------------
    // template_engine = legacy | template. When "template" and the project has
    // an imported bundle, that bundle drives every template-runtime page type.
    // A missing or broken bundle never produces an empty site: we log a
    // diagnostic event and fall back to the legacy renderers.
    const templateEngineMode = String(
      body.template_engine || (project as any).template_engine || "legacy",
    );
    const importedTemplateId: string | null =
      body.site_template_id || (project as any).site_template_id || null;
    let importedTemplate: any = null;
    let templateEngineOn = templateEngineMode === "template";
    if (templateEngineOn && importedTemplateId) {
      try {
        const { loadSiteTemplateById } = await import("./templateHome.ts");
        importedTemplate = await loadSiteTemplateById(supabaseAdmin as any, importedTemplateId);
      } catch (e) {
        console.warn("[template-engine] load failed:", (e as Error).message);
      }
      if (!importedTemplate) {
        templateEngineOn = false;
        console.warn("[template-engine] bundle unavailable -> legacy fallback");
        await supabaseAdmin.from("site_template_events").insert({
          user_id: user.id, project_id: projectId, template_id: importedTemplateId,
          level: "error", event: "template_bundle_unavailable",
          details: { fallback: "legacy" },
        });
      }
    }
    console.log("[template-engine]", templateEngineMode, "bundle:", importedTemplate ? "imported" : "builtin/legacy");

    if (!project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The wizard does not expose PDE as a separate step. Every preview, ZIP,
    // QA and hosting target ultimately uses this builder, so make the registry
    // prerequisite self-healing here instead of forcing users to leave the
    // wizard and run Page Decision Engine manually.
    if (String((project as any).url_scheme || "legacy") === "silo") {
      const { count: registryCount, error: registryCountErr } = await supabaseAdmin
        .from("page_registry")
        .select("entity_id", { count: "exact", head: true })
        .eq("project_id", projectId);
      if (registryCountErr) {
        throw new Error(`page_registry_unavailable: ${registryCountErr.message}`);
      }
      if ((registryCount || 0) === 0) {
        console.log("[deploy-cloudflare-direct] page registry empty - running PDE automatically");
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        const pdeRes = await fetch(`${supabaseUrl}/functions/v1/page-decision-engine`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
            "x-queue-user-id": user.id,
          },
          body: JSON.stringify({ project_id: projectId, dry_run: false }),
        });
        const pdeText = await pdeRes.text();
        if (!pdeRes.ok) {
          let detail = pdeText;
          try {
            const parsed = JSON.parse(pdeText);
            detail = String(parsed?.message || parsed?.error || pdeText);
          } catch { /* raw response */ }
          throw new Error(`page_registry_init_failed: ${detail || `HTTP ${pdeRes.status}`}`);
        }
        console.log("[deploy-cloudflare-direct] PDE completed automatically");
      }
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
    // P12: always read through the service-role client. This function is also
    // invoked server-to-server (site-qa-check) where no user JWT exists; the
    // rows stay scoped by project_id + user_id, so RLS is not weakened.
    const { data: articles, error: articlesErr } = await supabaseAdmin
      .from("articles")
      .select("id, title, content, meta_description, status, created_at, content_updated_at, featured_image_url, silo_id, site_cluster_id, slug, url_path")
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
    const posts = (articles || []).map((a: any, idx: number) => {
      const baseSlug = slugify(a.title || a.id);
      let slug = baseSlug;
      let n = 2;
      while (usedSlugs.has(slug)) { slug = `${baseSlug}-${n++}`; }
      usedSlugs.add(slug);
      const contentHtml = markdownToHtml(a.content || "");
      const excerpt = descriptionSource(a.meta_description, a.content);
      const pubDate = publishedDates[idx];
      // dateModified must equal datePublished unless the article was really
      // edited after publication.
      const realUpdated = a?.content_updated_at ? new Date(a.content_updated_at) : null;
      const modDate = realUpdated && realUpdated.getTime() > pubDate.getTime() && realUpdated.getTime() <= now
        ? realUpdated
        : pubDate;
      return {
        id: a.id as string,
        title: a.title || "Без названия",
        slug, contentHtml, excerpt,
        publishedAt: pubDate.toISOString(),
        modifiedAt: modDate.toISOString(),
        featuredImageUrl: a.featured_image_url || undefined,
      };
    });
    console.log("[deploy-cloudflare-direct] posts prepared:", posts.length);

    // Rewrite/validate every internal link in article bodies against the real
    // routing convention (/posts/{slug}.html) and the real slug list.
    {
      const validSlugs = new Set<string>(posts.map((p: any) => String(p.slug).toLowerCase()));
      const slugAliases = new Map<string, string>();
      for (const p of posts) {
        const s = String(p.slug).toLowerCase();
        slugAliases.set(s.replace(/-/g, ""), s);
        slugAliases.set(slugify(p.title || "").toLowerCase(), s);
      }
      let totalRewritten = 0, totalDropped = 0;
      for (const p of posts) {
        const res = normalizeInternalLinks(p.contentHtml, validSlugs, slugAliases);
        p.contentHtml = res.html;
        totalRewritten += res.rewritten;
        totalDropped += res.dropped;
      }
      console.log(
        `[internal-links] rewritten=${totalRewritten} dropped=${totalDropped} pattern=${SITE_URL_PATTERN}`,
      );
    }

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
      // No placeholder fallback: the target host must come from configuration.
      domain = (domainOverride
        || (project as any).custom_domain
        || project.domain
        || "").replace(/^https?:\/\//, "").replace(/\/+$/, "").split("/")[0];
      pagesDevUrl = `https://${domain}`;
      cfProjectName = sanitizeProjectName(siteName);
      console.log("[deploy-cloudflare-direct] build_only domain:", domain);
    }

    // ---- target domain gate (build AND deploy) ------------------------------
    // A build must never bake a placeholder host into canonical / og:url /
    // sitemap / Schema. Missing or example.com host blocks the pipeline.
    if (!domain || /(^|\.)example\.(com|org|net)$/i.test(domain)) {
      return new Response(JSON.stringify({
        error: "target_domain_missing",
        message: domain
          ? `Target domain "${domain}" is a placeholder. Set a real custom domain for the project.`
          : "Target domain is not configured. Set project custom_domain (or domain) before build/deploy.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
      positioning: undefined as string | undefined,
      metaDescription: undefined as string | undefined,
    };
    // Short positioning (3-6 words) for the homepage title, and a 130-160 char
    // meta description. Taken from the project when set, generated otherwise.
    try {
      const { resolveSiteMeta } = await import("./metaAi.ts");
      const meta = await resolveSiteMeta({
        siteName,
        topic: rawTopic,
        siteAbout: rawSiteAbout,
        positioning: (project as any).site_positioning || (body as any).positioning || "",
        lang,
      });
      (commonOpts as any).positioning = meta.positioning;
      (commonOpts as any).metaDescription = meta.metaDescription;
    } catch (e) {
      console.warn("[deploy-cloudflare-direct] positioning skipped:", (e as Error).message);
    }
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
      const landingCtx = {
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
      };
      const landingHtml = renderLandingHtml(
        landingCtx,
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

      // ---- Template-driven home ---------------------------------------------
      // DATA -> TEMPLATE -> HTML, wrapped by the existing SEO shell. Driven by
      // template_engine=template (legacy per-page flags still honoured). When
      // off or the bundle is missing, the renderer output above stays untouched.
      const templateRendererEnabled =
        templateEngineOn ||
        body.template_renderer_enabled === true ||
        (project as any).template_renderer_enabled === true;
      if (templateRendererEnabled) {
        try {
          const { renderTemplateHome } = await import("./templateHome.ts");
          const { skinTokens } = await import("./landingPage.ts");
          const { wrapPage } = await import("./seoChrome.ts");
          const tk = skinTokens(skin, accent);
          const tpl = await renderTemplateHome({
            ctx: landingCtx as any,
            content: landingContent,
            heroImageUrl: heroImage,
            template: importedTemplate || undefined,
            theme: {
              bg: tk.bg, ink: tk.ink, muted: tk.muted, surface: tk.surface,

              border: tk.border, cardRadius: tk.cardRadius, btnRadius: tk.btnRadius,
              shadow: tk.shadow, sectionPad: tk.sectionPad,
            },
          });
          if (tpl) {
            const chromeTplHome: any = {
              domain, siteName, siteAbout, topic, lang,
              accent, headingFont: fontPair[0], bodyFont: fontPair[1],
              ...commonOpts,
              unsplashAttribution: landingUnsplashAttribution,
            };
            files["index.html"] = wrapPage(chromeTplHome, {
              title: buildHomeTitle(siteName, (commonOpts as any).positioning || landingContent.heroBadge),
              description: buildMetaDescription(
                (commonOpts as any).metaDescription || landingContent.heroSubtitle,
                { fallback: siteAbout || topic },
              ),
              path: "/",
              type: "website",
              breadcrumbs: [{ label: lang === "en" ? "Home" : "Главная", href: "/" }],
              bodyClass: "tpl-home",
            }, tpl.mainHtml);
            files["style.css"] = (files["style.css"] || "") + "\n" + tpl.css + "\n";
            templateHomeApplied = true;
            console.log("[deploy-cloudflare-direct] template-driven home applied:",
              tpl.templateName, tpl.templateVersion);
          } else {
            console.warn("[deploy-cloudflare-direct] template home unavailable, fallback to renderer");
          }
        } catch (e) {
          console.warn("[deploy-cloudflare-direct] template home failed, fallback to renderer:", (e as Error).message);
        }
      }

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
      if (templateHomeApplied) {
        // POC rule: template-driven commercial pages keep stable, readable
        // class names - no PBN class obfuscation.
        throw new Error("template-driven home: anti-fp disabled");
      }
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

    // WordPress emulation removed: no generator meta, no wp-json / xmlrpc /
    // wlwmanifest endpoints, no wp-* body classes. Real RSS (/feed.xml) stays.

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





    // ---- Template runtime v1: shared loader (hub + article + commerce) ------
    // DATA -> TEMPLATE -> HTML for the page <main> only. URLs, meta, canonical,
    // JSON-LD, breadcrumbs, sitemap and the link graph stay untouched.
    let tplRuntimeCache: any = null;
    const getTemplateRuntime = async (): Promise<any> => {
      if (tplRuntimeCache !== null) return tplRuntimeCache;
      try {
        const mod = await import("./templateHome.ts");
        const { skinTokens } = await import("./landingPage.ts");
        const loaded = importedTemplate || (await mod.loadSiteTemplate());
        if (!loaded) { tplRuntimeCache = false; return false; }
        if (!files["assets/tpl-theme.css"]) {
          const tk = skinTokens(pickSkin(templateKey + "::" + projectId), accent);
          files["assets/tpl-theme.css"] = mod.renderTemplateThemeCss(loaded, {
            accent,
            heading_font: fontPair[0],
            body_font: fontPair[1],
            bg: tk.bg, ink: tk.ink, muted: tk.muted, surface: tk.surface,
            border: tk.border, card_radius: tk.cardRadius, btn_radius: tk.btnRadius,
            shadow: tk.shadow, section_pad: tk.sectionPad,
          });
        }
        tplRuntimeCache = { mod, loaded, themeHref: "/assets/tpl-theme.css" };
      } catch (e) {
        console.warn("[template-runtime] disabled:", (e as Error).message);
        tplRuntimeCache = false;
      }
      return tplRuntimeCache;
    };
    const tplHubFlag =
      templateEngineOn ||
      body.template_hub_enabled === true || (project as any).template_hub_enabled === true;
    const tplArticleFlag =
      templateEngineOn ||
      body.template_article_enabled === true || (project as any).template_article_enabled === true;


    // ---- Template runtime v1: ARTICLE (flag, default OFF) -------------------
    if (tplArticleFlag) {
      const rt = await getTemplateRuntime();
      if (rt && rt.loaded.article) {
        try {
          const { buildArticleTemplateData } = await import("./articleTemplateData.ts");
          const authorRow = ((project as any).authors || [])[0] || null;
          let swapped = 0;
          for (const p of posts as any[]) {
            const key = `posts/${p.slug}.html`;
            const page = files[key];
            if (!page) continue;
            const data = buildArticleTemplateData({
              lang,
              title: p.title,
              html: p.contentHtml || "",
              excerpt: p.excerpt || "",
              image: p.featuredImageUrl || null,
              publishedAt: p.publishedAt || null,
              author: authorRow ? { name: authorRow.name, image: authorRow.photo_url || null } : null,
              related: (posts as any[]).filter((x) => x.slug !== p.slug).slice(0, 3).map((x) => ({
                title: x.title,
                href: `/posts/${x.slug}.html`,
                excerpt: x.excerpt || "",
                image: x.featuredImageUrl || null,
                date: x.publishedAt || null,
              })),
              breadcrumbs: [
                { label: lang === "en" ? "Home" : "Главная", href: "/" },
                { label: lang === "en" ? "Blog" : "Блог", href: "/blog/" },
                { label: p.title },
              ],
            });
            const main = rt.mod.renderTemplateArticle(rt.loaded, data as any);
            if (!main) continue;
            files[key] = rt.mod.swapMainContent(page, main, rt.themeHref);
            swapped++;
          }
          console.log("[template-runtime] article pages=", swapped);
        } catch (e) {
          console.warn("[template-runtime][article] skipped:", (e as Error).message);
        }
      }
    }

    // ---- SILO layer (opt-in per project via projects.url_scheme) ------------
    // Legacy projects skip this entirely and keep /posts/{slug}.html.
    // P7.6: drafts are rendered in build/preview mode only; a production
    // deploy publishes active structure exclusively.
    // P8/P9: the Page Decision Engine owns page selection. BUILD renders only
    // what page_registry approved (build_only additionally previews
    // candidates; rejected pages never ship). For SILO projects an empty
    // registry is a hard error - no silent fallback to structure-driven build.
    const pdeAllowed = new Set<string>();
    let pdeActive = false;
    /** P12: full registry snapshot — the single source of truth for BUILD. */
    let pdeRegistry: any[] = [];
    const registryUrlByEntity = new Map<string, string>();
    const siloScheme = String((project as any).url_scheme || "legacy") === "silo";
    {
      const { data: pdeRows, error: pdeErr } = await supabaseAdmin
        .from("page_registry")
        .select("entity_id, entity_type, page_type, url_path, decision, status, indexable, canonical, is_system, title")
        .eq("project_id", projectId)
        .limit(10000);
      if (pdeErr) throw new Error(`page_registry_unavailable: ${pdeErr.message}`);
      pdeRegistry = (pdeRows || []) as any[];
      if (pdeRegistry.length > 0) {
        pdeActive = true;
        for (const r of pdeRegistry) {
          if (r.url_path) registryUrlByEntity.set(String(r.entity_id), String(r.url_path));
          if (r.is_system) continue;
          // build_only must model production exactly, otherwise the QA gate
          // green-lights a bundle the real deploy never produces.
          const ok = r.decision === "approved" || (r.decision !== "rejected" && r.status === "published");

          if (ok) pdeAllowed.add(String(r.entity_id));
        }
        console.log("[pde] registry rows=", pdeRegistry.length, "renderable=", pdeAllowed.size,
                    "system=", pdeRegistry.filter((r: any) => r.is_system).length);
      } else if (siloScheme) {
        throw new Error("page_registry_empty: run the Page Decision Engine before building this project");
      } else {
        console.log("[pde] legacy url_scheme, registry empty - structure-driven build");
      }
    }
    const draftExcluded: string[] = [];
    const publishedOnly = <T extends { id?: string; status?: string | null; name?: string }>(rows: T[]): T[] => {
      // Drafts are excluded in every mode: build_only is a QA rehearsal of the
      // production bundle, not a preview of unpublished work. What is dropped
      // is reported explicitly instead of vanishing silently.
      const base = rows.filter((r) => {
        if (String(r.status || "active") !== "draft") return true;
        draftExcluded.push(String((r as { name?: string }).name || r.id || "?"));
        return false;
      });
      if (!pdeActive) return base;
      return base.filter((r) => !r.id || pdeAllowed.has(String(r.id)));

    };
    // P7.5: build_only must never mutate the database (read-only QA mode).
    const persist = async (fn: () => Promise<unknown>) => { if (!buildOnly) await fn(); };
    const linkGraph: {
      from_path: string; to_path: string; anchor: string; type: string;
      from_kind: string; to_kind: string;
      from_product_id?: string | null; to_product_id?: string | null;
    }[] = [];
    // P7.4: DB-side facts fed into the QA engine (orphan products, empty silos).
    let qaStructure: import("../_shared/siteAudit.ts").StructureFacts | undefined;

    if (String((project as any).url_scheme || "legacy") === "silo") {
      try {
        const { applySiloLayer } = await import("./siloPages.ts");
        const [{ data: siloRows }, { data: clusterRows }] = await Promise.all([
          supabaseAdmin.from("site_silos")
            .select("id, name, slug, description, position, hub_article_id, status, seo_content")
            .eq("project_id", projectId).neq("status", "archived"),
          supabaseAdmin.from("site_clusters")
            .select("id, silo_id, parent_id, name, slug, description, position, type, hub_article_id, status, seo_content")
            .eq("project_id", projectId).neq("status", "archived"),
        ]);
        const silos = publishedOnly((siloRows || []) as any[]);
        const activeSiloIds = new Set(silos.map((s: any) => s.id));
        const clusters = publishedOnly((clusterRows || []) as any[])
          .filter((c: any) => activeSiloIds.has(c.silo_id));
        if (silos.length === 0) {
          console.log("[silo] url_scheme=silo but no silos configured - keeping legacy paths");
        } else {
          const articleMeta = new Map<string, any>();
          for (const a of (articles || []) as any[]) articleMeta.set(a.id, a);
          const siloChrome: any = {
            domain, siteName, siteAbout, topic, lang,
            accent, headingFont: fontPair[0], bodyFont: fontPair[1],
            projectId, trackerUrl: trackerBase,
            ...commonOpts,
          };
          const siloPagesInput = posts.map((p: any) => {
            const a = articleMeta.get(p.id) || {};
            return {
              articleId: p.id,
              title: p.title,
              slug: p.slug,
              excerpt: p.excerpt || "",
              // P12: never invent a second URL source — fall back to the
              // canonical path already recorded in page_registry.
              urlPath: a.url_path || registryUrlByEntity.get(String(p.id)) || null,
              siloId: a.silo_id || null,
              clusterId: a.site_cluster_id || null,
              publishedAt: p.publishedAt,
              modifiedAt: p.modifiedAt,
              featuredImageUrl: p.featuredImageUrl,
            };
          });
          let siloTemplateRuntime: any = undefined;
          if (tplHubFlag) {
            const rt = await getTemplateRuntime();
            if (rt && rt.loaded.hub) {
              siloTemplateRuntime = {
                hubTpl: rt.loaded.hub,
                enableHub: true,
                themeHref: rt.themeHref,
                renderHub: (tpl: string, data: any) => rt.mod.renderTemplateHub({ ...rt.loaded, hub: tpl }, data),
              };
            }
          }
          const res = applySiloLayer({
            chrome: siloChrome, silos, clusters, pages: siloPagesInput, files,
            templateRuntime: siloTemplateRuntime,
          });
          console.log("[silo] hubs=", res.hubs, "clusters=", res.clusters, "articles moved=", res.moved);

          // Persist the resolved canonical paths so URLs never drift.
          for (const p of siloPagesInput) {
            const path = res.pathByArticleId.get(p.articleId);
            const a = articleMeta.get(p.articleId) || {};
            if (!path || (a.url_path === path && a.slug === p.slug)) continue;
            const previous = a.url_path as string | null;
            await persist(async () => {
              await supabaseAdmin.from("articles")
                .update({ url_path: path, slug: p.slug })
                .eq("id", p.articleId);
              // P7.9: keep the old URL reachable with a 301.
              if (previous && previous !== path) {
                await supabaseAdmin.from("site_redirects").upsert({
                  project_id: projectId, old_url: previous, new_url: path,
                  status_code: 301, reason: "article_url_changed",
                  entity_type: "article", entity_id: p.articleId,
                }, { onConflict: "project_id,old_url" });
              }
            });
          }

          // Sitemap: rewrite moved article URLs and add hub/cluster entries.
          const sm = files["sitemap.xml"];
          if (typeof sm === "string" && sm.includes("<urlset")) {
            let xml = sm;
            for (const p of siloPagesInput) {
              const to = res.pathByArticleId.get(p.articleId);
              if (!to) continue;
              xml = xml.split(`https://${domain}/posts/${p.slug}.html`).join(`https://${domain}${to}`);
            }
            const extra = res.extraPaths.map((path) =>
              `  <url>\n    <loc>https://${domain}${path}</loc>\n    <priority>${path.split("/").filter(Boolean).length === 1 ? "0.9" : "0.8"}</priority>\n  </url>`
            ).join("\n");
            xml = xml.replace("</urlset>", `${extra}\n</urlset>`);
            files["sitemap.xml"] = xml;
          }
        }
      } catch (e) {
        console.warn("[silo] layer skipped:", (e as Error).message);
      }
    }

    // ---- Cookie consent banner (GDPR/152-ФЗ friendly) -----------------------
    // ---- Commercial layer (products / categories / catalog) -----------------
    // Additive: skipped entirely when the project has no site_products rows.
    // P7.15: commerce is bound to the SILO scheme; legacy projects keep
    // /posts/{slug}.html untouched and never get commercial paths injected.
    try {
      if (String((project as any).url_scheme || "legacy") !== "silo") {
        throw new Error("legacy url_scheme - commerce layer skipped");
      }
      const { data: productRows } = await supabaseAdmin
        .from("site_products")
        .select("id, silo_id, site_cluster_id, sku, name, slug, url_path, price, currency, brand, availability, description, characteristics, images, kind, status, position, seo_content")
        .eq("project_id", projectId)
        .neq("status", "archived");
      const products = (productRows || []) as any[];
      // REGISTRY = single source of URL geometry. site_products.url_path may
      // still hold a legacy /catalog/{slug}.html value written before the SILO
      // scheme; the registry path (silo/cluster/product) always wins, so
      // bundle URL = registry URL = canonical = sitemap = internal links.
      if (pdeActive) {
        for (const p of products) {
          const regPath = registryUrlByEntity.get(String(p.id));
          if (regPath && regPath.startsWith("/")) p.url_path = regPath;
        }
      }

      // P20 - Media Engine: attach image_assets to the catalog before the build.
      // Real supplier / client photos stay first, generated assets follow.
      try {
        const { loadMedia, mediaKey, mergeImages } = await import("../_shared/mediaAssets.ts");
        const mediaMap = await loadMedia(supabaseAdmin as any, projectId);
        for (const p of products) {
          const kind = String(p.kind || "") === "service" ? "service" : "product";
          p.images = mergeImages(p.images, mediaMap.get(mediaKey(kind, String(p.id))));
        }
      } catch (e) {
        console.warn("[media] assets skipped:", (e as Error).message);
      }
      if (products.length > 0) {
        const [{ data: cSilos }, { data: cClusters }] = await Promise.all([
          supabaseAdmin.from("site_silos")
            .select("id, name, slug, description, position, status, seo_content").eq("project_id", projectId).neq("status", "archived"),
          supabaseAdmin.from("site_clusters")
            .select("id, silo_id, parent_id, name, slug, description, position, page_type, status, seo_content")
            .eq("project_id", projectId).neq("status", "archived"),
        ]);
        const { applyCommerceLayer } = await import("./commercePages.ts");
        const commerceChrome: any = {
          domain, siteName, siteAbout, topic, lang,
          accent, headingFont: fontPair[0], bodyFont: fontPair[1],
          projectId, trackerUrl: trackerBase,
          ...commonOpts,
        };
        const commerceSilos = publishedOnly((cSilos || []) as any[]);
        const commerceSiloIds = new Set(commerceSilos.map((s: any) => s.id));
        const commerceClusters = publishedOnly((cClusters || []) as any[])
          .filter((c: any) => commerceSiloIds.has(c.silo_id));
        // ---- Template runtime v1: category + product (flags, default OFF) ---
        // DATA -> TEMPLATE -> HTML for the page body only. URLs, meta, JSON-LD,
        // breadcrumbs, link graph and sitemap keep coming from the code above.
        const tplCategoryFlag =
          templateEngineOn ||
          body.template_category_enabled === true ||
          (project as any).template_category_enabled === true;
        const tplProductFlag =
          templateEngineOn ||
          body.template_product_enabled === true ||
          (project as any).template_product_enabled === true;
        let commerceTemplateRuntime: any = undefined;
        if (tplCategoryFlag || tplProductFlag) {
          try {
            const { loadSiteTemplate, renderTemplateCategory, renderTemplateProduct, renderTemplateThemeCss } =
              await import("./templateHome.ts");
            const { skinTokens } = await import("./landingPage.ts");
            const loaded = importedTemplate || (await loadSiteTemplate());

            if (loaded) {
              const tk = skinTokens(pickSkin(templateKey + "::" + projectId), accent);
              files["assets/tpl-theme.css"] = renderTemplateThemeCss(loaded, {
                accent,
                heading_font: fontPair[0],
                body_font: fontPair[1],
                bg: tk.bg, ink: tk.ink, muted: tk.muted, surface: tk.surface,
                border: tk.border, card_radius: tk.cardRadius, btn_radius: tk.btnRadius,
                shadow: tk.shadow, section_pad: tk.sectionPad,
              });
              commerceTemplateRuntime = {
                categoryTpl: loaded.category,
                productTpl: loaded.product,
                enableCategory: tplCategoryFlag,
                enableProduct: tplProductFlag,
                themeHref: "/assets/tpl-theme.css",
                renderCategory: (tpl: string, data: any) => renderTemplateCategory({ ...loaded, category: tpl }, data),
                renderProduct: (tpl: string, data: any) => renderTemplateProduct({ ...loaded, product: tpl }, data),
              };
            }
          } catch (e) {
            console.warn("[commerce][template-runtime] disabled:", (e as Error).message);
          }
        }

        const cres = applyCommerceLayer({
          chrome: commerceChrome,
          files,
          templateRuntime: commerceTemplateRuntime,
          silos: commerceSilos,
          clusters: commerceClusters,
          products: publishedOnly(products),
          business: {
            phone: (project as any).company_phone || null,
            address: (project as any).company_address || (project as any).legal_address || null,
            city: null,
            workHours: (project as any).work_hours || null,
          },
        });
        console.log("[commerce] products=", cres.products, "categories=", cres.categories);
        if (draftExcluded.length) {
          console.warn("[build] draft entities excluded from the bundle:", draftExcluded.join(", "));
        }


        // ---- P26: premium homepage from the Company Profile ----------------
        // Presentation only. The hero never takes blog content: it uses the
        // company profile, and trust facts fall back to real catalog counts.
        // When the template runtime already produced the home <main>
        // (template_engine=template), the template stays the final source of
        // the homepage body - premium home must not overwrite index.html.
        try {
          if (templateHomeApplied) {
            throw new Error("template-driven home: premium home overwrite skipped");
          }
          const { renderPremiumHome } = await import("./premiumHome.ts");
          const { readCommercialProfile } = await import("../_shared/commercialProfile.ts");
          const cp = readCommercialProfile(project as any);
          const activeProducts = publishedOnly(products) as any[];

          const catLinks = commerceClusters.slice(0, 12).map((c: any) => {
            const silo = commerceSilos.find((s: any) => s.id === c.silo_id);
            const count = activeProducts.filter((p: any) => p.site_cluster_id === c.id).length;
            return {
              label: String(c.name || ""),
              href: silo ? `/${silo.slug}/${c.slug}/` : `/catalog/`,
              note: count ? `${count}` : "",
            };
          }).filter((x) => x.label);
          const prodLinks = activeProducts.slice(0, 8).map((p: any) => ({
            name: String(p.name || ""),
            href: cres.pathByProductId.get(p.id) || "/catalog/",
            image: Array.isArray(p.images) ? String(p.images[0] || "") : "",
            price: p.price ? `${Number(p.price).toLocaleString(lang === "en" ? "en-US" : "ru-RU")}${lang === "en" ? "" : " руб."}` : "",
            note: String(p.brand || ""),
          })).filter((x) => x.name);
          const homeFaq = (() => {
            const raw = (commerceSilos[0] as any)?.seo_content?.faq;
            return Array.isArray(raw)
              ? raw.map((f: any) => ({ q: String(f?.q || ""), a: String(f?.a || "") })).filter((f) => f.q && f.a)
              : [];
          })();
          const premiumBody = renderPremiumHome({
            chrome: commerceChrome,
            company: {
              name: cp.companyName || siteName,
              positioning: cp.positioning || siteName,
              description: cp.description || siteAbout,
              phone: cp.phone,
              email: cp.email,
              address: cp.address,
              workingHours: cp.workingHours,
              advantages: cp.advantages,
              brands: cp.brands.length ? cp.brands : [...new Set(activeProducts.map((p: any) => String(p.brand || "")).filter(Boolean))].slice(0, 18),
              delivery: cp.delivery,
              payment: cp.payment,
              warranty: cp.warranty,
              yearsInBusiness: cp.yearsInBusiness,
              primaryCta: cp.primaryCta,
              // P26.2: only a real catalog photo (Media Engine) may become the
              // hero. A generic stock image says nothing about what we sell,
              // so we render the text-only hero instead.
              heroImage: activeProducts
                .map((p: any) => (Array.isArray(p.images) ? String(p.images[0] || "") : ""))
                .find((u: string) => /^https?:\/\//.test(u)) || "",


            },
            categories: catLinks,
            products: prodLinks,
            applications: commerceSilos.map((s: any) => ({ label: String(s.name || ""), href: `/${s.slug}/` })).filter((x: any) => x.label),
            articles: [],
            faq: homeFaq,
            counts: { products: activeProducts.length, categories: commerceClusters.length, silos: commerceSilos.length },
          });
          const { wrapPage } = await import("./seoChrome.ts");
          if (files["index.html"] && !files["blog/index.html"]) files["blog/index.html"] = files["index.html"];
          files["index.html"] = wrapPage(commerceChrome, {
            title: `${cp.positioning || siteName}`.slice(0, 65),
            description: (cp.description || siteAbout || "").slice(0, 160),
            path: "/",
            type: "website",
            breadcrumbs: [{ label: lang === "en" ? "Home" : "Главная", href: "/" }],
            bodyClass: "pm-home",

          }, premiumBody);
          // PREMIUM_CSS is already in style.css (P26.2 shared append above).
          console.log("[p26] premium home rendered, sections from profile");
        } catch (e) {
          console.warn("[p26] premium home skipped:", (e as Error).message);
        }

        const { buildContentFacts } = await import("../_shared/commerceContent.ts");
        const { data: kwFacts } = await supabaseAdmin.from("site_keywords")
          .select("keyword, target_type, target_id").eq("project_id", projectId).limit(2000);
        qaStructure = {
          content: buildContentFacts({
            silos: commerceSilos as any[],
            clusters: commerceClusters as any[],
            products: publishedOnly(products) as any[],
          }),
          keywords: (kwFacts || []) as any[],
          // Parenthood is a DATA fact, not a render fact: a product whose
          // category page was rejected by the registry is still parented in
          // the DB, so orphan checks run against the full non-archived tree.
          silos: ((cSilos || []) as any[]).map((s: any) => ({ id: s.id, name: s.name, status: s.status })),
          clusters: ((cClusters || []) as any[]).map((c: any) => ({
            id: c.id, silo_id: c.silo_id, name: c.name, status: c.status,
          })),

          products: publishedOnly(products).map((p: any) => ({
            id: p.id, name: p.name, site_cluster_id: p.site_cluster_id ?? null, silo_id: p.silo_id ?? null,
          })),
        };

        // Persist resolved product URLs so they never drift between deploys.
        for (const p of products) {
          const path = cres.pathByProductId.get(p.id);
          if (!path || p.url_path === path) continue;
          const previous = p.url_path as string | null;
          await persist(async () => {
            await supabaseAdmin.from("site_products").update({ url_path: path }).eq("id", p.id);
            if (previous && previous !== path) {
              await supabaseAdmin.from("site_redirects").upsert({
                project_id: projectId, old_url: previous, new_url: path,
                status_code: 301, reason: "product_url_changed",
                entity_type: "product", entity_id: p.id,
              }, { onConflict: "project_id,old_url" });
            }
          });
        }

        // ---- P24: faceted filter landings (additive, after commerce) -------
        try {
          const { data: filterRows } = await supabaseAdmin
            .from("catalog_filter_pages")
            .select("id, cluster_id, cluster_path, url_path, title, h1, facets, product_ids, product_count, indexable, canonical, seo_content")
            .eq("project_id", projectId).eq("status", "active").limit(5000);
          const allowedFilters = (filterRows || []).filter((f: any) =>
            !pdeActive || pdeAllowed.has(String(f.id)));
          if (allowedFilters.length) {
            const { applyFilterLayer } = await import("./filterPages.ts");
            const productsById = new Map(publishedOnly(products).map((p: any) => [String(p.id), p]));
            const clusterNameById = new Map(commerceClusters.map((c: any) => [String(c.id), String(c.name)]));
            const siloCrumbByClusterId = new Map<string, { label: string; href: string }>();
            for (const c of commerceClusters as any[]) {
              const s = commerceSilos.find((x: any) => x.id === c.silo_id);
              if (s) siloCrumbByClusterId.set(String(c.id), { label: s.name, href: `/${s.slug}/` });
            }
            const fres = applyFilterLayer({
              chrome: commerceChrome,
              files,
              pages: allowedFilters as any[],
              productsById: productsById as any,
              pathByProductId: cres.pathByProductId,
              clusterNameById,
              siloCrumbByClusterId,
            });
            console.log("[p24-filters] rendered=", fres.pages, "indexable=", fres.indexable);
            for (const l of fres.links) linkGraph.push(l as any);
            const smF = files["sitemap.xml"];
            if (typeof smF === "string" && smF.includes("<urlset") && fres.extraPaths.length) {
              const extraF = fres.extraPaths
                .filter((pth) => !smF.includes(`https://${domain}${pth}<`))
                .map((pth) => `  <url>\n    <loc>https://${domain}${pth}</loc>\n    <priority>0.6</priority>\n  </url>`)
                .join("\n");
              if (extraF) files["sitemap.xml"] = smF.replace("</urlset>", `${extraF}\n</urlset>`);
            }
          }
        } catch (e) {
          console.warn("[p24-filters] layer skipped:", (e as Error).message);
        }

        // P7.2: persist the commercial part of the internal link graph.
        for (const l of cres.links || []) linkGraph.push(l);

        const smC = files["sitemap.xml"];
        if (typeof smC === "string" && smC.includes("<urlset")) {
          const seen = new Set<string>();
          const extra = cres.extraPaths
            .filter((p) => (seen.has(p) ? false : (seen.add(p), !smC.includes(`https://${domain}${p}<`))))
            .map((path) =>
              `  <url>\n    <loc>https://${domain}${path}</loc>\n    <priority>${path.endsWith("/") ? "0.8" : "0.7"}</priority>\n  </url>`
            ).join("\n");
          if (extra) files["sitemap.xml"] = smC.replace("</urlset>", `${extra}\n</urlset>`);
        }
      }
    } catch (e) {
      console.warn("[commerce] layer skipped:", (e as Error).message);
    }

    // ---- P26.2: shared chrome + premium UI kit in style.css -----------------
    // Landing pages were the only ones with chrome CSS (inlined through
    // chromeOverride), so every wrapPage-rendered page (home, hub, category,
    // product) shipped chrome markup with no styles at all. Append the chrome
    // stylesheet and the premium UI kit last, after the silo/commerce layers,
    // so all page types share one visual language.
    try {
      const { PREMIUM_CSS } = await import("./premiumHome.ts");
      const sharedChrome: any = {
        domain, siteName, siteAbout, topic, lang,
        accent, headingFont: fontPair[0], bodyFont: fontPair[1],
        projectId, trackerUrl: trackerBase,
        ...commonOpts,
      };
      files["style.css"] = (files["style.css"] || "") + "\n" + chromeStyles(sharedChrome) + "\n" + PREMIUM_CSS + "\n";
      console.log("[p26.2] shared chrome + premium css appended to style.css");
    } catch (e) {
      console.warn("[p26.2] shared css skipped:", (e as Error).message);
    }


    // ---- P7.9: 301 redirects (hosting rules + meta-refresh fallback) --------
    try {
      const { data: redirectRows } = await supabaseAdmin
        .from("site_redirects")
        .select("old_url, new_url, status_code")
        .eq("project_id", projectId)
        .limit(2000);
      const redirects = (redirectRows || []).filter((r: any) =>
        r.old_url && r.new_url && r.old_url !== r.new_url);
      if (redirects.length) {
        const rules = redirects.map((r: any) => `${r.old_url} ${r.new_url} ${r.status_code || 301}`);
        files["_redirects"] = rules.join("\n") + "\n";
        files["vercel.json"] = JSON.stringify({
          redirects: redirects.map((r: any) => ({
            source: r.old_url, destination: r.new_url, permanent: (r.status_code || 301) === 301,
          })),
        }, null, 2);
        // Static hosts without redirect rules still need a reachable old URL.
        for (const r of redirects) {
          const key = r.old_url.replace(/^\//, "").endsWith("/")
            ? `${r.old_url.replace(/^\//, "")}index.html`
            : r.old_url.replace(/^\//, "");
          if (files[key] !== undefined) continue;
          files[key] = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">`
            + `<meta name="robots" content="noindex,follow">`
            + `<link rel="canonical" href="https://${domain}${r.new_url}">`
            + `<meta http-equiv="refresh" content="0; url=${r.new_url}">`
            + `<title>Moved</title></head><body><a href="${r.new_url}">${r.new_url}</a></body></html>`;
        }
        console.log("[redirects] rules=", redirects.length);
      }
    } catch (e) {
      console.warn("[redirects] skipped:", (e as Error).message);
    }

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
        // P26.2: chrome pages already ship their own banner (#cookie-banner) -
        // injecting a second one stacked two dialogs on top of each other.
        if (html.includes('id="cookie-consent"') || html.includes('id="cookie-banner"')) continue;

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

    // Heading hygiene QA runs later, AFTER the h1-guard and the heading-level
    // normalization pass - running it here reported issues those passes fix.
    let headingQa: ReturnType<typeof summarizeReport> | null = null;


    // 3. Compute manifest { "/path": hash }
    // Inject IndexNow verification key file (required for IndexNow API).
    // Without this file at /{key}.txt the API rejects pings with 403.
    {
      let inKey = (project as any).indexnow_key as string | undefined;
      if (!inKey) {
        inKey = crypto.randomUUID().replace(/-/g, "");
        try {
          await persist(async () => {
            await supabaseAdmin.from("projects").update({ indexnow_key: inKey }).eq("id", projectId);
          });
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
    // ---- P7.11: custom domain becomes the canonical host --------------------
    const customDomain = String((project as any).custom_domain || "").trim()
      .replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const canonicalDomain = customDomain || domain;
    if (/(^|\.)example\.(com|org|net)$/i.test(canonicalDomain)) {
      return new Response(JSON.stringify({
        error: "target_domain_missing",
        message: `Canonical domain "${canonicalDomain}" is a placeholder.`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (customDomain && customDomain !== domain) {
      for (const [key, content] of Object.entries(files)) {
        if (!/\.(html|xml|txt|json|webmanifest)$/i.test(key)) continue;
        const next = String(content).split(`https://${domain}`).join(`https://${canonicalDomain}`);
        if (next !== content) files[key] = next;
      }
      console.log("[custom-domain] canonical host:", canonicalDomain);
    }

    // ---- P7.2: persist the internal link graph ------------------------------
    if (linkGraph.length) {
      await persist(async () => {
        await supabaseAdmin.from("internal_links").delete()
          .eq("project_id", projectId).in("from_kind", ["product", "category", "hub", "catalog", "filter"]);
        // Spec taxonomy: derive a stable link_type from the endpoint kinds.
        const typeOf = (from: string, to: string, fallback: string): string => {
          const pair = `${from}>${to}`;
          const map: Record<string, string> = {
            "product>category": "product_category",
            "product>hub": "silo_internal",
            "product>product": "product_related",
            "category>product": "cluster_to_product",
            "category>hub": "cluster_internal",
            "hub>category": "hub_to_cluster",
            "catalog>hub": "catalog_to_silo",
            "catalog>category": "catalog_to_cluster",
            "catalog>product": "catalog_to_product",
            "article>product": "article_to_commerce",
            "article>category": "article_to_commerce",
            "article>hub": "article_to_commerce",
          };
          return map[pair] || fallback;
        };
        const rows = linkGraph.slice(0, 5000).map((l) => ({
          project_id: projectId,
          ...l,
          type: typeOf(l.from_kind, l.to_kind, l.type),
        }));
        for (let i = 0; i < rows.length; i += 500) {
          await supabaseAdmin.from("internal_links").insert(rows.slice(i, i + 500) as any);
        }
        console.log("[link-graph] persisted", rows.length, "commercial links");
      });
    }

    // ---- P15: commercial block layer (additive, after page content) --------
    // The renderer itself is untouched: stored trust / conversion blocks are
    // appended to the already rendered HTML of registry pages.
    if (pdeActive) {
      try {
        const { fileCandidates } = await import("../_shared/systemPages.ts");
        const { renderCommercialBlocks, injectCommercialBlocks } =
          await import("../_shared/commercialBlocks.ts");
        const { data: cblocks } = await supabaseAdmin
          .from("page_commercial_blocks")
          .select("registry_id, block_type, title, content, priority, status")
          .eq("project_id", projectId);
        const byReg = new Map<string, any[]>();
        for (const b of (cblocks || []) as any[]) {
          const list = byReg.get(b.registry_id) || [];
          list.push(b);
          byReg.set(b.registry_id, list);
        }
        let injected = 0;
        for (const r of pdeRegistry) {
          const list = byReg.get(r.id);
          if (!list?.length) continue;
          const path = String(r.url_path || "");
          const fileKey = fileCandidates(path).find((c) => files[c] !== undefined);
          if (!fileKey) continue;
          const html = renderCommercialBlocks(list, lang !== "en");
          if (!html) continue;
          files[fileKey] = injectCommercialBlocks(String(files[fileKey]), html);
          injected++;
        }
        console.log("[p15-commercial] pages with commercial blocks:", injected);
      } catch (e) {
        console.warn("[p15-commercial] layer skipped:", (e as Error).message);
      }
    }


    // ---- P7.4: QA gate — critical issues block a production deploy ----------
    // ---- P12: registry-driven sitemap reconciliation ------------------------
    // The sitemap is rebuilt from the very same indexable registry pages the
    // bundle contains. noindex pages (404) never enter it.
    let registryFacts: import("../_shared/siteAudit.ts").RegistryFacts | undefined;
    if (pdeActive) {
      try {
        const { fileCandidates } = await import("../_shared/systemPages.ts");
        const { isNoindex } = await import("../_shared/siteAudit.ts");
        const expected: { path: string; priority: string }[] = [];
        const facts: import("../_shared/siteAudit.ts").RegistryFacts = { active: true, pages: [] };
        for (const r of pdeRegistry) {
          const renderable = r.is_system
            || r.decision === "approved"
            || (r.decision !== "rejected" && r.status === "published");

          if (!renderable) continue;
          const path = String(r.url_path || "");
          if (!path) continue;
          const indexable = r.indexable !== false;
          const fileKey = fileCandidates(path).find((c) => files[c] !== undefined) || null;
          facts.pages.push({
            url_path: path,
            indexable,
            page_type: String(r.page_type || ""),
            entity_type: String(r.entity_type || ""),
            is_system: r.is_system === true,
            file_key: fileKey,
          });
          if (!indexable || !fileKey) continue;
          if (isNoindex(String(files[fileKey]))) continue;
          // Every indexable registry page must carry the canonical recorded
          // in the registry (some copied pages, e.g. /blog/, ship without one).
          const pageHtml = String(files[fileKey]);
          if (!/<link[^>]+rel=["']canonical["']/i.test(pageHtml)) {
            const tag = `<link rel="canonical" href="https://${canonicalDomain}${path}">`;
            files[fileKey] = /<\/head>/i.test(pageHtml)
              ? pageHtml.replace(/<\/head>/i, `  ${tag}\n</head>`)
              : `${tag}${pageHtml}`;
          }
          const depth = path.split("/").filter(Boolean).length;
          expected.push({ path, priority: path === "/" ? "1.0" : depth <= 1 ? "0.9" : depth === 2 ? "0.8" : "0.7" });
        }
        registryFacts = facts;

        const old = String(files["sitemap.xml"] || "");
        const blocks = new Map<string, string>();
        for (const m of old.matchAll(/<url>[\s\S]*?<\/url>/g)) {
          const loc = m[0].match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim() || "";
          const p = loc.replace(/^https?:\/\/[^/]+/, "") || "/";
          if (!blocks.has(p)) blocks.set(p, m[0].trim());
        }
        const seenPaths = new Set<string>();
        const urls: string[] = [];
        for (const e of expected.sort((a, b) => a.path.localeCompare(b.path))) {
          if (seenPaths.has(e.path)) continue;
          seenPaths.add(e.path);
          const kept = blocks.get(e.path) || blocks.get(e.path.replace(/\/$/, ""));
          urls.push(kept
            ? `  ${kept}`
            : `  <url><loc>https://${canonicalDomain}${e.path}</loc><priority>${e.priority}</priority></url>`);
        }
        files["sitemap.xml"] = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");
        console.log("[p12-sitemap] rebuilt from registry:", urls.length, "urls");
      } catch (e) {
        console.warn("[p12-sitemap] reconciliation skipped:", (e as Error).message);
      }
    }

    // ---- URL contour: one public form for every published URL --------------
    // The host serves `foo.html` at the extensionless `/foo` and 308-redirects
    // `/foo.html` there, so canonical, sitemap, internal links and llms.txt
    // must all use the extensionless form. File keys and registry geometry are
    // untouched; llms.txt is rebuilt from the final sitemap so the AI index
    // never drifts from it.
    try {
      const { normalizeCleanUrls, rebuildLlmsTxt } = await import("./urlContour.ts");
      const hosts = [...new Set([domain, canonicalDomain, (project as any).custom_domain]
        .map((d) => String(d || "").trim()).filter(Boolean))];
      const touched = normalizeCleanUrls(files as Record<string, string>, hosts);
      const listed = rebuildLlmsTxt(files as Record<string, string>, canonicalDomain, lang);
      console.log("[url-contour] clean URLs in", touched, "file(s); llms.txt entries:", listed);
    } catch (e) {
      console.warn("[url-contour] skipped:", (e as Error).message);
    }


    let qaReport: Awaited<ReturnType<typeof import("../_shared/siteAudit.ts")["auditBundle"]>> | null = null;
    // ---- H1 guard ----------------------------------------------------------
    // Copied pages (e.g. /blog/ cloned from the old index) can ship without an
    // <h1>, which is a critical QA finding and blocks the deploy. Inject one
    // derived from <title> so every HTML page has exactly one top heading.
    try {
      let patchedH1 = 0;
      for (const [key, raw] of Object.entries(files)) {
        if (!key.endsWith(".html")) continue;
        const html = String(raw);
        if (/<h1[\s>]/i.test(html)) continue;
        const title = (html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "")
          .replace(/\s*[|\-–—]\s*[^|\-–—]*$/, "")
          .replace(/<[^>]+>/g, "")
          .trim() || (key === "blog/index.html" ? (lang === "en" ? "Blog" : "Блог") : siteName);
        const heading = `<h1 class="page-h1">${title}</h1>`;
        let next: string | null = null;
        if (/<main[^>]*>/i.test(html)) next = html.replace(/(<main[^>]*>)/i, `$1\n${heading}`);
        else if (/<body[^>]*>/i.test(html)) next = html.replace(/(<body[^>]*>)/i, `$1\n${heading}`);
        if (next) { files[key] = next; patchedH1++; }
      }
      if (patchedH1) console.log("[h1-guard] injected h1 on", patchedH1, "page(s)");
    } catch (e) {
      console.warn("[h1-guard] skipped:", (e as Error).message);
    }

    // ---- Heading level normalization ---------------------------------------
    // Imported templates can put a widget heading (e.g. the hero lead form)
    // at h3 right after the h1, producing an h1 -> h3 jump. Levels are
    // rewritten in document order so a heading never descends more than one
    // level below the previous one. Text, classes and attributes are kept.
    try {
      let normalized = 0;
      for (const [key, raw] of Object.entries(files)) {
        if (!key.endsWith(".html")) continue;
        const html = String(raw);
        let prev = 0;
        let touched = false;
        const next = html.replace(
          /<h([1-6])(\b[^>]*)>([\s\S]*?)<\/h\1>/gi,
          (full, lvlStr: string, attrs: string, inner: string) => {
            const level = parseInt(lvlStr, 10);
            if (!inner.replace(/<[^>]+>/g, "").trim()) return full;
            const fixed = prev > 0 && level > prev + 1 ? prev + 1 : level;
            prev = fixed;
            if (fixed === level) return full;
            touched = true;
            return `<h${fixed}${attrs}>${inner}</h${fixed}>`;
          },
        );
        if (touched) { files[key] = next; normalized++; }
      }
      if (normalized) console.log("[heading-levels] normalized on", normalized, "page(s)");
    } catch (e) {
      console.warn("[heading-levels] skipped:", (e as Error).message);
    }

    // ---- Heading hygiene QA -------------------------------------------------
    // Log-only: regex HTML parsing has false positives, so a flagged bundle is
    // still shipped, but the report tells us what to fix in the template.
    try {
      const report = validateHeadings(files);
      headingQa = summarizeReport(report);
      if (headingQa.ok) {
        console.log("[deploy-cloudflare-direct] heading-qa OK; pages=", headingQa.filesChecked);
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

    try {
      const { auditBundle } = await import("../_shared/siteAudit.ts");
      qaReport = auditBundle(files, canonicalDomain, qaStructure, registryFacts);
      await persist(async () => {
        await supabaseAdmin.from("projects").update({ last_qa_report: qaReport }).eq("id", projectId);
      });
      console.log("[qa-gate] score=", qaReport.score, "critical=", qaReport.critical, "warnings=", qaReport.warnings);
    } catch (e) {
      console.warn("[qa-gate] audit skipped:", (e as Error).message);
    }
    const qaGateEnabled = (project as any).qa_gate_enabled !== false && body.force_deploy !== true;
    if (!buildOnly && qaGateEnabled && qaReport && qaReport.critical > 0) {
      console.warn("[qa-gate] deploy BLOCKED, critical=", qaReport.critical);
      return new Response(JSON.stringify({
        error: "QA gate failed",
        blocked: true,
        qa_report: qaReport,
        hint: "Fix critical issues or retry with force_deploy: true",
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Short-circuit for build_only callers (e.g. deploy-github-pages).
    if (buildOnly) {
      validateSeoArtifacts(files, domain);
      console.log("[deploy-cloudflare-direct] build_only: returning", Object.keys(files).length, "files");
      return new Response(JSON.stringify({
        success: true,
        build_only: true,
        files,
        domain,
        canonical_domain: canonicalDomain,
        qa_report: qaReport,
        site_name: siteName,
        topic,
        template: templateKey,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    validateSeoArtifacts(files, domain);

    // Publish path lives in ./publish.ts - manifest, asset upload and the
    // Cloudflare deployment call. This is the seam where site_deploy_queue
    // driven incremental rebuilds get wired in.
    const published = await publishBundle({
      files,
      cfBaseUrl,
      cfProjectName,
      cfHeadersJson,
      apiToken,
    });
    if (!published.ok) {
      return new Response(JSON.stringify({ error: published.error }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 8b. Cache the shipped snapshot for the next (incremental) deploy.
    // Fire-and-forget: a cache miss only costs a full rebuild next time.
    void saveBundle(
      supabaseAdmin as never,
      projectId,
      files,
      bundleFingerprint({
        template: templateKey,
        domain: canonicalDomain,
        accent,
        fonts: fontPair.join("|"),
        engine: (project as any).template_engine || "legacy",
        site_template_id: (project as any).site_template_id || "",
      }),
    );

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

    // P8: approved pages that just shipped become 'published' in the registry.
    if (pdeActive && !buildOnly) {
      try {
        await supabaseAdmin.from("page_registry")
          .update({ status: "published", published_at: new Date().toISOString() })
          .eq("project_id", projectId).eq("decision", "approved");
      } catch (e) {
        console.warn("[pde] publish marking skipped:", (e as Error).message);
      }
    }

    // P7.8: mark everything queued for this project as shipped.
    try {
      await supabaseAdmin.from("site_deploy_queue")
        .update({ status: "done", processed_at: new Date().toISOString() })
        .eq("project_id", projectId).eq("status", "pending");
    } catch (e) {
      console.warn("[deploy-queue] drain skipped:", (e as Error).message);
    }

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
      deploy_id: published.deployId,
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