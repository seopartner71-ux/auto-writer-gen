## Plan: GEO Radar Backend Integration

### Phase 1: Database Migration
Create new tables with RLS:
- `radar_prompt_groups` — prompt categories (Situational, Comparative, etc.) linked to projects
- `radar_prompts` — individual prompts linked to groups
- `radar_analysis_runs` — tracks each scan run with timestamp
- Update `radar_results` to add `run_id` and `prompt_id` columns

### Phase 2: Update Edge Function `radar-check`
- Accept optional `run_id` parameter
- Support scanning by prompts (not just keywords)
- Extract and store sources from AI responses (especially Perplexity citations)
- Return progress events for real-time progress tracking
- Link results to analysis_runs

### Phase 3: Wire Sub-Tabs to Real Data
- **MentionsPage**: Replace MOCK_PROMPTS/MOCK_MENTIONS with Supabase queries from `radar_results` + `radar_prompts`
- **PromptsPage**: CRUD operations on `radar_prompt_groups` and `radar_prompts` via Supabase
- **SourcesPage**: Aggregate URLs from `radar_results.ai_response_text` and competitor_domains

### Phase 4: UI Enhancements
- Add scanning progress bar ("Analyzing Prompt 5/20 via ChatGPT...")
- Add analysis run history selector to compare results across runs
- Auto-generate default prompt groups when creating a project

### Notes
- OpenRouter API key is already configured in `api_keys` table
- Existing radar_check function already handles brand detection, sentiment, competitors
- Keep backward compatibility with existing radar_keywords workflow
