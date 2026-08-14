// Доступ к данным Persona Engine. Новые таблицы и новые edge-функции.

import { supabase } from "@/integrations/supabase/client";
import type { Persona, PersonaEvaluation, PersonaVersion, SiteDnaRow, StyleFingerprint, PersonaDna, StyleDna } from "../types";
import { compileMasterPrompt } from "./personaCompiler";
import { computePersonaHealth } from "./personaHealth";

const TABLE = "personas" as never;

function anyDb() {
  // Новые таблицы ещё не отражены в сгенерированных типах - работаем через any.
  return supabase as unknown as {
    from: (t: string) => any;
    functions: typeof supabase.functions;
  };
}

export async function listPersonas(): Promise<Persona[]> {
  const { data, error } = await anyDb().from("personas").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []) as Persona[];
}

export async function getPersona(id: string): Promise<Persona | null> {
  const { data, error } = await anyDb().from("personas").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Persona) || null;
}

export async function listSiteDna(): Promise<SiteDnaRow[]> {
  const { data, error } = await anyDb().from("site_dna").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []) as SiteDnaRow[];
}

export async function analyzeSite(url: string, force = false): Promise<SiteDnaRow> {
  const { data, error } = await supabase.functions.invoke("site-dna-analyze", { body: { url, force } });
  if (error) throw new Error(await extractError(error));
  if (data?.error) throw new Error(data.error);
  return data.site_dna as SiteDnaRow;
}

export async function saveSiteDna(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await anyDb().from("site_dna").update(patch).eq("id", id);
  if (error) throw error;
}

/** Забирает текст страницы сайта - для примеров стиля автора. */
export async function fetchSiteText(url: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("extract-source-content", {
    body: { url, source_type: "page" },
  });
  if (error) throw new Error(await extractError(error));
  if (data?.error) throw new Error(data.error);
  return String(data?.content || "").trim();
}

export interface CompileResponse {
  persona_dna: PersonaDna;
  style_dna: StyleDna;
  confidence?: Record<string, number>;
  conflicts?: { rule_a: string; rule_b: string; resolution: string }[];
  missing_inputs?: string[];
  suggested_name?: string;
  suggested_role?: string;
}

export async function compilePersona(payload: {
  description: string;
  site_dna?: unknown;
  samples?: string[];
  style_fingerprint?: StyleFingerprint | null;
  inputs?: Record<string, unknown>;
  language?: string;
}): Promise<CompileResponse> {
  const { data, error } = await supabase.functions.invoke("persona-compile", { body: payload });
  if (error) throw new Error(await extractError(error));
  if (data?.error) throw new Error(data.error);
  return data as CompileResponse;
}

export async function testPersona(personaId: string, task: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("persona-test", { body: { persona_id: personaId, task } });
  if (error) throw new Error(await extractError(error));
  if (data?.error) throw new Error(data.error);
  return String(data.output || "");
}

export async function evaluatePersona(payload: {
  persona_id: string;
  text: string;
  task?: string | null;
  article_id?: string | null;
  persist?: boolean;
}): Promise<PersonaEvaluation & { evaluation_id: string | null }> {
  const { data, error } = await supabase.functions.invoke("persona-evaluate", { body: payload });
  if (error) throw new Error(await extractError(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Пересобирает Master Prompt и Health Score из DNA. */
export function derivePersonaFields(p: Partial<Persona>): { master_prompt: string; health_score: number } {
  const master_prompt = compileMasterPrompt({
    name: p.name || "Автор",
    role: p.role,
    personaDna: (p.persona_dna || {}) as PersonaDna,
    styleDna: (p.style_dna || {}) as StyleDna,
    fingerprint: p.style_fingerprint,
  });
  const health_score = computePersonaHealth({ ...p, master_prompt }).score;
  return { master_prompt, health_score };
}

export async function createPersona(input: Partial<Persona> & { name: string }): Promise<Persona> {
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) throw new Error("Требуется авторизация");
  const derived = derivePersonaFields(input);
  const { data, error } = await anyDb().from("personas").insert({
    user_id: userId,
    name: input.name,
    role: input.role ?? null,
    description: input.description ?? null,
    status: input.status ?? "draft",
    version: input.version ?? "1.0",
    site_url: input.site_url ?? null,
    site_dna_id: input.site_dna_id ?? null,
    persona_dna: input.persona_dna ?? {},
    style_dna: input.style_dna ?? {},
    style_fingerprint: input.style_fingerprint ?? null,
    quality_rules: input.quality_rules ?? {},
    language: input.language ?? "ru",
    change_log: input.change_log ?? "Создание персоны",
    ...derived,
  }).select().single();
  if (error) throw error;
  await snapshotVersion(data as Persona, "Создание персоны");
  return data as Persona;
}

export async function updatePersona(id: string, patch: Partial<Persona>, changeLog?: string): Promise<Persona> {
  const current = await getPersona(id);
  if (!current) throw new Error("Персона не найдена");
  const merged = { ...current, ...patch } as Persona;
  const derived = derivePersonaFields(merged);
  const { data, error } = await anyDb().from("personas")
    .update({ ...patch, ...derived, change_log: changeLog ?? patch.change_log ?? current.change_log })
    .eq("id", id).select().single();
  if (error) throw error;
  return data as Persona;
}

function bumpVersion(version: string, major: boolean): string {
  const [maj, min] = version.split(".").map(n => parseInt(n, 10) || 0);
  return major ? `${maj + 1}.0` : `${maj}.${min + 1}`;
}

/** Создание новой версии: старая сохраняется в истории. */
export async function createPersonaVersion(id: string, changeLog: string, major = false): Promise<Persona> {
  const current = await getPersona(id);
  if (!current) throw new Error("Персона не найдена");
  await snapshotVersion(current, current.change_log || "Предыдущая версия");
  return updatePersona(id, { version: bumpVersion(current.version, major) }, changeLog);
}

async function snapshotVersion(persona: Persona, changeLog: string): Promise<void> {
  await anyDb().from("persona_versions").insert({
    persona_id: persona.id,
    user_id: persona.user_id,
    version: persona.version,
    snapshot: {
      name: persona.name, role: persona.role, description: persona.description,
      persona_dna: persona.persona_dna, style_dna: persona.style_dna,
      style_fingerprint: persona.style_fingerprint, master_prompt: persona.master_prompt,
    },
    change_log: changeLog,
  });
}

export async function listVersions(personaId: string): Promise<PersonaVersion[]> {
  const { data, error } = await anyDb().from("persona_versions").select("*").eq("persona_id", personaId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as PersonaVersion[];
}

export async function listEvaluations(personaId: string): Promise<PersonaEvaluation[]> {
  const { data, error } = await anyDb().from("persona_evaluations").select("*").eq("persona_id", personaId).order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return (data || []) as PersonaEvaluation[];
}

export async function duplicatePersona(persona: Persona, name: string): Promise<Persona> {
  return createPersona({
    ...persona,
    name,
    status: "draft",
    version: "1.0",
    change_log: `Дубликат персоны ${persona.name}`,
  });
}

export async function archivePersona(id: string): Promise<void> {
  const { error } = await anyDb().from("personas").update({ status: "archived" }).eq("id", id);
  if (error) throw error;
}

export async function addStyleExample(personaId: string, content: string, kind: "positive" | "negative", reason?: string): Promise<void> {
  const { data: userRes } = await supabase.auth.getUser();
  const { error } = await anyDb().from("persona_style_examples").insert({
    persona_id: personaId,
    user_id: userRes.user?.id,
    kind,
    content,
    reason: reason || null,
  });
  if (error) throw error;
}

export async function listStyleExamples(personaId: string) {
  const { data, error } = await anyDb().from("persona_style_examples").select("*").eq("persona_id", personaId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as { id: string; kind: string; content: string; reason: string | null; created_at: string }[];
}

export async function deleteStyleExample(id: string) {
  const { error } = await anyDb().from("persona_style_examples").delete().eq("id", id);
  if (error) throw error;
}

async function extractError(error: unknown): Promise<string> {
  const err = error as { message?: string; context?: Response };
  try {
    const body = await err.context?.json();
    if (body?.error) return String(body.error);
  } catch {
    // ignore
  }
  return err?.message || "Неизвестная ошибка";
}

export { TABLE };