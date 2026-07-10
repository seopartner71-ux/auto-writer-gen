// Persona language sanity-check shared across generate-article,
// bulk-generate and improve-article. The UI filters personas by locale,
// but edge functions accept any author_profile_id via API, so we must
// re-validate on the server before injecting a persona prompt written in
// a different language than the target article.
//
// Usage:
//   const safe = assertPersonaLanguage({
//     authorProfile, articleLang,
//     context: { fn: "generate-article", userId, articleId, keywordId }
//   });
//   // safe === null => do NOT apply persona prompt (write plain style).

import { logPipelineEvent } from "./pipelineLogger.ts";

export interface PersonaGuardContext {
  fn: string;
  userId?: string | null;
  articleId?: string | null;
  keywordId?: string | null;
}

/**
 * Returns the authorProfile if its `language` matches `articleLang`.
 * Returns null (and logs a warning to pipeline_events) when the persona
 * belongs to a different locale — caller must then generate without the
 * persona prompt or pick a default persona of the correct language.
 *
 * Presets that opt out of localisation by leaving `language` NULL are
 * treated as language-agnostic and accepted for any target locale.
 */
export function assertPersonaLanguage<T extends { id?: string; name?: string; language?: string | null } | null | undefined>(
  params: {
    authorProfile: T;
    articleLang: string;
    context: PersonaGuardContext;
  },
): T | null {
  const { authorProfile, articleLang, context } = params;
  if (!authorProfile) return authorProfile ?? null;

  const target = String(articleLang || "").toLowerCase().slice(0, 2);
  const persona = String((authorProfile as any).language || "").toLowerCase().slice(0, 2);

  // Language-agnostic persona (legacy row with NULL language) — allow.
  if (!persona) return authorProfile;
  // Matches target locale — allow.
  if (persona === target) return authorProfile;

  console.warn(
    `[persona-guard][${context.fn}] language mismatch: persona=${persona} article=${target} ` +
      `id=${(authorProfile as any).id} name="${(authorProfile as any).name}" — dropping persona prompt`,
  );

  logPipelineEvent({
    stage: "compliance_check",
    user_id: context.userId ?? null,
    article_id: context.articleId ?? null,
    verdict: "warning",
    error_kind: "persona_language_mismatch",
    error_message: `persona lang "${persona}" != article lang "${target}"`,
    meta: {
      fn: context.fn,
      author_profile_id: (authorProfile as any).id ?? null,
      author_name: (authorProfile as any).name ?? null,
      persona_language: persona,
      article_language: target,
      keyword_id: context.keywordId ?? null,
    },
  });

  return null;
}