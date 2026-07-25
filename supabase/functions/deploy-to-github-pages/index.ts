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
      .select("id, ecosystem_id, format_type, pdf_path, pdf_url, status, content, image_urls, content_ecosystems!inner(id, user_id, client_id, source_article_id, clients(id, user_id, name, domain, brand_color, expert_name, expert_bio, expert_photo_url, contact_email, contact_phone, logo_url, github_username, github_repo, github_pages_url, github_token_encrypted), articles(id, title, meta_description, lsi_keywords, main_keyword))")
      .eq("id", formatId)
      .maybeSingle();
    if (fmtErr || !fmt) throw new Error("format_not_found");
    formatType = fmt.format_type;
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
    const title = article?.title || "Документ";
    const slug = slugify(title);
    const owner = client.github_username.replace(/[^A-Za-z0-9-]/g, "");
    const repo = (client.github_repo || "docs").replace(/[^A-Za-z0-9._-]/g, "");
    const pagesBase = (client.github_pages_url || `https://${owner}.github.io/${repo}`).replace(/\/+$/, "");
    const fullUrl = `${pagesBase}/${slug}/`;
    const pdfPublicUrl = `${pagesBase}/${slug}/${slug}.pdf`;
    const description = article?.meta_description || "";
    const lsi: string[] = Array.isArray(article?.lsi_keywords) ? article.lsi_keywords.slice(0, 20) : [];
    const nowIso = new Date().toISOString();
    const brandColor: string = (client.brand_color && /^#[0-9a-fA-F]{6}$/.test(client.brand_color))
      ? client.brand_color : "#6E56CF";
    const domainClean = cleanDomain(client.domain);
    const orgUrl = domainClean ? `https://${domainClean}` : "";
    const commitMsg = `[Distribution] ${slug} — ${nowIso}`;

    // 6. Parse markdown content
    const parsed = parseChecklistMarkdown((fmt as any).content || "");
    const displayTitle = parsed.h1 || title;
    const introText = parsed.intro || description;
    const metaDesc = description || introText.slice(0, 200);

    // 7. Copy hero images into the repo so links survive Supabase signed-URL expiry
    const sourceImageUrls: string[] = Array.isArray((fmt as any).image_urls) ? (fmt as any).image_urls : [];
    const localImages: string[] = [];
    for (let idx = 0; idx < Math.min(sourceImageUrls.length, 4); idx++) {
      const raw = await fetchBytes(sourceImageUrls[idx]);
      if (!raw) continue;
      const name = `img-${idx + 1}.${raw.ext}`;
      try {
        await putContent(token, owner, repo, `${slug}/images/${name}`, bytesToBase64(raw.bytes), `${commitMsg} image ${idx + 1}`);
        localImages.push(`./images/${name}`);
      } catch (e) {
        console.warn("[deploy-to-github-pages] image upload failed:", (e as Error).message);
      }
    }
    const heroImage = localImages[0] || "";
    const midImage = localImages[1] || "";
    const heroImageAbs = heroImage ? `${pagesBase}/${slug}/${heroImage.replace(/^\.\//, "")}` : "";

    // 8. Schema.org HowTo
    const jsonLd: any = {
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: displayTitle,
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
      ...(heroImageAbs ? { image: heroImageAbs } : {}),
      step: parsed.items.map((it) => ({
        "@type": "HowToStep",
        name: stripMd(it.title),
        text: stripMd(it.description) || stripMd(it.title),
      })),
    };

    const expertInitial = escapeHtml(((client.expert_name || client.name || "?").trim()[0] || "?").toUpperCase());
    const authorHtml = client.expert_photo_url
      ? `<img src="${escapeHtml(client.expert_photo_url)}" alt="${escapeHtml(client.expert_name || client.name || "")}" class="author-photo">`
      : `<div class="author-photo author-initial" style="background:${brandColor}">${expertInitial}</div>`;

    // 9. Full HTML landing
    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(displayTitle)}</title>
<meta name="description" content="${escapeHtml(metaDesc)}">
<meta name="keywords" content="${escapeHtml(lsi.join(", "))}">
<meta name="author" content="${escapeHtml([client.expert_name, client.name].filter(Boolean).join(", "))}">
<link rel="canonical" href="${escapeHtml(fullUrl)}">
<meta property="og:title" content="${escapeHtml(displayTitle)}">
<meta property="og:description" content="${escapeHtml(metaDesc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${escapeHtml(fullUrl)}">
${heroImageAbs ? `<meta property="og:image" content="${escapeHtml(heroImageAbs)}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(displayTitle)}">
<meta name="twitter:description" content="${escapeHtml(metaDesc)}">
${heroImageAbs ? `<meta name="twitter:image" content="${escapeHtml(heroImageAbs)}">` : ""}
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
  :root{--brand:${brandColor};--ink:#111;--muted:#5b6470;--line:#e5e7eb;--surface:#f5f5f7;}
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--ink);line-height:1.6;margin:0;background:#fff;-webkit-font-smoothing:antialiased}
  .container{max-width:800px;margin:0 auto;padding:24px 20px 60px}
  .brand{font-size:13px;color:var(--muted);letter-spacing:.02em;padding:8px 0 24px;border-bottom:1px solid var(--line);margin-bottom:32px}
  .brand b{color:var(--ink);font-weight:600}
  h1{font-size:34px;line-height:1.2;margin:0 0 8px;color:var(--brand);font-weight:700;letter-spacing:-.01em}
  .subtitle{color:var(--muted);font-size:13px;margin:0 0 24px;text-transform:uppercase;letter-spacing:.08em;font-weight:500}
  .hero{width:100%;height:auto;border-radius:12px;margin:0 0 28px;display:block}
  .intro{font-size:18px;color:#333;margin:0 0 28px}
  .download-top{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border:1.5px solid var(--brand);color:var(--brand);text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;margin-bottom:36px;transition:all .15s}
  .download-top:hover{background:var(--brand);color:#fff}
  .checklist{list-style:none;padding:0;margin:0 0 40px}
  .checklist li{display:flex;gap:14px;padding:16px 0;border-bottom:1px solid var(--line)}
  .checklist li:last-child{border-bottom:none}
  .check{flex-shrink:0;width:22px;height:22px;border:2px solid var(--brand);border-radius:5px;margin-top:2px}
  .item-body{flex:1;min-width:0}
  .item-title{font-weight:700;font-size:16px;margin:0 0 4px;color:var(--ink)}
  .item-desc{color:#333;font-size:15px;margin:0}
  .item-desc a,.intro a{color:var(--brand);text-decoration:underline}
  .mid-image{width:100%;height:auto;border-radius:12px;margin:32px 0;display:block}
  .notes{background:var(--surface);border-radius:12px;padding:24px 28px;margin:8px 0 40px}
  .notes h2{font-size:20px;margin:0 0 14px;color:var(--ink)}
  .notes p{margin:0 0 10px;font-size:15px;color:#333}
  .notes p:last-child{margin-bottom:0}
  .author-card{display:flex;gap:18px;align-items:flex-start;background:var(--surface);border-radius:12px;padding:24px;margin:40px 0}
  .author-photo{width:80px;height:80px;border-radius:50%;object-fit:cover;flex-shrink:0}
  .author-initial{display:flex;align-items:center;justify-content:center;color:#fff;font-size:32px;font-weight:600}
  .author-name{font-weight:700;font-size:17px;margin:0 0 4px}
  .author-bio{color:var(--muted);font-size:14px;margin:0 0 10px;line-height:1.5}
  .author-org a{color:var(--brand);text-decoration:none;font-weight:500;font-size:14px}
  .author-contacts{font-size:13px;color:var(--muted);margin-top:8px}
  .author-contacts span{margin-right:14px;display:inline-block}
  .author-contacts a{color:inherit;text-decoration:none}
  .cta{display:block;text-align:center;background:var(--brand);color:#fff;padding:16px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;margin:24px 0 16px;transition:opacity .15s}
  .cta:hover{opacity:.9}
  .pdf-link{display:block;text-align:center;color:var(--muted);text-decoration:none;font-size:14px;padding:8px;margin-bottom:24px}
  .pdf-link:hover{color:var(--brand)}
  footer{border-top:1px solid var(--line);padding-top:20px;color:var(--muted);font-size:13px;text-align:center}
  footer p{margin:4px 0}
  @media (max-width:600px){
    h1{font-size:26px}
    .container{padding:20px 16px 40px}
    .author-card{flex-direction:column;align-items:center;text-align:center}
    .notes{padding:20px}
  }
</style>
</head>
<body>
<div class="container">
  <div class="brand"><b>${escapeHtml(client.name || "")}</b></div>
  <h1>${escapeHtml(displayTitle)}</h1>
  <p class="subtitle">Практический чек-лист</p>
  ${heroImage ? `<img src="${escapeHtml(heroImage)}" alt="${escapeHtml(displayTitle)}" class="hero" loading="lazy">` : ""}
  ${introText ? `<p class="intro">${renderInline(introText)}</p>` : ""}
  <a href="./${escapeHtml(slug)}.pdf" download class="download-top">📄 Скачать в PDF</a>
  <ul class="checklist">
${parsed.items.map((it) => `    <li>
      <div class="check" aria-hidden="true"></div>
      <div class="item-body">
        <p class="item-title">${renderInline(it.title)}</p>
        ${it.description ? `<p class="item-desc">${renderInline(it.description)}</p>` : ""}
      </div>
    </li>`).join("\n")}
  </ul>
  ${midImage ? `<img src="${escapeHtml(midImage)}" alt="" class="mid-image" loading="lazy">` : ""}
  ${parsed.notes.length ? `<section class="notes">
    <h2>${escapeHtml(parsed.finalHeading)}</h2>
${parsed.notes.map((n) => `    <p>${renderInline(n)}</p>`).join("\n")}
  </section>` : ""}
  <div class="author-card">
    ${authorHtml}
    <div>
      <p class="author-name">${escapeHtml(client.expert_name || client.name || "")}</p>
      ${client.expert_bio ? `<p class="author-bio">${escapeHtml(client.expert_bio)}</p>` : ""}
      ${client.name ? (orgUrl
        ? `<div class="author-org"><a href="${escapeHtml(orgUrl)}" target="_blank" rel="noopener">${escapeHtml(client.name)}</a></div>`
        : `<div class="author-org">${escapeHtml(client.name)}</div>`) : ""}
      <div class="author-contacts">
        ${client.contact_email ? `<span>Email: <a href="mailto:${escapeHtml(client.contact_email)}">${escapeHtml(client.contact_email)}</a></span>` : ""}
        ${client.contact_phone ? `<span>Тел.: ${escapeHtml(client.contact_phone)}</span>` : ""}
      </div>
    </div>
  </div>
  ${orgUrl ? `<a href="${escapeHtml(orgUrl)}" target="_blank" rel="noopener" class="cta">Обсудить подбор с экспертом</a>` : ""}
  <a href="./${escapeHtml(slug)}.pdf" download class="pdf-link">Скачать чек-лист в PDF</a>
  <footer>
    <p>Материал подготовлен: ${escapeHtml([client.expert_name, client.name].filter(Boolean).join(", "))}</p>
    <p>© ${new Date().getFullYear()} ${escapeHtml(client.name || "")}</p>
  </footer>
</div>
</body>
</html>`;

    // 10. Push page files
    await putContent(token, owner, repo, `${slug}/${slug}.pdf`, bytesToBase64(pdfBytes), commitMsg);
    await putContent(token, owner, repo, `${slug}/index.html`, utf8Base64(html), commitMsg);

    // 11. Refresh root robots.txt + sitemap.xml with every deployed format for this client
    try {
      const { data: allDeps } = await admin
        .from("format_deployments")
        .select("published_url, deployed_at, status, ecosystem_formats!inner(ecosystem_id, content_ecosystems!inner(client_id))")
        .eq("platform", "github_pages")
        .eq("status", "deployed")
        .eq("ecosystem_formats.content_ecosystems.client_id", client.id);
      const urlSet = new Map<string, string>();
      urlSet.set(fullUrl, nowIso); // ensure current one included even if row not updated yet
      for (const d of (allDeps || []) as any[]) {
        if (d.published_url && String(d.published_url).startsWith(pagesBase)) {
          urlSet.set(d.published_url, d.deployed_at || nowIso);
        }
      }
      const robots = `User-agent: *\nAllow: /\nSitemap: ${pagesBase}/sitemap.xml\n`;
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
        [...urlSet.entries()].map(([u, ts]) =>
          `  <url>\n    <loc>${escapeHtml(u)}</loc>\n    <lastmod>${String(ts || nowIso).split("T")[0]}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`
        ).join("\n")
      }\n</urlset>\n`;
      await putContent(token, owner, repo, `robots.txt`, utf8Base64(robots), `[Distribution] robots.txt refresh`);
      await putContent(token, owner, repo, `sitemap.xml`, utf8Base64(sitemap), `[Distribution] sitemap refresh`);
    } catch (e) {
      console.warn("[deploy-to-github-pages] sitemap/robots refresh failed:", (e as Error).message);
    }

    // 12. Update deployment
    await admin.from("format_deployments").update({
      status: "deployed",
      published_url: fullUrl,
      deployed_at: nowIso,
      error_reason: null,
    }).eq("id", deploymentId);

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
        items_count: parsed.items.length,
        images_count: localImages.length,
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