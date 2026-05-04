import { useEffect, useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SectionedGenerator } from "@/components/article/SectionedGenerator";

interface Props {
  selectedKeyword: any;
  currentArticleId: string | null;
  authorProfiles: any[];
  selectedAuthorId: string;
  outline: { text: string; level: string }[];
  onArticleCreated: (id: string) => void;
  onComplete: (md: string, h1: string) => void;
}

export function SectionedGeneratorMount({
  selectedKeyword,
  currentArticleId,
  authorProfiles,
  selectedAuthorId,
  outline,
  onArticleCreated,
  onComplete,
}: Props) {
  const [articleId, setArticleId] = useState<string | null>(currentArticleId);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setArticleId(currentArticleId);
  }, [currentArticleId]);

  if (!selectedKeyword) {
    return <div className="text-sm text-muted-foreground">Сначала выберите ключевое слово.</div>;
  }

  if (!articleId) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">
          Будет создан черновик статьи для разбиения на разделы.
        </div>
        <Button
          disabled={creating}
          onClick={async () => {
            setCreating(true);
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) throw new Error("Not authenticated");
              const { data, error } = await supabase
                .from("articles")
                .insert({
                  user_id: user.id,
                  keyword_id: selectedKeyword.id,
                  author_profile_id:
                    selectedAuthorId && selectedAuthorId !== "none" ? selectedAuthorId : null,
                  title: selectedKeyword.seed_keyword,
                  content: "",
                  status: "generating",
                  language: selectedKeyword.language || "ru",
                })
                .select("id")
                .single();
              if (error) throw error;
              setArticleId(data.id);
              onArticleCreated(data.id);
            } catch (e: any) {
              toast.error(`Не удалось создать черновик: ${e?.message || e}`);
            } finally {
              setCreating(false);
            }
          }}
        >
          {creating ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Wand2 className="size-4 mr-1" />}
          Создать черновик и продолжить
        </Button>
      </div>
    );
  }

  const author = authorProfiles?.find((a: any) => a.id === selectedAuthorId);
  const personaPrompt =
    author?.system_prompt_override ||
    author?.system_instruction ||
    (author ? `Имя: ${author.name}. Тон: ${author.voice_tone || "-"}.` : "");

  return (
    <SectionedGenerator
      articleId={articleId}
      keyword={selectedKeyword.seed_keyword}
      language={selectedKeyword.language || "ru"}
      personaPrompt={personaPrompt}
      existingOutline={outline?.length ? outline.map(o => ({ text: o.text })) : undefined}
      onComplete={onComplete}
    />
  );
}