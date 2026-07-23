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
      .select("id, user_id, source_article_id, client_id, articles(title,content), clients(name,brand_color,expert_name,domain)")
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
  article: { title?: string; content?: string } | null;
  client: { name?: string; brand_color?: string; expert_name?: string; domain?: string } | null;
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
      has_checkboxes: (markdown.match(/^-\s*\[\s?\]/gm) || []).length >= 5,
      has_howto: /##\s+Как пользоваться/i.test(markdown),
    };
    console.log("[CHECKLIST-GEN] Post-checks", { formatId: ctx.formatId, ...checks });

    await setProgress(60, { model_used: modelUsed, content: markdown });

    let pdfUrl: string | null = null;
    let pdfPath: string | null = null;
    let pdfError: string | null = null;
    try {
      console.log("[CHECKLIST-PDF] PDF generation started", { formatId: ctx.formatId });
      const pdfStart = Date.now();
      const pdfBytes = await buildChecklistPdf({ title, markdown, client: ctx.client });
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

  const system =
    "Ты редактор-методолог. Из исходной статьи собираешь практический чек-лист. Верни строго Markdown: заголовок H1 = название чек-листа, короткое вступление (2-3 предложения), затем 8-14 пунктов вида '- [ ] Действие - короткое пояснение (1-2 предложения)'. В конце блок '## Как пользоваться' (2-4 строки). Без воды, без эмодзи, только короткое тире '-' (никогда не длинное). Пиши на русском, если исходник на русском.";
  const user =
    `Название материала: ${input.title}\n` +
    (input.clientName ? `Бренд/клиент: ${input.clientName}\n` : "") +
    `\nИсходный материал:\n${input.articleText}\n\n` +
    "Собери чек-лист в описанном формате.";

  const attempt = async (model: string) => {
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
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 2000,
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

  try {
    const out = await attempt(PRIMARY_MODEL);
    if (out.markdown.length < 200) throw new Error("primary output too short");
    return out;
  } catch (e) {
    console.warn("[generate-checklist] primary failed, falling back:", (e as Error).message);
    return await attempt(FALLBACK_MODEL);
  }
}

async function fetchFont(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`font ${url} ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
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

function hexToRgb(hex: string | undefined | null): { r: number; g: number; b: number } {
  const h = (hex || "#6E56CF").replace("#", "").padEnd(6, "0").slice(0, 6);
  const num = parseInt(h, 16);
  return { r: ((num >> 16) & 255) / 255, g: ((num >> 8) & 255) / 255, b: (num & 255) / 255 };
}

async function buildPdf(input: {
  title: string;
  markdown: string;
  client: { name?: string; brand_color?: string; expert_name?: string; domain?: string } | null;
}): Promise<Uint8Array> {
  const [regularBytes, boldBytes] = await Promise.all([
    fetchFont(FONT_REGULAR_URL),
    fetchFont(FONT_BOLD_URL),
  ]);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit as any);
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });

  const brand = hexToRgb(input.client?.brand_color);
  const brandColor = rgb(brand.r, brand.g, brand.b);
  const inkColor = rgb(0.09, 0.09, 0.12);
  const mutedColor = rgb(0.42, 0.42, 0.48);

  const pageW = 595.28;
  const pageH = 841.89;
  const marginX = 56;
  const marginTop = 64;
  const marginBottom = 56;
  const contentW = pageW - marginX * 2;

  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - marginTop;

  const drawHeader = () => {
    page.drawRectangle({ x: 0, y: pageH - 8, width: pageW, height: 8, color: brandColor });
    if (input.client?.name) {
      page.drawText(input.client.name, { x: marginX, y: pageH - 32, size: 10, font: bold, color: mutedColor });
    }
  };
  const drawFooter = () => {
    const label = input.client?.domain
      ? `${input.client.name || ""} · ${input.client.domain}`.trim()
      : (input.client?.name || "СЕО-Модуль");
    page.drawText(label, { x: marginX, y: 28, size: 9, font: regular, color: mutedColor });
  };
  const newPage = () => {
    drawFooter();
    page = pdf.addPage([pageW, pageH]);
    y = pageH - marginTop;
    drawHeader();
  };
  drawHeader();

  const wrap = (text: string, font: any, size: number, maxW: number): string[] => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) <= maxW) cur = trial;
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const drawLines = (
    text: string,
    opts: { font: any; size: number; color?: any; leading?: number; indent?: number },
  ) => {
    const leading = opts.leading ?? opts.size * 1.35;
    const indent = opts.indent ?? 0;
    const maxW = contentW - indent;
    const lines = wrap(text, opts.font, opts.size, maxW);
    for (const line of lines) {
      if (y - leading < marginBottom) newPage();
      page.drawText(line, {
        x: marginX + indent,
        y: y - opts.size,
        size: opts.size,
        font: opts.font,
        color: opts.color ?? inkColor,
      });
      y -= leading;
    }
  };

  const md = input.markdown.replace(/\r\n/g, "\n").split("\n");
  let titleLine = input.title;
  const startIdx = md.findIndex((l) => l.trim().startsWith("# "));
  if (startIdx >= 0) {
    titleLine = md[startIdx].replace(/^#\s+/, "").trim();
    md.splice(startIdx, 1);
  }
  drawLines(titleLine, { font: bold, size: 22, leading: 28 });
  y -= 6;
  drawLines("Практический чек-лист", { font: regular, size: 11, color: mutedColor, leading: 16 });
  y -= 14;

  for (const raw of md) {
    const line = raw.replace(/\r/g, "");
    if (!line.trim()) { y -= 8; continue; }
    if (line.startsWith("## ")) {
      y -= 6;
      drawLines(line.replace(/^##\s+/, ""), { font: bold, size: 14, leading: 20 });
      y -= 4;
      continue;
    }
    const check = line.match(/^-\s*\[\s?\]\s*(.+)$/);
    if (check) {
      if (y - 18 < marginBottom) newPage();
      const boxY = y - 14;
      page.drawRectangle({ x: marginX, y: boxY, width: 11, height: 11, borderColor: brandColor, borderWidth: 1.2 });
      drawLines(check[1], { font: regular, size: 11, leading: 16, indent: 20 });
      y -= 4;
      continue;
    }
    if (line.startsWith("- ")) {
      drawLines("• " + line.slice(2), { font: regular, size: 11, leading: 16, indent: 12 });
      continue;
    }
    drawLines(line, { font: regular, size: 11, leading: 16 });
  }

  drawFooter();
  return await pdf.save();
}
