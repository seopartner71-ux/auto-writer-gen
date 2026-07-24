// Deploy a checklist PDF (from ecosystem_formats) to a client's GitHub Pages repo.
// Body: { ecosystem_format_id: string }
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
  // Look up existing sha to allow overwrite.
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
      .select("id, ecosystem_id, format_type, pdf_path, pdf_url, status, content_ecosystems!inner(id, user_id, client_id, source_article_id, clients(id, user_id, name, domain, expert_name, github_username, github_repo, github_pages_url, github_token_encrypted), articles(id, title, meta_description, lsi_keywords))")
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
    const pdfUrl = `${pagesBase}/${slug}/${slug}.pdf`;
    const description = article?.meta_description || "";
    const lsi: string[] = Array.isArray(article?.lsi_keywords) ? article.lsi_keywords.slice(0, 20) : [];
    const nowIso = new Date().toISOString();

    // 6. HTML landing
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: title,
      description,
      author: { "@type": "Person", name: client.expert_name || client.name },
      publisher: {
        "@type": "Organization",
        name: client.name,
        url: client.domain ? `https://${client.domain}` : undefined,
      },
      datePublished: nowIso,
      url: fullUrl,
    };
    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="keywords" content="${escapeHtml(lsi.join(", "))}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="article">
<meta name="author" content="${escapeHtml([client.expert_name, client.name].filter(Boolean).join(", "))}">
<link rel="canonical" href="${escapeHtml(fullUrl)}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#111;line-height:1.55}
  h1{font-size:28px;margin:0 0 12px}
  .desc{color:#444;font-size:16px;margin-bottom:24px}
  .btn{display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600}
  .author{margin-top:32px;padding-top:16px;border-top:1px solid #eee;color:#666;font-size:14px}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="desc">${escapeHtml(description)}</p>
<p><a class="btn" href="./${escapeHtml(slug)}.pdf" download>📄 Скачать PDF</a></p>
<p class="author">Материал подготовлен: ${escapeHtml([client.expert_name, client.name].filter(Boolean).join(", "))}</p>
</body>
</html>`;

    // 7. Push files
    const commitMsg = `[Distribution] ${slug} — ${nowIso}`;
    await putContent(token, owner, repo, `${slug}/${slug}.pdf`, bytesToBase64(pdfBytes), commitMsg);
    await putContent(token, owner, repo, `${slug}/index.html`, utf8Base64(html), commitMsg);

    // 8. Update deployment
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
      },
    });

    return new Response(JSON.stringify({
      success: true,
      deployment_id: deploymentId,
      published_url: fullUrl,
      pdf_url: pdfUrl,
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