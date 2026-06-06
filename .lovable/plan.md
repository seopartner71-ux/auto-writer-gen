## Цель

Убрать «промт-винегрет»: то, что можно проверить кодом - проверять кодом и автоматически переписывать. То, что нельзя - оставить в промте, но коротко и приоритизированно.

## Структура

### Шаг 1. Разбить `antiTurgenevAddon.ts` на 3 константы

Файл `supabase/functions/_shared/antiTurgenevAddon.ts` превращается в композицию:

- `HARD_RULES` - 6-7 строк, только то, что валидируется кодом (длина предложений, серии коротких, обрывы мыслей, частотность ключа, запрет повтора зачинов абзацев). Идёт в system-промт первой.
- `BANLIST` - плоский список запрещённых слов/фраз через запятую (канцеляризмы, штампы, заглушки, клише). Идёт отдельным блоком - LLM такие списки парсит лучше нумерованных.
- `STYLE_GUIDE` - мягкие рекомендации по чередованию длин, абзацам, риторике. Подключается опционально (отключается для «raw» Persona, чтобы не дрались правила).

Экспортируем `ANTI_TURGENEV_ADDON` (HARD + BANLIST) как дефолт - совместимость со всеми вызовами не ломается. `STYLE_GUIDE` экспортируется отдельно.

### Шаг 2. Создать 3 новых валидатора (по образцу `sentenceStructure.ts`)

В `supabase/functions/_shared/validators/`:

1. **`cancellaryGuard.ts`** - regex по BANLIST канцеляризмов и штампов. Возвращает `{ verdict, hits: [{phrase, count, samples}], issues }`. `fail` если >3 уникальных канцеляризма или любой встречается ≥3 раз.

2. **`keywordFrequencyGuard.ts`** - считает частотность seed-ключа и значимых слов на 1000 знаков. `fail` если ключ чаще 2 раз в H2-блоке или значимое слово >2/1000 знаков.

3. **`danglingThoughtGuard.ts`** - regex на висящие союзы в конце абзацев/H2 (`и`, `но`, `поэтому`, `однако`, `при этом`) и предложения, обрывающиеся без терминатора. `fail` если хоть один висящий союз.

Каждый валидатор экспортирует `analyze*` + `build*FixHint(metrics)` - точно как `sentenceStructure.ts`.

Дублирующая копия для фронта - в `src/shared/utils/validators/` (если понадобится в LiveTurgenevBadge).

### Шаг 3. Подключить к `quality-check`

В `supabase/functions/quality-check/index.ts`:

- Импортировать все 4 валидатора (sentence + 3 новых).
- Прогонять последовательно по plain text.
- Сложить результаты в `quality_details.validators = { sentence_structure, cancellary, keyword_frequency, dangling_thoughts }`.
- Aggregate verdict: `fail` если ≥1 валидатор fail; `warning` если ≥1 warning.
- При `fail` - диспатчить `improve-article` с `fix_type: <validator_name>` и hint. Флаг `*_auto_fixed: true` в `quality_details` чтобы избежать петель. Если несколько fail - вызвать **последовательно по приоритету**: dangling → sentence → cancellary → keyword_frequency.

### Шаг 4. Расширить `improve-article`

В `supabase/functions/improve-article/index.ts` добавить phase для каждого валидатора:
- `phase: "cancellary"` - Sonnet перепишет фрагменты с канцеляризмами.
- `phase: "keyword_freq"` - Sonnet снизит частотность через синонимы/местоимения.
- `phase: "dangling"` - Sonnet закроет висящие мысли.

Каждая phase: bypass plan limits + cooldown (как `sentence`), system-промт с конкретным hint от валидатора, после фикса - background re-trigger `quality-check`.

### Шаг 5. Урезать промт

После того как валидаторы покрывают правила - в `antiTurgenevAddon` оставить:
- 6-7 HARD-строк (одной строкой каждая, без объяснений «почему»).
- BANLIST одной плоской строкой.
- Финальная строка: «Текст проверяется автоматически на выходе. Нарушения переписываются.»

Получается ~30% от текущего объёма. Промт читается LLM целиком, а не выборочно.

## Технические детали

### Совместимость
- Имя `ANTI_TURGENEV_ADDON` и сигнатура не меняются - все edge-функции, что импортируют его, продолжают работать.
- `analyzeSentenceStructure` и `buildSentenceStructureFixHint` остаются с прежними сигнатурами.

### Анти-петли
- Каждый валидатор пишет `quality_details.<name>_auto_fixed: true` после фикса.
- Второй вызов `quality-check` не диспатчит `improve-article` если флаг уже стоит (даже если verdict снова fail) - чтобы не зациклиться на трудных текстах. Логируется warning.

### Порядок фиксов
Dangling (структурно ломает текст) → Sentence (стиль) → Cancellary (лексика) → Keyword frequency (тонкая настройка). Каждый следующий шаг работает с уже улучшенным текстом.

### Файлы

Новые:
- `supabase/functions/_shared/validators/cancellaryGuard.ts`
- `supabase/functions/_shared/validators/keywordFrequencyGuard.ts`
- `supabase/functions/_shared/validators/danglingThoughtGuard.ts`

Изменения:
- `supabase/functions/_shared/antiTurgenevAddon.ts` - разнести на 3 константы, урезать.
- `supabase/functions/quality-check/index.ts` - подключить все валидаторы, aggregate, dispatch по приоритету.
- `supabase/functions/improve-article/index.ts` - добавить phases: cancellary, keyword_freq, dangling.

Деплой: `quality-check`, `improve-article`.

## Что НЕ делаю на этом шаге
- Per-Persona оверрайды STYLE_GUIDE (отдельная задача).
- UI-индикаторы новых валидаторов в `QualityCheckPanel` (могу добавить отдельно после проверки).
- Front-копии валидаторов в `src/shared/utils/` - подключим, когда понадобится live-валидация в редакторе.
