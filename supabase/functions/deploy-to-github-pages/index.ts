// Deploy a checklist to a client's GitHub Pages repo.
// Body: { ecosystem_format_id: string }
// Publishes a full HTML landing (checklist content + hero images) with the
// PDF as a downloadable companion, plus site-wide robots.txt + sitemap.xml.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function transliterate(text: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
    з: "z", и: "i", й: "j", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
    ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return text.toLowerCase().split("").map((c) => map[c] ?? c).join("");
}

function slugify(input: string): string {
  const s = transliterate((input || "").trim())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || `doc-${Date.now().toString(36)}`;
}

function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function cleanDomain(raw?: string | null): string {
  return (raw || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "").split("/")[0];
}

function stripMd(s: string): string {
  return (s || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

// Render inline markdown: **bold** + [text](url). Escapes surrounding text.
function renderInline(md: string): string {
  const src = md || "";
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  const segments: Array<{ type: "text" | "link"; text: string; href?: string }> = [];
  let last = 0; let m: RegExpExecArray | null;
  while ((m = linkRe.exec(src)) !== null) {
    if (m.index > last) segments.push({ type: "text", text: src.slice(last, m.index) });
    segments.push({ type: "link", text: m[1], href: m[2] });
    last = m.index + m[0].length;
  }
  if (last < src.length) segments.push({ type: "text", text: src.slice(last) });
  return segments.map((seg) => {
    if (seg.type === "link") {
      return `<a href="${escapeHtml(seg.href!)}" target="_blank" rel="noopener">${escapeHtml(seg.text)}</a>`;
    }
    const boldRe = /\*\*([^*]+)\*\*/g;
    let out = ""; let lb = 0; let bm: RegExpExecArray | null;
    while ((bm = boldRe.exec(seg.text)) !== null) {
      out += escapeHtml(seg.text.slice(lb, bm.index));
      out += `<strong>${escapeHtml(bm[1])}</strong>`;
      lb = bm.index + bm[0].length;
    }
    out += escapeHtml(seg.text.slice(lb));
    return out;
  }).join("");
}

interface ParsedChecklist {
  h1: string;
  intro: string;
  items: Array<{ title: string; description: string }>;
  notes: string[];
  finalHeading: string;
}

function parseChecklistMarkdown(md: string): ParsedChecklist {
  const lines = (md || "").split(/\r?\n/);
  let h1 = "";
  const intro: string[] = [];
  const items: Array<{ title: string; description: string }> = [];
  const notes: string[] = [];
  let finalHeading = "Что важно помнить";
  let mode: "pre" | "intro" | "items" | "notes" = "pre";

  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, "");
    if (!line.trim()) continue;
    const h1m = line.match(/^#\s+(.+)$/);
    if (h1m && !h1) { h1 = h1m[1].trim(); mode = "intro"; continue; }
    const h2m = line.match(/^##\s+(.+)$/);
    if (h2m) { finalHeading = h2m[1].trim(); mode = "notes"; continue; }
    const itm = line.match(/^-\s*\[\s?\]\s*(.+)$/);
    if (itm) {
      mode = "items";
      const body = itm[1];
      const sep = body.match(/^(.*?)\s+[-\u2014]\s+(.+)$/);
      if (sep) items.push({ title: sep[1].trim(), description: sep[2].trim() });
      else items.push({ title: body.trim(), description: "" });
      continue;
    }
    if (mode === "notes") {
      const bul = line.match(/^[-*]\s+(.+)$/);
      notes.push(bul ? bul[1].trim() : line.trim());
      continue;
    }
    if (mode === "intro" || mode === "pre") {
      mode = "intro";
      intro.push(line.trim());
    }
  }
  return {
    h1,
    intro: intro.join(" ").replace(/\s+/g, " ").trim(),
    items,
    notes,
    finalHeading,
  };
}

// Универсальный парсер для non-checklist типов: h1, вводные параграфы, H2-разделы.
interface ParsedDoc {
  h1: string;
  intro: string[];              // первые параграфы до первого H2
  chapters: Array<{ title: string; blocks: Array<{ kind: "p" | "li" | "h3" | "table"; text?: string; rows?: string[][] }> }>;
}

// Локализация типовых английских заголовков H2 из AI-Ready фреймворка.
const H2_RU_MAP: Record<string, string> = {
  "entity block": "Блок сущности",
  "expert summary": "Экспертное резюме",
  "answer first": "Прямой ответ",
  "semantic seo": "Семантическое SEO",
  "q&a": "Вопросы и ответы",
  "qa": "Вопросы и ответы",
  "faq": "Вопросы и ответы",
  "decision framework": "Как принять решение",
  "trust signals": "Сигналы доверия",
  "ai audit": "Проверка перед публикацией",
  "final checklist": "Финальный чек-лист",
  "cta": "Что делать дальше",
  "metadata": "Метаданные",
  "ai answer layer": "Ответы для ИИ-поиска",
  "entity facts": "Факты о сущности",
  "expert opinion": "Мнение эксперта",
};
function localizeHeading(t: string): string {
  const key = t.toLowerCase().replace(/[:.]+$/, "").trim();
  return H2_RU_MAP[key] || t;
}

function isTableSeparator(line: string): boolean {
  const s = line.trim();
  if (!s.startsWith("|") || !s.endsWith("|")) return false;
  const cells = s.slice(1, -1).split("|").map((c) => c.trim());
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function parseGenericMarkdown(md: string): ParsedDoc {
  const lines = (md || "").split(/\r?\n/);
  let h1 = "";
  const intro: string[] = [];
  const chapters: ParsedDoc["chapters"] = [];
  let cur: ParsedDoc["chapters"][number] | null = null;
  let seenH2 = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/g, "");
    if (!line.trim()) continue;
    const h1m = line.match(/^#\s+(.+)$/);
    if (h1m && !h1) { h1 = h1m[1].trim(); continue; }
    const h2m = line.match(/^##\s+(.+)$/);
    if (h2m) { seenH2 = true; cur = { title: localizeHeading(h2m[1].trim()), blocks: [] }; chapters.push(cur); continue; }
    const h3m = line.match(/^###\s+(.+)$/);
    if (h3m) { if (cur) cur.blocks.push({ kind: "h3", text: localizeHeading(h3m[1].trim()) }); continue; }
    // Markdown pipe table
    if (line.trim().startsWith("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(line);
      const rows: string[][] = [header];
      i += 2; // skip separator
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim().startsWith("|")) break;
        rows.push(splitTableRow(l));
        i++;
      }
      i--;
      if (cur) cur.blocks.push({ kind: "table", rows });
      continue;
    }
    const li = line.match(/^[-*]\s+(.+)$/);
    if (li) {
      if (cur) cur.blocks.push({ kind: "li", text: li[1].trim() });
      else intro.push(line.trim());
      continue;
    }
    if (cur) cur.blocks.push({ kind: "p", text: line.trim() });
    else if (!seenH2) intro.push(line.trim());
  }
  return { h1, intro, chapters };
}

function pluralTerms(n: number): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "термин";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "термина";
  return "терминов";
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(bin);
}

function utf8Base64(s: string): string {
  return bytesToBase64(new TextEncoder().encode(s));
}

const GH_HEADERS_BASE = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "seo-module-distribution",
};

async function gh(token: string, path: string, init: RequestInit = {}) {
  const headers = {
    ...GH_HEADERS_BASE,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(init.headers || {}),
  };
  const res = await fetch(`https://api.github.com${path}`, { ...init, headers });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, data, text };
}

async function putContent(token: string, owner: string, repo: string, path: string, base64: string, message: string) {
  const existing = await gh(token, `/repos/${owner}/${repo}/contents/${encodeURI(path)}`);
  const body: any = { message, content: base64, branch: "main" };
  if (existing.ok && existing.data?.sha) body.sha = existing.data.sha;
  const r = await gh(token, `/repos/${owner}/${repo}/contents/${encodeURI(path)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PUT ${path} failed: ${r.status} ${r.text.slice(0, 300)}`);
  return r.data;
}

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; ext: string } | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
    return { bytes: buf, ext };
  } catch (e) {
    console.warn("[deploy-to-github-pages] image fetch failed:", (e as Error).message);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const __auth = await verifyAuth(req);
  if (__auth instanceof Response) return __auth;
  const userId = __auth.userId;
  const startedAt = Date.now();

  let deploymentId: string | null = null;
  let formatType = "checklist";
  try {
    const body = await req.json().catch(() => ({}));
    const formatId: string = body.ecosystem_format_id;
    if (!formatId) {
      return new Response(JSON.stringify({ error: "Missing ecosystem_format_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Load format + ecosystem + client + article
    const { data: fmt, error: fmtErr } = await admin
      .from("ecosystem_formats")
      .select("id, ecosystem_id, format_type, document_type_id, publication_slug, pdf_path, pdf_url, status, content, image_urls, document_types(slug, name, html_landing_config), content_ecosystems!inner(id, user_id, client_id, source_article_id, clients(id, user_id, name, domain, brand_color, expert_name, expert_bio, expert_photo_url, contact_email, contact_phone, logo_url, github_username, github_repo, github_pages_url, github_token_encrypted), articles(id, title, meta_description, lsi_keywords, main_keyword))")
      .eq("id", formatId)
      .maybeSingle();
    if (fmtErr || !fmt) throw new Error("format_not_found");
    // Prefer document_type slug (new architecture); fall back to legacy format_type.
    formatType = ((fmt as any).document_types?.slug) || fmt.format_type;
    const htmlLandingConfig: any = ((fmt as any).document_types?.html_landing_config) || {};
    const eco: any = (fmt as any).content_ecosystems;
    if (eco.user_id !== userId) throw new Error("forbidden");
    const client: any = eco.clients;
    const article: any = eco.articles;
    if (!client) throw new Error("client_not_found");
    if (!client.github_username || !client.github_token_encrypted) {
      throw new Error("GitHub не настроен для этого клиента");
    }
    if (!fmt.pdf_path) throw new Error("PDF отсутствует для этого формата");

    // 2. Decrypt token
    const { data: dec, error: decErr } = await admin.rpc("decrypt_sensitive", {
      ciphertext: client.github_token_encrypted,
    });
    if (decErr || !dec) throw new Error("Не удалось расшифровать GitHub-токен");
    const token: string = String(dec);

    // 3. Create deployment row
    const { data: dep, error: depErr } = await admin
      .from("format_deployments")
      .insert({
        ecosystem_format_id: formatId,
        platform: "github_pages",
        status: "deploying",
      })
      .select()
      .single();
    if (depErr) throw depErr;
    deploymentId = dep.id;

    // 4. Download PDF
    const dl = await admin.storage.from("ecosystem-formats").download(fmt.pdf_path);
    if (dl.error || !dl.data) throw new Error(`Не удалось скачать PDF: ${dl.error?.message || "empty"}`);
    const pdfBytes = new Uint8Array(await dl.data.arrayBuffer());

    // 5. Slug & metadata
    // Публикация всегда идёт по уникальному publication_slug формата
    // (`{type}/{keyword}-{hash8}`). Это гарантирует, что вторая памятка на
    // ту же тему для того же клиента не затрёт первую в GitHub Pages.
    // Для legacy-записей без publication_slug возвращаемся к старой схеме.
    const title = article?.title || "Документ";
    const pubSlug: string | null = (fmt as any).publication_slug || null;
    let slug: string;
    let pdfBasename: string;
    if (pubSlug) {
      slug = pubSlug.replace(/^\/+|\/+$/g, "");
      pdfBasename = slug.split("/").pop() || slug;
    } else {
      const baseSlug = slugify(title);
      const typeSuffix = slugify(formatType || "doc") || "doc";
      slug = `${baseSlug}-${typeSuffix}`;
      pdfBasename = slug;
    }
    const owner = client.github_username.replace(/[^A-Za-z0-9-]/g, "");
    const repo = (client.github_repo || "docs").replace(/[^A-Za-z0-9._-]/g, "");
    const pagesBase = (client.github_pages_url || `https://${owner}.github.io/${repo}`).replace(/\/+$/, "");
    const fullUrl = `${pagesBase}/${slug}/`;
    const pdfPublicUrl = `${pagesBase}/${slug}/${pdfBasename}.pdf`;
    const description = article?.meta_description || "";
    const lsi: string[] = Array.isArray(article?.lsi_keywords) ? article.lsi_keywords.slice(0, 20) : [];
    const keywordsList: string[] = lsi.length
      ? lsi
      : Array.from(new Set([
          article?.main_keyword,
          client.name,
          ...slug.split("-").filter((t: string) => t && t.length > 2),
        ].filter(Boolean) as string[]));
    const keywordsAttr = keywordsList.join(", ");
    const nowIso = new Date().toISOString();
    const brandColor: string = (client.brand_color && /^#[0-9a-fA-F]{6}$/.test(client.brand_color))
      ? client.brand_color : "#6E56CF";
    const domainClean = cleanDomain(client.domain);
    const orgUrl = domainClean ? `https://${domainClean}` : "";
    // UTM builder for author-block + CTA links (Fix 3)
    const buildUtmUrl = (content: string): string => {
      if (!orgUrl) return "";
      const sep = orgUrl.includes("?") ? "&" : "?";
      const params = `utm_source=github_pages&utm_medium=ecosystem&utm_campaign=ecosystem_${encodeURIComponent(eco.id)}&utm_content=${encodeURIComponent(content)}`;
      return `${orgUrl}${sep}${params}`;
    };
    const authorBrandUrl = buildUtmUrl("author_brand");
    const ctaExpertUrl = buildUtmUrl("cta_expert");
    // Phone href for tel: (Fix 5): keep leading + and digits only
    const phoneHref = client.contact_phone
      ? "tel:" + String(client.contact_phone).replace(/[^\d+]/g, "")
      : "";
    const commitMsg = `[Distribution] ${slug} — ${nowIso}`;

    // 6. Parse markdown content (единый парсер для всех типов)
    const genericParsed = parseGenericMarkdown((fmt as any).content || "");
    const parsedChecklist = parseChecklistMarkdown((fmt as any).content || "");
    const displayTitle = genericParsed.h1 || parsedChecklist.h1 || title;
    const introText = genericParsed.intro.join(" ") || parsedChecklist.intro || description;
    const metaDesc = (description || introText).slice(0, 160);
    const docTypeName: string = ((fmt as any).document_types?.name) || "Документ";
    const docTypeNameLower = docTypeName.charAt(0).toLowerCase() + docTypeName.slice(1);

    // 7. Expert photo -> repo (единственное изображение на лендинге)
    let expertPhotoLocal = "";
    if (client.expert_photo_url) {
      const raw = await fetchBytes(client.expert_photo_url);
      if (raw) {
        const name = `expert.${raw.ext}`;
        try {
          await putContent(token, owner, repo, `${slug}/images/${name}`, bytesToBase64(raw.bytes), `${commitMsg} expert photo`);
          expertPhotoLocal = `./images/${name}`;
        } catch (e) {
          console.warn("[deploy-to-github-pages] expert photo upload failed:", (e as Error).message);
        }
      }
    }

    // 8. Schema.org — тип-специфичная разметка (полные данные документа)
    const SCHEMA_BY_TYPE: Record<string, string> = {
      checklist: "HowTo", memo: "HowTo", howto: "HowTo",
      faq: "FAQPage",
      case: "Article", expert_pdf: "Article", encyclopedia: "Article",
      mistakes: "Article", guide: "Article", comparison_review: "Article",
      whitepaper: "Report",
      ranking: "ItemList", catalog: "ItemList",
      glossary: "DefinedTermSet",
    };
    const schemaType = SCHEMA_BY_TYPE[formatType] || String(htmlLandingConfig?.schema_type || "Article");
    const jsonLdBase: any = {
      "@context": "https://schema.org",
      "@type": schemaType,
      name: displayTitle,
      headline: displayTitle,
      description: metaDesc,
      author: {
        "@type": "Person",
        name: client.expert_name || client.name,
        ...(client.expert_bio ? { description: client.expert_bio } : {}),
      },
      publisher: {
        "@type": "Organization",
        name: client.name,
        ...(orgUrl ? { url: orgUrl } : {}),
      },
      datePublished: nowIso,
      url: fullUrl,
      ...(formatType === "comparison_review" ? { articleSection: "Comparison" } : {}),
    };
    if (schemaType === "HowTo") {
      const steps = parsedChecklist.items.length
        ? parsedChecklist.items.map((it) => ({
            "@type": "HowToStep",
            name: stripMd(it.title),
            text: stripMd(it.description) || stripMd(it.title),
          }))
        : genericParsed.chapters.map((ch) => ({
            "@type": "HowToStep",
            name: stripMd(ch.title),
            text: stripMd(String(ch.blocks.find((b) => b.kind === "p" || b.kind === "li")?.text || ch.title)).slice(0, 400),
          }));
      if (steps.length) jsonLdBase.step = steps.slice(0, 100);
    }
    if (schemaType === "FAQPage") {
      const qas: any[] = [];
      for (const ch of genericParsed.chapters) {
        for (let i = 0; i < ch.blocks.length; i++) {
          const b = ch.blocks[i];
          if (b.kind !== "h3") continue;
          const ans = ch.blocks.slice(i + 1).find((x) => x.kind === "p" || x.kind === "li");
          if (!ans) continue;
          qas.push({
            "@type": "Question",
            name: stripMd(String(b.text || "")),
            acceptedAnswer: { "@type": "Answer", text: stripMd(String(ans.text || "")).slice(0, 800) },
          });
        }
      }
      if (qas.length) jsonLdBase.mainEntity = qas.slice(0, 100);
    }
    if (schemaType === "ItemList") {
      const items: any[] = [];
      let pos = 0;
      for (const ch of genericParsed.chapters) {
        for (let i = 0; i < ch.blocks.length; i++) {
          const b = ch.blocks[i];
          if (b.kind !== "h3") continue;
          pos++;
          const desc = ch.blocks.slice(i + 1).find((x) => x.kind === "p" || x.kind === "li");
          items.push({
            "@type": "ListItem",
            position: pos,
            name: stripMd(String(b.text || "").replace(/^\d+[.)]\s*/, "")),
            ...(desc ? { description: stripMd(String(desc.text || "")).slice(0, 300) } : {}),
          });
        }
      }
      if (items.length) {
        jsonLdBase.itemListElement = items.slice(0, 200);
        jsonLdBase.numberOfItems = Math.min(items.length, 200);
      }
    }
    if (schemaType === "DefinedTermSet") {
      const terms: any[] = [];
      for (const ch of genericParsed.chapters) {
        for (let i = 0; i < ch.blocks.length; i++) {
          const b = ch.blocks[i];
          if (b.kind !== "h3") continue;
          const desc = ch.blocks.slice(i + 1).find((x) => x.kind === "p");
          terms.push({
            "@type": "DefinedTerm",
            name: stripMd(String(b.text || "")),
            ...(desc ? { description: stripMd(String(desc.text || "")).slice(0, 400) } : {}),
            inDefinedTermSet: fullUrl,
          });
        }
      }
      if (terms.length) jsonLdBase.hasDefinedTerm = terms.slice(0, 300);
    }
    const jsonLd = jsonLdBase;

    const expertInitial = escapeHtml(((client.expert_name || client.name || "?").trim()[0] || "?").toUpperCase());
    const authorHtml = expertPhotoLocal
      ? `<img src="${escapeHtml(expertPhotoLocal)}" alt="${escapeHtml(client.expert_name || client.name || "")}" class="author-photo">`
      : `<div class="author-initial" style="background:${brandColor}">${expertInitial}</div>`;

    // 9. Единый минималистичный лендинг для всех 13 типов.
    // Содержание = H2-заголовки документа (служебные пропускаем).
    const SERVICE_H2 = /^(ссылки|источники|метаданные|metadata|references|sources|cta|литература)\b/i;
    const tocChapters = genericParsed.chapters.filter((c) => !SERVICE_H2.test(c.title.trim()));
    const tocItems: string[] = tocChapters.map((c) => {
      if (formatType === "glossary" && /^[A-ZА-ЯЁ]$/i.test(c.title.trim())) {
        const n = c.blocks.filter((b) => b.kind === "h3").length;
        return n ? `${c.title.trim().toUpperCase()} (${n} ${pluralTerms(n)})` : c.title.trim().toUpperCase();
      }
      return c.title.trim();
    });
    const tocHtml = tocItems.length
      ? `<section class="toc-section">
      <h2>Содержание</h2>
      <ol class="toc-list">${tocItems.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ol>
    </section>`
      : "";

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(displayTitle)} - ${escapeHtml(client.name || "")}</title>
<meta name="description" content="${escapeHtml(metaDesc)}">
<meta name="keywords" content="${escapeHtml(keywordsAttr)}">
<meta name="author" content="${escapeHtml([client.expert_name, client.name].filter(Boolean).join(", "))}">
<link rel="canonical" href="${escapeHtml(fullUrl)}">
<link rel="alternate" type="application/pdf" href="./${escapeHtml(pdfBasename)}.pdf" title="${escapeHtml(displayTitle)} - PDF версия">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:title" content="${escapeHtml(displayTitle)}">
<meta property="og:description" content="${escapeHtml(metaDesc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${escapeHtml(fullUrl)}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
  :root{--brand-color:${brandColor};--text-primary:#1a1a1a;--text-secondary:#666;--bg-tint:${hexToRgba(brandColor, 0.05)};}
  *{box-sizing:border-box}
  body{max-width:720px;margin:0 auto;padding:24px 20px 48px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--text-primary);line-height:1.6;background:#fff}
  header{display:flex;align-items:center;gap:12px;margin-bottom:32px}
  .brand-logo{width:40px;height:40px;object-fit:contain}
  .brand-name{font-size:16px;font-weight:600;margin:0}
  main h1{font-size:28px;font-weight:700;margin:0 0 32px;line-height:1.25}
  .toc-section{margin-bottom:32px}
  .toc-section h2{font-size:20px;margin-bottom:12px}
  .toc-list{padding-left:24px;margin:0}
  .toc-list li{margin-bottom:6px;color:var(--text-secondary)}
  .download-btn-large{display:inline-block;padding:16px 32px;background:var(--brand-color);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;margin:24px 0}
  .author-card{background:var(--bg-tint);border-radius:12px;padding:24px;margin:32px 0}
  .author-header{display:flex;align-items:center;gap:16px;margin-bottom:16px}
  .author-photo,.author-initial{width:60px;height:60px;border-radius:50%;object-fit:cover;display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:700;flex-shrink:0}
  .author-header h3{margin:0;font-size:17px}
  .author-bio{color:var(--text-secondary);font-size:14px}
  .author-brand a,.author-contacts a{color:var(--brand-color);text-decoration:none}
  .author-contacts{font-size:14px;color:var(--text-secondary)}
  .author-contacts a{margin-right:4px}
  .cta-btn{display:inline-block;padding:14px 28px;background:transparent;color:var(--brand-color);border:2px solid var(--brand-color);border-radius:8px;text-decoration:none;font-weight:600;margin-top:24px}
  footer{margin-top:48px;padding-top:24px;border-top:1px solid #eee;color:var(--text-secondary);font-size:13px}
  footer p{margin:4px 0}
  @media(max-width:600px){main h1{font-size:23px}}
</style>
</head>
<body>
  <header>
    ${client.logo_url ? `<img src="${escapeHtml(client.logo_url)}" alt="${escapeHtml(client.name || "")}" class="brand-logo">` : ""}
    <h2 class="brand-name">${escapeHtml(client.name || "")}</h2>
  </header>

  <main>
    <h1>${escapeHtml(docTypeName)}: ${escapeHtml(displayTitle)}</h1>

    ${tocHtml}

    <section class="download-section">
      <a href="./${escapeHtml(pdfBasename)}.pdf" target="_blank" rel="noopener" class="download-btn-large">Скачать ${escapeHtml(docTypeNameLower)} (PDF)</a>
    </section>

    <section class="author-card">
      <div class="author-header">
        ${authorHtml}
        <h3>${escapeHtml(client.expert_name || client.name || "")}</h3>
      </div>
      ${client.expert_bio ? `<p class="author-bio">${escapeHtml(client.expert_bio)}</p>` : ""}
      ${client.name ? `<p class="author-brand">${authorBrandUrl
        ? `<a href="${escapeHtml(authorBrandUrl)}" target="_blank" rel="noopener">${escapeHtml(client.name)}</a>`
        : escapeHtml(client.name)}</p>` : ""}
      ${(client.contact_email || client.contact_phone) ? `<p class="author-contacts">
        ${client.contact_email ? `Email: <a href="mailto:${escapeHtml(client.contact_email)}">${escapeHtml(client.contact_email)}</a>` : ""}
        ${client.contact_phone ? `Тел.: <a href="${escapeHtml(phoneHref)}">${escapeHtml(client.contact_phone)}</a>` : ""}
      </p>` : ""}
    </section>

    ${ctaExpertUrl ? `<section class="cta-section">
      <a href="${escapeHtml(ctaExpertUrl)}" target="_blank" rel="noopener" class="cta-btn">Обсудить с экспертом</a>
    </section>` : ""}
  </main>

  <footer>
    <p>Материал подготовлен: ${escapeHtml([client.expert_name, client.name].filter(Boolean).join(", "))}</p>
    <p><small>© ${new Date().getFullYear()} ${escapeHtml(client.name || "")}</small></p>
  </footer>
</body>
</html>`;

    // 10. Push page files
    await putContent(token, owner, repo, `${slug}/${pdfBasename}.pdf`, bytesToBase64(pdfBytes), commitMsg);
    await putContent(token, owner, repo, `${slug}/index.html`, utf8Base64(html), commitMsg);

    // 11. Пересобираем robots.txt + sitemap.xml в корне репозитория при КАЖДОЙ публикации.
    async function regenerateRobotsTxt(): Promise<void> {
      const robots = [
        "User-agent: *",
        "Allow: /",
        "Allow: /*.pdf$",
        "",
        "# Sitemap",
        `Sitemap: ${pagesBase}/sitemap.xml`,
        "",
        "# Crawl-delay для тяжелых типов",
        "Crawl-delay: 1",
        "",
      ].join("\n");
      await putContent(token, owner, repo, `robots.txt`, utf8Base64(robots), `[Distribution] robots.txt refresh`);
      console.log(`[ROBOTS] client=${client.id} sitemap_url=${pagesBase}/sitemap.xml`);
    }

    async function regenerateSitemapXml(): Promise<void> {
      const { data: allDeps } = await admin
        .from("format_deployments")
        .select("published_url, pdf_url, deployed_at, ecosystem_formats!inner(ecosystem_id, archived, content_ecosystems!inner(client_id))")
        .eq("platform", "github_pages")
        .eq("status", "deployed")
        .eq("ecosystem_formats.archived", false)
        .eq("ecosystem_formats.content_ecosystems.client_id", client.id)
        .order("deployed_at", { ascending: false });

      // published_url -> { lastmod, pdf }. Текущий деплой добавляем принудительно:
      // строка format_deployments обновляется чуть ниже по коду.
      const rows = new Map<string, { ts: string; pdf: string }>();
      rows.set(fullUrl, { ts: nowIso, pdf: pdfPublicUrl });
      for (const d of (allDeps || []) as any[]) {
        const u = String(d.published_url || "");
        if (!u || !u.startsWith(pagesBase) || rows.has(u)) continue;
        let pdf = String(d.pdf_url || "");
        if (!pdf) {
          // Legacy-записи без pdf_url: выводим путь из slug.
          const trimmed = u.replace(/\/+$/, "");
          const seg = trimmed.split("/").pop() || "";
          pdf = seg ? `${trimmed}/${seg}.pdf` : "";
        }
        rows.set(u, { ts: d.deployed_at || nowIso, pdf });
      }

      const sorted = Array.from(rows.entries())
        .sort((a, b) => String(b[1].ts).localeCompare(String(a[1].ts)));

      const entries: string[] = [];
      const MAX_URLS = 50000;
      for (const [u, meta] of sorted) {
        if (entries.length >= MAX_URLS) break;
        const lastmod = String(meta.ts || nowIso).split("T")[0];
        entries.push(`  <url>\n    <loc>${escapeHtml(u)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`);
        if (meta.pdf && entries.length < MAX_URLS) {
          entries.push(`  <url>\n    <loc>${escapeHtml(meta.pdf)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`);
        }
      }
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;
      await putContent(token, owner, repo, `sitemap.xml`, utf8Base64(sitemap), `[Distribution] sitemap refresh`);
      console.log(`[SITEMAP] client=${client.id} deployments_count=${sorted.length} urls=${entries.length} size=${new TextEncoder().encode(sitemap).length} bytes`);
    }

    try {
      await regenerateRobotsTxt();
      await regenerateSitemapXml();
    } catch (e) {
      console.warn("[deploy-to-github-pages] sitemap/robots refresh failed:", (e as Error).message);
    }

    // 12. Update deployment
    await admin.from("format_deployments").update({
      status: "deployed",
      published_url: fullUrl,
      pdf_url: pdfPublicUrl,
      deployed_at: nowIso,
      error_reason: null,
    }).eq("id", deploymentId);

    // 12b. Auto-submit to IndexNow (opt-out via profiles.auto_indexnow)
    try {
      const { data: prof } = await admin
        .from("profiles").select("auto_indexnow").eq("id", userId).maybeSingle();
      if (prof?.auto_indexnow !== false) {
        const authHeader = req.headers.get("Authorization") || "";
        await fetch(`${supabaseUrl}/functions/v1/submit-to-indexnow`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader },
          body: JSON.stringify({ deployment_ids: [deploymentId] }),
        });
      }
    } catch (e) {
      console.warn("[deploy-to-github-pages] indexnow auto-submit failed:", (e as Error).message);
    }

    // Analytics
    await admin.from("activation_events").insert({
      user_id: userId,
      event_name: "format_deployment_completed",
      session_id: "server",
      metadata: {
        format_type: formatType,
        platform: "github_pages",
        published_url: fullUrl,
        duration_ms: Date.now() - startedAt,
        items_count: tocItems.length,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      deployment_id: deploymentId,
      published_url: fullUrl,
      pdf_url: pdfPublicUrl,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error("[deploy-to-github-pages] error:", message);
    if (deploymentId) {
      await admin.from("format_deployments").update({
        status: "failed",
        error_reason: message.slice(0, 500),
      }).eq("id", deploymentId);
    }
    try {
      await admin.from("activation_events").insert({
        user_id: userId,
        event_name: "format_deployment_failed",
        session_id: "server",
        metadata: { format_type: formatType, platform: "github_pages", error_reason: message.slice(0, 200) },
      });
    } catch { /* noop */ }
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});