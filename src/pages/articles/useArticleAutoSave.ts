import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Options {
  articleId: string | null;
  content: string;
  title: string;
  metaDescription: string;
  isStreaming: boolean;
  isSavingExternally?: boolean;
  /** Debounce in ms (default 8000). */
  delayMs?: number;
}

/**
 * Debounced autosave for the article editor. Persists content/title/meta
 * to the `articles` row after `delayMs` of idle time. Skips while a
 * stream is in progress or another save is pending. Silent on errors -
 * the next debounce tick will retry.
 */
export function useArticleAutoSave({
  articleId,
  content,
  title,
  metaDescription,
  isStreaming,
  isSavingExternally = false,
  delayMs = 8000,
}: Options) {
  const timerRef = useRef<number | null>(null);
  const lastSavedRef = useRef<string>("");

  useEffect(() => {
    if (!articleId) return;
    if (isStreaming) return;
    if (!content || content.length < 50) return;
    if (content === lastSavedRef.current) return;
    if (isSavingExternally) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(async () => {
      try {
        const { error } = await supabase
          .from("articles")
          .update({
            content,
            title: title || null,
            meta_description: metaDescription || null,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", articleId);
        if (!error) lastSavedRef.current = content;
      } catch {
        // silent - debounce will retry on next change
      }
    }, delayMs);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [content, title, metaDescription, articleId, isStreaming, isSavingExternally, delayMs]);
}