// Detects «обрывы мысли»: висящие союзы в конце абзацев/H2 и предложения
// без терминатора. LLM на длинных промтах любит обрывать абзац на «и»,
// «но», «поэтому» — это структурно ломает текст, поэтому фиксится первым.

const DANGLING_CONJUNCTIONS = [
  "и","но","а","или","также","однако","поэтому","потому","причем","причём",
  "тогда","значит","зато","ведь","хотя","если","когда","пока","чтобы",
  "при этом","в то время как","несмотря на то что","так что","за счет того что",
];

// Хвосты, после которых терминатор — гарантированный обрубок придаточного:
// "потому что.", "но когда.", "но зимой.", "если.", "чтобы." и т.п.
// Проверяются per-sentence, не только в конце блока.
const SENTENCE_TAIL_FRAGMENTS = [
  "потому что","потому","так как","поскольку","чтобы","если","когда","пока",
  "но когда","а когда","но если","но зимой","но летом","но при","и когда",
  "хотя","несмотря на","при","без","из-за","благодаря","вопреки",
];

export interface DanglingHit {
  kind: "block_end" | "missing_terminator" | "sentence_fragment";
  trigger: string;
  preview: string;
}

export interface DanglingMetrics {
  blockCount: number;
  hits: DanglingHit[];
  verdict: "pass" | "warning" | "fail";
  issues: string[];
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function lastSnippet(text: string): string {
  const t = text.trim();
  return t.length > 160 ? "…" + t.slice(-160) : t;
}

function extractBlocks(htmlOrText: string): string[] {
  // HTML: берём содержимое <p>, <li>, <h2>, <h3> как отдельные блоки.
  if (/<(p|li|h[1-6])[\s>]/i.test(htmlOrText)) {
    const blocks: string[] = [];
    const re = /<(p|li|h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(htmlOrText)) !== null) {
      const txt = stripTags(m[2]);
      if (txt.length >= 20) blocks.push(txt);
    }
    if (blocks.length) return blocks;
  }
  // Plain text: блоки по двойному переносу.
  return htmlOrText.split(/\n{2,}/).map((s) => s.trim()).filter((s) => s.length >= 20);
}

export function analyzeDanglingThoughts(contentHtmlOrText: string): DanglingMetrics {
  const blocks = extractBlocks(contentHtmlOrText);
  const hits: DanglingHit[] = [];

  for (const block of blocks) {
    // 0. Per-sentence: обрубки придаточных вида "…потому что." / "…но зимой."
    const sentences = block.split(/(?<=[.!?…])\s+/);
    for (const s of sentences) {
      const trimmedS = s.trim().replace(/[»"'`)\]]+$/g, "");
      if (trimmedS.length < 8) continue;
      const noTermS = trimmedS.replace(/[.!?…]+$/g, "").trim().toLowerCase().replace(/ё/g, "е");
      for (const frag of SENTENCE_TAIL_FRAGMENTS) {
        const re = new RegExp(`(?:^|\\s)${frag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
        if (re.test(noTermS)) {
          hits.push({ kind: "sentence_fragment", trigger: frag, preview: lastSnippet(trimmedS) });
          break;
        }
      }
    }

    const trimmed = block.replace(/\s+$/g, "").replace(/[«»"'`)\]]+$/g, "").trim();
    if (!trimmed) continue;

    // 1. Висящий союз в конце блока (после удаления возможной точки/запятой).
    const noTerm = trimmed.replace(/[.!?…,;:]+$/g, "").trim();
    const tail = noTerm.toLowerCase().replace(/ё/g, "е");
    let danglingHit: string | null = null;
    for (const conj of DANGLING_CONJUNCTIONS) {
      const re = new RegExp(`(?:^|\\s)${conj.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
      if (re.test(tail)) {
        danglingHit = conj;
        break;
      }
    }
    if (danglingHit) {
      hits.push({
        kind: "block_end",
        trigger: danglingHit,
        preview: lastSnippet(block),
      });
      continue;
    }

    // 2. Блок > 80 символов и не оканчивается терминатором — оборванная мысль.
    if (trimmed.length > 80 && !/[.!?…]$/.test(trimmed) && !/[:;]$/.test(trimmed)) {
      hits.push({
        kind: "missing_terminator",
        trigger: "",
        preview: lastSnippet(block),
      });
    }
  }

  const issues: string[] = [];
  const dangling = hits.filter((h) => h.kind === "block_end").length;
  const missing = hits.filter((h) => h.kind === "missing_terminator").length;
  const fragments = hits.filter((h) => h.kind === "sentence_fragment").length;
  if (dangling) issues.push(`Найдено ${dangling} абзацев, заканчивающихся висящим союзом ("и", "но", "поэтому"...).`);
  if (missing) issues.push(`Найдено ${missing} абзацев без терминатора предложения — мысль не закрыта.`);
  if (fragments) issues.push(`Найдено ${fragments} обрубков придаточных предложений вида "…потому что." / "…но зимой." / "…если." — короткое предложение обязано быть грамматически полным.`);

  const verdict: "pass" | "warning" | "fail" = hits.length === 0 ? "pass" : "fail";

  return {
    blockCount: blocks.length,
    hits,
    verdict,
    issues,
  };
}

export function buildDanglingFixHint(m: DanglingMetrics): string | null {
  if (m.verdict === "pass") return null;
  const lines: string[] = ["Закрой оборванные мысли. Каждый абзац должен заканчиваться завершённым предложением — без висящих союзов и без обрыва без точки."];
  for (const h of m.hits.slice(0, 8)) {
    if (h.kind === "block_end") {
      lines.push(`  • Висящий "${h.trigger}": ${h.preview}`);
    } else if (h.kind === "missing_terminator") {
      lines.push(`  • Нет терминатора: ${h.preview}`);
    } else {
      lines.push(`  • Обрубок придаточного "${h.trigger}.": ${h.preview}`);
    }
  }
  lines.push("Допиши логическое завершение придаточной части (что именно происходит «потому что», «когда», «если»). Короткое предложение должно быть грамматически полным: подлежащее + сказуемое или законченное назывное.");
  return lines.join("\n");
}