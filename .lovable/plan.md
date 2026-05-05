## Quick Start / Expert modes for AI Writer

### 1. Mode state
- Add `aiwriterMode: "quick" | "expert"` state in `ArticlesPage.tsx`, hydrated from `localStorage.getItem('aiwriter_mode')`, default `"expert"`.
- Persist on change.

### 2. Mode switcher UI (top of page, under H1)
- Two pill tabs: `🚀 Быстрый старт` / `⚙️ Эксперт`.
- Active = primary (purple) bg + white text; inactive = transparent + muted text.
- Render in `HeaderModeSwitcher` (below the existing Boutique/Factory row), wrapped in a `transition-opacity` so content fades 150ms.

### 3. `GenerationForm` — `quickMode` prop
When `quickMode=true`, hide:
- Interlinking panel
- Expert quote / Comparison table chips
- SEO keywords input
- GEO toggle + region input
- Custom instructions textarea
- "По разделам (beta)" button

Keep: project select, keyword select, `PersonaSelector`, big Generate button.

### 4. Author block sanitization (both modes)
The `description` field on custom authors is currently populated from the first 100 chars of `system_instruction` (in `PersonaSelector.handleCreateAuthor`), so it looks like a raw prompt. Fix:
- Stop seeding `description` from the prompt; set `description: null` for new custom authors.
- In the preview Author block (`ArticlesPage.tsx` line ~1310): render only `name` + a short subtitle = `niche || voice_tone || type`. Truncate to ~40 chars and never render `description` if it looks long/prompt-like (>60 chars or contains `\n`).

### 5. Right panel in Quick Start
Replace `SeoSidePanelContainer` + `EditorSidebar` + Tabs(`dashboard`/`human`/`benchmark`) block with a single `QuickStartSummary` card:
- Before content: hint card ("Выберите ключевое слово…").
- After content: summary card built from the same data `QualityBadge` subscribes to:
  - Big status: 🟢 ГОТОВО / 🟡 РЕКОМЕНДУЕМ УЛУЧШИТЬ / 🔴 ТРЕБУЕТ ДОРАБОТКИ.
  - 4 rows (AI / Burstiness / Density / Turgenev) using the human-language labels from spec.
  - "✨ Улучшить автоматически" + "📤 Сохранить статью" buttons.

### 6. Editor toolbar in Quick Start
In the toolbar row above the editor (~line 1240–1290), when `quickMode=true`:
- Show only: Editor tab, Preview tab, `…` `DropdownMenu` (Copy / Download HTML / Google Docs / FAQ&Schema), Save button, and `QualityBadge`.
- Hide: HTML tab, FAQ&Schema tab, History, Share, "Доработка".

Expert mode stays as-is (no grouping refactor in this pass — too risky).

### 7. Sidebar badge
In `AppSidebar.tsx` next to the "Статьи / Articles" nav item, render a tiny badge `Старт` / `Эксперт` reading from `localStorage` (subscribe via a custom event dispatched on mode change, so it updates live).

### Out of scope (per user "Не трогать")
- `handleGenerate` and any generation logic
- Edge Functions
- Quality checks logic
- DB tables
- Routing
- Sidebar nav structure (only badge added)

### Files to edit
- `src/pages/ArticlesPage.tsx` — mode state, conditional right panel, conditional toolbar, sanitized author block.
- `src/features/article-editor/HeaderModeSwitcher.tsx` + `src/pages/articles/ArticlesPageHeader.tsx` — Quick/Expert pill row.
- `src/features/article-editor/GenerationForm.tsx` — `quickMode` prop.
- `src/features/article-quality/QuickStartSummary.tsx` — new component.
- `src/components/article/PersonaSelector.tsx` — stop seeding `description` from prompt.
- `src/components/AppSidebar.tsx` — mode badge.
