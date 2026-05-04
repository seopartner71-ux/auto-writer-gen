import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { History, RotateCcw, Trash2, Eye } from "lucide-react";
import { diffWords } from "diff";
import { toast } from "sonner";
import { useArticleVersions, type ArticleVersion, type VersionReason } from "./useArticleVersions";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

const REASON_LABEL: Record<string, { label: string; color: string }> = {
  manual: { label: "Ручное сохранение", color: "bg-muted text-muted-foreground" },
  humanize: { label: "Humanize Fix", color: "bg-emerald-500/15 text-emerald-300" },
  optimize: { label: "Оптимизация", color: "bg-blue-500/15 text-blue-300" },
  benchmark: { label: "ТОП-10", color: "bg-violet-500/15 text-violet-300" },
  fix: { label: "Исправление", color: "bg-amber-500/15 text-amber-300" },
  rewrite: { label: "Переписано", color: "bg-pink-500/15 text-pink-300" },
  auto: { label: "Авто", color: "bg-slate-500/15 text-slate-300" },
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  articleId: string | null;
  currentContent: string;
  onRestore: (content: string) => void;
}

export function VersionHistoryDialog({ open, onOpenChange, articleId, currentContent, onRestore }: Props) {
  const { list, remove } = useArticleVersions();
  const [versions, setVersions] = useState<ArticleVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ArticleVersion | null>(null);
  const [mode, setMode] = useState<"diff" | "preview">("diff");

  useEffect(() => {
    if (!open || !articleId) return;
    setLoading(true);
    list(articleId).then((v) => {
      setVersions(v);
      setSelected(v[0] || null);
      setLoading(false);
    });
  }, [open, articleId, list]);

  const diff = useMemo(() => {
    if (!selected) return [];
    return diffWords(selected.content, currentContent);
  }, [selected, currentContent]);

  const handleRestore = (v: ArticleVersion) => {
    onRestore(v.content);
    toast.success("Версия восстановлена");
    onOpenChange(false);
  };

  const handleDelete = async (id: string) => {
    await remove(id);
    setVersions((prev) => prev.filter((v) => v.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5" /> История версий
          </DialogTitle>
          <DialogDescription>
            Снапшоты создаются автоматически перед Humanize, Оптимизацией и переписыванием. Любую версию можно восстановить.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-[280px_1fr] gap-4 min-h-0">
          <ScrollArea className="border rounded-lg">
            <div className="p-2 space-y-1">
              {loading && <div className="p-4 text-sm text-muted-foreground">Загрузка...</div>}
              {!loading && versions.length === 0 && (
                <div className="p-4 text-sm text-muted-foreground">
                  Версий пока нет. Они появятся после первого Humanize или Оптимизации.
                </div>
              )}
              {versions.map((v) => {
                const meta = REASON_LABEL[v.reason] || REASON_LABEL.manual;
                const active = selected?.id === v.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => setSelected(v)}
                    className={`w-full text-left p-2 rounded-md transition-colors ${
                      active ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/50 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <Badge className={`${meta.color} text-[10px] px-1.5 py-0`}>{meta.label}</Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {v.word_count ?? 0} сл.
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(v.created_at), { addSuffix: true, locale: ru })}
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>

          <div className="border rounded-lg flex flex-col min-h-0">
            {selected ? (
              <>
                <div className="flex items-center justify-between gap-2 p-2 border-b">
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant={mode === "diff" ? "default" : "ghost"}
                      onClick={() => setMode("diff")}
                    >
                      Сравнить с текущей
                    </Button>
                    <Button
                      size="sm"
                      variant={mode === "preview" ? "default" : "ghost"}
                      onClick={() => setMode("preview")}
                    >
                      <Eye className="w-3 h-3 mr-1" /> Превью
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => handleRestore(selected)}>
                      <RotateCcw className="w-3 h-3 mr-1" /> Восстановить
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(selected.id)}>
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </div>
                </div>
                <ScrollArea className="flex-1 p-3">
                  {mode === "diff" ? (
                    <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed">
                      {diff.map((part, i) => (
                        <span
                          key={i}
                          className={
                            part.added
                              ? "bg-emerald-500/20 text-emerald-200"
                              : part.removed
                              ? "bg-red-500/20 text-red-200 line-through"
                              : "text-muted-foreground"
                          }
                        >
                          {part.value}
                        </span>
                      ))}
                    </pre>
                  ) : (
                    <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed">{selected.content}</pre>
                  )}
                </ScrollArea>
              </>
            ) : (
              <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
                Выберите версию слева
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
