import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface Position {
  id: string;
  keyword: string;
  position: number | null;
  url: string | null;
  checked_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  articleId: string;
  defaultKeyword?: string;
  defaultUrl?: string;
  geo?: string;
  language?: string;
}

export function SerpTrackingDialog({ open, onOpenChange, articleId, defaultKeyword, defaultUrl, geo, language }: Props) {
  const [keyword, setKeyword] = useState(defaultKeyword || "");
  const [url, setUrl] = useState(defaultUrl || "");
  const [checking, setChecking] = useState(false);
  const [history, setHistory] = useState<Position[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("serp_positions")
      .select("id,keyword,position,url,checked_at")
      .eq("article_id", articleId)
      .order("checked_at", { ascending: false })
      .limit(50);
    setHistory((data as Position[]) || []);
  };

  useEffect(() => {
    if (open) {
      load();
      setKeyword(defaultKeyword || "");
      setUrl(defaultUrl || "");
    }
  }, [open, articleId, defaultKeyword, defaultUrl]);

  const check = async () => {
    if (!keyword.trim() || !url.trim()) {
      toast.error("Укажите ключ и URL статьи");
      return;
    }
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("check-serp-position", {
        body: { article_id: articleId, keyword: keyword.trim(), target_url: url.trim(), geo, language },
      });
      if (error) throw error;
      if (data?.position) {
        toast.success(`Позиция: ${data.position}`);
      } else {
        toast.message("Не в ТОП-100");
      }
      await load();
    } catch (e: any) {
      toast.error(e.message || "Ошибка проверки");
    } finally {
      setChecking(false);
    }
  };

  const trend = (current: Position, idx: number) => {
    const prev = history.slice(idx + 1).find((h) => h.keyword === current.keyword);
    if (!prev || current.position == null || prev.position == null) return <Minus className="h-3 w-3 text-muted-foreground" />;
    if (current.position < prev.position) return <TrendingUp className="h-3 w-3 text-green-500" />;
    if (current.position > prev.position) return <TrendingDown className="h-3 w-3 text-red-500" />;
    return <Minus className="h-3 w-3 text-muted-foreground" />;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>SERP-трекинг</DialogTitle>
          <DialogDescription>Проверка позиции статьи в Google по ключу.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Ключевое слово" />
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL статьи" />
          </div>
          <Button onClick={check} disabled={checking} className="w-full">
            {checking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Проверить позицию
          </Button>
          <div className="border rounded-lg max-h-72 overflow-y-auto">
            {history.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">История пуста</div>
            ) : (
              history.map((h, i) => (
                <div key={h.id} className="flex items-center justify-between px-3 py-2 border-b last:border-0 text-sm">
                  <div className="flex items-center gap-2 truncate">
                    {trend(h, i)}
                    <span className="truncate">{h.keyword}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{h.position ? `#${h.position}` : "вне ТОП-100"}</span>
                    <span>{new Date(h.checked_at).toLocaleString("ru-RU")}</span>
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