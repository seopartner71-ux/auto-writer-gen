import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Link2, ExternalLink, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Suggestion { anchor: string; url: string; target_title: string; match_count: number; }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId?: string | null;
  currentArticleId: string | null;
  content: string;
  onInsert: (anchor: string, url: string) => void;
}

export function InternalLinksDialog({ open, onOpenChange, projectId, currentArticleId, content, onInsert }: Props) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [candCount, setCandCount] = useState<number>(0);
  const [inserted, setInserted] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true); setItems([]); setInserted(new Set());
    try {
      const { data, error } = await supabase.functions.invoke("suggest-internal-links", {
        body: { project_id: projectId || null, current_article_id: currentArticleId, content },
      });
      if (error) throw error;
      setItems(data?.suggestions || []);
      setCandCount(data?.candidate_count || 0);
    } catch (e: any) {
      toast.error(e?.message || "Не удалось получить предложения");
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (v) load(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-primary" /> Внутренние ссылки
          </DialogTitle>
          <DialogDescription>
            Подбираем перелинковку из ваших опубликованных статей. Жмите "Вставить" - и анкор станет markdown-ссылкой в начале первого вхождения.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-12 grid place-items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Сканируем статьи проекта...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {candCount === 0
              ? "В проекте нет опубликованных статей с заполненным URL. Заполните 'URL статьи на сайте' в опубликованных материалах."
              : "Не нашли подходящих анкоров в текущем тексте."}
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2 pr-2">
              {items.map((s, i) => {
                const key = `${s.url}::${s.anchor}`;
                const done = inserted.has(key);
                return (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-muted/20">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="text-[10px]">{s.match_count}x</Badge>
                        <span className="font-medium text-sm truncate">{s.anchor}</span>
                      </div>
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                        {s.target_title} <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <Button
                      size="sm"
                      variant={done ? "secondary" : "default"}
                      disabled={done}
                      onClick={() => {
                        onInsert(s.anchor, s.url);
                        setInserted((prev) => new Set(prev).add(key));
                      }}
                    >
                      <Plus className="w-3 h-3 mr-1" /> {done ? "Вставлено" : "Вставить"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
