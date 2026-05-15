/**
 * SERP Cluster Discipline v2 — DYNAMIC top-N entity injection.
 *
 * Goal: stop the model from ignoring competitor entities by promoting the
 * highest-overlap entities (present in ≥2 of top-3 SERP results) into a
 * separate MANDATORY block at the END of the system prompt (last position
 * has the strongest steering effect).
 *
 * Returns "" if not enough signal to enforce.
 */

type SerpRow = {
  position?: number | null;
  deep_analysis?: { entities?: Array<string | { name?: string; entity?: string }> } | null;
};

function normEntity(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function pickTopSerpEntities(serpResults: SerpRow[], topN = 3, limitEntities = 8): string[] {
  const top = (serpResults || [])
    .slice() // don't mutate
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
    .slice(0, topN);

  if (top.length < 2) return [];

  // Count entity occurrences across top results.
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  top.forEach((r, idx) => {
    const ents = r.deep_analysis?.entities || [];
    const seen = new Set<string>();
    for (const e of ents) {
      const raw = typeof e === "string" ? e : e?.name || e?.entity;
      if (!raw) continue;
      const name = normEntity(raw);
      if (name.length < 2 || name.length > 60) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(name, (counts.get(name) || 0) + 1);
      if (!firstSeen.has(name)) firstSeen.set(name, idx);
    }
  });

  // Keep entities present in ≥2 of top-N results, then fall back to top-1 ents
  // if nothing overlapped.
  const overlapping = [...counts.entries()].filter(([, c]) => c >= 2);
  const sorted = (overlapping.length > 0 ? overlapping : [...counts.entries()])
    .sort((a, b) => b[1] - a[1] || (firstSeen.get(a[0])! - firstSeen.get(b[0])!))
    .slice(0, limitEntities)
    .map(([name]) => name);

  return sorted;
}

export function buildSerpEntityDisciplineAddon(
  serpResults: SerpRow[],
  language: string = "ru",
): string {
  const ents = pickTopSerpEntities(serpResults);
  if (ents.length === 0) return "";

  if (language === "ru") {
    return `\n\nSERP-CLUSTER DISCIPLINE v2 (КРИТИЧНО, не игнорируй):
Ниже - сущности, которые встречаются у топ-3 конкурентов в выдаче по этому запросу. Это маркеры тематической полноты, без них Google не считает страницу релевантной кластеру.
ОБЯЗАТЕЛЬНО упомяни КАЖДУЮ из этих сущностей минимум один раз в естественном контексте (не списком, не подряд):
${ents.map((e, i) => `${i + 1}. ${e}`).join("\n")}

Правила:
- Каждая сущность должна быть в осмысленном предложении, а не просто перечислена.
- Не выделяй их жирным, не делай из них отдельный раздел "ключевые сущности".
- Если сущность дублируется по смыслу - используй один раз, не нагнетай переспам.
- Сущности встроены в основной поток; читатель не должен заметить, что это SEO-маркеры.`;
  }

  return `\n\nSERP CLUSTER DISCIPLINE v2 (CRITICAL, do not ignore):
Below are entities that appear across the top-3 competitors for this query. They are topical completeness markers - without them Google does not consider the page relevant to the cluster.
You MUST mention EACH of these entities at least once in natural context (not as a list, not back-to-back):
${ents.map((e, i) => `${i + 1}. ${e}`).join("\n")}

Rules:
- Each entity must appear inside a meaningful sentence, not just enumerated.
- Do not bold them or create a separate "key entities" section.
- If an entity is semantically duplicated - mention it once, no keyword stuffing.
- Entities should blend into the prose; the reader should not notice they are SEO markers.`;
}