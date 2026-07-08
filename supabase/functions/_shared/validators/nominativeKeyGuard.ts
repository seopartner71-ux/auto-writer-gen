// Nominative-key / fragment guard.
// Ловит фрагменты, которые проходят через punkt как «предложения», но
// грамматически являются назывными конструкциями без сказуемого или
// оборванными условными придаточными:
//
//   • «Если это газовый котел отопления частного дома.»   — условная стуб
//   • «По опыту объектов с 1998 года.»                    — назывной лид
//   • «Baxi, Protherm, Vaillant, Ariston и Navien.»       — набивка брендов
//
// Все три паттерна — характерные маркеры LLM-текста в русских seo-статьях.
// Работает на plain-тексте (HTML пусть снимает вызывающая сторона).

export interface NominativeHit {
  kind: "conditional_stub" | "nominative_lead" | "brand_stuffing";
  trigger: string;
  preview: string;
}

export interface NominativeMetrics {
  sentenceCount: number;
  hits: NominativeHit[];
  verdict: "pass" | "warning" | "fail";
  issues: string[];
}

// Условный "если это <NP>." без запятой (нет придаточной части) — стуб.
const COND_STUB = /^\s*если\s+это\s+[^,;:—-]+\.\s*$/i;

// Назывные лиды: короткое предложение (≤ 12 слов) без глагольных признаков.
const NOM_LEAD = /^\s*(по\s+опыту|по\s+практике|по\s+наблюдениям|по\s+данным|на\s+опыте|на\s+основе|из\s+опыта|исходя\s+из\s+опыта)\b/i;

// Грубая эвристика «есть ли глагол» — типовые русские окончания.
// Достаточно, чтобы отличить «По опыту объектов с 1998 года.» (нет) от
// «По опыту объектов, накопленному с 1998 года, стенд ведёт себя…» (есть).
const VERB_HINT = /\b\w+(?:ет|ит|ут|ют|ают|яют|ся|ешь|ишь|ил|ила|ило|или|ется|ится|аем|аете|ите|ем|им|ал|ала|ало|али)\b/i;

// Набивка брендов: ≥ 3 подряд идущих Title-case латинских токенов, разделённых
// запятой/пробелом/«и». Ловит «Baxi, Protherm, Vaillant, Ariston и Navien».
const BRAND_LIST = /(?:\b[A-Z][A-Za-z0-9\-]{1,}\b[ ,]+){2,}(?:и\s+)?\b[A-Z][A-Za-z0-9\-]{1,}\b/;

function splitSentences(plain: string): string[] {
  return plain.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
}

function snippet(s: string, max = 180): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function analyzeNominativeKeys(plain: string): NominativeMetrics {
  const sents = splitSentences(plain);
  const hits: NominativeHit[] = [];

  for (const s of sents) {
    if (COND_STUB.test(s)) {
      hits.push({ kind: "conditional_stub", trigger: "если это", preview: snippet(s) });
      continue;
    }
    if (NOM_LEAD.test(s)) {
      const wc = s.split(/\s+/).filter(Boolean).length;
      if (wc <= 12 && !VERB_HINT.test(s)) {
        const m = s.match(NOM_LEAD)!;
        hits.push({ kind: "nominative_lead", trigger: m[1].toLowerCase(), preview: snippet(s) });
        continue;
      }
    }
    const bm = s.match(BRAND_LIST);
    if (bm && bm[0].split(/\s+/).filter(Boolean).length >= 3) {
      hits.push({ kind: "brand_stuffing", trigger: bm[0].slice(0, 80), preview: snippet(s) });
    }
  }

  const issues: string[] = [];
  const c = hits.filter((h) => h.kind === "conditional_stub").length;
  const n = hits.filter((h) => h.kind === "nominative_lead").length;
  const b = hits.filter((h) => h.kind === "brand_stuffing").length;
  if (c) issues.push(`Найдено ${c} оборванных условных предложений вида «Если это <NP>.» — нет придаточной части.`);
  if (n) issues.push(`Найдено ${n} назывных лидов вида «По опыту / По практике <NP>.» без сказуемого.`);
  if (b) issues.push(`Найдено ${b} набивок брендов подряд без контекста (≥ 3 названий).`);

  const verdict: "pass" | "warning" | "fail" = hits.length === 0 ? "pass" : (hits.length >= 3 ? "fail" : "warning");
  return { sentenceCount: sents.length, hits, verdict, issues };
}

export function buildNominativeFixHint(m: NominativeMetrics): string | null {
  if (m.verdict === "pass") return null;
  const lines: string[] = ["Убери назывные обрывки — каждое предложение должно быть грамматически полным."];
  for (const h of m.hits.slice(0, 8)) {
    if (h.kind === "conditional_stub") lines.push(`  • Условный стуб: ${h.preview}. Допиши «то …» с реальным действием.`);
    else if (h.kind === "nominative_lead") lines.push(`  • Назывной лид «${h.trigger}»: ${h.preview}. Введи сказуемое.`);
    else lines.push(`  • Набивка брендов: ${h.preview}. Оставь 2-3 бренда с пояснением, что их отличает.`);
  }
  return lines.join("\n");
}