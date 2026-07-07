import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StageRow {
  stage: string;
  total: number;
  passes: number;
  warnings: number;
  fails: number;
  errors: number;
  avg_score: number | null;
  avg_duration_ms: number | null;
  p95_duration_ms: number | null;
  total_cost_usd: number | null;
}

const STAGE_LABELS: Record<string, string> = {
  generate: "Генерация",
  commercial_block: "Коммерческий блок",
  humanize: "Гуманизация",
  anti_turgenev: "Анти-Тургенев",
  fact_check_llm: "Fact-check (LLM)",
  fact_check_web: "Fact-check (web)",
  fact_check_regex: "Fact-check (regex)",
  sentence_structure: "Структура предложений",
  cancellary_guard: "Канцелярит",
  dangling_thought: "Висячие мысли",
  keyword_frequency: "Плотность ключей",
  compliance_check: "Проверка автора",
  improve: "Improve",
  quality_retry: "Quality Retry",
};

function rateColor(pct: number): string {
  if (pct >= 70) return "text-emerald-500";
  if (pct >= 30) return "text-amber-500";
  return "text-rose-500";
}

function dropRate(row: StageRow): number {
  const bad = row.fails + row.errors;
  return row.total > 0 ? Math.round((bad / row.total) * 100) : 0;
}

export function PipelineHealthTab() {
  const { data, isLoading, refetch, isFetching, error } = useQuery({
    queryKey: ["pipeline-health-24h"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pipeline_health_24h");
      if (error) throw error;
      return (data || []) as StageRow[];
    },
    refetchInterval: 60_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Pipeline Health (24ч)</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Drop-rate по стадиям, средний verdict, p95 латентность. Данные за последние 24 часа.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Загрузка...</div>
        ) : error ? (
          <div className="text-rose-500 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {(error as Error).message}</div>
        ) : !data || data.length === 0 ? (
          <div className="text-muted-foreground">Нет событий за последние 24 часа. Pipeline observability только что подключен - данные появятся после первых генераций.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Стадия</TableHead>
                  <TableHead className="text-right">Всего</TableHead>
                  <TableHead className="text-right">Pass</TableHead>
                  <TableHead className="text-right">Warn</TableHead>
                  <TableHead className="text-right">Fail</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="text-right">Drop %</TableHead>
                  <TableHead className="text-right">Avg score</TableHead>
                  <TableHead className="text-right">Avg ms</TableHead>
                  <TableHead className="text-right">p95 ms</TableHead>
                  <TableHead className="text-right">Cost $</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => {
                  const drop = dropRate(row);
                  return (
                    <TableRow key={row.stage}>
                      <TableCell className="font-medium">
                        {STAGE_LABELS[row.stage] || row.stage}
                        <div className="text-xs text-muted-foreground">{row.stage}</div>
                      </TableCell>
                      <TableCell className="text-right">{row.total}</TableCell>
                      <TableCell className="text-right text-emerald-500">{row.passes}</TableCell>
                      <TableCell className="text-right text-amber-500">{row.warnings}</TableCell>
                      <TableCell className="text-right text-rose-500">{row.fails}</TableCell>
                      <TableCell className="text-right text-rose-500">{row.errors}</TableCell>
                      <TableCell className={`text-right font-semibold ${rateColor(100 - drop)}`}>
                        <Badge variant="outline" className={rateColor(100 - drop)}>{drop}%</Badge>
                      </TableCell>
                      <TableCell className="text-right">{row.avg_score ?? "-"}</TableCell>
                      <TableCell className="text-right">{row.avg_duration_ms ?? "-"}</TableCell>
                      <TableCell className="text-right">{row.p95_duration_ms ?? "-"}</TableCell>
                      <TableCell className="text-right">{row.total_cost_usd ? Number(row.total_cost_usd).toFixed(4) : "-"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}