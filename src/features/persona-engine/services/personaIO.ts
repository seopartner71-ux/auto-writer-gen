// Импорт и экспорт персон: JSON, Master Prompt, отчёт.

import type { Persona, PersonaDna, StyleDna } from "../types";
import { computePersonaHealth } from "./personaHealth";

export interface ImportResult {
  name: string;
  role: string | null;
  description: string | null;
  persona_dna: PersonaDna;
  style_dna: StyleDna;
  problems: string[];
}

/** Распознаёт JSON-персону или голый Master Prompt. */
export function parseImport(raw: string): ImportResult {
  const text = raw.trim();
  const problems: string[] = [];
  if (!text) throw new Error("Пустой ввод");

  if (text.startsWith("{")) {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("Не удалось разобрать JSON");
    }
    const dna = (json.persona_dna || json.personaDna || json.dna || {}) as PersonaDna;
    const style = (json.style_dna || json.styleDna || {}) as StyleDna;
    if (!Object.keys(dna).length) problems.push("В файле не найдена Persona DNA - блоки придётся заполнить вручную.");
    if (!dna.identity) problems.push("Не найден блок identity.");
    if (!dna.voice) problems.push("Не найден блок voice.");
    if (!dna.fact_policy) problems.push("Не найдена Fact Policy - будет применена политика по умолчанию.");
    const conflicts = Array.isArray(dna.conflicts) ? dna.conflicts : [];
    conflicts.filter(c => !c?.resolution).forEach(c => problems.push(`Неразрешённый конфликт: ${c?.rule_a} / ${c?.rule_b}`));
    return {
      name: String(json.name || "Импортированная персона"),
      role: (json.role as string) || null,
      description: (json.description as string) || null,
      persona_dna: dna,
      style_dna: style,
      problems,
    };
  }

  // Голый Master Prompt: сохраняем как исходное описание, DNA собирается компилятором.
  problems.push("Загружен текстовый Master Prompt. Он будет преобразован в Persona DNA через анализ.");
  return {
    name: "Импортированная персона",
    role: null,
    description: text.slice(0, 6000),
    persona_dna: {},
    style_dna: {},
    problems,
  };
}

export function exportJson(persona: Persona): string {
  return JSON.stringify({
    name: persona.name,
    role: persona.role,
    description: persona.description,
    version: persona.version,
    language: persona.language,
    persona_dna: persona.persona_dna,
    style_dna: persona.style_dna,
    style_fingerprint: persona.style_fingerprint,
    quality_rules: persona.quality_rules,
  }, null, 2);
}

export function exportReport(persona: Persona): string {
  const health = computePersonaHealth(persona);
  const lines: string[] = [];
  lines.push(`Persona Report: ${persona.name}`);
  lines.push(`Роль: ${persona.role || "не указана"}`);
  lines.push(`Версия: ${persona.version}   Статус: ${persona.status}`);
  lines.push(`Сайт: ${persona.site_url || "не привязан"}`);
  lines.push(`Persona Health: ${health.score}/100`);
  lines.push("");
  lines.push("Компоненты здоровья:");
  health.components.forEach(c => lines.push(`- ${c.label}: ${c.score}`));
  if (health.hints.length) {
    lines.push("");
    lines.push("Рекомендации:");
    health.hints.forEach(h => lines.push(`- ${h}`));
  }
  lines.push("");
  lines.push("Persona DNA:");
  lines.push(JSON.stringify(persona.persona_dna, null, 2));
  lines.push("");
  lines.push("Style DNA:");
  lines.push(JSON.stringify(persona.style_dna, null, 2));
  return lines.join("\n");
}

export function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}