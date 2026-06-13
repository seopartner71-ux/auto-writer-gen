// vc.ru Writer auxiliary tools — bundles 3 actions for the single-article flow:
//   action="humanize" — runs runDoubleHumanizePass on the markdown and returns rewritten text.
//   action="fix"      — uses LLM to auto-fix failed checklist items (P.S., personal touch, mistake,
//                       extra H2, more numbers, length adjust). Mechanical fixes (bold, ё, dashes,
//                       tables) are also applied locally as a final clean-up.
//   action="serp_top" — calls Serper for the target_query (gl=ru, hl=ru) and returns top-10 results
//                       (title, link, snippet, position) — used as competitive snippet preview.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { withTimeout } from "../_shared/withTimeout.ts";
import {
  buildChecklist, ensureClientLinks, normalizeDashes, ruEReplace,
  stripMarkdownTables, stripText, pickVcModel, factCheckMarkdown,
  applyNumericGuard,
} from "../_shared/vcWriterCore.ts";
import { chatJson } from "../_shared/aiClient.ts";
import { runDoubleHumanizePass } from "../_shared/humanizePass.ts";

async function getOpenRouterKey(admin: ReturnType<typeof adminClient>): Promise<string | null> {
  const { data } = await admin
    .from("api_keys").select("api_key")
    .eq("provider", "openrouter").eq("is_valid", true).maybeSingle();
  return data?.api_key || Deno.env.get("OPENROUTER_API_KEY") || null;
}

function mechanicalCleanup(md: string): string {
  let out = stripMarkdownTables(normalizeDashes(ruEReplace(md)));
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  return out;
}

async function actionHumanize(req: any, auth: any, admin: any) {
  const md = String(req.markdown || "");
  if (md.length < 300) return errorResponse("markdown is too short", 400);
  const apiKey = await getOpenRouterKey(admin);
  if (!apiKey) return errorResponse("OpenRouter key not configured", 500);
  const cleaned = mechanicalCleanup(md);
  const res = await runDoubleHumanizePass(cleaned, "ru", apiKey, { admin, userId: auth.userId });
  const finalMd = mechanicalCleanup(res.content || cleaned);
  const ps = (finalMd.match(/P\.?\s*S\.?[^\n]*/i)?.[0] || "").replace(/^P\.?\s*S\.?\s*/i, "");
  const checklist = buildChecklist(finalMd, ps);
  return jsonResponse({
    ok: true,
    markdown: finalMd,
    passes_applied: res.passesApplied,
    models: res.modelsUsed,
    checklist,
    stats: { chars: stripText(finalMd).length },
  });
}

async function actionFix(req: any, admin: any) {
  const md = String(req.markdown || "");
  if (md.length < 200) return errorResponse("markdown is too short", 400);
  const failed: string[] = Array.isArray(req.failed) ? req.failed.map((s: any) => String(s)).slice(0, 12) : [];
  if (!failed.length) return errorResponse("failed list is empty", 400);
  const apiKey = await getOpenRouterKey(admin);
  if (!apiKey) return errorResponse("OpenRouter key not configured", 500);
  const model = pickVcModel(req.model);
  const psQuestion = String(req.ps_question || "").trim();
  const verifiedFacts = ruEReplace(normalizeDashes(String(req.verified_facts || ""))).slice(0, 4000);

  const fixesText = failed.map((f, i) => `${i + 1}. ${f}`).join("\n");
  const factsBlock = verifiedFacts
    ? `\n\nПРОВЕРЕННЫЕ ФАКТЫ (использовать ТОЛЬКО эти конкретные цифры, новые не выдумывать):\n${verifiedFacts}`
    : `\n\nНе выдумывай новые цифры/цены/лабораторные показатели/количество клиентов. Если для исправления нужно число - используй обобщения ("по нашей практике", "обычно", диапазон).`;
  const system = `Ты редактор vc.ru. Тебе дают черновик статьи и список проблем. Перепиши минимально, чтобы устранить ВСЕ проблемы из списка. Запреты: жирный (**), ё, длинное тире (—/–), markdown-таблицы. Все тире только обычный дефис "-". Сохрани заголовки H2, факты, цифры, длину (±10%), общий тон. Не выдумывай имён экспертов, компаний, новых конкретных чисел.${factsBlock}`;
  const user = `СПИСОК ПРОБЛЕМ:\n${fixesText}\n\n${psQuestion ? `Если нужно добавить P.S. - используй вопрос: "${psQuestion}"\n\n` : ""}Текущий markdown:\n\n${md}\n\nВерни строго JSON: {"markdown": "исправленный markdown целиком"}`;

  const result = await chatJson<{ markdown: string }>({
    apiKey, model, system, user,
    temperature: 0.5, maxTokens: 6000, timeoutMs: 150_000,
    appTitle: "vc.ru Writer Fix", retries: 1,
  });
  let fixed = mechanicalCleanup(String(result.data?.markdown || md));
  // Numeric Guard поверх правок - чтобы fix не вернул выдуманные числа.
  fixed = applyNumericGuard(fixed, verifiedFacts).content;
  // Re-inject client links if provided.
  const links = Array.isArray(req.client_links) ? req.client_links : [];
  let linksReport: { injected: string[]; appended: string[] } | undefined;
  if (links.length) {
    const r = ensureClientLinks(fixed, links.map((l: any) => ({ url: String(l.url || ""), anchor: String(l.anchor || "") })));
    fixed = r.md;
    linksReport = { injected: r.injected, appended: r.appended };
  }
  const checklist = buildChecklist(fixed, psQuestion);
  let risk_report: any = null;
  try { risk_report = await factCheckMarkdown(apiKey, fixed, verifiedFacts || undefined); } catch (_) {}
  return jsonResponse({
    ok: true,
    markdown: fixed,
    checklist,
    links_report: linksReport,
    risk_report,
    stats: { chars: stripText(fixed).length, model: result.model },
  });
}

async function actionSerpTop(req: any, admin: any) {
  const q = ruEReplace(normalizeDashes(String(req.query || ""))).trim().slice(0, 200);
  if (q.length < 3) return errorResponse("query is required", 400);
  const onlyVc = !!req.only_vc;
  const { data: keyRow } = await admin
    .from("api_keys").select("api_key")
    .eq("provider", "serper").eq("is_valid", true).maybeSingle();
  const serperKey = keyRow?.api_key || Deno.env.get("SERPER_API_KEY");
  if (!serperKey) return errorResponse("Serper API key not configured", 500);
  const query = onlyVc ? `site:vc.ru ${q}` : q;
  try {
    const r = await withTimeout(fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "ru", hl: "ru", num: 10 }),
    }), 12_000, "serper");
    if (!r.ok) return errorResponse(`Serper ${r.status}`, 502);
    const j: any = await r.json();
    const top = Array.isArray(j?.organic) ? j.organic.slice(0, 10).map((o: any, i: number) => ({
      position: o?.position ?? i + 1,
      title: ruEReplace(normalizeDashes(String(o?.title || ""))).slice(0, 200),
      link: String(o?.link || ""),
      snippet: ruEReplace(normalizeDashes(String(o?.snippet || ""))).slice(0, 400),
    })) : [];
    const paa = Array.isArray(j?.peopleAlsoAsk)
      ? j.peopleAlsoAsk.slice(0, 6).map((p: any) => String(p?.question || "")).filter(Boolean)
      : [];
    return jsonResponse({ ok: true, query, only_vc: onlyVc, top, paa });
  } catch (e: any) {
    return errorResponse(e?.message || "serp failed", 500);
  }
}

async function actionFactCheck(req: any, admin: any) {
  const md = String(req.markdown || "");
  if (md.length < 200) return errorResponse("markdown is too short", 400);
  const apiKey = await getOpenRouterKey(admin);
  if (!apiKey) return errorResponse("OpenRouter key not configured", 500);
  const verifiedFacts = ruEReplace(normalizeDashes(String(req.verified_facts || ""))).slice(0, 4000);
  const report = await factCheckMarkdown(apiKey, md, verifiedFacts || undefined);
  return jsonResponse({ ok: true, risk_report: report });
}

async function actionDefake(req: any, admin: any) {
  const md = String(req.markdown || "");
  if (md.length < 200) return errorResponse("markdown is too short", 400);
  const claims: Array<{ text: string; note?: string }> = Array.isArray(req.claims)
    ? req.claims.filter((c: any) => c && typeof c.text === "string").slice(0, 25)
    : [];
  if (!claims.length) return errorResponse("claims list is empty", 400);
  const apiKey = await getOpenRouterKey(admin);
  if (!apiKey) return errorResponse("OpenRouter key not configured", 500);
  const model = pickVcModel(req.model);
  const verifiedFacts = ruEReplace(normalizeDashes(String(req.verified_facts || ""))).slice(0, 4000);

  const claimsList = claims.map((c, i) => `${i + 1}. "${c.text}"${c.note ? ` -> риск: ${c.note}` : ""}`).join("\n");
  const factsBlock = verifiedFacts
    ? `\n\nПодтверждённые факты (их НЕ трогай):\n${verifiedFacts}`
    : "";
  const system = `Ты редактор-факт-чекер vc.ru. Тебе дают черновик и список неподтверждённых конкретных чисел/фактов. Задача:\n- Для КАЖДОГО пункта из списка перепиши соответствующую фразу так, чтобы убрать выдуманную конкретику.\n- Заменяй на обобщения: "по нашей практике", "обычно", "у коллег по рынку видел", или на диапазон ("на 15-30% дороже" вместо точной цены).\n- НЕ выдумывай новых чисел и брендов взамен.\n- Не меняй структуру H2, длина текста ±10%.\n- Запреты: жирный (**), ё, длинное тире (—/–), markdown-таблицы. Дефис только "-".${factsBlock}`;
  const user = `НЕПОДТВЕРЖДЁННЫЕ УТВЕРЖДЕНИЯ:\n${claimsList}\n\nЧерновик:\n\n${md}\n\nВерни JSON: {"markdown": "переписанный markdown целиком"}`;

  const result = await chatJson<{ markdown: string }>({
    apiKey, model, system, user,
    temperature: 0.3, maxTokens: 6000, timeoutMs: 150_000,
    appTitle: "vc.ru Defake", retries: 1,
  });
  let fixed = mechanicalCleanup(String(result.data?.markdown || md));
  fixed = applyNumericGuard(fixed, verifiedFacts).content;
  const links = Array.isArray(req.client_links) ? req.client_links : [];
  let linksReport: { injected: string[]; appended: string[] } | undefined;
  if (links.length) {
    const r = ensureClientLinks(fixed, links.map((l: any) => ({ url: String(l.url || ""), anchor: String(l.anchor || "") })));
    fixed = r.md;
    linksReport = { injected: r.injected, appended: r.appended };
  }
  const checklist = buildChecklist(fixed, String(req.ps_question || ""));
  let risk_report: any = null;
  try { risk_report = await factCheckMarkdown(apiKey, fixed, verifiedFacts || undefined); } catch (_) {}
  return jsonResponse({
    ok: true,
    markdown: fixed,
    checklist,
    links_report: linksReport,
    risk_report,
    stats: { chars: stripText(fixed).length, model: result.model },
  });
}

async function actionFactCheckWeb(req: any, admin: any) {
  const claimsIn: Array<{ text: string; kind?: string; note?: string }> = Array.isArray(req.claims)
    ? req.claims.filter((c: any) => c && typeof c.text === "string").slice(0, 12)
    : [];
  if (!claimsIn.length) return errorResponse("claims list is empty", 400);
  const { data: keyRow } = await admin
    .from("api_keys").select("api_key")
    .eq("provider", "serper").eq("is_valid", true).maybeSingle();
  const serperKey = keyRow?.api_key || Deno.env.get("SERPER_API_KEY");
  if (!serperKey) return errorResponse("Serper API key not configured", 500);
  const apiKey = await getOpenRouterKey(admin);

  async function checkOne(claim: { text: string; kind?: string; note?: string }) {
    const q = claim.text.slice(0, 200);
    try {
      const r = await withTimeout(fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q, gl: "ru", hl: "ru", num: 5 }),
      }), 9_000, "serper");
      if (!r.ok) return { ...claim, status: "not_found" as const, evidence: [] as Array<{ title: string; link: string; snippet: string }> };
      const j: any = await r.json();
      const evidence = Array.isArray(j?.organic) ? j.organic.slice(0, 3).map((o: any) => ({
        title: ruEReplace(normalizeDashes(String(o?.title || ""))).slice(0, 160),
        link: String(o?.link || ""),
        snippet: ruEReplace(normalizeDashes(String(o?.snippet || ""))).slice(0, 300),
      })) : [];
      if (!evidence.length || !apiKey) {
        return { ...claim, status: "not_found" as const, evidence };
      }
      const sys = "Ты факт-чекер. Дано утверждение и 3 сниппета из Google. Реши: confirmed (сниппеты прямо подтверждают конкретику), contradicted (опровергают), not_found (нет данных). Верни JSON.";
      const usr = `Утверждение: "${claim.text}"\n\nСниппеты:\n${evidence.map((e, i) => `${i + 1}. ${e.title} - ${e.snippet}`).join("\n")}\n\nJSON: {"status":"confirmed|contradicted|not_found","why":"коротко до 120 символов"}`;
      try {
        const cls = await chatJson<{ status: string; why: string }>({
          apiKey: apiKey!, model: "google/gemini-2.5-flash",
          system: sys, user: usr,
          temperature: 0.1, maxTokens: 200, timeoutMs: 30_000,
          appTitle: "vc.ru Web Fact-Check", retries: 0,
        });
        const status = ["confirmed", "contradicted", "not_found"].includes(cls.data?.status || "") ? cls.data!.status : "not_found";
        return { ...claim, status, why: cls.data?.why || "", evidence };
      } catch {
        return { ...claim, status: "not_found" as const, evidence };
      }
    } catch {
      return { ...claim, status: "not_found" as const, evidence: [] };
    }
  }

  const results = await Promise.all(claimsIn.map(checkOne));
  const summary = {
    confirmed: results.filter((r) => r.status === "confirmed").length,
    contradicted: results.filter((r) => r.status === "contradicted").length,
    not_found: results.filter((r) => r.status === "not_found").length,
    total: results.length,
  };
  return jsonResponse({ ok: true, results, summary });
}

/**
 * Topic Research: ищет в Google топ-материалы по теме (общий + site:vc.ru),
 * прогоняет сниппеты через LLM и возвращает паттерны + рекомендованный формат.
 */
async function actionTopicResearch(req: any, admin: any) {
  const topic = ruEReplace(normalizeDashes(String(req.topic || ""))).trim().slice(0, 200);
  if (topic.length < 5) return errorResponse("topic is required", 400);
  const selectedFormat = String(req.selected_format || "").trim();

  const { data: serperRow } = await admin
    .from("api_keys").select("api_key")
    .eq("provider", "serper").eq("is_valid", true).maybeSingle();
  const serperKey = serperRow?.api_key || Deno.env.get("SERPER_API_KEY");
  if (!serperKey) return errorResponse("Serper API key not configured", 500);

  async function searchSerper(q: string, num = 10) {
    try {
      const r = await withTimeout(fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q, gl: "ru", hl: "ru", num }),
      }), 12_000, "serper");
      if (!r.ok) return [] as Array<{ title: string; link: string; snippet: string }>;
      const j: any = await r.json();
      return Array.isArray(j?.organic) ? j.organic.slice(0, num).map((o: any) => ({
        title: ruEReplace(normalizeDashes(String(o?.title || ""))).slice(0, 200),
        link: String(o?.link || ""),
        snippet: ruEReplace(normalizeDashes(String(o?.snippet || ""))).slice(0, 400),
      })) : [];
    } catch { return []; }
  }

  const [general, onVc] = await Promise.all([
    searchSerper(topic, 10),
    searchSerper(`site:vc.ru ${topic}`, 8),
  ]);
  const all = [...onVc, ...general].slice(0, 16);
  if (!all.length) return errorResponse("no search results", 502);

  const apiKey = await getOpenRouterKey(admin);
  if (!apiKey) return errorResponse("OpenRouter key not configured", 500);

  const list = all.map((r, i) => `${i + 1}. [${r.link}] ${r.title}\n   ${r.snippet}`).join("\n");
  const system = `Ты - редактор-аналитик vc.ru. На входе - список топ-материалов по теме из Google (vc.ru + общая выдача). Твоя задача - выделить ПАТТЕРНЫ успешных публикаций по теме и рекомендовать формат.\nВерни строгий JSON. Не копируй конкретные цифры/кейсы из статей - только закономерности.`;
  const user = `Тема: "${topic}"\n${selectedFormat ? `Пользователь хочет писать в формате: ${selectedFormat}.` : ""}\n\nТоп-материалы:\n${list}\n\nВерни JSON:\n{\n  "title_patterns": ["3-5 коротких типов заголовков, например: 'Личный кейс с цифрой потерь', 'Сравнение 5 брендов', 'Гайд по выбору'"],\n  "structure_patterns": ["3-5 типовых структур, кратко"],\n  "audience_signals": ["3-5 что обсуждает аудитория в комментах / какие возражения"],\n  "dominant_format": "case|rating|review|guide",\n  "recommended_format": "case|rating|review|guide",\n  "format_reason": "1-2 предложения, почему именно этот формат для темы",\n  "format_mismatch": true|false,\n  "mismatch_warning": "если пользователь выбрал не тот формат - короткий совет, иначе пустая строка",\n  "do_not_copy": ["3-5 вещей, которые модель НЕ должна копировать из этих статей: имена, конкретные цены, расчёты и т.п."]\n}`;

  const r = await chatJson<any>({
    apiKey, model: "google/gemini-2.5-flash",
    system, user,
    temperature: 0.2, maxTokens: 1500, timeoutMs: 60_000,
    appTitle: "vc.ru Topic Research", retries: 0,
  });
  const d = r.data || {};
  const recommended = ["case", "rating", "review", "guide"].includes(d.recommended_format) ? d.recommended_format : "case";
  const dominant = ["case", "rating", "review", "guide"].includes(d.dominant_format) ? d.dominant_format : recommended;
  const mismatch = selectedFormat && selectedFormat !== recommended;

  const summaryMd = [
    `Тема: ${topic}`,
    `Доминирующий формат в топе: ${dominant}. Рекомендуем: ${recommended}.`,
    d.format_reason ? `Почему: ${d.format_reason}` : "",
    "",
    "Типы заголовков, которые работают:",
    ...(Array.isArray(d.title_patterns) ? d.title_patterns : []).slice(0, 6).map((s: string) => `- ${s}`),
    "",
    "Типовые структуры:",
    ...(Array.isArray(d.structure_patterns) ? d.structure_patterns : []).slice(0, 6).map((s: string) => `- ${s}`),
    "",
    "Сигналы аудитории (что обсуждают, возражения):",
    ...(Array.isArray(d.audience_signals) ? d.audience_signals : []).slice(0, 6).map((s: string) => `- ${s}`),
    "",
    "НЕ копировать из исследованных статей:",
    ...(Array.isArray(d.do_not_copy) ? d.do_not_copy : []).slice(0, 6).map((s: string) => `- ${s}`),
  ].filter(Boolean).join("\n");

  return jsonResponse({
    ok: true,
    topic,
    selected_format: selectedFormat || null,
    recommended_format: recommended,
    dominant_format: dominant,
    format_reason: String(d.format_reason || ""),
    format_mismatch: !!mismatch,
    mismatch_warning: mismatch ? (String(d.mismatch_warning || "") || `В топе по теме доминируют материалы в формате "${dominant}", а не "${selectedFormat}". Подумайте о смене формата.`) : "",
    title_patterns: Array.isArray(d.title_patterns) ? d.title_patterns.slice(0, 6) : [],
    structure_patterns: Array.isArray(d.structure_patterns) ? d.structure_patterns.slice(0, 6) : [],
    audience_signals: Array.isArray(d.audience_signals) ? d.audience_signals.slice(0, 6) : [],
    do_not_copy: Array.isArray(d.do_not_copy) ? d.do_not_copy.slice(0, 6) : [],
    sources: all.map((s) => ({ title: s.title, link: s.link })).slice(0, 12),
    summary_md: summaryMd,
  });
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const admin = adminClient();
    if (action === "humanize")  return await actionHumanize(body, auth, admin);
    if (action === "fix")       return await actionFix(body, admin);
    if (action === "serp_top")  return await actionSerpTop(body, admin);
    if (action === "factcheck") return await actionFactCheck(body, admin);
    if (action === "defake")        return await actionDefake(body, admin);
    if (action === "factcheck_web") return await actionFactCheckWeb(body, admin);
    if (action === "topic_research") return await actionTopicResearch(body, admin);
    if (action === "topics_by_site") return await actionTopicsBySite(body, admin);
    return errorResponse("unknown action", 400);
  } catch (e: any) {
    console.error("[vc-writer-tools] error", e?.message || e);
    const status = e?.status || (e?.kind === "budget" ? 402 : e?.kind === "rate_limit" ? 429 : 500);
    return errorResponse(e?.message || "tool failed", status);
  }
});