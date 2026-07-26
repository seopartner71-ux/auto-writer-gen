// Reusable image fetcher for Content Ecosystem documents.
// Generates 3-5 English photo query variants via Gemini, searches Unsplash
// (with a Pexels-key fallback path), ranks by likes+downloads, uploads the
// top N to Supabase storage and returns signed URLs. Best-effort: any failure
// returns an empty array so the caller (PDF builder) simply skips images.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiTranslateToPhotoQuery, fetchPexelsPhotos } from "./unsplash.ts";

export interface FetchDocPhotosArgs {
  userId: string;
  ecosystemId: string;
  slug: string;      // document type slug (checklist/memo/howto/guide/...)
  query: string;     // main keyword or title
  count?: number;    // desired photo count, default 3
}

export async function fetchDocumentPhotos(
  // deno-lint-ignore no-explicit-any
  admin: any,
  args: FetchDocPhotosArgs,
): Promise<string[]> {
  const count = Math.max(1, Math.min(6, args.count ?? 3));
  const rawQuery = (args.query || "").trim();
  if (!rawQuery) {
    console.warn("[DOC-PHOTOS] empty query");
    return [];
  }
  const unsplashKey = (Deno.env.get("UNSPLASH_ACCESS_KEY") || "").trim();
  const pexelsKey = (Deno.env.get("PEXELS_API_KEY") || "").trim();
  if (!unsplashKey && !pexelsKey) {
    console.warn("[DOC-PHOTOS] no UNSPLASH_ACCESS_KEY / PEXELS_API_KEY");
    return [];
  }

  // 1. Query variants
  let queries: string[] = [];
  try {
    queries = await generateQueryVariants(rawQuery);
  } catch (e) {
    console.warn("[DOC-PHOTOS] variants failed:", (e as Error).message);
  }
  if (queries.length === 0) {
    try {
      const fb = await aiTranslateToPhotoQuery(rawQuery);
      if (fb) queries = [fb];
    } catch { /* ignore */ }
    if (queries.length === 0) queries = [rawQuery];
  }
  console.log("[DOC-PHOTOS] queries", { source: rawQuery, variants: queries });

  // 2. Search — Unsplash first (has richer ranking data), then Pexels fallback.
  // deno-lint-ignore no-explicit-any
  const pool: any[] = [];
  if (unsplashKey) {
    const searches = await Promise.all(queries.map(async (q) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10000);
        const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=4&orientation=landscape&content_filter=high&client_id=${encodeURIComponent(unsplashKey)}`;
        const r = await fetch(url, { signal: ctrl.signal, headers: { "Accept-Version": "v1" } });
        clearTimeout(timer);
        if (!r.ok) return [] as any[];
        const j = await r.json();
        return (Array.isArray(j?.results) ? j.results : []).map((p: any) => ({
          id: `unsplash:${p.id}`,
          url: p?.urls?.regular,
          score: (Number(p?.likes) || 0) + 2 * (Number(p?.downloads) || 0),
        }));
      } catch { return []; }
    }));
    for (const arr of searches) pool.push(...arr);
  }
  if (pool.length === 0 && pexelsKey) {
    for (const q of queries) {
      const arr = await fetchPexelsPhotos(pexelsKey, q, 4);
      for (const p of arr) pool.push({ id: `pexels:${p.url}`, url: p.url, score: 1 });
    }
  }

  // 3. Dedupe + rank + take top N
  const byId = new Map<string, { id: string; url: string; score: number }>();
  for (const p of pool) if (p?.url && !byId.has(p.id)) byId.set(p.id, p);
  const ranked = Array.from(byId.values()).sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, count);
  console.log("[DOC-PHOTOS] top", { unique: byId.size, taken: top.length });
  if (top.length === 0) return [];

  // 4. Upload to storage and sign URLs
  const uploaded: string[] = [];
  for (let idx = 0; idx < top.length; idx++) {
    try {
      const img = await fetch(top[idx].url);
      if (!img.ok) throw new Error(`img HTTP ${img.status}`);
      const bytes = new Uint8Array(await img.arrayBuffer());
      const path = `${args.userId}/${args.ecosystemId}/${args.slug}/images/${Date.now()}_${idx + 1}.jpg`;
      const { error: upErr } = await admin.storage
        .from("ecosystem-formats")
        .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
      if (upErr) throw upErr;
      const { data: signed } = await admin.storage
        .from("ecosystem-formats")
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      if (signed?.signedUrl) uploaded.push(signed.signedUrl);
    } catch (e) {
      console.warn(`[DOC-PHOTOS] upload ${idx + 1} failed: ${(e as Error).message}`);
    }
  }
  return uploaded;
}

async function generateQueryVariants(topic: string): Promise<string[]> {
  const trimmed = String(topic || "").trim();
  if (!trimmed) return [];
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: orKey } = await admin
    .from("api_keys").select("api_key")
    .eq("provider", "openrouter").eq("is_valid", true).single();
  const key = orKey?.api_key || Deno.env.get("OPENROUTER_API_KEY");
  if (!key) return [];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`, "Content-Type": "application/json",
        "X-Title": "SEO-Module / doc-photos",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 0.4, max_tokens: 220,
        messages: [
          { role: "system", content: "Ты помогаешь подобрать фото на Unsplash. Верни СТРОГО JSON-массив из 5 разных английских поисковых запросов, отражающих тему с разных углов (общий, специфичный, эмоциональный, визуальный, контекстный). Только массив строк, без пояснений и markdown." },
          { role: "user", content: `Тема материала: "${trimmed.slice(0, 200)}"` },
        ],
      }),
    });
    clearTimeout(timer);
    if (!r.ok) return [];
    const j = await r.json();
    const raw = String(j?.choices?.[0]?.message?.content || "").trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const arr = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(arr)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of arr) {
      const q = String(s || "").trim().replace(/["'`]+/g, "").replace(/\s{2,}/g, " ");
      if (!q || q.length > 80 || /[\u0400-\u04FF]/.test(q)) continue;
      const k = q.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); out.push(q);
      if (out.length >= 5) break;
    }
    return out;
  } catch {
    clearTimeout(timer);
    return [];
  }
}