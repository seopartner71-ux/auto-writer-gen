# Project rules

- Competitor phrase labels (add / check / skip) come only from `supabase/functions/_shared/termActions.ts`; why: one pure, unit-tested source of truth for what the generator may treat as mandatory.
- Client archives (KB and RAG) are stored in one GitHub repository, one folder per client, via the `archive-github` function; why: centralized storage and deletion per client.
