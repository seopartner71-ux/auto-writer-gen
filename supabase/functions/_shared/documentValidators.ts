// Универсальный движок пост-проверок для generate-doc-universal.
// Читает post_checks_config из document_types и прогоняет по markdown.

export interface ValidatorContext {
  sourceArticleText?: string;
  anchorsCount?: number;
  clientPagesCount?: number;
}

export interface CheckResult { type: string; ok: boolean; reason?: string; details?: any }

export interface RunResult { ok: boolean; results: CheckResult[]; failedReasons: string[] }

const FILLER_PHRASES = [
  "в этой статье", "в этой инструкции", "в этом гайде",
  "данная тема", "как известно", "многие задаются вопросом",
  "стоит отметить", "нельзя не отметить",
];

function countMatches(md: string, pattern: string): number {
  try {
    const re = new RegExp(pattern, "gm");
    return (md.match(re) || []).length;
  } catch { return 0; }
}

function firstParagraph(md: string): string {
  const paras = md.replace(/\r/g, "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return paras.find((p) => !p.startsWith("#") && !p.startsWith("-") && !p.startsWith("|")) || "";
}

function stripLinks(s: string): string {
  return s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function countWords(md: string): number {
  return stripLinks(md).replace(/[#*_`>~|-]/g, " ").split(/\s+/).filter(Boolean).length;
}

function extractSectionBody(md: string, title: string): string | null {
  const re = new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*$`, "m");
  const m = md.match(re);
  if (!m || m.index == null) return null;
  const rest = md.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+/m);
  return next >= 0 ? rest.slice(0, next).trim() : rest.trim();
}

function extractH2Bodies(md: string): { title: string; body: string }[] {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: { title: string; body: string }[] = [];
  let cur: { title: string; body: string } | null = null;
  for (const ln of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(ln);
    if (m) {
      if (cur) out.push(cur);
      cur = { title: m[1].trim(), body: "" };
    } else if (cur) {
      cur.body += ln + "\n";
    }
  }
  if (cur) out.push(cur);
  return out;
}

// deno-lint-ignore no-explicit-any
export function runValidators(md: string, checks: any[], ctx: ValidatorContext = {}): RunResult {
  const results: CheckResult[] = [];
  if (!Array.isArray(checks)) return { ok: true, results, failedReasons: [] };

  const push = (r: CheckResult) => results.push(r);

  for (const raw of checks) {
    const type = raw?.type;
    if (!type) continue;
    try {
      switch (type) {
        case "h1_present": {
          const ok = /^#\s+.+/m.test(md);
          push({ type, ok, reason: ok ? "" : "H1 отсутствует" }); break;
        }
        case "min_word_count": {
          const w = countWords(md); const min = Number(raw.min || 0);
          push({ type, ok: w >= min, reason: w >= min ? "" : `слов ${w} < ${min}`, details: { w } }); break;
        }
        case "max_word_count": {
          const w = countWords(md); const max = Number(raw.max || Infinity);
          push({ type, ok: w <= max, reason: w <= max ? "" : `слов ${w} > ${max}`, details: { w } }); break;
        }
        case "min_bullet_count": {
          const n = countMatches(md, raw.pattern || "^-\\s+"); const min = Number(raw.min || 0);
          push({ type, ok: n >= min, reason: n >= min ? "" : `пунктов ${n} < ${min}` }); break;
        }
        case "max_bullet_count": {
          const n = countMatches(md, raw.pattern || "^-\\s+"); const max = Number(raw.max || Infinity);
          push({ type, ok: n <= max, reason: n <= max ? "" : `пунктов ${n} > ${max}` }); break;
        }
        case "final_section_exact": {
          const title = String(raw.title || "").trim();
          const re = new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*$`, "m");
          const ok = re.test(md);
          push({ type, ok, reason: ok ? "" : `нет ровно "## ${title}"` }); break;
        }
        case "no_tables": {
          const ok = !/^\s*\|.+\|\s*$/m.test(md);
          push({ type, ok, reason: ok ? "" : "содержит markdown-таблицу" }); break;
        }
        case "no_task_list": {
          const ok = !/^-\s*\[\s?\]/m.test(md);
          push({ type, ok, reason: ok ? "" : "содержит - [ ] задачи" }); break;
        }
        case "no_forbidden_openings": {
          const phrases: string[] = Array.isArray(raw.phrases) ? raw.phrases : [];
          const head = md.slice(0, 500).toLowerCase();
          const hit = phrases.find((p) => head.includes(String(p).toLowerCase()));
          push({ type, ok: !hit, reason: hit ? `запрещённый зачин "${hit}"` : "" }); break;
        }
        case "numbered_steps_present": {
          const n = countMatches(md, raw.pattern || "^### \\d+\\.");
          const min = Number(raw.min || 1); const max = Number(raw.max || Infinity);
          const ok = n >= min && n <= max;
          push({ type, ok, reason: ok ? "" : `шагов ${n} вне диапазона ${min}-${max}` }); break;
        }
        case "h2_count": {
          const n = countMatches(md, "^##\\s+");
          const min = Number(raw.min || 0); const max = Number(raw.max || Infinity);
          const ok = n >= min && n <= max;
          push({ type, ok, reason: ok ? "" : `H2 ${n} вне диапазона ${min}-${max}` }); break;
        }
        case "practical_conclusions_present": {
          const title = String(raw.title || "Практические выводы");
          const body = extractSectionBody(md, title);
          const items = body ? (body.match(/^[-*]\s+/gm) || []).length : 0;
          const minItems = Number(raw.min_items || 3);
          const w = body ? countWords(body) : 0;
          const minWords = Number(raw.min_words || 60);
          const reasons: string[] = [];
          if (!body) reasons.push(`нет H2 "${title}"`);
          else {
            if (items < minItems) reasons.push(`пунктов ${items} < ${minItems}`);
            if (w < minWords) reasons.push(`слов ${w} < ${minWords}`);
          }
          push({ type, ok: reasons.length === 0, reason: reasons.length ? `"${title}": ${reasons.join(", ")}` : "" }); break;
        }
        case "no_verbose_intro": {
          const p = firstParagraph(md);
          const sentences = p.split(/(?<=[.!?])\s+/).filter(Boolean).length;
          const lower = p.toLowerCase();
          const filler = FILLER_PHRASES.some((f) => lower.includes(f));
          const ok = sentences <= 3 && !filler;
          push({ type, ok, reason: ok ? "" : `лид ${sentences} предл. / filler=${filler}` }); break;
        }
        case "no_invented_brands": {
          const src = (ctx.sourceArticleText || "").toLowerCase();
          if (!src) { push({ type, ok: true }); break; }
          const allowedHeadings = new Set([
            "FAQ", "Executive", "Summary", "H1", "H2", "H3",
            "Кратко", "Ситуация", "Задача", "Решение", "Результаты", "Выводы", "Рекомендации",
            "Хотите", "Подводные", "Камни", "Итог", "Оглавление", "Категория", "Как", "Выбрать",
            "Ключевые", "Не", "Нашли", "Ответа", "Практические", "Что", "Дальше",
          ]);
          const capitalWords = Array.from(
            new Set((stripLinks(md).match(/\b[A-ZА-ЯЁ][a-zа-яё]{2,}\b/g) || []))
          ).filter((w) => !allowedHeadings.has(w) && !["Или", "Если", "После", "Перед", "При", "Про", "Это"].includes(w));
          const invented = capitalWords.filter((w) => !src.includes(w.toLowerCase())).slice(0, 5);
          const ok = invented.length === 0;
          push({ type, ok, reason: ok ? "" : `возможные придуманные названия: ${invented.join(", ")}` }); break;
        }
        case "context_links_count": {
          const n = countMatches(md, "\\[[^\\]]+\\]\\(https?://[^)]+\\)");
          const min = Number(raw.min || 0); const max = Number(raw.max || Infinity);
          const available = Number(ctx.anchorsCount || 0) + Number(ctx.clientPagesCount || 0);
          const effectiveMin = available > 0 ? Math.min(min, available) : 0;
          const ok = n >= effectiveMin && n <= max;
          push({
            type,
            ok,
            reason: ok ? "" : `ссылок ${n} вне диапазона ${effectiveMin}-${max}`,
            details: { n, available, effectiveMin },
          }); break;
        }
        case "min_tables": {
          // Считаем markdown-таблицы: строка `|...|` + следующая `|---|`
          const lines = md.replace(/\r/g, "").split("\n");
          let n = 0;
          for (let i = 0; i < lines.length - 1; i++) {
            if (/^\|.+\|\s*$/.test(lines[i]) && /^\|[\s\-:|]+\|\s*$/.test(lines[i + 1])) n++;
          }
          const min = Number(raw.min || 1);
          push({ type, ok: n >= min, reason: n >= min ? "" : `таблиц ${n} < ${min}`, details: { n } }); break;
        }
        case "min_faq": {
          const title = String(raw.title || "FAQ");
          const body = extractSectionBody(md, title);
          const q = body ? (body.match(/^###\s+/gm) || []).length : 0;
          const min = Number(raw.min || 10);
          push({ type, ok: q >= min, reason: q >= min ? "" : `вопросов FAQ ${q} < ${min}` }); break;
        }
        case "min_mistakes": {
          const title = String(raw.title || "Типичные ошибки");
          const body = extractSectionBody(md, title);
          const n = body ? (body.match(/^###\s+/gm) || []).length : 0;
          const min = Number(raw.min || 10);
          push({ type, ok: n >= min, reason: n >= min ? "" : `ошибок ${n} < ${min}` }); break;
        }
        case "min_final_checklist_items": {
          const title = String(raw.title || "Финальный чек-лист");
          const body = extractSectionBody(md, title);
          const n = body ? (body.match(/^[-*]\s+(\[\s?\])?/gm) || []).length : 0;
          const min = Number(raw.min || 20);
          push({ type, ok: n >= min, reason: n >= min ? "" : `пунктов финального чек-листа ${n} < ${min}` }); break;
        }
        case "min_questions_count":
        case "max_questions_count": {
          const n = (md.match(/^###\s+.+\?\s*$/gm) || []).length;
          if (type === "min_questions_count") {
            const min = Number(raw.min || 1);
            push({ type, ok: n >= min, reason: n >= min ? "" : `вопросов ${n} < ${min}`, details: { n } });
          } else {
            const max = Number(raw.max || Infinity);
            push({ type, ok: n <= max, reason: n <= max ? "" : `вопросов ${n} > ${max}`, details: { n } });
          }
          break;
        }
        case "min_answer_word_count": {
          const min = Number(raw.min || 30);
          const lines = md.replace(/\r/g, "").split("\n");
          const short: string[] = [];
          let inQ = false; let buf: string[] = []; let qText = "";
          const flush = () => {
            if (!inQ) return;
            const text = buf.join(" ").trim();
            const w = countWords(text);
            if (w < min) short.push(`«${qText.slice(0, 60)}» — ${w} слов`);
          };
          for (const ln of lines) {
            const h3 = /^###\s+(.+?)\s*$/.exec(ln);
            const h2 = /^##\s+/.test(ln);
            if (h3 && h3[1].trim().endsWith("?")) {
              flush(); buf = []; qText = h3[1]; inQ = true; continue;
            }
            if (h2 || (h3 && !h3[1].trim().endsWith("?"))) {
              flush(); inQ = false; buf = []; continue;
            }
            if (inQ) buf.push(ln);
          }
          flush();
          const ok = short.length === 0;
          push({ type, ok, reason: ok ? "" : `ответы короче ${min} слов: ${short.slice(0, 3).join("; ")}` });
          break;
        }
        case "required_sections": {
          const req: string[] = Array.isArray(raw.sections) ? raw.sections : [];
          const present = new Set(extractH2Bodies(md).map((s) => s.title));
          const missing = req.filter((t) => !present.has(String(t).trim()));
          const ok = missing.length === 0;
          push({ type, ok, reason: ok ? "" : `отсутствуют H2: ${missing.join(", ")}` });
          break;
        }
        case "min_metrics_count": {
          const section = String(raw.section || "Результаты");
          const body = extractSectionBody(md, section) || "";
          const min = Number(raw.min || 3);
          const re = /(?:[+\-]?\d[\d.,\s]*)\s*(?:%|₽|руб|р\.|шт|ч\.?|часов|минут|мин|сек|раз|раза|дн\.?|дней|тыс|млн|млрд|x|х)\b/gi;
          const n = (body.match(re) || []).length;
          const sourceMetrics = ((ctx.sourceArticleText || "").match(re) || []).length;
          if (sourceMetrics === 0 && n === 0) {
            push({ type, ok: true, reason: "not_applicable: в источнике нет проверяемых метрик", details: { n, sourceMetrics } });
            break;
          }
          push({ type, ok: n >= min, reason: n >= min ? "" : `метрик в "${section}" ${n} < ${min}`, details: { n } });
          break;
        }
        case "executive_summary_present": {
          const title = String(raw.title || "Executive Summary");
          const body = extractSectionBody(md, title);
          const w = body ? countWords(body) : 0;
          const min = Number(raw.min_words || 300);
          const max = Number(raw.max_words || 600);
          const ok = !!body && w >= min && w <= max;
          push({ type, ok, reason: ok ? "" : (!body ? `нет H2 "${title}"` : `слов в Executive Summary ${w} вне ${min}-${max}`) });
          break;
        }
        case "key_findings_present":
        case "recommendations_present": {
          const defTitle = type === "key_findings_present" ? "Ключевые выводы" : "Рекомендации";
          const title = String(raw.title || defTitle);
          const body = extractSectionBody(md, title) || "";
          const items = (body.match(/^\s*(?:[-*]|\d+[.)])\s+\S/gm) || []).length;
          const w = countWords(body);
          const minItems = Number(raw.min || 5);
          const minWords = Number(raw.min_words || 100);
          const reasons: string[] = [];
          if (!body) reasons.push(`нет H2 "${title}"`);
          else {
            if (w < minWords) reasons.push(`слов ${w} < ${minWords}`);
            if (items < minItems) reasons.push(`пунктов ${items} < ${minItems}`);
          }
          push({ type, ok: reasons.length === 0, reason: reasons.length ? `"${title}": ${reasons.join(", ")}` : "" });
          break;
        }
        case "no_metadata_leak": {
          // Ищем строки-утечки метаданных, попавшие в тело документа.
          const patterns: RegExp[] = [
            /^\s*[-*]?\s*Заголовок документа\s*:/im,
            /^\s*[-*]?\s*Категория(?:\s+документа)?\s*:/im,
            /^\s*[-*]?\s*Целевая аудитория\s*:/im,
            /^\s*[-*]?\s*Версия\s*:\s*\d/im,
            /^\s*[-*]?\s*Источник документа\s*:/im,
            /^\s*[-*]?\s*Текст CTA\s*:/im,
            /^\s*[-*]?\s*Био\s*:/im,
            /^\s*[-*]?\s*Подзаголовок\s*(?:\/\s*польза)?\s*:/im,
            /^\s*[-*]?\s*География\s*\/\s*рынок\s*:/im,
            /^##\s+(?:Метаданные|О документе|Паспорт документа|Ссылки на клиента)\s*$/im,
          ];
          const hits = patterns.map((re) => re.exec(md)).filter(Boolean) as RegExpExecArray[];
          const ok = hits.length === 0;
          const sample = hits.slice(0, 3).map((m) => m[0].trim().slice(0, 80)).join(" | ");
          push({ type, ok, reason: ok ? "" : `утечка метаданных в тело: ${sample}` });
          break;
        }
        case "category_headers_count": {
          const pattern = String(raw.pattern || "^##\\s+Категория");
          const n = countMatches(md, pattern);
          const min = Number(raw.min || 1);
          const max = Number(raw.max || Infinity);
          const ok = n >= min && n <= max;
          push({ type, ok, reason: ok ? "" : `H2-категорий ${n} вне ${min}-${max}`, details: { n } });
          break;
        }
        case "items_per_category_min": {
          const pattern = String(raw.category_pattern || "^Категория");
          const min = Number(raw.min || 3);
          const bodies = extractH2Bodies(md).filter((s) => new RegExp(pattern).test(s.title));
          const short = bodies
            .map((s) => ({ title: s.title, n: (s.body.match(/^###\s+/gm) || []).length }))
            .filter((s) => s.n < min);
          const ok = bodies.length > 0 && short.length === 0;
          push({ type, ok, reason: ok ? "" : short.map((s) => `«${s.title}»: ${s.n} < ${min}`).join("; ") || "нет категорий" });
          break;
        }
        case "toc_present": {
          const title = String(raw.title || "Оглавление");
          const body = extractSectionBody(md, title);
          const ok = !!body && (body.match(/^[-*]\s+/gm) || []).length >= Number(raw.min_items || 3);
          push({ type, ok, reason: ok ? "" : `нет H2 "${title}" или мало пунктов` });
          break;
        }
        default:
          push({ type, ok: true, reason: `валидатор "${type}" не реализован, пропущен` });
      }
    } catch (e) {
      push({ type, ok: false, reason: `ошибка валидатора: ${(e as Error).message}` });
    }
  }

  const failedReasons = results.filter((r) => !r.ok).map((r) => `[${r.type}] ${r.reason || "fail"}`);
  return { ok: failedReasons.length === 0, results, failedReasons };
}