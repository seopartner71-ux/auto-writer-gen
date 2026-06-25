// Suggest content-plan topics via OpenRouter (Claude Sonnet).
// Body: { kind: 'blog'|'links'|'trust', domain: string, niche: string, count?: number }
// Returns: { ok: true, topics: string[] }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { chatComplete } from "../_shared/aiClient.ts";
import { ruEReplace, normalizeDashes } from "../_shared/vcWriterCore.ts";

const KIND_LABEL: Record<string, string> = {
  blog: "блог клиента (информационная SEO-статья на корпоративном сайте)",
  links: "статья для размещения на бирже ссылок (естественный, читаемый формат с упоминанием бренда без рекламности)",
  trust: "статья для трастового ресурса (экспертная, без явной рекламы)",
};

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const userId = (auth as any).user?.id || (auth as any).userId || (auth as any).id;

    const admin = adminClient();
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
    const allowed = (roles || []).some((r: any) => r.role === "admin" || r.role === "staff");
    if (!allowed) return errorResponse("forbidden", 403);

    const body = await req.json().catch(() => ({}));
    const kind = String(body.kind || "blog");
    if (!KIND_LABEL[kind]) return errorResponse("invalid kind", 400);
    const domain = String(body.domain || "").trim().slice(0, 200);
    const niche = String(body.niche || "").trim().slice(0, 400);
    if (!domain || !niche) return errorResponse("domain и niche обязательны", 400);
    const count = Math.min(15, Math.max(3, Number(body.count) || 8));

    const { data: orRow } = await admin
      .from("api_keys").select("api_key")
      .eq("provider", "openrouter").eq("is_valid", true).maybeSingle();
    const apiKey = orRow?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return errorResponse("OpenRouter ключ не настроен", 500);

    const system = `Ты SEO-специалист. Пиши на русском, БЕЗ буквы ё. Используй ТОЛЬКО обычный дефис "-".`;
    const user = `Предложи ${count} тем для ${KIND_LABEL[kind]} для сайта ${domain} в нише: ${niche}.
Темы должны быть трафиковыми, отвечать на реальные вопросы аудитории, без штампов.
Верни ТОЛЬКО список тем, каждая с новой строки, без нумерации, без маркеров и без пояснений.`;

    const res = await chatComplete({
      apiKey,
      model: "anthropic/claude-sonnet-4",
      system, user,
      temperature: 0.85, maxTokens: 1200, timeoutMs: 60_000,
      appTitle: "Content Plan Topics",
    });

    const topics = res.content.split(/\r?\n/)
      .map((s) => ruEReplace(normalizeDashes(s)).trim())
      .map((s) => s.replace(/^[\d]+[.)]\s*/, "").replace(/^[-*•]\s*/, "").trim())
      .filter((s) => s.length >= 6 && s.length <= 200)
      .slice(0, count);

    return jsonResponse({ ok: true, topics, model: res.model });
  } catch (e: any) {
    console.error("[content-plan-suggest-topics]", e?.message || e);
    const status = e?.status || (e?.kind === "budget" ? 402 : e?.kind === "rate_limit" ? 429 : 500);
    return errorResponse(e?.message || "Unknown error", status);
  }
});