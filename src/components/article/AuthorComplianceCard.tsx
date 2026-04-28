import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ShieldCheck, AlertTriangle, XCircle, Loader2, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ComplianceDeviation = {
  severity: "high" | "medium" | "low";
  category: string;
  rule: string;
  quote: string;
  suggestion: string;
};

export type ComplianceResult = {
  score: number;
  verdict: "pass" | "warning" | "fail";
  summary: string;
  deviations: ComplianceDeviation[];
  matched_rules: string[];
};

interface Props {
  content: string;
  authorProfileId: string | null;
  authorHasInstruction: boolean;
  onResult?: (r: ComplianceResult | null) => void;
}

export function AuthorComplianceCard({ content, authorProfileId, authorHasInstruction, onResult }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComplianceResult | null>(null);
  const [expanded, setExpanded] = useState(true);

  const canCheck = !!authorProfileId && authorHasInstruction && content.trim().length >= 100;

  const run = async () => {
    if (!canCheck) return;
    setLoading(true);
    setResult(null);
    onResult?.(null);
    try {
      const { data, error } = await supabase.functions.invoke("check-author-compliance", {
        body: { content, author_profile_id: authorProfileId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const r = data.result as ComplianceResult;
      setResult(r);
      onResult?.(r);
      const v = data.result.verdict;
      if (v === "pass") toast.success("Статья соответствует промту автора");
      else if (v === "warning") toast.warning("Найдены отклонения - проверьте до публикации");
      else toast.error("Статья сильно отклоняется от промта автора");
    } catch (e: any) {
      toast.error(e?.message || "Ошибка проверки");
    } finally {
      setLoading(false);
    }
  };

  const verdictColor =
    result?.verdict === "pass" ? "text-success" :
    result?.verdict === "warning" ? "text-warning" : "text-destructive";

  const VerdictIcon =
    result?.verdict === "pass" ? CheckCircle2 :
    result?.verdict === "warning" ? AlertTriangle : XCircle;

  const sevColor = (s: ComplianceDeviation["severity"]) =>
    s === "high" ? "bg-destructive/15 text-destructive border-destructive/30" :
    s === "medium" ? "bg-warning/15 text-warning border-warning/30" :
    "bg-muted text-muted-foreground border-border";

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Соответствие промту автора
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!authorProfileId && (
          <p className="text-xs text-muted-foreground">Выберите автора, чтобы запустить проверку.</p>
        )}
        {authorProfileId && !authorHasInstruction && (
          <p className="text-xs text-muted-foreground">У выбранного автора не задан системный промт - проверять не на что.</p>
        )}
        {authorProfileId && authorHasInstruction && content.trim().length < 100 && (
          <p className="text-xs text-muted-foreground">Сгенерируйте статью, чтобы проверить соответствие.</p>
        )}

        <Button
          size="sm"
          variant="outline"
          className="w-full h-8 text-xs"
          onClick={run}
          disabled={!canCheck || loading}
        >
          {loading ? (
            <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Проверка...</>
          ) : result ? (
            <>Проверить заново</>
          ) : (
            <>Проверить соответствие</>
          )}
        </Button>

        {result && (
          <>
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">Оценка соответствия</span>
                <span className={`font-mono font-semibold ${verdictColor}`}>{result.score}/100</span>
              </div>
              <Progress value={result.score} className="h-2" />
            </div>

            <div className={`flex items-start gap-2 text-xs ${verdictColor}`}>
              <VerdictIcon className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{result.summary}</span>
            </div>

            {result.deviations.length > 0 && (
              <>
                <Separator />
                <button
                  className="w-full flex items-center justify-between text-xs text-foreground hover:text-primary"
                  onClick={() => setExpanded(!expanded)}
                >
                  <span className="font-medium">Найдено отклонений: {result.deviations.length}</span>
                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>

                {expanded && (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-hide">
                    {result.deviations.map((d, i) => (
                      <div key={i} className={`rounded-md border p-2 text-[11px] space-y-1 ${sevColor(d.severity)}`}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className="text-[9px] h-4 px-1">{d.severity}</Badge>
                          <Badge variant="outline" className="text-[9px] h-4 px-1">{d.category}</Badge>
                        </div>
                        <div className="text-foreground"><span className="font-medium">Правило:</span> {d.rule}</div>
                        {d.quote && (
                          <div className="italic text-muted-foreground border-l-2 border-current/40 pl-2">
                            «{d.quote}»
                          </div>
                        )}
                        {d.suggestion && (
                          <div className="text-foreground"><span className="font-medium">Что сделать:</span> {d.suggestion}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {result.matched_rules.length > 0 && (
              <>
                <Separator />
                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-success">Соблюдено:</p>
                  <ul className="space-y-0.5">
                    {result.matched_rules.slice(0, 5).map((r, i) => (
                      <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1">
                        <CheckCircle2 className="h-3 w-3 text-success shrink-0 mt-0.5" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}