// Types for the centralized prompt registry.
//
// Every prompt key declares its parameter shape here so callers get compile-
// time errors if a placeholder is missing. Keep this file the *only* place
// that knows about individual key names — domain files import PromptKey and
// PromptParams from here.

export type Lang = "ru" | "en";

export interface PromptParamMap {
  // improve.*
  "improve.humanize.user": {
    content: string;
    conservativeBlock?: string;
    validatorContextBlock?: string;
    judgeReasonsBlock?: string;
    lexicalBanBlock?: string;
    rhythmBlock?: string;
  };
  "improve.humanize.system": Record<string, never>;
  "improve.sentence_structure.user": {
    content: string;
    fixHint: string;
  };
  "improve.cancellary.user": {
    content: string;
    fixHint: string;
  };
  // RU-only. `en` throws — the calling pass must be skipped for non-ru.
  "improve.keyword_declension.user": {
    content: string;
    keyword: string;
    problemSentences: string;
  };

  // writer.*
  "writer.article.system": {
    // Filled in step 2 once tone is approved.
    [k: string]: unknown;
  };
  "writer.article.user": {
    [k: string]: unknown;
  };

  // bulk.*
  "bulk.section.system": {
    [k: string]: unknown;
  };

  // rewrite.*
  "rewrite.optimize.user": {
    instruction: string;
  };
  "rewrite.benchmark.user": {
    [k: string]: unknown;
  };
}

export type PromptKey = keyof PromptParamMap;
export type PromptParams<K extends PromptKey> = PromptParamMap[K];

export type PromptTemplate<K extends PromptKey> = (p: PromptParams<K>) => string;

// Language-restricted keys. Requesting a language not listed here throws.
// Everything else must ship both `ru` and `en`.
export const RESTRICTED_LANGS: Partial<Record<PromptKey, readonly Lang[]>> = {
  "improve.keyword_declension.user": ["ru"],
};