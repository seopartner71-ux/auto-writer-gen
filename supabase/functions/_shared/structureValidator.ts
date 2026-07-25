// Structure validator for generate-article.
//
// The writer receives an approved outline (H1/H2/H3) built from the SERP
// medians. The model sometimes drops H2 sections, invents its own, or
// reorders them. This helper:
//   1. renders the approved outline as a HARD-REQUIREMENT block (XML
//      tagged so the model does not paraphrase it),
//   2. extracts headings from the generated markdown,
//   3. compares them with the approved outline using a fuzzy match
//      (the model may lightly rephrase - "Как оттереть засохший
//      суперклей" <-> "Удаление засохшего суперклея" is fine; dropping a
//      section entirely is not).
//
// Everything here is pure TS - no network, no Supabase - so it can be
// unit-tested and reused from bulk-generate.

export type OutlineLevel = "h1" | "h2" | "h3";
export interface OutlineItem { level: OutlineLevel; text: string }

export interface HeadingHit { level: 1 | 2 | 3; title: string; line: number }

export interface StructureReport {
  passed: boolean;
  approved_h1: string | null;
  approved_h2_count: number;
  approved_h3_count: number;
  generated_h1: string | null;
  generated_h2_count: number;
  generated_h3_count: number;
  missing_h2: string[];    // approved H2 absent from output
  missing_h3: string[];    // approved H3 absent from output
  extra_h2: string[];      // generated H2 not in approved outline
  extra_h3: string[];      // generated H3 not in approved outline
  wrong_order: boolean;    // approved H2s appear out of sequence
  h2_match_ratio: number;  // 0..1 - fraction of approved H2 matched
  h3_match_ratio: number;  // 0..1 - fraction of approved H3 matched
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter((w) => w.length >= 3);
}

/** Fuzzy similarity between two heading titles: Jaccard over 3+char tokens.
 *  Returns 0..1. Threshold 0.5 is a safe "same topic, slight rewording". */
export function similarText(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Extract H1/H2/H3 from markdown and HTML headings. */
export function extractHeadings(md: string): HeadingHit[] {
  const out: HeadingHit[] = [];
  const lines = String(md || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      const level = m[1].length as 1 | 2 | 3;
      const title = m[2].trim();
      if (title) out.push({ level, title, line: i });
      continue;
    }
    const htmlRe = /<h([1-3])\b[^>]*>(.*?)<\/h\1>/gi;
    let hm: RegExpExecArray | null;
    while ((hm = htmlRe.exec(line)) !== null) {
      const level = Number(hm[1]) as 1 | 2 | 3;
      const title = hm[2]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
      if (title) out.push({ level, title, line: i });
    }
  }
  return out;
}

/** Render outline as a HARD-REQUIREMENT block for the writer prompt.
 *  XML tags + explicit ban on adding/removing/reordering headings. */
export function renderApprovedStructureBlock(
  outline: OutlineItem[] | undefined,
  lang: "ru" | "en" = "ru",
): string {
  const items = (outline || []).filter((o) => o && o.text && o.text.trim());
  if (!items.length) return "";
  const rendered = items
    .map((o) => {
      const marker = o.level === "h1" ? "#" : o.level === "h3" ? "###" : "##";
      return `${marker} ${o.text.trim()}`;
    })
    .join("\n");
  const h2n = items.filter((o) => o.level === "h2").length;
  const h3n = items.filter((o) => o.level === "h3").length;

  if (lang === "en") {
    return `
<required_structure>
## STRICT ARTICLE STRUCTURE (mandatory)
You MUST write the article using the exact heading structure below.
- DO NOT add new H2 headings that are not in the list.
- DO NOT skip any H2 or H3 from the list.
- DO NOT change the order of H2/H3 headings.
- You MAY lightly rephrase a heading (keep the topic), but you MUST NOT drop it.
- Each H2 section MUST contain at least 200 words of substantive content.
- If a heading has H3 subheadings, cover EACH of them as a subsection inside its parent H2.
- After the H1 you MUST write a lead paragraph (2-4 sentences, 40-90 words) BEFORE the first H2. Never place an H2 immediately after the H1.

Approved outline (${items.length} headings - 1 H1, ${h2n} H2, ${h3n} H3):
${rendered}

Before you finish, silently verify:
1. Every approved H2 is present in your article.
2. The order matches the outline above.
3. Every approved H3 is present under its parent H2.
If any check fails - rewrite before returning the answer.
</required_structure>
`;
  }
  return `
<required_structure>
## СТРОГАЯ СТРУКТУРА СТАТЬИ (обязательно)
Ты ДОЛЖЕН написать статью строго по следующей структуре заголовков.
- НЕ ДОБАВЛЯЙ новые H2, которых нет в списке.
- НЕ ПРОПУСКАЙ ни один H2 или H3 из списка.
- НЕ МЕНЯЙ порядок заголовков H2/H3.
- Разрешено слегка перефразировать заголовок (тема должна остаться), но НЕЛЬЗЯ его пропускать.
- Каждый H2-раздел ДОЛЖЕН содержать минимум 200 слов содержательного текста.
- Если у H2 есть подзаголовки H3 - раскрой КАЖДЫЙ из них как подраздел внутри соответствующего H2.
- После H1 ОБЯЗАТЕЛЬНО идет лид-абзац (2-4 предложения, 40-90 слов) ДО первого H2. Никогда не ставь H2 сразу после H1 - между ними всегда должен быть вводный абзац.

Утвержденная структура (${items.length} заголовков - 1 H1, ${h2n} H2, ${h3n} H3):
${rendered}

Перед выдачей ответа МОЛЧА проверь:
1. Все ли утвержденные H2 присутствуют в статье?
2. Порядок совпадает с планом выше?
3. Каждый ли H3 раскрыт внутри своего H2?
Если хоть один пункт не выполнен - перепиши статью до того, как отдашь ответ.
</required_structure>
`;
}

/** Compare generated markdown against the approved outline.
  *  passed = required ratios for approved H2/H3 matched AND order preserved. */
export interface ValidateOptions {
  /** Per-heading fuzzy match threshold (0..1). Lower = more forgiving. */
  simThreshold?: number;
  /** Fraction of approved H2 that must match for `passed=true`. */
  passRatio?: number;
  /** Fraction of approved H3 that must match for `passed=true`. */
  h3PassRatio?: number;
  /** Extra-H2 tolerance as fraction of approved H2 count (min 2 in strict, 4 in flexible). */
  extraToleranceRatio?: number;
  /** Exact number of extra H2 allowed. Overrides ratio when provided. */
  extraTolerance?: number;
  /** If true, wrong order does NOT flip `passed` to false. */
  allowReorder?: boolean;
}

export function validateStructure(
  outline: OutlineItem[] | undefined,
  markdown: string,
  optsOrThreshold: number | ValidateOptions = {},
): StructureReport {
  const opts: ValidateOptions = typeof optsOrThreshold === "number"
    ? { simThreshold: optsOrThreshold }
    : (optsOrThreshold || {});
  const simThreshold = opts.simThreshold ?? 0.5;
  const passRatio = opts.passRatio ?? 0.7;
  const h3PassRatio = opts.h3PassRatio ?? passRatio;
  const extraToleranceRatio = opts.extraToleranceRatio ?? 0.3;
  const allowReorder = !!opts.allowReorder;
  const approved = (outline || []).filter((o) => o && o.text && o.text.trim());
  const approvedH1 = approved.find((o) => o.level === "h1")?.text?.trim() || null;
  const approvedH2 = approved.filter((o) => o.level === "h2").map((o) => o.text.trim());
  const approvedH3 = approved.filter((o) => o.level === "h3").map((o) => o.text.trim());
  const approvedH3Count = approvedH3.length;

  const heads = extractHeadings(markdown || "");
  const genH1 = heads.find((h) => h.level === 1)?.title || null;
  const genH2 = heads.filter((h) => h.level === 2).map((h) => h.title);
  const genH3 = heads.filter((h) => h.level === 3).map((h) => h.title);
  const genH3Count = genH3.length;

  // Match each approved H2 to at most one generated H2 (greedy, in order).
  const matchedGenIdx = new Set<number>();
  const matchedApprovedIdx = new Set<number>();
  const approvedToGen: number[] = [];
  for (let i = 0; i < approvedH2.length; i++) {
    let bestIdx = -1;
    let bestSim = 0;
    for (let j = 0; j < genH2.length; j++) {
      if (matchedGenIdx.has(j)) continue;
      const s = similarText(approvedH2[i], genH2[j]);
      if (s > bestSim) { bestSim = s; bestIdx = j; }
    }
    if (bestIdx !== -1 && bestSim >= simThreshold) {
      matchedGenIdx.add(bestIdx);
      matchedApprovedIdx.add(i);
      approvedToGen.push(bestIdx);
    } else {
      approvedToGen.push(-1);
    }
  }

  const missingH2 = approvedH2.filter((_, i) => !matchedApprovedIdx.has(i));
  const extraH2 = genH2.filter((_, j) => !matchedGenIdx.has(j));

  const matchedGenH3Idx = new Set<number>();
  const matchedApprovedH3Idx = new Set<number>();
  for (let i = 0; i < approvedH3.length; i++) {
    let bestIdx = -1;
    let bestSim = 0;
    for (let j = 0; j < genH3.length; j++) {
      if (matchedGenH3Idx.has(j)) continue;
      const s = similarText(approvedH3[i], genH3[j]);
      if (s > bestSim) { bestSim = s; bestIdx = j; }
    }
    if (bestIdx !== -1 && bestSim >= simThreshold) {
      matchedGenH3Idx.add(bestIdx);
      matchedApprovedH3Idx.add(i);
    }
  }
  const missingH3 = approvedH3.filter((_, i) => !matchedApprovedH3Idx.has(i));
  const extraH3 = genH3.filter((_, j) => !matchedGenH3Idx.has(j));

  // Order check: sequence of matched gen-indices must be strictly increasing.
  const seq = approvedToGen.filter((v) => v !== -1);
  let wrongOrder = false;
  for (let k = 1; k < seq.length; k++) {
    if (seq[k] < seq[k - 1]) { wrongOrder = true; break; }
  }

  const ratio = approvedH2.length === 0
    ? 1
    : matchedApprovedIdx.size / approvedH2.length;
  const h3Ratio = approvedH3.length === 0
    ? 1
    : matchedApprovedH3Idx.size / approvedH3.length;

  // "Passed" = enough approved H2/H3 matched AND correct order AND
  // no more than the allowed extra H2s beyond the plan.
  const extraTolerance = typeof opts.extraTolerance === "number"
    ? opts.extraTolerance
    : Math.max(
        allowReorder ? 4 : 2,
        Math.ceil(approvedH2.length * extraToleranceRatio),
      );
  const passed = approvedH2.length === 0
    ? true
    : ratio >= passRatio
      && h3Ratio >= h3PassRatio
      && (allowReorder || !wrongOrder)
      && extraH2.length <= extraTolerance;

  return {
    passed,
    approved_h1: approvedH1,
    approved_h2_count: approvedH2.length,
    approved_h3_count: approvedH3Count,
    generated_h1: genH1,
    generated_h2_count: genH2.length,
    generated_h3_count: genH3Count,
    missing_h2: missingH2,
    missing_h3: missingH3,
    extra_h2: extraH2,
    extra_h3: extraH3,
    wrong_order: wrongOrder,
    h2_match_ratio: Number(ratio.toFixed(3)),
    h3_match_ratio: Number(h3Ratio.toFixed(3)),
  };
}

/** Build a reinforcement snippet appended to the user prompt on retry,
 *  listing the concrete violations from the previous attempt. */
export function buildStructureRetryDirective(
  report: StructureReport,
  lang: "ru" | "en" = "ru",
): string {
  const miss = report.missing_h2.slice(0, 10).map((t) => `- "${t}"`).join("\n");
  const missH3 = report.missing_h3.slice(0, 10).map((t) => `- "${t}"`).join("\n");
  const extra = report.extra_h2.slice(0, 10).map((t) => `- "${t}"`).join("\n");
  if (lang === "en") {
    return `\n\n---\n⚠️ PREVIOUS ATTEMPT VIOLATED THE APPROVED STRUCTURE.
Match ratio: ${(report.h2_match_ratio * 100).toFixed(0)}% of approved H2.
${report.missing_h2.length ? `MISSING H2 (must be added, in the exact order from <required_structure>):\n${miss}\n` : ""}${report.missing_h3.length ? `MISSING H3 (must be restored under their parent H2):\n${missH3}\n` : ""}${report.extra_h2.length ? `EXTRA H2 (must be removed - they are NOT in the approved outline):\n${extra}\n` : ""}${report.wrong_order ? "ORDER: H2 sections appeared out of the approved order. Restore the exact sequence.\n" : ""}
Rewrite the article now. Every approved H2 and H3 must appear once, in the approved order, with at least 200 words per H2. Do not add any H2 that is not in <required_structure>.`;
  }
  return `\n\n---\n⚠️ ПРЕДЫДУЩАЯ ПОПЫТКА НАРУШИЛА УТВЕРЖДЕННУЮ СТРУКТУРУ.
Совпадение: ${(report.h2_match_ratio * 100).toFixed(0)}% утвержденных H2.
${report.missing_h2.length ? `ПРОПУЩЕНЫ H2 (обязательно добавить в том же порядке, что в <required_structure>):\n${miss}\n` : ""}${report.missing_h3.length ? `ПРОПУЩЕНЫ H3 (обязательно вернуть внутри родительского H2):\n${missH3}\n` : ""}${report.extra_h2.length ? `ЛИШНИЕ H2 (обязательно удалить - их НЕТ в утвержденной структуре):\n${extra}\n` : ""}${report.wrong_order ? "ПОРЯДОК: H2 идут не в утвержденном порядке. Восстанови точную последовательность.\n" : ""}
Перепиши статью сейчас. Каждый утвержденный H2 и H3 должен появиться ровно один раз, в утвержденном порядке, минимум 200 слов на H2-раздел. Не добавляй H2, которых нет в <required_structure>.`;
}