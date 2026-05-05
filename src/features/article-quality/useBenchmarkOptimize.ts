import { useCallback, useRef, type MutableRefObject } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAndAnalyze, buildAnalysisContext, type DeepParseResult } from "@/entities/competitor/analysisService";
import { parseSseStream } from "@/features/article-editor/parseSseStream";
import type { KeywordRef } from "@/features/article-editor/types";

export interface BenchmarkCacheEntry {
  data: DeepParseResult;
  context: string;
  instructions: string;
}

export interface BenchmarkOptimizeDeps {
  selectedKeywordId: string;
  selectedAuthorId: string;
  outline: unknown;
  lsiKeywords: string[];
  selectedKeyword: KeywordRef | null;
  content: string;
  setContent: (c: string) => void;
  title: string;
  setStreamPhase: (p: "thinking" | "writing" | null) => void;
  abortRef: React.MutableRefObject<AbortController | null>;
  snapshotVersion: (a: { articleId: string | null; content: string; title?: string; reason: string }) => void;
  currentArticleId: string | null;
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;
  benchmarkCacheRef: MutableRefObject<Map<string, BenchmarkCacheEntry>>;
}

/**
 * Step 5 refactor: extracted onBenchmarkOptimize handler.
 * Streams a TOP-10-aware rewrite of the current article using cached or
 * freshly fetched competitor analysis. Identical behaviour to the inline
 * version that lived inside QualityCheckPanel callback in ArticlesPage.
 */
export function useBenchmarkOptimize(deps: BenchmarkOptimizeDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  return useCallback(async () => {
    const d = depsRef.current;
    if (!d.selectedKeywordId) return;
    if (d.isStreaming) return;
    const { data: { session: freshSession } } = await supabase.auth.refreshSession();
    const token = freshSession?.access_token;
    if (!token) throw new Error("Not authenticated");
    const cached = d.benchmarkCacheRef.current.get(d.selectedKeywordId);
    let data: DeepParseResult, benchmarkContext: string, instructions: string;
    if (cached) {
      toast.info("Используем кэш ТОП-10...", { duration: 3000 });
      data = cached.data; benchmarkContext = cached.context; instructions = cached.instructions;
    } else {
      const userId = freshSession?.user?.id;
      let dbHit: any = null;
      if (userId) {
        const { data: row } = await supabase
          .from("benchmark_cache" as any)
          .select("data, context, instructions, expires_at")
          .eq("user_id", userId)
          .eq("keyword_id", d.selectedKeywordId)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();
        dbHit = row;
      }
      if (dbHit) {
        toast.info("Используем сохранённый анализ ТОП-10...", { duration: 3000 });
        data = (dbHit as any).data;
        benchmarkContext = (dbHit as any).context;
        instructions = (dbHit as any).instructions;
        d.benchmarkCacheRef.current.set(d.selectedKeywordId, { data, context: benchmarkContext, instructions });
      } else {
        toast.info("Анализ ТОП-10 и сущностей...", { duration: 8000 });
        data = await fetchAndAnalyze(d.selectedKeywordId, token, false);
        benchmarkContext = buildAnalysisContext(data);
        instructions = `Перепиши статью с учетом ТОП-10:
- Целевой объем: ${data.benchmark.target_word_count} слов (медиана: ${data.benchmark.median_word_count})
- H2: ${data.benchmark.target_h2_count}, H3 медиана: ${data.benchmark.median_h3_count}
- Изображений: ${data.benchmark.target_img_count}
- Плотность ключа: около ${data.benchmark.median_keyword_density}%
${data.must_use_phrases.length > 0 ? `\nОбязательные фразы из ТОП-10:\n${data.must_use_phrases.slice(0,12).map((p:any)=>`- ${p.phrase}`).join('\n')}` : ''}
${data.entities.filter((e:any)=>e.importance>=5).length > 0 ? `\nКлючевые сущности:\n${data.entities.filter((e:any)=>e.importance>=5).slice(0,15).map((e:any)=>`- ${e.name}`).join('\n')}` : ''}

Сохрани стиль и тональность. Не добавляй вымышленных фактов.`;
        d.benchmarkCacheRef.current.set(d.selectedKeywordId, { data, context: benchmarkContext, instructions });
        if (userId) {
          try {
            await supabase.from("benchmark_cache" as any).upsert({
              user_id: userId,
              keyword_id: d.selectedKeywordId,
              data,
              context: benchmarkContext,
              instructions,
              expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            } as any, { onConflict: "user_id,keyword_id" });
          } catch (e) { console.warn("benchmark cache upsert failed", e); }
        }
      }
    }

    d.setIsStreaming(true);
    d.setStreamPhase("thinking");
    const prevContent = d.content;
    d.snapshotVersion({
      articleId: d.currentArticleId,
      content: prevContent,
      title: d.title || undefined,
      reason: "benchmark",
    });
    d.setContent("");
    const controller = new AbortController();
    d.abortRef.current = controller;
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-article`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          keyword_id: d.selectedKeywordId,
          author_profile_id: (d.selectedAuthorId && d.selectedAuthorId !== "none") ? d.selectedAuthorId : null,
          outline: d.outline,
          lsi_keywords: d.lsiKeywords,
          language: (d.selectedKeyword as any)?.language || null,
          optimize_instructions: instructions,
          deep_analysis_context: benchmarkContext,
          existing_content: prevContent,
        }),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
      let fullContent = "";
      await parseSseStream(resp.body, (delta) => {
        if (!fullContent) d.setStreamPhase("writing");
        fullContent += delta;
        d.setContent(fullContent);
      });
      toast.success("Оптимизировано под ТОП-10");
    } catch (e: any) {
      throw e;
    } finally {
      d.setIsStreaming(false);
      d.setStreamPhase(null);
      d.abortRef.current = null;
    }
  }, []);
}