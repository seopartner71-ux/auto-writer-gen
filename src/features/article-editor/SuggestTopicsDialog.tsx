import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sparkles, Loader2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useI18n } from "@/shared/hooks/useI18n";

interface Topic {
  h1: string;
  angle: string;
  intent: string;
  reason: string;
}

interface Props {
  keyword: string | null;
  language?: string;
  geo?: string;
  onPick: (topic: Topic) => void;
  disabled?: boolean;
}

const intentColors: Record<string, string> = {
  informational: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  commercial: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  transactional: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  comparison: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  "how-to": "bg-pink-500/10 text-pink-300 border-pink-500/30",
};

export function SuggestTopicsDialog({ keyword, language, geo, onPick, disabled }: Props) {
  const { lang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [topics, setTopics] = useState<Topic[]>([]);

  const fetchTopics = async () => {
    if (!keyword) return;
    setLoading(true);
    setTopics([]);
    try {
      const { data, error } = await supabase.functions.invoke("suggest-article-topics", {
        body: { keyword, language: language || lang, geo },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setTopics(data?.topics || []);
    } catch (e: any) {
      toast.error(e?.message || t("topics.failed"));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && topics.length === 0 && !loading) {
      void fetchTopics();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !keyword}
          className="w-full h-9 gap-1.5 text-xs border-purple-500/30 hover:border-purple-500/60 hover:bg-purple-500/10 text-purple-300"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t("topics.suggestFree")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-400" />
            {t("topics.fiveAngles")}
            {keyword && (
              <span className="text-xs font-normal text-muted-foreground ml-2">
                {t("topics.forQuery")}: <span className="text-foreground">{keyword}</span>
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
            <p className="text-sm">{t("topics.analyzing")}</p>
          </div>
        )}

        {!loading && topics.length > 0 && (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {topics.map((t, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => { onPick(t); setOpen(false); }}
                className="w-full text-left p-3 rounded-lg border border-border bg-card hover:border-purple-500/60 hover:bg-purple-500/5 transition-all group"
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <h4 className="text-sm font-semibold text-foreground leading-snug">{t.h1}</h4>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-purple-400 shrink-0 mt-0.5 transition-colors" />
                </div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${intentColors[t.intent] || "bg-muted text-muted-foreground border-border"}`}>
                    {t.intent}
                  </span>
                  <span className="text-xs text-muted-foreground line-clamp-1">{t.angle}</span>
                </div>
                <p className="text-[11px] text-muted-foreground/80 leading-relaxed">{t.reason}</p>
              </button>
            ))}
            <div className="pt-2 flex justify-end">
              <Button variant="ghost" size="sm" onClick={fetchTopics} disabled={loading} className="text-xs">
                {t("topics.regenerate")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
