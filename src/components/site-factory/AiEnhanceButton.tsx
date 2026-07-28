import { useEffect, useState } from "react";
import { Sparkles, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/shared/hooks/useI18n";

interface Scores {
  seo_score: number;
  geo_score: number;
  expertise_score: number;
  structure_score: number;
  ai_ready_score: number;
}

interface Enhancement {
  detected_format?: string;
  recommended_format?: string;
  entity_block?: {
    topic?: string; category?: string;
    main_entities?: string[]; related_concepts?: string[]; expert_terms?: string[];
  };
  expert_summary?: { verdict?: string; audience?: string; main_takeaway?: string };
  action_framework?: Array<{ step: number; title: string; what_to_do: string; why: string; common_mistakes: string; pro_tip: string }>;
  checklist?: { title?: string; items?: string[] };
  common_mistakes?: Array<{ mistake: string; why: string; how_to_avoid: string }>;
  faq?: Array<{ q: string; a: string }>;
  geo_optimization?: {
    has_direct_answer?: boolean; one_paragraph_answer?: string;
    definitions_present?: boolean; tables_present?: boolean; structured_lists_present?: boolean; notes?: string;
  };
  scores?: Scores;
  enhanced_at?: string;
  model?: string;
}

interface Props {
  articleId: string;
  disabled?: boolean;
}

function scoreColor(v: number): string {
  if (v >= 70) return "text-emerald-500";
  if (v >= 30) return "text-amber-500";
  return "text-destructive";
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-mono font-medium ${scoreColor(value)}`}>{value}/100</span>
      </div>
      <Progress value={value} />
    </div>
  );
}

export function AiEnhanceButton({ articleId, disabled }: Props) {
  const { lang } = useI18n();
  const { toast } = useToast();
  const ru = lang === "ru";
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [appendToContent, setAppendToContent] = useState(true);
  const [data, setData] = useState<Enhancement | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: row } = await supabase
        .from("articles")
        .select("ai_enhancement")
        .eq("id", articleId)
        .maybeSingle();
      if (cancelled) return;
      setData(((row as any)?.ai_enhancement as Enhancement) || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, articleId]);

  async function run() {
    setRunning(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("enhance-article-ai", {
        body: { article_id: articleId, append_to_content: appendToContent },
      });
      if (error) throw error;
      toast({
        title: ru ? "AI-улучшение готово" : "AI enhancement ready",
        description: ru
          ? `AI Ready Score: ${res?.scores?.ai_ready_score ?? "-"}/100`
          : `AI Ready Score: ${res?.scores?.ai_ready_score ?? "-"}/100`,
      });
      const { data: row } = await supabase
        .from("articles")
        .select("ai_enhancement")
        .eq("id", articleId)
        .maybeSingle();
      setData(((row as any)?.ai_enhancement as Enhancement) || null);
    } catch (e: any) {
      toast({
        title: ru ? "Ошибка AI-улучшения" : "AI enhancement failed",
        description: e?.message || String(e),
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  }

  const scores = data?.scores;

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={ru ? "AI-улучшение (Knowledge Asset Layer)" : "AI Enhancement (Knowledge Asset Layer)"}
      >
        <Sparkles className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {ru ? "AI Knowledge Asset Layer" : "AI Knowledge Asset Layer"}
            </DialogTitle>
            <DialogDescription>
              {ru
                ? "Дополнительный слой поверх статьи: Expert Summary, Entity Block, Action Framework, Checklist, FAQ, GEO-оптимизация. Базовый текст не переписывается."
                : "Extra layer on top of the article: Expert Summary, Entity Block, Action Framework, Checklist, FAQ, GEO optimization. The base article is not rewritten."}
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> {ru ? "Загрузка..." : "Loading..."}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="append-toggle" className="text-sm">
                    {ru ? "Дописать блоки в статью" : "Append blocks to article"}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {ru
                      ? "Блоки будут добавлены в конец статьи и попадут на сайт при следующем деплое."
                      : "Blocks will be appended to the article and shipped on the next deploy."}
                  </p>
                </div>
                <Switch id="append-toggle" checked={appendToContent} onCheckedChange={setAppendToContent} />
              </div>

              {data ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      {ru ? "Формат:" : "Format:"} {data.detected_format || "-"}
                    </Badge>
                    {data.enhanced_at && (
                      <span className="text-muted-foreground">
                        {ru ? "Обновлено:" : "Updated:"} {new Date(data.enhanced_at).toLocaleString()}
                      </span>
                    )}
                  </div>

                  {scores && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-md border p-3">
                      <ScoreRow label="SEO Score" value={scores.seo_score} />
                      <ScoreRow label="GEO Score" value={scores.geo_score} />
                      <ScoreRow label={ru ? "Экспертиза" : "Expertise"} value={scores.expertise_score} />
                      <ScoreRow label={ru ? "Структура" : "Structure"} value={scores.structure_score} />
                      <div className="sm:col-span-2">
                        <ScoreRow label="AI Ready Score" value={scores.ai_ready_score} />
                      </div>
                    </div>
                  )}

                  {data.expert_summary?.verdict && (
                    <section className="text-sm space-y-1">
                      <div className="font-medium">{ru ? "Экспертное резюме" : "Expert Summary"}</div>
                      <p className="text-muted-foreground">{data.expert_summary.verdict}</p>
                      {data.expert_summary.audience && (
                        <p className="text-xs text-muted-foreground">
                          {ru ? "Кому подходит:" : "Audience:"} {data.expert_summary.audience}
                        </p>
                      )}
                      {data.expert_summary.main_takeaway && (
                        <p className="text-xs text-muted-foreground">
                          {ru ? "Главный вывод:" : "Main takeaway:"} {data.expert_summary.main_takeaway}
                        </p>
                      )}
                    </section>
                  )}

                  {!!data.action_framework?.length && (
                    <section className="text-sm space-y-1">
                      <div className="font-medium">{ru ? "Пошаговый фреймворк" : "Action Framework"}</div>
                      <ol className="list-decimal pl-5 text-muted-foreground space-y-0.5">
                        {data.action_framework.slice(0, 6).map((s, i) => (
                          <li key={i}>{s.title || s.what_to_do}</li>
                        ))}
                      </ol>
                    </section>
                  )}

                  {!!data.checklist?.items?.length && (
                    <section className="text-sm space-y-1">
                      <div className="font-medium">{data.checklist.title || (ru ? "Чек-лист" : "Checklist")}</div>
                      <ul className="text-muted-foreground text-xs space-y-0.5">
                        {data.checklist.items.slice(0, 8).map((it, i) => (
                          <li key={i}>☐ {it}</li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {!!data.faq?.length && (
                    <section className="text-sm">
                      <div className="font-medium mb-1">FAQ ({data.faq.length})</div>
                      <ul className="text-xs text-muted-foreground space-y-0.5">
                        {data.faq.slice(0, 5).map((f, i) => (<li key={i}>• {f.q}</li>))}
                      </ul>
                    </section>
                  )}
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    {ru
                      ? "AI-улучшение для этой статьи ещё не запускалось. Нажмите кнопку ниже, чтобы построить Knowledge Asset слой."
                      : "AI enhancement has not been run yet. Click below to build the Knowledge Asset layer."}
                  </span>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {ru ? "Закрыть" : "Close"}
            </Button>
            <Button onClick={run} disabled={running}>
              {running ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {ru ? "Улучшаем..." : "Enhancing..."}</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-2" /> {data ? (ru ? "Перегенерировать" : "Re-run") : (ru ? "Запустить" : "Run")}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}