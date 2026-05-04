import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type VersionReason = "manual" | "humanize" | "optimize" | "benchmark" | "fix" | "rewrite" | "auto";

export interface ArticleVersion {
  id: string;
  article_id: string;
  user_id: string;
  title: string | null;
  content: string;
  reason: VersionReason | string;
  word_count: number | null;
  created_at: string;
}

const wc = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function useArticleVersions() {
  const snapshot = useCallback(
    async (params: { articleId: string | null; content: string; title?: string; reason: VersionReason }) => {
      const { articleId, content, title, reason } = params;
      if (!articleId || !content?.trim()) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) return;
        await supabase.from("article_versions").insert({
          article_id: articleId,
          user_id: userId,
          title: title ?? null,
          content,
          reason,
          word_count: wc(content),
        } as any);
      } catch (e) {
        console.warn("snapshot failed", e);
      }
    },
    []
  );

  const list = useCallback(async (articleId: string): Promise<ArticleVersion[]> => {
    const { data, error } = await supabase
      .from("article_versions" as any)
      .select("*")
      .eq("article_id", articleId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      toast.error("Не удалось загрузить историю");
      return [];
    }
    return (data as any) || [];
  }, []);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from("article_versions" as any).delete().eq("id", id);
    if (error) toast.error("Не удалось удалить версию");
  }, []);

  return { snapshot, list, remove };
}
