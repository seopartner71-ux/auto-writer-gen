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
          const ok = !!body && items >= minItems;
          push({ type, ok, reason: ok ? "" : `блок "${title}" отсутствует или < ${minItems} пунктов` }); break;
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
          const capitalWords = Array.from(
            new Set((stripLinks(md).match(/\b[A-ZА-ЯЁ][a-zа-яё]{2,}\b/g) || []))
          ).filter((w) => !["Что", "Как", "Или", "Если", "После", "Перед", "При", "Про", "Это"].includes(w));
          const invented = capitalWords.filter((w) => !src.includes(w.toLowerCase())).slice(0, 5);
          const ok = invented.length === 0;
          push({ type, ok, reason: ok ? "" : `возможные придуманные названия: ${invented.join(", ")}` }); break;
        }
        case "context_links_count": {
          const n = countMatches(md, "\\[[^\\]]+\\]\\(https?://[^)]+\\)");
          const min = Number(raw.min || 0); const max = Number(raw.max || Infinity);
          const ok = n >= min && n <= max;
          push({ type, ok, reason: ok ? "" : `ссылок ${n} вне диапазона ${min}-${max}` }); break;
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