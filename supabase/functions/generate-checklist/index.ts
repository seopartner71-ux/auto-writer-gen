// Generates a checklist format for a Content Ecosystem.
// Primary: anthropic/claude-haiku-4.5, fallback: anthropic/claude-opus-4.
// Uploads PDF to private bucket `ecosystem-formats` and signs a URL.
// Client fires-and-forgets; UI subscribes to public.ecosystem_formats via Realtime.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { logCost, tokensToUsd } from "../_shared/costLogger.ts";
import { buildChecklistPdf, uploadChecklistPdf } from "../_shared/checklistPdf.ts";
import { aiTranslateToPhotoQuery } from "../_shared/unsplash.ts";

const PRIMARY_MODEL = "anthropic/claude-haiku-4.5";
const FALLBACK_MODEL = "anthropic/claude-opus-4";

interface ReqBody { ecosystem_id: string; format_id: string }

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const body = (await req.json()) as ReqBody;
    if (!body?.ecosystem_id || !body?.format_id) {
      return json({ error: "ecosystem_id and format_id required" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: eco, error: ecoErr } = await admin
      .from("content_ecosystems")
      .select("id, user_id, source_article_id, client_id, articles(title,content,main_keyword,keywords), clients(name,brand_color,expert_name,expert_bio,expert_photo_url,contact_email,contact_phone,domain,logo_url)")
      .eq("id", body.ecosystem_id)
      .single();
    if (ecoErr || !eco) return json({ error: "ecosystem not found" }, 404);
    if ((eco as any).user_id !== userId) return json({ error: "forbidden" }, 403);

    const { data: fmt } = await admin
      .from("ecosystem_formats")
      .select("id, format_type, status, retry_count")
      .eq("id", body.format_id)
      .eq("ecosystem_id", body.ecosystem_id)
      .single();
    if (!fmt) return json({ error: "format not found" }, 404);
    if ((fmt as any).format_type !== "checklist") return json({ error: "format is not checklist" }, 400);
    if ((fmt as any).status === "generating") return json({ ok: true, note: "already generating" }, 202);

    await admin
      .from("ecosystem_formats")
      .update({
        status: "generating",
        progress: 10,
        error_reason: null,
        started_at: new Date().toISOString(),
      })
      .eq("id", (fmt as any).id);

    // deno-lint-ignore no-explicit-any
    const runtime: any = (globalThis as any).EdgeRuntime;
    const task = generateInBackground(admin, {
      formatId: (fmt as any).id,
      ecosystemId: (eco as any).id,
      userId,
      retryCount: (fmt as any).retry_count ?? 0,
      article: (eco as any).articles,
      client: (eco as any).clients,
    });
    if (runtime?.waitUntil) runtime.waitUntil(task);
    else task.catch((e) => console.error("[generate-checklist] bg", e));

    return json({ ok: true, format_id: (fmt as any).id }, 202);
  } catch (e) {
    console.error("[generate-checklist] top", e);
    return json({ error: (e as Error).message || "internal error" }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface BgCtx {
  formatId: string;
  ecosystemId: string;
  userId: string;
  retryCount: number;
  article: { title?: string; content?: string; main_keyword?: string; keywords?: string[] } | null;
  client: {
    name?: string; brand_color?: string; expert_name?: string; expert_bio?: string;
    expert_photo_url?: string; contact_email?: string; contact_phone?: string;
    domain?: string; logo_url?: string;
  } | null;
}

// deno-lint-ignore no-explicit-any
async function generateInBackground(admin: any, ctx: BgCtx) {
  const startedAt = Date.now();
  const setProgress = (progress: number, patch: Record<string, unknown> = {}) =>
    admin.from("ecosystem_formats").update({ progress, ...patch }).eq("id", ctx.formatId);

  try {
    const title = (ctx.article?.title || "Материал").slice(0, 200);
    const articleText = stripHtml(ctx.article?.content || "").slice(0, 12000);
    if (!articleText || articleText.length < 300) {
      throw new Error("Исходная статья пуста или слишком короткая");
    }

    await setProgress(25);
    console.log("[CHECKLIST-GEN] Model call started", { formatId: ctx.formatId, model: PRIMARY_MODEL });
    const llmStart = Date.now();
    const { markdown, modelUsed, tokensIn, tokensOut } = await callChecklistLlm({
      title,
      articleText,
      clientName: ctx.client?.name || null,
    });
    console.log("[CHECKLIST-GEN] Model returned", {
      formatId: ctx.formatId,
      modelUsed,
      ms: Date.now() - llmStart,
      mdLen: markdown.length,
      tokensIn,
      tokensOut,
    });
    const checks = {
      has_title: /^\s*#\s+/m.test(markdown),
      has_checkboxes: (markdown.match(/^-\s*\[\s?\]/gm) || []).length >= 8,
      has_final_block: /^##\s+Что важно помнить\s*$/m.test(markdown),
    };
    console.log("[CHECKLIST-GEN] Post-checks", { formatId: ctx.formatId, ...checks });

    await setProgress(50, { model_used: modelUsed, content: markdown });

    // Fetch Unsplash images (best-effort). Never blocks PDF.
    const imageUrls = await fetchChecklistPhotos(admin, {
      userId: ctx.userId,
      ecosystemId: ctx.ecosystemId,
      query: ctx.article?.main_keyword || (ctx.article?.keywords || [])[0] || title,
    });
    if (imageUrls.length > 0) {
      await admin.from("ecosystem_formats").update({ image_urls: imageUrls }).eq("id", ctx.formatId);
    }
    await setProgress(65);

    let pdfUrl: string | null = null;
    let pdfPath: string | null = null;
    let pdfError: string | null = null;
    try {
      console.log("[CHECKLIST-PDF] PDF generation started", { formatId: ctx.formatId });
      const pdfStart = Date.now();
      const pdfBytes = await buildChecklistPdf({
        title,
        markdown,
        ecosystemId: ctx.ecosystemId,
        client: ctx.client,
        imageUrls,
      });
      console.log("[CHECKLIST-PDF] PDF rendered", { formatId: ctx.formatId, ms: Date.now() - pdfStart, bytes: pdfBytes.byteLength });
      const targetPath = `${ctx.userId}/${ctx.ecosystemId}/checklist/${Date.now()}.pdf`;
      await setProgress(80);
      console.log("[CHECKLIST-PDF] Storage upload started", { formatId: ctx.formatId, path: targetPath });
      const uploaded = await uploadChecklistPdf(admin, targetPath, pdfBytes);
      pdfPath = uploaded.path;
      pdfUrl = uploaded.signedUrl;
      console.log("[CHECKLIST-PDF] Storage upload completed", { formatId: ctx.formatId, path: pdfPath, signed: !!pdfUrl });
      if (!pdfUrl) {
        throw new Error("Не удалось получить подписанную ссылку на PDF");
      }
    } catch (pdfErr) {
      pdfError = (pdfErr as Error).message?.slice(0, 500) || "unknown PDF error";
      pdfUrl = null;
      pdfPath = null;
      console.error("[CHECKLIST-PDF] PDF generation failed", { formatId: ctx.formatId, error: pdfError });
    }

    try {
      const cost = tokensToUsd(modelUsed, tokensIn, tokensOut);
      await logCost(admin, {
        user_id: ctx.userId,
        operation_type: "llm_call",
        model: modelUsed,
        tokens_input: tokensIn,
        tokens_output: tokensOut,
        cost_usd: cost,
        metadata: { function: "generate-checklist", ecosystem_id: ctx.ecosystemId },
      });
    } catch (_) { /* ignore */ }

    await admin
      .from("ecosystem_formats")
      .update({
        status: pdfUrl ? "completed" : "partial",
        progress: 100,
        content: markdown,
        model_used: modelUsed,
        pdf_url: pdfUrl,
        pdf_path: pdfPath,
        generated_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        error_reason: pdfUrl ? null : `PDF generation failed: ${pdfError || "unknown"}`,
      })
      .eq("id", ctx.formatId);

    const { data: sib } = await admin
      .from("ecosystem_formats")
      .select("format_type,status")
      .eq("ecosystem_id", ctx.ecosystemId);
    const completedTypes = (sib || [])
      .filter((r: any) => r.status === "completed" || r.status === "partial")
      .map((r: any) => r.format_type);
    await admin
      .from("content_ecosystems")
      .update({
        formats_completed: completedTypes,
        status: (sib || []).every((r: any) => r.status === "completed" || r.status === "partial")
          ? "completed"
          : "generating",
      })
      .eq("id", ctx.ecosystemId);
  } catch (err) {
    console.error("[generate-checklist] failed", err);
    await admin
      .from("ecosystem_formats")
      .update({
        status: "failed",
        error_reason: (err as Error).message?.slice(0, 500) || "unknown",
        retry_count: ctx.retryCount + 1,
        duration_ms: Date.now() - startedAt,
      })
      .eq("id", ctx.formatId);
  }
}

async function callChecklistLlm(input: { title: string; articleText: string; clientName: string | null }) {
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: orKey } = await supabaseAdmin
    .from("api_keys")
    .select("api_key")
    .eq("provider", "openrouter")
    .eq("is_valid", true)
    .single();
  const key = orKey?.api_key || Deno.env.get("OPENROUTER_API_KEY");
  if (!key) throw new Error("OpenRouter API key not configured");

  const baseSystem =
    "Ты редактор-методолог. Из исходной статьи собираешь премиум-чек-лист на 600-900 слов. " +
    "Верни СТРОГО Markdown в такой структуре и без отклонений:\n" +
    "1. Первая строка — заголовок вида `# Чек-лист: [тема]` (обязательно с префиксом «Чек-лист: »).\n" +
    "2. Вводный абзац 3-5 предложений (без списков, без заголовков).\n" +
    "3. 10-14 пунктов подряд, каждый строго в формате:\n" +
    "   `- [ ] Название пункта — краткое описание с обоснованием (2-4 предложения, объясни почему важно и на что смотреть).`\n" +
    "   Тире между названием и описанием — короткое `-` с пробелами вокруг, никаких длинных тире.\n" +
    "4. Финальный блок ОБЯЗАТЕЛЬНО начинается со строки `## Что важно помнить` (ровно так, без вариаций). Далее 2-3 напоминания списком `- ` или короткими абзацами.\n" +
    "Запрещено: эмодзи, длинное тире `—`, буква «ё» (используй «е»), любые H2 кроме `## Что важно помнить`, любые другие финальные заголовки (`Резюме`, `Итог`, `Как пользоваться`, `Совет` и т.п.).\n" +
    "Пиши на русском, если исходник на русском.";
  const user =
    `Название материала: ${input.title}\n` +
    (input.clientName ? `Бренд/клиент: ${input.clientName}\n` : "") +
    `\nИсходный материал:\n${input.articleText}\n\n` +
    "Собери чек-лист по описанному формату.";

  const attempt = async (model: string, systemPrompt: string) => {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "SEO-Module / generate-checklist",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: user },
        ],
        max_tokens: 3200,
        temperature: 0.4,
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`OpenRouter ${model} ${r.status}: ${text.slice(0, 200)}`);
    }
    const j = await r.json();
    const content: string = j?.choices?.[0]?.message?.content || "";
    return {
      markdown: content.trim(),
      modelUsed: model,
      tokensIn: j?.usage?.prompt_tokens || 0,
      tokensOut: j?.usage?.completion_tokens || 0,
    };
  };

  const isValidFinal = (md: string) => /^##\s+Что важно помнить\s*$/m.test(md);
  const hasEnoughItems = (md: string) => (md.match(/^-\s*\[\s?\]/gm) || []).length >= 8;

  const runWithRetry = async (model: string) => {
    let out = await attempt(model, baseSystem);
    if (out.markdown.length < 400) throw new Error(`${model} output too short`);
    const finalOk = isValidFinal(out.markdown);
    const itemsOk = hasEnoughItems(out.markdown);
    if (finalOk && itemsOk) return out;
    console.warn("[generate-checklist] validation failed, retrying", {
      model, finalOk, itemsOk, mdLen: out.markdown.length,
    });
    const reinforced = baseSystem +
      "\n\nПРЕДЫДУЩАЯ ПОПЫТКА НАРУШИЛА ФОРМАТ. Строго используй заголовок `## Что важно помнить` для финального блока (не «Как пользоваться», не «Резюме», не «Итог»). Обязательно 10-14 пунктов в формате `- [ ] Название — описание`.";
    const retry = await attempt(model, reinforced);
    // Combine token usage from both attempts so cost logging stays truthful.
    return {
      ...retry,
      tokensIn: (out.tokensIn || 0) + (retry.tokensIn || 0),
      tokensOut: (out.tokensOut || 0) + (retry.tokensOut || 0),
    };
  };

  try {
    return await runWithRetry(PRIMARY_MODEL);
  } catch (e) {
    console.warn("[generate-checklist] primary failed, falling back:", (e as Error).message);
    return await runWithRetry(FALLBACK_MODEL);
  }
}

async function fetchChecklistPhotos(
  // deno-lint-ignore no-explicit-any
  admin: any,
  args: { userId: string; ecosystemId: string; query: string },
): Promise<string[]> {
  const key = (Deno.env.get("UNSPLASH_ACCESS_KEY") || "").trim();
  if (!key) {
    console.warn("[CHECKLIST-UNSPLASH] failed: UNSPLASH_ACCESS_KEY not configured");
    return [];
  }
  const rawQuery = (args.query || "").trim();
  if (!rawQuery) {
    console.warn("[CHECKLIST-UNSPLASH] failed: empty query");
    return [];
  }
  let query = rawQuery;
  try {
    query = await aiTranslateToPhotoQuery(rawQuery);
  } catch (_) { /* keep raw */ }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const url =
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}` +
      `&per_page=5&orientation=landscape&client_id=${encodeURIComponent(key)}`;
    const r = await fetch(url, { signal: ctrl.signal, headers: { "Accept-Version": "v1" } });
    clearTimeout(timer);
    if (!r.ok) {
      console.warn(`[CHECKLIST-UNSPLASH] failed: HTTP ${r.status}`);
      return [];
    }
    const j = await r.json();
    const results: any[] = Array.isArray(j?.results) ? j.results : [];
    if (results.length === 0) {
      console.warn("[CHECKLIST-UNSPLASH] failed: no results for", query);
      return [];
    }
    const top = results
      .filter((p) => p?.urls?.regular)
      .sort((a, b) => (b?.likes ?? 0) - (a?.likes ?? 0))
      .slice(0, 2);
    if (top.length === 0) return [];

    const uploaded: string[] = [];
    for (let idx = 0; idx < top.length; idx++) {
      const photo = top[idx];
      try {
        const img = await fetch(photo.urls.regular);
        if (!img.ok) throw new Error(`img HTTP ${img.status}`);
        const bytes = new Uint8Array(await img.arrayBuffer());
        const path = `${args.userId}/${args.ecosystemId}/images/${Date.now()}_${idx + 1}.jpg`;
        const { error: upErr } = await admin.storage
          .from("ecosystem-formats")
          .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
        if (upErr) throw upErr;
        const { data: signed } = await admin.storage
          .from("ecosystem-formats")
          .createSignedUrl(path, 60 * 60 * 24 * 7);
        if (signed?.signedUrl) uploaded.push(signed.signedUrl);
      } catch (e) {
        console.warn(`[CHECKLIST-UNSPLASH] failed: image ${idx + 1}: ${(e as Error).message}`);
      }
    }
    return uploaded;
  } catch (e) {
    console.warn(`[CHECKLIST-UNSPLASH] failed: ${(e as Error).message}`);
    return [];
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "-")
    .replace(/&ndash;/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
