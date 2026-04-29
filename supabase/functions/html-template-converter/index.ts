// HTML Template Converter
// Принимает HTML / URL / ZIP, анализирует структуру, ставит плейсхолдеры,
// возвращает готовый html_structure + css_styles для pbn_templates.
//
// Auth: только админ (проверка по user_roles).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { DOMParser, Element, HTMLDocument } from "https://deno.land/x/[email protected]/deno-dom-wasm.ts";
import { BlobReader, ZipReader, TextWriter, BlobWriter } from "https://esm.sh/@zip-js/[email protected]";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Analysis {
  selectors: Record<string, { selector: string | null; sample: string }>;
  postsBlock: { container: string | null; itemSelector: string | null; titleSelector: string | null; excerptSelector: string | null; dateSelector: string | null; linkSelector: string | null; sample: string[] } | null;
  accentColor: string | null;
  headingFont: string | null;
  bodyFont: string | null;
  hasFooter: boolean;
  hasSidebar: boolean;
}

function pickFirst(doc: HTMLDocument, selectors: string[]): Element | null {
  for (const s of selectors) {
    try {
      const el = doc.querySelector(s);
      if (el && (el.textContent || "").trim()) return el as Element;
    } catch { /* invalid selector */ }
  }
  return null;
}

function shortPath(el: Element | null): string | null {
  if (!el) return null;
  const id = (el as any).id;
  if (id) return `#${id}`;
  const cls = (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean);
  if (cls.length) return `${el.tagName.toLowerCase()}.${cls[0]}`;
  return el.tagName.toLowerCase();
}

function sampleText(el: Element | null, limit = 120): string {
  if (!el) return "";
  return (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, limit);
}

function detectPostsBlock(doc: HTMLDocument) {
  // Find a container with multiple repeating children that contain a heading + link
  const candidates: { container: Element; items: Element[] }[] = [];
  const containerSelectors = [
    ".posts", ".blog", ".cards", ".grid", ".articles", ".post-list",
    "main .list", "section.posts", "section.blog", "ul.posts", "div.posts",
  ];
  for (const sel of containerSelectors) {
    try {
      const c = doc.querySelector(sel);
      if (c) {
        const items = Array.from(c.children).filter((ch) => {
          const e = ch as Element;
          return e.querySelector?.("h1,h2,h3,h4,a") != null;
        }) as Element[];
        if (items.length >= 2) candidates.push({ container: c as Element, items });
      }
    } catch { /* ignore */ }
  }
  // Fallback: any element with >=2 <article> children
  if (!candidates.length) {
    doc.querySelectorAll("*").forEach((node) => {
      const el = node as Element;
      const arts = Array.from(el.children).filter((c) => (c as Element).tagName === "ARTICLE");
      if (arts.length >= 2) candidates.push({ container: el, items: arts as Element[] });
    });
  }
  // Fallback: container with >=3 same-tag children that include a link
  if (!candidates.length) {
    doc.querySelectorAll("ul,ol,div,section,main").forEach((node) => {
      const el = node as Element;
      const ch = Array.from(el.children) as Element[];
      if (ch.length < 3) return;
      const tag = ch[0].tagName;
      if (!ch.every((c) => c.tagName === tag)) return;
      const withLink = ch.filter((c) => c.querySelector?.("a[href]")).length;
      if (withLink >= 3) candidates.push({ container: el, items: ch });
    });
  }
  if (!candidates.length) return null;

  // Pick the candidate with the most items
  candidates.sort((a, b) => b.items.length - a.items.length);
  const best = candidates[0];
  const item = best.items[0];

  const title = item.querySelector("h1,h2,h3,h4,.post-title,.title");
  const excerpt = item.querySelector(".excerpt,.summary,.description,p");
  const date = item.querySelector("time,.date,.published,.meta-date");
  const link = item.querySelector("a[href]");

  return {
    container: shortPath(best.container),
    itemSelector: item.tagName.toLowerCase() + (item.getAttribute("class") ? `.${(item.getAttribute("class") || "").trim().split(/\s+/)[0]}` : ""),
    titleSelector: shortPath(title as Element | null),
    excerptSelector: shortPath(excerpt as Element | null),
    dateSelector: shortPath(date as Element | null),
    linkSelector: shortPath(link as Element | null),
    sample: best.items.slice(0, 3).map((i) => sampleText(i.querySelector("h1,h2,h3,h4,a"))),
  };
}

function detectAccent(doc: HTMLDocument, css: string): string | null {
  // 1) :root --accent / --primary
  const m = css.match(/--(?:accent|primary|brand|main)[\w-]*\s*:\s*(#[0-9a-fA-F]{3,8}|hsl\([^)]+\)|rgb\([^)]+\))/);
  if (m) return m[1];
  // 2) inline style with background or color
  const styled = doc.querySelector("[style*='background'], [style*='color']");
  if (styled) {
    const s = styled.getAttribute("style") || "";
    const c = s.match(/(#[0-9a-fA-F]{6})/);
    if (c) return c[1];
  }
  // 3) first hex color in css
  const any = css.match(/#[0-9a-fA-F]{6}\b/);
  return any ? any[0] : null;
}

function detectFonts(doc: HTMLDocument, css: string): { heading: string | null; body: string | null } {
  const link = doc.querySelector("link[href*='fonts.googleapis.com']");
  const families: string[] = [];
  if (link) {
    const href = link.getAttribute("href") || "";
    const matches = href.matchAll(/family=([^&:]+)/g);
    for (const m of matches) families.push(decodeURIComponent(m[1].replace(/\+/g, " ")));
  }
  const cssImport = css.match(/@import\s+url\([^)]*family=([^&)'"]+)/);
  if (cssImport) families.push(decodeURIComponent(cssImport[1].replace(/\+/g, " ")));

  const ffMatches = Array.from(css.matchAll(/font-family\s*:\s*([^;}\n]+)/g)).map((m) =>
    m[1].split(",")[0].replace(/['"]/g, "").trim()
  );

  const heading = families[0] || ffMatches.find((f) => /serif|display|heading/i.test(f)) || ffMatches[0] || null;
  const body = families[1] || families[0] || ffMatches[1] || ffMatches[0] || null;
  return { heading, body };
}

async function fetchExternalCss(doc: HTMLDocument, baseUrl: string | null): Promise<string> {
  let combined = "";
  const links = Array.from(doc.querySelectorAll("link[rel='stylesheet']"));
  for (const l of links) {
    const href = (l as Element).getAttribute("href");
    if (!href || href.startsWith("data:")) continue;
    try {
      const url = baseUrl ? new URL(href, baseUrl).toString() : href;
      if (!/^https?:/i.test(url)) continue;
      const r = await fetch(url);
      if (r.ok) combined += "\n/* " + url + " */\n" + (await r.text());
    } catch { /* ignore */ }
  }
  // inline <style>
  doc.querySelectorAll("style").forEach((s) => {
    combined += "\n" + ((s as Element).textContent || "");
  });
  return combined;
}

function absolutizeUrls(doc: HTMLDocument, baseUrl: string) {
  const fix = (el: Element, attr: string) => {
    const v = el.getAttribute(attr);
    if (!v) return;
    if (/^(https?:|data:|mailto:|tel:|#)/i.test(v)) return;
    try { el.setAttribute(attr, new URL(v, baseUrl).toString()); } catch { /* ignore */ }
  };
  doc.querySelectorAll("img[src]").forEach((e) => fix(e as Element, "src"));
  doc.querySelectorAll("img[srcset]").forEach((e) => {
    const v = (e as Element).getAttribute("srcset") || "";
    const out = v.split(",").map((p) => {
      const [u, d] = p.trim().split(/\s+/);
      if (!u || /^(https?:|data:)/i.test(u)) return p;
      try { return new URL(u, baseUrl).toString() + (d ? " " + d : ""); } catch { return p; }
    }).join(", ");
    (e as Element).setAttribute("srcset", out);
  });
  doc.querySelectorAll("source[src]").forEach((e) => fix(e as Element, "src"));
}

function injectPlaceholders(doc: HTMLDocument, mapping: Record<string, string | null>, postsCfg: ReturnType<typeof detectPostsBlock>): void {
  const setText = (sel: string | null, ph: string) => {
    if (!sel) return;
    try {
      const el = doc.querySelector(sel);
      if (el) el.textContent = ph;
    } catch { /* ignore */ }
  };

  setText(mapping.site_name, "{{site_name}}");
  setText(mapping.site_description, "{{site_description}}");
  setText(mapping.author_name, "{{author_name}}");

  // about / contacts / privacy — replace innerHTML with placeholder paragraph
  const setHtml = (sel: string | null, ph: string) => {
    if (!sel) return;
    try {
      const el = doc.querySelector(sel);
      if (el) (el as Element).innerHTML = ph;
    } catch { /* ignore */ }
  };
  setHtml(mapping.site_about, "{{site_about}}");
  setHtml(mapping.contacts_content, "{{contacts_content}}");
  setHtml(mapping.privacy_content, "{{privacy_content}}");

  // Year in footer copyright
  if (mapping.year) {
    try {
      const el = doc.querySelector(mapping.year);
      if (el) {
        const t = el.textContent || "";
        el.textContent = t.replace(/\b(19|20)\d{2}\b/, "{{year}}");
        if (!/\{\{year\}\}/.test(el.textContent)) el.textContent = (el.textContent || "") + " © {{year}}";
      }
    } catch { /* ignore */ }
  }

  // Posts block: replace items with mustache loop
  if (postsCfg && postsCfg.container) {
    try {
      const container = doc.querySelector(postsCfg.container) as Element | null;
      if (container) {
        const tpl = `{{#posts}}<article class="pbn-post"><h2 class="pbn-post-title"><a href="{{url}}">{{title}}</a></h2><p class="pbn-post-excerpt">{{excerpt}}</p><time class="pbn-post-date">{{date}}</time></article>{{/posts}}`;
        container.innerHTML = tpl;
      }
    } catch { /* ignore */ }
  }

  // Footer link (single anchor inside footer if marked)
  if (mapping.footer_link) {
    try {
      const a = doc.querySelector(mapping.footer_link) as Element | null;
      if (a) {
        a.setAttribute("href", "{{footer_link_url}}");
        a.textContent = "{{footer_link_text}}";
      }
    } catch { /* ignore */ }
  }
}

async function readZipToHtmlCss(buf: Uint8Array): Promise<{ html: string; css: string }> {
  const blob = new Blob([buf]);
  const reader = new ZipReader(new BlobReader(blob));
  const entries = await reader.getEntries();
  let html = "";
  let css = "";
  const cssMap: Record<string, string> = {};
  for (const e of entries) {
    if (e.directory) continue;
    const name = e.filename.toLowerCase();
    if (name.endsWith(".html") || name.endsWith(".htm")) {
      if (!html || /index\./.test(name)) {
        html = await e.getData!(new TextWriter());
      }
    } else if (name.endsWith(".css")) {
      cssMap[e.filename] = await e.getData!(new TextWriter());
    }
  }
  await reader.close();
  css = Object.values(cssMap).join("\n");
  return { html, css };
}

async function isAdmin(token: string): Promise<{ ok: boolean; userId?: string }> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key);
  const { data: userData } = await sb.auth.getUser(token);
  if (!userData?.user) return { ok: false };
  const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", userData.user.id);
  const ok = Array.isArray(roles) && roles.some((r) => r.role === "admin");
  return { ok, userId: userData.user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) return jsonRes({ error: "unauthorized" }, 401);
    const role = await isAdmin(token);
    if (!role.ok) return jsonRes({ error: "forbidden" }, 403);

    const url = new URL(req.url);
    const isApply = url.searchParams.get("action") === "apply" || url.pathname.endsWith("/apply");

    if (isApply) {
      const body = await req.json();
      const html: string = String(body.html || "");
      const css: string = String(body.css || "");
      const mapping: Record<string, string | null> = body.mapping || {};
      const postsBlock = body.postsBlock || null;
      if (!html) return jsonRes({ error: "html required" }, 400);
      const doc = new DOMParser().parseFromString(html, "text/html");
      if (!doc) return jsonRes({ error: "parse failed" }, 400);
      // Strip <link rel=stylesheet> & <style> — CSS будет inline через рендерер
      doc.querySelectorAll("link[rel='stylesheet']").forEach((n) => (n as Element).remove());
      doc.querySelectorAll("style").forEach((n) => (n as Element).remove());
      // Inject placeholders
      injectPlaceholders(doc, mapping, postsBlock);
      // Add inline link to /style.css (рендерер заменяет на <style>)
      const head = doc.querySelector("head");
      if (head) {
        const linkTag = `<link rel="stylesheet" href="/style.css">`;
        head.insertAdjacentHTML?.("beforeend", linkTag);
      }
      const out = "<!DOCTYPE html>\n" + (doc.documentElement?.outerHTML || doc.body?.outerHTML || "");
      return jsonRes({ html_structure: out, css_styles: css });
    }

    const ct = req.headers.get("content-type") || "";
    let kind = "html";
    let html = "";
    let baseUrl: string | null = null;
    let cssFromZip = "";

    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      kind = String(form.get("kind") || "zip");
      const file = form.get("file") as File | null;
      if (!file) return jsonRes({ error: "file required" }, 400);
      const buf = new Uint8Array(await file.arrayBuffer());
      if (kind === "zip") {
        const r = await readZipToHtmlCss(buf);
        html = r.html; cssFromZip = r.css;
      } else {
        html = new TextDecoder().decode(buf);
      }
    } else {
      const body = await req.json();
      kind = body.kind || "html";
      if (kind === "url") {
        const url = String(body.url || "");
        if (!/^https?:\/\//i.test(url)) return jsonRes({ error: "valid url required" }, 400);
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 SeoModulBot" } });
        if (!r.ok) return jsonRes({ error: `fetch failed: ${r.status}` }, 400);
        html = await r.text();
        baseUrl = url;
      } else if (kind === "html") {
        html = String(body.html || "");
      } else {
        return jsonRes({ error: "unsupported kind" }, 400);
      }
    }

    if (!html || html.length < 50) return jsonRes({ error: "empty html" }, 400);

    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc) return jsonRes({ error: "parse failed" }, 400);

    // Inline external CSS (from URL only — we can fetch). For ZIP, cssFromZip is already collected.
    let css = "";
    if (kind === "url") css = await fetchExternalCss(doc, baseUrl);
    else if (kind === "zip") {
      css = cssFromZip;
      doc.querySelectorAll("style").forEach((s) => { css += "\n" + ((s as Element).textContent || ""); });
    } else {
      doc.querySelectorAll("style").forEach((s) => { css += "\n" + ((s as Element).textContent || ""); });
    }

    if (baseUrl) absolutizeUrls(doc, baseUrl);

    // Detect selectors
    const titleEl = pickFirst(doc, ["h1.logo", ".site-title", ".logo", "header h1", "h1"]);
    const descEl = pickFirst(doc, [".tagline", ".subtitle", ".site-description", "header p"]);
    const aboutEl = pickFirst(doc, ["#about", ".about", "section.about", "[data-about]"]);
    const contactsEl = pickFirst(doc, ["#contacts", ".contacts", "section.contacts", "address"]);
    const privacyEl = pickFirst(doc, ["#privacy", ".privacy"]);
    const authorEl = pickFirst(doc, [".author", ".author-name", "[rel=author]"]);
    const footerEl = pickFirst(doc, ["footer", ".footer", "#footer"]);
    let yearSel: string | null = null;
    if (footerEl) {
      const cp = footerEl.querySelector(".copyright,.copy,small");
      yearSel = shortPath((cp as Element) || footerEl);
    }
    const posts = detectPostsBlock(doc);
    const accent = detectAccent(doc, css);
    const fonts = detectFonts(doc, css);
    const sidebar = !!doc.querySelector("aside,.sidebar");

    const analysis: Analysis = {
      selectors: {
        site_name: { selector: shortPath(titleEl), sample: sampleText(titleEl) },
        site_description: { selector: shortPath(descEl), sample: sampleText(descEl) },
        site_about: { selector: shortPath(aboutEl), sample: sampleText(aboutEl, 200) },
        contacts_content: { selector: shortPath(contactsEl), sample: sampleText(contactsEl, 200) },
        privacy_content: { selector: shortPath(privacyEl), sample: sampleText(privacyEl, 200) },
        author_name: { selector: shortPath(authorEl), sample: sampleText(authorEl) },
        year: { selector: yearSel, sample: sampleText(footerEl, 80) },
      },
      postsBlock: posts,
      accentColor: accent,
      headingFont: fonts.heading,
      bodyFont: fonts.body,
      hasFooter: !!footerEl,
      hasSidebar: sidebar,
    };

    return jsonRes({
      analysis,
      raw_html: html,
      raw_css: css,
    });
  } catch (e) {
    console.error("converter error", e);
    return jsonRes({ error: String((e as Error).message || e) }, 500);
  }
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ===========================================================
// Apply mapping endpoint not separate — UI sends mapping back with /apply path.
// To keep one function, support `?action=apply` POST with JSON:
//   { html, css, mapping, postsBlock }
// Returns { html_structure, css_styles }.
// (Implemented via routing below if pathname endsWith /apply)
// We export apply via a second handler:
