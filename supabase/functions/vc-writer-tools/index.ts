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
    return errorResponse("unknown action", 400);
  } catch (e: any) {
    console.error("[vc-writer-tools] error", e?.message || e);
    const status = e?.status || (e?.kind === "budget" ? 402 : e?.kind === "rate_limit" ? 429 : 500);
    return errorResponse(e?.message || "tool failed", status);
  }
});