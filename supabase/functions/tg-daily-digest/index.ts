import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type ArticleRow = {
  id: string;
  user_id: string | null;
  title: string | null;
  status: string | null;
  ai_score: number | null;
  generation_model: string | null;
  content_topic_id: string | null;
  source: string | null;
  quality_status: string | null;
  updated_at: string | null;
  created_at: string | null;
};

function labelSource(a: ArticleRow): string {
  if (a.content_topic_id) return "Контент-план";
  const s = (a.source || "").toLowerCase();
  if (s === "commercial") return "Коммерческий";
  if (s === "factory" || s === "site_factory") return "Фабрика";
  if (s === "bulk") return "Пакетная";
  if (s === "quickstart" || s === "quick_start") return "Quick Start";
  return "Редактор";
}

function labelModel(m: string | null | undefined): string {
  if (!m) return "Модель не указана";
  const s = String(m);
  // trim provider prefix like "openrouter/anthropic/claude-3.5-sonnet"
  const parts = s.split("/");
  const tail = parts[parts.length - 1];
  return tail
    .replace(/^anthropic-/i, "")
    .replace(/^openai-/i, "")
    .replace(/^mistralai-/i, "")
    .replace(/-latest$/i, "");
}

function formatDateRu(d: Date): string {
  return d.toLocaleDateString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Window: last 24h (МСК-aware handled via UTC delta)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: rows, error } = await admin
      .from("articles")
      .select(
        "id, user_id, title, status, ai_score, generation_model, content_topic_id, source, quality_status, updated_at, created_at"
      )
      .eq("is_ab_test", false)
      .gte("updated_at", since)
      .limit(2000);

    if (error) throw new Error(error.message);

    const list = (rows || []) as ArticleRow[];
    const doneStatuses = new Set(["completed", "done", "published"]);
    const errorStatuses = new Set(["error", "failed"]);

    const doneArticles = list.filter((a) => doneStatuses.has(String(a.status || "").toLowerCase()));
    const brokenArticles = list.filter((a) => errorStatuses.has(String(a.status || "").toLowerCase()));
    const needsImprove = doneArticles.filter(
      (a) => String(a.quality_status || "").toLowerCase() === "needs_improve"
    ).length;

    const dateLabel = formatDateRu(new Date());

    if (doneArticles.length === 0) {
      const emptyText = `📊 <b>Статьи за ${dateLabel}</b>\n\nСегодня статей не было.`;
      await postDigest(supabaseUrl, serviceRoleKey, emptyText);
      return new Response(JSON.stringify({ ok: true, total: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load profiles for grouping
    const userIds = Array.from(new Set(doneArticles.map((a) => a.user_id).filter(Boolean))) as string[];
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);
    const nameById = new Map<string, string>();
    for (const p of profiles || []) {
      nameById.set(p.id as string, (p.full_name as string) || (p.email as string) || "Без имени");
    }

    // Group
    type Bucket = {
      name: string;
      count: number;
      models: Map<string, number>;
      sources: Map<string, number>;
      scoreSum: number;
      scoreN: number;
    };
    const buckets = new Map<string, Bucket>();
    for (const a of doneArticles) {
      const uid = a.user_id || "unknown";
      let b = buckets.get(uid);
      if (!b) {
        b = {
          name: nameById.get(uid) || "Без имени",
          count: 0,
          models: new Map(),
          sources: new Map(),
          scoreSum: 0,
          scoreN: 0,
        };
        buckets.set(uid, b);
      }
      b.count += 1;
      const model = labelModel(a.generation_model);
      b.models.set(model, (b.models.get(model) || 0) + 1);
      const src = labelSource(a);
      b.sources.set(src, (b.sources.get(src) || 0) + 1);
      if (typeof a.ai_score === "number") {
        b.scoreSum += a.ai_score;
        b.scoreN += 1;
      }
    }

    // Sort users by article count desc
    const sorted = Array.from(buckets.values()).sort((a, b) => b.count - a.count);

    const lines: string[] = [];
    lines.push(`📊 <b>Статьи за ${dateLabel} — всего ${doneArticles.length}</b>`);
    lines.push("");

    for (const b of sorted) {
      lines.push(`<b>${esc(b.name)}</b> — ${b.count} ${pluralArticles(b.count)}`);
      const modelsStr = formatCounts(b.models);
      if (modelsStr) lines.push(`  Модели: ${esc(modelsStr)}`);
      const sourcesStr = formatCounts(b.sources);
      if (sourcesStr) lines.push(`  Источники: ${esc(sourcesStr)}`);
      if (b.scoreN > 0) {
        const avg = Math.round(b.scoreSum / b.scoreN);
        lines.push(`  Средняя человечность: ${avg}/100`);
      }
      lines.push("");
    }

    lines.push(
      `Требуют доработки: ${needsImprove} | Битых заблокировано: ${brokenArticles.length}`
    );

    const text = lines.join("\n");
    await postDigest(supabaseUrl, serviceRoleKey, text);

    return new Response(
      JSON.stringify({ ok: true, total: doneArticles.length, users: sorted.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("tg-daily-digest error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function pluralArticles(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "статья";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "статьи";
  return "статей";
}

function formatCounts(m: Map<string, number>): string {
  const arr = Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  return arr.map(([k, v]) => `${k} ${v}`).join(", ");
}

async function postDigest(supabaseUrl: string, serviceKey: string, text: string) {
  const res = await fetch(`${supabaseUrl}/functions/v1/telegram-notify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ type: "articles_digest", data: { text } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`telegram-notify failed [${res.status}]: ${body}`);
  }
}