// Detects «обрывы мысли»: висящие союзы в конце абзацев/H2 и предложения
// без терминатора. LLM на длинных промтах любит обрывать абзац на «и»,
// «но», «поэтому» — это структурно ломает текст, поэтому фиксится первым.

const DANGLING_CONJUNCTIONS = [
  "и","но","а","или","также","однако","поэтому","потому","причем","причём",
  "тогда","значит","зато","ведь","хотя","если","когда","пока","чтобы",
  "при этом","в то время как","несмотря на то что","так что","за счет того что",
];

export interface DanglingHit {
  kind: "block_end" | "missing_terminator";
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
  if (dangling) issues.push(`Найдено ${dangling} абзацев, заканчивающихся висящим союзом ("и", "но", "поэтому"...).`);
  if (missing) issues.push(`Найдено ${missing} абзацев без терминатора предложения — мысль не закрыта.`);

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
    } else {
      lines.push(`  • Нет терминатора: ${h.preview}`);
    }
  }
  lines.push("Допиши логическое завершение, не выкидывай абзац целиком.");
  return lines.join("\n");
}