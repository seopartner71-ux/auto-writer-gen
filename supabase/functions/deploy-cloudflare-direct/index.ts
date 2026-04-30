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
import { generateLandingContent, renderLandingHtml, pickSkin, ensureLandingImages, ensureSiteIcon } from "./landingPage.ts";
import { headerHtml as chromeHeaderHtml, footerHtml as chromeFooterHtml, chromeStyles, build404Page, pickAuthor } from "./seoChrome.ts";
import { renderMagazineHome, renderMagazineArticle, magazineExtraCss } from "./magazinePage.ts";
import { applyAntiFingerprint } from "./antiFingerprint.ts";
import { applyWordPressEmulation } from "./wordpressEmulation.ts";

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
  // If content already looks like HTML (has tags), return as-is.
  if (/<\s*(h[1-6]|p|ul|ol|div|article|section)\b/i.test(md)) return md;

  const lines = md.replace(/\r\n/g, "\n").split("\n");
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
  return out.join("\n");
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

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    console.log("[deploy-cloudflare-direct] auth user:", user?.id || "none", "err:", authErr?.message || "none");
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    console.log("[deploy-cloudflare-direct] body:", JSON.stringify(body));
    const projectId: string = body.project_id;
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
      .select("name, domain, custom_domain, site_name, site_about, hosting_platform, language, company_name, company_address, company_phone, company_email, founding_year, team_members, site_contacts, site_privacy, site_terms, og_image_url, footer_link, injection_links, legal_address, work_hours, juridical_inn, whatsapp_url, telegram_url, vk_url, youtube_url, instagram_url, clients_count_text, authors, business_pages, homepage_style")
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
    // Topic must be a SHORT niche keyword, not a long welcome paragraph from site_about.
    // Prefer explicit body.topic > project.name > first short sentence of site_about.
    const firstClause = (s: string) => stripHtml(s).split(/[.!?\n«»]/)[0]?.trim() || "";
    const rawTopic = body.topic
      || project.name
      || firstClause(project.site_about || "")
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

    // Cloudflare credentials
    const { data: apiKeys, error: keysErr } = await supabaseAdmin
      .from("api_keys")
      .select("provider, api_key")
      .in("provider", ["cloudflare_account_id", "cloudflare_api_token"]);
    console.log("[deploy-cloudflare-direct] api_keys rows:", apiKeys?.length ?? 0, "err:", keysErr?.message || "none");
    const keyMap = Object.fromEntries((apiKeys || []).map((k: any) => [k.provider, k.api_key]));
    const accountId = keyMap["cloudflare_account_id"];
    const apiToken = keyMap["cloudflare_api_token"];
    console.log("[deploy-cloudflare-direct] account_id:", accountId ? "set" : "missing",
                "api_token:", apiToken ? "set" : "missing");
    if (!accountId || !apiToken) {
      return new Response(JSON.stringify({
        error: "Cloudflare credentials not configured. Add cloudflare_account_id and cloudflare_api_token in Admin.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const cfHeadersJson = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };
    const cfBaseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`;

    // 1. Create or reuse Direct Upload project (no source = direct upload mode)
    const baseName = sanitizeProjectName(siteName);
    const idShort = projectId.replace(/-/g, "");
    const candidates = [baseName, `${baseName}-${idShort.slice(0, 6)}`, `${baseName}-${idShort.slice(0, 12)}`];
    console.log("[deploy-cloudflare-direct] candidates:", candidates);
    let cfProjectName = "";
    let lastErr = "";

    // First check if a project already exists (resolved domain)
    const existingHost = (project.domain || "").replace(/^https?:\/\//, "").split("/")[0];
    const existingMatch = existingHost.match(/^([a-z0-9-]+)\.pages\.dev$/i);
    if (existingMatch) {
      const checkRes = await fetch(`${cfBaseUrl}/${existingMatch[1]}`, { headers: cfHeadersJson });
      console.log("[deploy-cloudflare-direct] reuse check:", existingMatch[1], "->", checkRes.status);
      if (checkRes.ok) cfProjectName = existingMatch[1];
    }

    if (!cfProjectName) {
      for (const candidate of candidates) {
        console.log(`[direct] creating project ${candidate}`);
        const createRes = await fetch(cfBaseUrl, {
          method: "POST",
          headers: cfHeadersJson,
          body: JSON.stringify({
            name: candidate,
            production_branch: "main",
          }),
        });
        const parsed = await tryParseJson(createRes);
        console.log("[deploy-cloudflare-direct] create", candidate, "status:", parsed.status, "ok:", parsed.ok);
        if (parsed.ok) { cfProjectName = candidate; break; }
        const msg = cfErr(parsed.data, parsed.text, parsed.status);
        lastErr = msg;
        console.log("[deploy-cloudflare-direct] create err:", msg);
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
    console.log("[deploy-cloudflare-direct] cfProjectName:", cfProjectName);

    const pagesDevUrl = `https://${cfProjectName}.pages.dev`;
    const domain = `${cfProjectName}.pages.dev`;

    // 2. Render files (DB template takes priority)
    const trackerBase = `${Deno.env.get("SUPABASE_URL")}/functions/v1/track-visit`;
    const lang = ((project as any).language || "ru").toString().toLowerCase().startsWith("ru") ? "ru" : "en";
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
      injectionLinks: (project as any).injection_links || undefined,
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
          region: String(body.region || (project as any).region || ""),
          audience: String(body.audience || ""),
          team: landingContent.team || [],
          posts: posts.slice(0, 3).map((p) => ({ title: p.title, slug: p.slug })),
        },
      );
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
        lang,
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

    // 3. Compute manifest { "/path": hash }
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
    }).eq("id", projectId);
    console.log("[deploy-cloudflare-direct] success ->", pagesDevUrl);

    return new Response(JSON.stringify({
      success: true,
      project_name: cfProjectName,
      url: pagesDevUrl,
      template: templateKey, accent_color: accent, font_pair: fontPair,
      deploy_id: deployParsed.data?.result?.id || null,
      message: `Direct Upload deployed: ${pagesDevUrl}`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[deploy-cloudflare-direct] ERROR:", err?.message, err?.stack);
    return new Response(JSON.stringify({ error: err?.message || String(err), stack: err?.stack }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});