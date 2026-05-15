// Generate or refresh the semantic embedding for one or many articles.
//
// Body:
//   { article_id: string }              // single article
//   { project_id: string, limit?: 50 }  // backfill missing embeddings in a project
//   { all?: true, limit?: 100 }         // admin-only: backfill across the whole DB
//
// Strategy:
//   1) OpenRouter (/v1/embeddings, openai/text-embedding-3-small) using
//      OPENROUTER_API_KEY — already configured, same key as the writer uses.
//   2) Fall back to OpenAI direct (api.openai.com) using OPENAI_API_KEY if set.
//   3) If neither works, return 200 with skipped=true so the caller never breaks.
//
// Embeddings are stored on articles.embedding (vector(1536)).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMBED_MODEL_OPENROUTER = "openai/text-embedding-3-small";
const EMBED_MODEL_OPENAI = "text-embedding-3-small";

function stripHtml(html: string): string {
  return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function buildEmbedText(title: string | null, content: string | null): string {
  // Title gets repeated for weight; first ~3000 chars of body cover main topic.
  const t = (title || "").trim();
  const body = stripHtml(content || "").slice(0, 3000);
  return [t, t, body].filter(Boolean).join(". ");
}

async function getOpenRouterKey(admin: any): Promise<string | null> {
  // Prefer the rotating key stored in the API Vault, fall back to env.
  try {
    const { data } = await admin.from("api_keys").select("api_key")
      .eq("provider", "openrouter").eq("is_valid", true).limit(1).maybeSingle();
    if (data?.api_key) return data.api_key;
  } catch (_) { /* ignore */ }
  return Deno.env.get("OPENROUTER_API_KEY") || null;
}

async function callEmbedding(text: string, openrouterKey: string | null): Promise<number[] | null> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  // Strategy 1: OpenRouter
  if (openrouterKey) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openrouterKey}`,
          "Content-Type": "application/json",
          "X-Title": "SEO-Module Semantic Interlinking",
        },
        body: JSON.stringify({ model: EMBED_MODEL_OPENROUTER, input: text }),
      });
      if (r.ok) {
        const data = await r.json();
        const vec = data?.data?.[0]?.embedding;
        if (Array.isArray(vec) && vec.length === 1536) return vec;
      } else {
        console.warn("[generate-embedding] openrouter HTTP", r.status);
      }
    } catch (e) {
      console.warn("[generate-embedding] openrouter error:", (e as Error).message);
    }
  }

  // Strategy 2: OpenAI direct
  if (openaiKey) {
    try {
      const r = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: EMBED_MODEL_OPENAI, input: text }),
      });
      if (r.ok) {
        const data = await r.json();
        const vec = data?.data?.[0]?.embedding;
        if (Array.isArray(vec) && vec.length === 1536) return vec;
      } else {
        console.warn("[generate-embedding] openai HTTP", r.status);
      }
    } catch (e) {
      console.warn("[generate-embedding] openai error:", (e as Error).message);
    }
  }

  return null;
}

async function embedAndStore(admin: any, openrouterKey: string | null, row: { id: string; title: string | null; content: string | null }): Promise<boolean> {
  const text = buildEmbedText(row.title, row.content);
  if (!text || text.length < 30) return false;
  const vec = await callEmbedding(text, openrouterKey);
  if (!vec) return false;
  // pgvector accepts the JSON array text form directly.
  const { error } = await admin
    .from("articles")
    .update({ embedding: JSON.stringify(vec) })
    .eq("id", row.id);
  if (error) {
    console.error("[generate-embedding] update fail:", row.id, error.message);
    return false;
  }
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, service);

    const openrouterKey = await getOpenRouterKey(admin);

    const body = await req.json().catch(() => ({}));
    const articleId: string | undefined = body.article_id;
    const projectId: string | undefined = body.project_id;
    const all: boolean = body.all === true;
    const limit: number = Math.min(Math.max(Number(body.limit) || 50, 1), 200);

    // ── Single article ──
    if (articleId) {
      const { data: row } = await admin
        .from("articles")
        .select("id, title, content, embedding")
        .eq("id", articleId)
        .maybeSingle();
      if (!row) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const ok = await embedAndStore(admin, openrouterKey, row);
      return new Response(JSON.stringify({ ok, article_id: articleId, skipped: !ok }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Backfill: project or global ──
    let q = admin
      .from("articles")
      .select("id, title, content")
      .is("embedding", null)
      .not("title", "is", null)
      .not("content", "is", null)
      .in("status", ["completed", "published"])
      .order("created_at", { ascending: false })
      .limit(limit);
    if (projectId) q = q.eq("project_id", projectId);
    if (!projectId && !all) {
      return new Response(JSON.stringify({ error: "Provide article_id, project_id, or all:true" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: rows, error } = await q;
    if (error) throw error;
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, message: "No articles need embedding" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0;
    let failed = 0;
    for (const r of rows) {
      const ok = await embedAndStore(admin, openrouterKey, r);
      if (ok) processed++; else failed++;
      // gentle throttle to stay under rate limits
      await new Promise((res) => setTimeout(res, 80));
    }

    return new Response(JSON.stringify({ ok: true, processed, failed, scanned: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-embedding error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});