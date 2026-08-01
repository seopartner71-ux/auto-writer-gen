// Submit published ecosystem URLs (landing + PDF) to IndexNow.
// Body: { deployment_ids: string[] }  — or { client_id: string } for all deployed rows.
// Ensures the client repo hosts {key}.txt, then posts the batch to api.indexnow.org.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";

const GH = "https://api.github.com";

function utf8Base64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function ghPut(token: string, owner: string, repo: string, path: string, contentB64: string, message: string) {
  const url = `${GH}/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  let sha: string | undefined;
  const cur = await fetch(url, { headers });
  if (cur.ok) sha = (await cur.json())?.sha;
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({ message, content: contentB64, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

function newKey(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const __auth = await verifyAuth(req);
    if (__auth instanceof Response) return __auth;
    const userId = __auth.userId;

    const body = await req.json().catch(() => ({}));
    const deploymentIds: string[] = Array.isArray(body.deployment_ids) ? body.deployment_ids.filter(Boolean) : [];
    const clientId: string | null = body.client_id || null;

    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });

    if (deploymentIds.length === 0 && !clientId) {
      return errorResponse("deployment_ids или client_id обязательны", 400);
    }

    // 1. Deployments
    let q = admin
      .from("format_deployments")
      .select("id, published_url, pdf_url, status, ecosystem_format_id")
      .eq("status", "deployed");
    if (deploymentIds.length > 0) q = q.in("id", deploymentIds);
    const { data: deployRows, error } = await q;
    if (error) throw error;

    // 2. Resolve format -> ecosystem -> client chain
    const formatIds = Array.from(new Set((deployRows || []).map((r: any) => r.ecosystem_format_id).filter(Boolean)));
    const { data: formats } = formatIds.length
      ? await admin.from("ecosystem_formats").select("id, ecosystem_id").in("id", formatIds)
      : { data: [] as any[] };
    const ecoIds = Array.from(new Set((formats || []).map((f: any) => f.ecosystem_id).filter(Boolean)));
    const { data: ecos } = ecoIds.length
      ? await admin.from("content_ecosystems").select("id, user_id, client_id").in("id", ecoIds)
      : { data: [] as any[] };
    const clientIds = Array.from(new Set((ecos || []).map((e: any) => e.client_id).filter(Boolean)));
    const { data: clientRows } = clientIds.length
      ? await admin.from("clients")
          .select("id, user_id, name, indexnow_key, github_username, github_repo, github_token_encrypted")
          .in("id", clientIds)
      : { data: [] as any[] };

    const formatById = new Map((formats || []).map((f: any) => [f.id, f]));
    const ecoById = new Map((ecos || []).map((e: any) => [e.id, e]));
    const clientById = new Map((clientRows || []).map((c: any) => [c.id, c]));

    // 3. Group by client, keeping only rows owned by the caller
    const byClient = new Map<string, { client: any; deps: any[] }>();
    for (const r of (deployRows || []) as any[]) {
      const eco = ecoById.get(formatById.get(r.ecosystem_format_id)?.ecosystem_id);
      if (!eco || (eco.user_id !== userId && !isAdmin)) continue;
      if (clientId && eco.client_id !== clientId) continue;
      const c = clientById.get(eco.client_id);
      if (!c) continue;
      const entry = byClient.get(c.id) || { client: c, deps: [] };
      entry.deps.push(r);
      byClient.set(c.id, entry);
    }

    if (byClient.size === 0) {
      return jsonResponse({ ok: true, submitted: 0, results: [], message: "Нет подходящих публикаций" });
    }

    const results: any[] = [];
    let submittedCount = 0;

    for (const { client, deps } of byClient.values()) {
      const urls = Array.from(new Set(
        deps.flatMap((d) => [d.published_url, d.pdf_url]).filter((u): u is string => !!u && /^https?:\/\//i.test(u)),
      ));
      if (urls.length === 0) continue;

      let host = "";
      try { host = new URL(urls[0]).host; } catch { continue; }

      // 1. Ensure key exists on the client record
      let key: string = client.indexnow_key || "";
      if (!key) {
        key = newKey();
        await admin.from("clients").update({ indexnow_key: key }).eq("id", client.id);
      }

      // 2. Ensure {key}.txt is published in the client's GitHub Pages repo
      let keyLocation = `https://${host}/${key}.txt`;
      try {
        if (client.github_username && client.github_repo && client.github_token_encrypted) {
          const { data: dec } = await admin.rpc("decrypt_sensitive", { ciphertext: client.github_token_encrypted });
          if (dec) {
            await ghPut(String(dec), client.github_username, client.github_repo, `${key}.txt`, utf8Base64(key), "[IndexNow] key file");
          }
        }
      } catch (e) {
        console.warn("[submit-to-indexnow] key file upload failed:", (e as Error).message);
      }

      // 3. Submit batch
      let status = "submitted";
      let response: any = null;
      try {
        const res = await fetch("https://api.indexnow.org/indexnow", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ host, key, keyLocation, urlList: urls }),
        });
        const text = (await res.text()).slice(0, 500);
        response = { code: res.status, body: text, urls_count: urls.length, submitted_at: new Date().toISOString() };
        if (res.status < 200 || res.status >= 300) status = "error";
      } catch (e) {
        status = "error";
        response = { error: (e as Error).message, urls_count: urls.length };
      }

      const nowIso = new Date().toISOString();
      await admin.from("format_deployments").update({
        indexnow_submitted_at: nowIso,
        indexnow_response: response,
        indexing_status: status,
        indexing_status_google: status === "error" ? "error" : "submitted",
        indexing_status_yandex: status === "error" ? "error" : "submitted",
      }).in("id", deps.map((d) => d.id));

      if (status === "submitted") submittedCount += deps.length;
      results.push({ client: client.name, host, urls: urls.length, status, response });
    }

    return jsonResponse({ ok: true, submitted: submittedCount, results });
  } catch (err: any) {
    console.error("[submit-to-indexnow] error:", err?.message || err);
    return errorResponse(err?.message || String(err), 500);
  }
});
