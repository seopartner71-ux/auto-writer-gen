// Persona Health Score и Quality Gate перед переводом в Active.

import type { Persona, PersonaDna } from "../types";

export interface HealthComponent {
  key: string;
  label: string;
  score: number;
  weight: number;
}

export interface HealthResult {
  score: number;
  components: HealthComponent[];
  hints: string[];
}

function has(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function pct(part: number, total: number): number {
  return total ? Math.round((part / total) * 100) : 0;
}

export function computePersonaHealth(persona: Partial<Persona>): HealthResult {
  const dna = (persona.persona_dna || {}) as PersonaDna;
  const style = persona.style_dna || {};
  const hints: string[] = [];

  const completenessChecks = [
    has(dna.identity), has(dna.expertise), has(dna.audience), has(dna.purpose),
    has(dna.voice), has(style), has(dna.fact_policy), has(dna.source_policy),
    has(dna.seo_policy), has(dna.editorial_rules), has(dna.quality_control),
  ];
  const completeness = pct(completenessChecks.filter(Boolean).length, completenessChecks.length);

  const conflicts = Array.isArray(dna.conflicts) ? dna.conflicts : [];
  const unresolved = conflicts.filter(c => !c?.resolution).length;
  const consistency = Math.max(0, 100 - unresolved * 34);

  const voice = dna.voice || {};
  const numericVoice = ["formality", "warmth", "energy", "authority", "emotionality", "directness", "subjectivity", "conversationality"]
    .filter(k => typeof (voice as Record<string, unknown>)[k] === "number").length;
  const specificity = pct(numericVoice, 8);

  const fp = persona.style_fingerprint;
  const evidence = fp ? Math.min(100, 40 + (fp.samples_count || 0) * 20) : 20;

  const styleKeys = ["vocabulary", "sentence_style", "paragraph_style", "rhythm"].filter(k => has((style as Record<string, unknown>)[k])).length;
  const styleClarity = pct(styleKeys, 4);

  const factPolicy = has(dna.fact_policy?.rules) ? 100 : has(dna.fact_policy) ? 60 : 0;
  const promptQuality = persona.master_prompt
    ? Math.min(100, Math.round((persona.master_prompt.length / 3500) * 100))
    : 0;

  const components: HealthComponent[] = [
    { key: "completeness", label: "Полнота", score: completeness, weight: 2 },
    { key: "consistency", label: "Непротиворечивость", score: consistency, weight: 1.5 },
    { key: "specificity", label: "Конкретность", score: specificity, weight: 1.5 },
    { key: "evidence", label: "Доказательность", score: evidence, weight: 1 },
    { key: "style_clarity", label: "Ясность стиля", score: styleClarity, weight: 1.5 },
    { key: "fact_policy", label: "Фактологическая политика", score: factPolicy, weight: 1.5 },
    { key: "prompt_quality", label: "Качество промпта", score: promptQuality, weight: 1 },
  ];

  const totalWeight = components.reduce((a, c) => a + c.weight, 0);
  const score = Math.round(components.reduce((a, c) => a + c.score * c.weight, 0) / totalWeight);

  if (completeness < 80) hints.push("Персона слишком общая - заполните недостающие блоки Persona DNA.");
  if (evidence < 60) hints.push("Добавьте 2-3 примера текстов, чтобы уточнить стиль.");
  if (!has(dna.identity?.role)) hints.push("Уточните роль автора.");
  if (typeof voice.subjectivity !== "number") hints.push("Определите степень субъективности.");
  if (!has((dna.narrative as Record<string, unknown>)?.first_person_policy)) hints.push("Укажите, разрешено ли первое лицо.");
  if (unresolved) hints.push("Есть неразрешённые противоречия в требованиях.");

  return { score, components, hints };
}

export interface QualityGateResult {
  passed: boolean;
  problems: string[];
}

/** Персону нельзя перевести в Active, пока не пройден Quality Gate. */
export function personaQualityGate(persona: Partial<Persona>): QualityGateResult {
  const dna = (persona.persona_dna || {}) as PersonaDna;
  const problems: string[] = [];
  if (!has(dna.identity)) problems.push("Не определена Identity автора.");
  if (!has(dna.audience)) problems.push("Не определена аудитория.");
  if (!has(dna.voice)) problems.push("Не определён Voice.");
  if (!has(persona.style_dna)) problems.push("Не определён Style DNA.");
  if (!has(dna.fact_policy)) problems.push("Не определена Fact Policy.");
  if (!persona.master_prompt) problems.push("Master Prompt не скомпилирован.");
  const conflicts = Array.isArray(dna.conflicts) ? dna.conflicts : [];
  if (conflicts.some(c => !c?.resolution)) problems.push("Есть критический неразрешённый конфликт требований.");
  return { passed: problems.length === 0, problems };
}