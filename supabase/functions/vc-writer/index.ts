// vc.ru Writer - generates an article tuned for vc.ru editorial format.
// Body: { format, topic, thesis?, audience?, tone?, length?, generate_cover? }
// Returns: { markdown, meta:{title,subtitle,tags[],ps_question}, checklist[{label,ok,hint}], cover_data_url? }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { generateVcArticle, isVcFormat, pickVcModel, ruEReplace, normalizeDashes } from "../_shared/vcWriterCore.ts";
import type { AuthorPersona, OfferBlockInput } from "../_shared/vcWriterCore.ts";
import { validateVcArticle } from "../_shared/vcQualityGuard.ts";
import {
  fetchMapsItems, fetchShoppingItems, fetchOrganicItems,
  parseManualList, pinToFront, renderItemsBlock, attributionLine,
  type RatingItem, type RatingSourceType,
} from "../_shared/ratingSources.ts";

const ALLOWED_PERSONAS: ReadonlySet<AuthorPersona> = new Set([
  "agency", "inhouse", "brand_owner", "expert", "freeform",
]);
import { withTimeout } from "../_shared/withTimeout.ts";

async function serperSuggest(apiKey: string, q: string): Promise<string[]> {
  try {
    const res = await withTimeout(
      fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q, gl: "ru", hl: "ru", num: 10 }),
      }),
      10000, "serper",
    );
    if (!res.ok) return [];
    const j: any = await res.json();
    const out: string[] = [];
    for (const p of j?.peopleAlsoAsk ?? []) if (p?.question) out.push(String(p.question));
    for (const r of j?.relatedSearches ?? []) if (r?.query) out.push(String(r.query));
    return out.map((s) => ruEReplace(normalizeDashes(s)).trim()).filter((s) => s.length >= 6 && s.length <= 120).slice(0, 12);
  } catch { return []; }
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const format = body.format ?? "guide";
    if (!isVcFormat(format)) return errorResponse("invalid format", 400);
    const topic = String(body.topic || "").trim();
    if (topic.length < 5) return errorResponse("topic is required (min 5 chars)", 400);
    const thesis = String(body.thesis || "").slice(0, 600);
    const audience = String(body.audience || "").slice(0, 200);
    const tone = String(body.tone || "").slice(0, 100);
    const length = Math.min(8000, Math.max(2500, Number(body.length) || 5500));
    // Cover generation disabled for vc-writer.
    const wantCover = false;
    const model = pickVcModel(body.model);
    const seoMode = !!body.seo_mode;
    let targetQuery = ruEReplace(normalizeDashes(String(body.target_query || ""))).trim().slice(0, 120);

    const personaRaw = String(body.author_persona || "freeform") as AuthorPersona;
    const authorPersona: AuthorPersona = ALLOWED_PERSONAS.has(personaRaw) ? personaRaw : "freeform";
    const verifiedFacts = ruEReplace(normalizeDashes(String(body.verified_facts || ""))).slice(0, 4000);
    const factCheckOn = body.fact_check !== false;
    const topicResearch = ruEReplace(normalizeDashes(String(body.topic_research || ""))).slice(0, 5000);
    const humanizeOn = !!body.humanize;

    // Профессиональные термины ниши (опционально): до 10 коротких токенов.
    const rawNiche = Array.isArray(body.niche_terms) ? body.niche_terms : [];
    const nicheTerms = rawNiche
      .map((t: any) => ruEReplace(normalizeDashes(String(t || ""))).trim().slice(0, 40))
      .filter((t: string) => t.length >= 2)
      .slice(0, 10);

    // Закрепить клиента на 1-м месте в рейтинге (только для format=rating).
    const pinnedCompany = ruEReplace(normalizeDashes(String(body.pinned_company || ""))).trim().slice(0, 120);

    // Опциональный конверсионный блок-оффер автора (нативный CTA).
    let offerBlock: OfferBlockInput | undefined;
    const rawOffer = body.offer_block;
    if (rawOffer && typeof rawOffer === "object") {
      const styleRaw = String(rawOffer.style || "native").toLowerCase();
      const style: OfferBlockInput["style"] =
        styleRaw === "soft" || styleRaw === "leadmagnet" ? (styleRaw as any) : "native";
      const offerText = ruEReplace(normalizeDashes(String(rawOffer.offer || ""))).trim().slice(0, 240);
      const benefitText = ruEReplace(normalizeDashes(String(rawOffer.benefit || ""))).trim().slice(0, 240);
      const ctaText = ruEReplace(normalizeDashes(String(rawOffer.cta || ""))).trim().slice(0, 80);
      const urlText = String(rawOffer.url || "").trim().slice(0, 500);
      if (offerText.length >= 3 && ctaText.length >= 2 && /^https?:\/\/\S+$/i.test(urlText)) {
        offerBlock = {
          style,
          offer: offerText,
          benefit: benefitText || undefined,
          cta: ctaText,
          url: urlText,
          disclosure: format === "rating" && !!pinnedCompany,
        };
      }
    }

    // Источник реальных позиций для рейтинга. По умолчанию services (Maps).
    const ratingTypeRaw = String(body.rating_type || "services").toLowerCase();
    const ratingType: RatingSourceType =
      ratingTypeRaw === "products" || ratingTypeRaw === "saas" || ratingTypeRaw === "manual"
        ? (ratingTypeRaw as RatingSourceType)
        : "services";
    const ratingCity = ruEReplace(normalizeDashes(String(body.rating_city || ""))).trim().slice(0, 80);
    const ratingManual = ruEReplace(normalizeDashes(String(body.rating_manual || ""))).slice(0, 4000);

    // Клиентские ссылки: до 5 шт, валидируем url+anchor.
    const rawLinks = Array.isArray(body.client_links) ? body.client_links : [];
    const clientLinks = rawLinks
      .map((l: any) => ({
        url: String(l?.url || "").trim().slice(0, 500),
        anchor: ruEReplace(normalizeDashes(String(l?.anchor || ""))).trim().slice(0, 120),
        hint: String(l?.hint || "").trim().slice(0, 200),
      }))
      .filter((l: any) => /^https?:\/\/\S+$/i.test(l.url) && l.anchor.length >= 2)
      .slice(0, 5);

    const admin = adminClient();
    const { data: orRow } = await admin
      .from("api_keys")
      .select("api_key")
      .eq("provider", "openrouter")
      .eq("is_valid", true)
      .maybeSingle();
    const apiKey = orRow?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return errorResponse("OpenRouter key not configured", 500);

    // Resolve Serper key (used for both SEO suggestions and rating sources).
    let serperKey = "";
    if ((seoMode && !targetQuery) || format === "rating") {
      const { data: serperRow } = await admin
        .from("api_keys").select("api_key")
        .eq("provider", "serper").eq("is_valid", true).maybeSingle();
      serperKey = serperRow?.api_key || Deno.env.get("SERPER_API_KEY") || "";
    }

    // SEO mode без явного target_query: вытаскиваем подсказки из Serper и берём топовую.
    let serperSuggestions: string[] = [];
    if (seoMode && !targetQuery && serperKey) {
      serperSuggestions = await serperSuggest(serperKey, topic);
      if (serperSuggestions.length) {
        targetQuery = serperSuggestions[0].toLowerCase().slice(0, 120);
      }
    }

    // Для рейтинга: тянем реальные позиции из выбранного источника, пинним клиента.
    let realItems: RatingItem[] = [];
    let realItemsBlock = "";
    let realItemsAttribution = "";
    let realItemsError = "";
    if (format === "rating") {
      try {
        if (ratingType === "manual") {
          realItems = parseManualList(ratingManual);
        } else if (serperKey) {
          if (ratingType === "services") {
            realItems = await fetchMapsItems(serperKey, topic, ratingCity);
          } else if (ratingType === "products") {
            realItems = await fetchShoppingItems(serperKey, topic);
          } else if (ratingType === "saas") {
            realItems = await fetchOrganicItems(serperKey, topic);
          }
        } else {
          realItemsError = "Serper API key не настроен - источник реальных позиций недоступен";
        }
        realItems = pinToFront(realItems, pinnedCompany);
        // Cap to 10 items (DTF/VC standard).
        realItems = realItems.slice(0, 10);
        if (realItems.length >= 5) {
          realItemsBlock = renderItemsBlock(realItems);
          realItemsAttribution = attributionLine(realItems);
        } else if (realItems.length > 0) {
          realItemsError = `Найдено только ${realItems.length} позиций (минимум 5). Уточните запрос/город или вставьте список вручную.`;
        } else if (!realItemsError) {
          realItemsError = "Источник не вернул ни одной позиции. Уточните запрос или используйте ручной список.";
        }
      } catch (e: any) {
        realItemsError = `Не удалось получить реальные позиции: ${e?.message || "unknown"}`;
      }
    }

    const out = await generateVcArticle({
      apiKey, model, format, topic, thesis, audience, tone, length, wantCover,
      targetQuery: targetQuery || undefined,
      clientLinks: clientLinks.length ? clientLinks : undefined,
      authorPersona,
      verifiedFacts: verifiedFacts || undefined,
      factCheck: factCheckOn,
      topicResearch: topicResearch || undefined,
      humanize: humanizeOn,
      nicheTerms: nicheTerms.length ? nicheTerms : undefined,
      pinnedCompany: (format === "rating" && pinnedCompany) ? pinnedCompany : undefined,
      realItemsBlock: realItemsBlock || undefined,
      realItemsAttribution: realItemsAttribution || undefined,
      offerBlock,
    });

    // Quality guard: catches broken H3 splits, duplicated lead/conclusion and
    // template bullet repetition BEFORE we persist the article. Broken
    // headings are auto-repaired; the rest is attached to risk_report.
    const guard = validateVcArticle(out.markdown || "", format);
    if (guard.repaired) {
      out.markdown = guard.markdown;
    }
    const mergedRiskReport = {
      ...(out.risk_report ?? {}),
      quality_guard: guard.report,
    };
    if (guard.report.issues.length) {
      console.log("[vc-writer] quality_guard issues", JSON.stringify(guard.report.issues));
    }

    // Сохраняем в историю (без cover_data_url - тяжёлый base64).
    let historyId: string | null = null;
    try {
      const { data: hist } = await admin
        .from("vc_writer_history")
        .insert({
          user_id: auth.userId,
          format, model, topic, thesis: thesis || null, audience: audience || null, tone: tone || null,
          length_target: length,
          target_query: targetQuery || null,
          seo_mode: seoMode,
          client_links: clientLinks,
          title: out.meta.title,
          subtitle: out.meta.subtitle,
          tags: out.meta.tags,
          ps_question: out.meta.ps_question,
          markdown: out.markdown,
          checklist: out.checklist,
          links_report: out.links_report ?? null,
          chars: out.stats?.chars ?? 0,
          author_persona: authorPersona,
          verified_facts: verifiedFacts || null,
          risk_report: mergedRiskReport,
        })
        .select("id")
        .maybeSingle();
      historyId = hist?.id ?? null;
    } catch (e) {
      console.error("[vc-writer] history insert failed", e);
    }

    return jsonResponse({
      ok: true,
      ...out,
      risk_report: mergedRiskReport,
      quality_guard: guard.report,
      history_id: historyId,
      seo: { mode: seoMode, target_query: targetQuery || null, suggestions: serperSuggestions },
      rating_sources: format === "rating" ? {
        type: ratingType,
        city: ratingCity || null,
        items: realItems,
        error: realItemsError || null,
      } : null,
    });
  } catch (e: any) {
    console.error("[vc-writer] error", e?.message || e);
    const msg = e?.message || "Unknown error";
    const status = e?.status || (e?.kind === "budget" ? 402 : e?.kind === "rate_limit" ? 429 : 500);
    return errorResponse(msg, status);
  }
});