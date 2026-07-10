# `_shared/prompts/` — centralized bilingual prompt registry

Single source of truth for every LLM-facing prompt in the generation pipeline.
Mirrors the shape of `src/shared/i18n/` but for **server-side prompts sent to
models**, not UI copy.

## Why this exists

Before this module we had ~19 call sites that built prompts inline as russian
template literals and shipped them to the model **regardless of the article's
language** (`article.language` / `keyword.language`). That caused the same
class of bug as the 840-article `language='en'` desync: english article →
russian system prompt → mixed-language output.

## Contract

```ts
import { getPrompt } from "../_shared/prompts/index.ts";

const usr = getPrompt("improve.humanize.user", article.language, {
  content,
  conservativeBlock,
  validatorContextBlock,
  judgeReasonsBlock,
  lexicalBanBlock,
  rhythmBlock,
});
```

### Rules — hard

1. **Language is always explicit.** Callers pass `article.language` (or
   `keyword.language` at generation time). No implicit default, no
   `?? "ru"`.
2. **Missing translation fails loudly.** If a registered key has no entry for
   the requested language, `getPrompt` throws
   `MissingPromptTranslationError`. Callers wrap the call and log a
   `pipeline_events` warning with `error_kind: "prompt_language_missing"`,
   then either abort the pass or fall back to a *language-neutral* prompt —
   never to russian.
3. **EN prompts are native, not machine-translated.** Same intent, same
   constraints, but written in idiomatic english. Rules that only make sense
   for russian morphology (падежи, склонение ключей, Turgenev/Baden-Baden,
   russian банлист) are **omitted** from the EN version — the corresponding
   pass should be skipped for `language !== "ru"` upstream.
4. **Params are typed per key.** Each prompt key declares its parameter
   shape in `keys.ts` so callers get compile-time errors if a placeholder is
   missing.
5. **No prompt string lives outside this module.** If you find yourself
   writing `` `Перепиши...` `` in an edge function, stop and add a key here.

### Naming convention

`<domain>.<action>.<role>` where `role ∈ {system, user}`.

Examples:
- `writer.article.system` — main article writer system prompt
- `writer.article.user` — user turn for the writer
- `improve.humanize.user` — humanize pass user prompt
- `improve.sentence_structure.user` — sentence-structure rewrite pass
- `improve.cancellary.user` — cancellary-ban rewrite pass
- `improve.keyword_declension.user` — russian-only, throws for `en`
- `bulk.section.system` — bulk-generate per-section system prompt
- `rewrite.optimize.user` — quality-issue targeted fix
- `rewrite.benchmark.user` — top-10 benchmark optimize

## File layout

```
_shared/prompts/
  README.md           ← this file
  index.ts            ← getPrompt, registry, error types
  types.ts            ← Lang, PromptKey, PromptParams<K>
  writer.ts           ← writer.* keys (article generation)
  improve.ts          ← improve.* keys (humanize / structure / bans)
  rewrite.ts          ← rewrite.* keys (targeted fixes & benchmarks)
  bulk.ts             ← bulk.* keys (bulk-generate)
```

Each domain file exports `{ ru, en }` for every key it owns and re-registers
them via `registerPrompts()`.

## Migration status (step 1)

Scope of the first batch — CRITICAL, ядро генерации:

| Key | Source (was) | Status |
|---|---|---|
| `improve.humanize.user` | `improve-article/index.ts:1126` | **registered (RU + EN reference)** — call site NOT yet swapped, awaiting tone review |
| `writer.article.system` | `_shared/promptBuilder.ts:569` (`buildSystemPrompt`) | key reserved, RU-only until reference approved |
| `writer.article.user`   | `_shared/promptBuilder.ts:1102` (`buildUserPrompt`) | key reserved |
| `bulk.section.system`   | `bulk-generate/index.ts` writer block | key reserved |
| `improve.sentence_structure.user` | `improve-article/index.ts:1433` | key reserved |
| `improve.cancellary.user` | `improve-article/index.ts:1529` | key reserved |
| `improve.keyword_declension.user` | `improve-article/index.ts:1653` | **RU-only**, `en` throws — pass should be skipped upstream |

HIGH / MEDIUM / LOW (16 remaining points) land in step 2 after the exemplar
EN prompt below is approved for tone.