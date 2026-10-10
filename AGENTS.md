# Project rules

- Article generation reads the current form state, and final polish carries the selected narration voice and approved H1; why: stale callbacks and unconstrained editing must not override user choices.
- Auto-save receives the final validated content explicitly, and reopening restores the stored narration voice; why: asynchronous state updates must not save a pre-correction draft or lose the user's voice selection.
- Paragraph-sized H1 repairs use `_shared/articleHeadingGuard.ts` and preserve the displaced text; why: the introduction must not become a heading or be discarded during correction.

- Competitor phrase labels (add / check / skip) come only from `supabase/functions/_shared/termActions.ts`; why: one pure, unit-tested source of truth for what the generator may treat as mandatory.
- Client archives (KB and RAG) are stored in one GitHub repository, one folder per client, via the `archive-github` function; why: centralized storage and deletion per client.
- Knowledge Base archive download is blocked by `buildKnowledgeBaseGated` blockers, and general construction reference lives only in `src/features/knowledge-base/kbReference.ts` with an explicit "не зафиксировано у компании" label; why: an unchecked or unlabeled archive must never reach a client.
- Knowledge Base fact statuses: form/price = confirmed; site facts = published only with an exact URL on the client domain, otherwise needs_confirmation; conflict blocks export, outdated is hidden; query-map github_doc always points to a FAQ anchor; why: honest provenance and FAQ as the canonical answer.
- Delivery FAQ uses deliveryTariffRows and deliveryMinRule with verified provenance; document counts derive from generated docs files; why: answers and metadata must match archive data.
