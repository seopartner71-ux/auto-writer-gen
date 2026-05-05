import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface FixIssueDeps {
  selectedKeywordId: string;
  selectedAuthorId: string;
  outline: string;
  lsiKeywords: string[];
  selectedKeyword: any;
  content: string;
  setContent: (c: string) => void;
  currentArticleId: string | null;
  title: string;
  lang: string;
  t: (k: string) => string;
  setIsStreaming: (v: boolean) => void;
  setStreamPhase: (p: "thinking" | "writing" | null) => void;
  setFixingIssue: (k: string | null) => void;
  abortRef: React.MutableRefObject<AbortController | null>;
  snapshotVersion: (args: { articleId: string | null; content: string; title?: string; reason: string }) => void;
}

/**
 * Step 4 refactor: extracted runFixIssue logic.
 * Streams a targeted fix from generate-article and replaces editor content.
 * Behaviour identical to the inline version in ArticlesPage.
 */
export function useFixIssue(deps: FixIssueDeps) {
  // Hold latest deps in a ref so the returned callback identity is stable
  // and matches the original useCallback semantics.
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const runFixIssue = useCallback(async (issueKey: string, instruction: string) => {
    const d = depsRef.current;
    if (!d.selectedKeywordId || !d.content.trim()) {
      toast.error("Нет контента для исправления");
      return;
    }
    d.setFixingIssue(issueKey);
    d.setIsStreaming(true);
    d.setStreamPhase("thinking");
    const prevContent = d.content;
    d.snapshotVersion({
      articleId: d.currentArticleId,
      content: prevContent,
      title: d.title || undefined,
      reason: issueKey === "humanize-all" ? "humanize" : "fix",
    });
    d.setContent("");

    const isHumanize = issueKey === "humanize-all";
    if (isHumanize) {
      toast.info(d.lang === "ru"
        ? "Анализируем структуру текста и убираем AI-паттерны..."
        : "Analyzing text structure and removing AI patterns...",
        { duration: 8000 }
      );
    }

    const controller = new AbortController();
    d.abortRef.current = controller;
    try {
      const { data: { session: freshSession }, error: refreshError } = await supabase.auth.refreshSession();
      const token = freshSession?.access_token;
      if (refreshError || !token) throw new Error("Not authenticated");

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
          optimize_instructions: `ЗАДАЧА: Исправь ТОЛЬКО указанную проблему, сохрани весь остальной текст максимально близко к оригиналу.\n\n${instruction}\n\nВАЖНО: НЕ переписывай статью целиком. Измени только те части, которые нарушают указанное правило. Сохрани структуру, заголовки и объём.`,
          existing_content: prevContent,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      if (!resp.body) throw new Error("No stream body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let ni: number;
        while ((ni = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, ni);
          buffer = buffer.slice(ni + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) { if (!fullContent) d.setStreamPhase("writing"); fullContent += delta; d.setContent(fullContent); }
          } catch { buffer = line + "\n" + buffer; break; }
        }
      }

      if (isHumanize) {
        toast.success(d.lang === "ru"
          ? "Текст успешно гуманизирован! Запах GPT устранён."
          : "Text humanized successfully! GPT smell eliminated.",
          { duration: 5000 }
        );
      } else {
        toast.success(d.lang === "ru" ? "Проблема исправлена — проверьте Human Score" : "Issue fixed — check Human Score");
      }
    } catch (e: any) {
      if (e.name === "AbortError") { toast.info(d.t("articles.genStopped")); }
      else {
        toast.error(isHumanize
          ? (d.lang === "ru" ? "Ошибка при обработке текста. Попробуйте ещё раз." : "Error processing text. Please try again.")
          : e.message
        );
        d.setContent(prevContent);
        throw e;
      }
    } finally {
      d.setIsStreaming(false);
      d.setStreamPhase(null);
      d.setFixingIssue(null);
      d.abortRef.current = null;
    }
  }, []);

  return runFixIssue;
}