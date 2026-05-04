import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Variant { angle: string; title: string; meta: string; }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  keyword: string;
  content: string;
  language?: "ru" | "en";
  currentTitle: string;
  currentMeta: string;
  onApply: (v: Variant) => void;
}

const ANGLE_LABEL: Record<string, string> = {
  informational: "Экспертный",
  benefit: "Решение проблемы",
  curiosity: "Любопытство",
  variant: "Вариант",
};

const ANGLE_COLOR: Record<string, string> = {
  informational: "bg-blue-500/15 text-blue-300",
  benefit: "bg-emerald-500/15 text-emerald-300",
  curiosity: "bg-amber-500/15 text-amber-300",
  variant: "bg-muted text-muted-foreground",
};

export function TitleVariantsDialog({ open, onOpenChange, keyword, content, language, currentTitle, currentMeta, onApply }: Props) {
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [picked, setPicked] = useState<number | null>(null);

  async function generate() {
    setLoading(true); setPicked(null); setVariants([]);
    try {
      const { data, error } = await supabase.functions.invoke("generate-title-variants", {
        body: { keyword, content, language, current_title: currentTitle, current_meta: currentMeta },
      });
      if (error) throw error;
      if (!data?.variants?.length) throw new Error("Нет вариантов");
      setVariants(data.variants);
    } catch (e: any) {
      toast.error(e?.message || "Не удалось сгенерировать варианты");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (v && variants.length === 0 && !loading) generate(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" /> A/B варианты заголовка и meta
          </DialogTitle>
          <DialogDescription>
            Три разных угла подачи. Выберите тот, что лучше попадает в интент. Можно регенерировать.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-12 grid place-items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Генерируем 3 варианта...</p>
          </div>
        ) : (
          <div className="space-y-2">
            {variants.map((v, i) => {
              const angleKey = (v.angle in ANGLE_LABEL ? v.angle : "variant");
              const isPicked = picked === i;
              return (
                <button
                  key={i}
                  onClick={() => setPicked(i)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    isPicked ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30" : "border-border/50 hover:border-border bg-muted/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <Badge className={`${ANGLE_COLOR[angleKey]} text-[10px]`}>{ANGLE_LABEL[angleKey] || v.angle}</Badge>
                    {isPicked && <Check className="w-4 h-4 text-primary" />}
                  </div>
                  <div className="font-medium text-sm text-foreground mb-1 leading-snug">{v.title}</div>
                  <div className="text-xs text-muted-foreground leading-relaxed">{v.meta}</div>
                  <div className="mt-1.5 flex gap-3 text-[10px] text-muted-foreground/70">
                    <span>title: {v.title.length}</span>
                    <span>meta: {v.meta.length}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={generate} disabled={loading}>
            <Sparkles className="w-3 h-3 mr-1" /> Регенерировать
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button
              size="sm"
              disabled={picked === null || loading}
              onClick={() => {
                if (picked === null) return;
                onApply(variants[picked]);
                onOpenChange(false);
                toast.success("Заголовок и meta применены");
              }}
            >
              Применить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
