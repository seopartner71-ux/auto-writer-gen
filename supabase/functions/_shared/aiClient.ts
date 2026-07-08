// Единый AI-клиент для всех edge-функций. Заменяет россыпь самописных
// fetch + timeout + parseLoose по проекту.

import { logLLM } from "./costLogger.ts";
//
// Что даёт:
// - один вход chatComplete / chatJson;
// - встроенный AbortController с таймаутом;
// - схема ответа через OpenRouter response_format (json_schema → json_object → text fallback);
// - один retry при невалидном JSON с явным "fix it" в систему;
// - типизированные ошибки AiError (rate_limit / budget / auth / upstream / timeout / parse / network);
// - структурированный console.log для будущей observability.

export type AiErrorKind =
  | "rate_limit"
  | "budget"
  | "auth"
  | "upstream"
  | "timeout"
  | "parse_failed"
  | "network"
  | "config";

export class AiError extends Error {
  kind: AiErrorKind;
  status?: number;
  retryable: boolean;
  upstreamBody?: string;
  constructor(kind: AiErrorKind, message: string, opts: { status?: number; retryable?: boolean; upstreamBody?: string } = {}) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
    this.status = opts.status;
    this.retryable = opts.retryable ?? (kind === "rate_limit" || kind === "upstream" || kind === "timeout" || kind === "network");
    this.upstreamBody = opts.upstreamBody;
  }
}

export interface ChatOptions {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Передаётся в OpenRouter HTTP-Referer / X-Title — для аналитики провайдера. */
  appTitle?: string;
  /** Для cost_log — какая функция вызвала. По умолчанию берётся appTitle или "aiClient". */
  functionName?: string;
  /** Для cost_log. */
  userId?: string | null;
  articleId?: string | null;
  projectId?: string | null;
  /** Отключает автоматическую запись в cost_log (для функций, которые логируют агрегат сами). */
  disableCostLog?: boolean;
}

export interface ChatResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
  finishReason?: string;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT = 60_000;
const baseExtraJsonObject = { response_format: { type: "json_object" } } as const;

function buildHeaders(apiKey: string, appTitle?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://seo-modul.pro",
    "X-Title": appTitle || "SEO-Modul",
  };
}

async function callOpenRouter(opts: ChatOptions, extraBody: Record<string, unknown>): Promise<ChatResult> {
  if (!opts.apiKey) throw new AiError("config", "OPENROUTER_API_KEY not configured");
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
  const startedAt = Date.now();
  try {
    const body = {
      model: opts.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 2000,
      ...extraBody,
    };
    const r = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: buildHeaders(opts.apiKey, opts.appTitle),
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      const status = r.status;
      const kind: AiErrorKind =
        status === 401 || status === 403 ? "auth" :
        status === 402 ? "budget" :
        status === 429 ? "rate_limit" :
        status >= 500 ? "upstream" : "upstream";
      console.warn("[aiClient] non-ok", { model: opts.model, status, body: txt.slice(0, 200) });
      throw new AiError(kind, `OpenRouter ${status}: ${txt.slice(0, 200)}`, { status, upstreamBody: txt.slice(0, 1000) });
    }
    const j = await r.json();
    const content = String(j?.choices?.[0]?.message?.content ?? "").trim();
    const finishReason = j?.choices?.[0]?.finish_reason;
    const result: ChatResult = {
      content,
      tokensIn: Number(j?.usage?.prompt_tokens || 0),
      tokensOut: Number(j?.usage?.completion_tokens || 0),
      model: String(j?.model || opts.model),
      finishReason,
    };
    console.log("[aiClient] ok", { model: result.model, ms: Date.now() - startedAt, in: result.tokensIn, out: result.tokensOut, finish: finishReason });
    // best-effort cost logging (можно отключить, если функция агрегирует cost сама)
    if (!opts.disableCostLog) {
      logLLM({
        functionName: opts.functionName || opts.appTitle || "aiClient",
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        userId: opts.userId ?? null,
        articleId: opts.articleId ?? null,
        projectId: opts.projectId ?? null,
      });
    }
    return result;
  } catch (e) {
    if (e instanceof AiError) throw e;
    if ((e as Error)?.name === "AbortError") {
      throw new AiError("timeout", `Timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT}ms`);
    }
    throw new AiError("network", (e as Error)?.message || "network error");
  } finally {
    clearTimeout(t);
  }
}

/** Plain chat completion. */
export function chatComplete(opts: ChatOptions): Promise<ChatResult> {
  return callOpenRouter(opts, {});
}

export interface ChatJsonOptions<T> extends ChatOptions {
  /** JSON Schema describing the expected response. Если undefined — используется json_object. */
  schema?: Record<string, unknown>;
  schemaName?: string;
  /** Поправляет результат после парсинга (нормализация, дефолты). */
  postProcess?: (raw: unknown) => T;
  /** Сколько раз повторно попросить модель починить JSON. По умолчанию 1. */
  retries?: number;
}

export interface ChatJsonResult<T> {
  data: T;
  raw: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
  retries: number;
}

/** Light cleanup перед JSON.parse — без агрессивной починки скобок. */
function softParse(raw: string): unknown {
  if (!raw) throw new SyntaxError("empty response");
  let s = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a > 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

export async function chatJson<T = unknown>(opts: ChatJsonOptions<T>): Promise<ChatJsonResult<T>> {
  const retries = Math.max(0, opts.retries ?? 1);
  const baseExtra: Record<string, unknown> = opts.schema
    ? {
        response_format: {
          type: "json_schema",
          json_schema: { name: opts.schemaName || "response", schema: opts.schema, strict: true },
        },
      }
    : { response_format: { type: "json_object" } };

  let attempt = 0;
  let lastErr: Error | null = null;
  let lastRaw = "";
  // shadow system with explicit "JSON only" guard
  const systemForJson = `${opts.system}\n\nВерни ТОЛЬКО валидный JSON по схеме. Никакого markdown, никаких комментариев.`;
  let extra = baseExtra;
  let user = opts.user;

  while (attempt <= retries) {
    let res: ChatResult;
    try {
      res = await callOpenRouter({ ...opts, system: systemForJson, user }, extra);
    } catch (e) {
      // Если модель отвергает json_schema (400) — фоллбэк на json_object и повтор.
      if (e instanceof AiError && e.status === 400 && opts.schema && extra !== baseExtraJsonObject) {
        console.warn("[aiClient] json_schema rejected, fallback to json_object");
        extra = baseExtraJsonObject;
        continue;
      }
      throw e;
    }
    lastRaw = res.content;
    try {
      const parsed = softParse(res.content);
      const data = (opts.postProcess ? opts.postProcess(parsed) : (parsed as T));
      return { data, raw: res.content, tokensIn: res.tokensIn, tokensOut: res.tokensOut, model: res.model, retries: attempt };
    } catch (e) {
      lastErr = e as Error;
      attempt++;
      if (attempt > retries) break;
      console.warn("[aiClient] parse_failed, retrying", { attempt, err: lastErr.message.slice(0, 120) });
      user = `${opts.user}\n\nПРЕДЫДУЩИЙ ОТВЕТ БЫЛ НЕВАЛИДЕН: ${lastErr.message}\nВерни ТОЛЬКО валидный JSON, ничего лишнего.`;
      // на ретрае всегда требуем json_object — это переживут все модели
      extra = baseExtraJsonObject;
    }
  }
  throw new AiError("parse_failed", `Failed to parse JSON after ${retries + 1} attempts: ${lastErr?.message || "unknown"}`, { upstreamBody: lastRaw.slice(0, 50_000) });
}


/** Маппинг AiError → HTTP-ответ для edge-функций. */
export function aiErrorToResponse(e: unknown, cors: Record<string, string>): Response {
  const err = e instanceof AiError ? e : new AiError("upstream", (e as Error)?.message || "unknown");
  const status =
    err.kind === "rate_limit" ? 429 :
    err.kind === "budget" ? 402 :
    err.kind === "auth" ? 401 :
    err.kind === "timeout" ? 504 :
    err.kind === "parse_failed" ? 502 :
    err.kind === "config" ? 500 : 502;
  const userMsg =
    err.kind === "rate_limit" ? "Превышен лимит запросов, попробуйте позже" :
    err.kind === "budget" ? "AI-кредиты исчерпаны" :
    err.kind === "timeout" ? "AI-запрос занял слишком много времени" :
    err.kind === "parse_failed" ? "Модель вернула невалидный ответ, повторите попытку" :
    err.message;
  return new Response(JSON.stringify({ error: userMsg, kind: err.kind }), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}