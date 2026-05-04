import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Check, Trash2, MessageSquare } from "lucide-react";

interface Comment {
  id: string;
  selected_text: string | null;
  comment: string;
  resolved: boolean;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  articleId: string;
  userId: string;
}

export function CommentsDialog({ open, onOpenChange, articleId, userId }: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState("");

  const load = async () => {
    const { data } = await supabase
      .from("article_comments")
      .select("id,selected_text,comment,resolved,created_at")
      .eq("article_id", articleId)
      .order("created_at", { ascending: false });
    setComments((data as Comment[]) || []);
  };

  useEffect(() => {
    if (open) load();
  }, [open, articleId]);

  const add = async () => {
    if (!text.trim()) return;
    const { error } = await supabase.from("article_comments").insert({
      user_id: userId,
      article_id: articleId,
      comment: text.trim(),
      selected_text: selected.trim() || null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setText("");
    setSelected("");
    load();
  };

  const toggle = async (c: Comment) => {
    await supabase.from("article_comments").update({ resolved: !c.resolved }).eq("id", c.id);
    load();
  };

  const remove = async (id: string) => {
    await supabase.from("article_comments").delete().eq("id", id);
    load();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> Комментарии
          </DialogTitle>
          <DialogDescription>Заметки и пометки для совместной работы над статьей.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2 border rounded-lg p-3">
            <Textarea
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              placeholder="Цитата из статьи (опционально)"
              rows={2}
            />
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ваш комментарий..."
              rows={3}
            />
            <Button onClick={add} disabled={!text.trim()} size="sm">Добавить</Button>
          </div>

          <div className="max-h-80 overflow-y-auto space-y-2">
            {comments.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">Комментариев нет</div>
            ) : (
              comments.map((c) => (
                <div
                  key={c.id}
                  className={`border rounded-lg p-3 text-sm ${c.resolved ? "opacity-60" : ""}`}
                >
                  {c.selected_text && (
                    <div className="text-xs italic border-l-2 border-primary pl-2 mb-2 text-muted-foreground">
                      "{c.selected_text}"
                    </div>
                  )}
                  <div className={c.resolved ? "line-through" : ""}>{c.comment}</div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleString("ru-RU")}
                    </span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => toggle(c)}>
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(c.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}