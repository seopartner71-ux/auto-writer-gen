// Central prompt registry — bilingual (ru/en), fail-loud on missing translations.
//
// Usage:
//   import { getPrompt } from "../_shared/prompts/index.ts";
//   const usr = getPrompt("improve.humanize.user", article.language, { content, ... });
//
// Rules (see README.md):
//   1. Language is always explicit — never default to "ru".
//   2. Missing translation → MissingPromptTranslationError. Callers wrap and
//      log a pipeline_events warning with error_kind:"prompt_language_missing".
//   3. EN prompts are native, not machine-translated.
//   4. RU-only prompts (russian morphology) throw for `en`. Upstream must
//      skip the pass for non-ru articles.

import type { Lang, PromptKey, PromptParams, PromptTemplate } from "./types.ts";
import { RESTRICTED_LANGS } from "./types.ts";
import { registerImprove } from "./improve.ts";

export class MissingPromptTranslationError extends Error {
  constructor(public readonly key: PromptKey, public readonly lang: Lang) {
    super(`prompt "${key}" has no ${lang} translation`);
    this.name = "MissingPromptTranslationError";
  }
}

export class RestrictedPromptLanguageError extends Error {
  constructor(public readonly key: PromptKey, public readonly lang: Lang, public readonly allowed: readonly Lang[]) {
    super(`prompt "${key}" is not available in ${lang} (allowed: ${allowed.join(",")})`);
    this.name = "RestrictedPromptLanguageError";
  }
}

type Registry = {
  [K in PromptKey]?: Partial<Record<Lang, PromptTemplate<K>>>;
};

const REGISTRY: Registry = {};

export function registerPrompt<K extends PromptKey>(
  key: K,
  lang: Lang,
  template: PromptTemplate<K>,
): void {
  const bucket = (REGISTRY[key] ??= {}) as Partial<Record<Lang, PromptTemplate<K>>>;
  bucket[lang] = template;
}

export function getPrompt<K extends PromptKey>(
  key: K,
  lang: Lang,
  params: PromptParams<K>,
): string {
  const restricted = RESTRICTED_LANGS[key];
  if (restricted && !restricted.includes(lang)) {
    throw new RestrictedPromptLanguageError(key, lang, restricted);
  }
  const bucket = REGISTRY[key] as Partial<Record<Lang, PromptTemplate<K>>> | undefined;
  const tpl = bucket?.[lang];
  if (!tpl) throw new MissingPromptTranslationError(key, lang);
  return tpl(params);
}

/** Does the registry have this key in this language? Non-throwing probe. */
export function hasPrompt(key: PromptKey, lang: Lang): boolean {
  const bucket = REGISTRY[key] as Partial<Record<Lang, unknown>> | undefined;
  return !!bucket?.[lang];
}

// Register all domain modules on first import.
registerImprove();

export type { Lang, PromptKey, PromptParams };