import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, DollarSign, RefreshCw } from "lucide-react";

// Цены OpenRouter (USD за 1M токенов). Актуальность: 2026-07
// Обновлять вручную при изменениях у провайдера. Синхронизировано с
// supabase/functions/_shared/costLogger.ts → PRICE_TABLE.
const PRICES_UPDATED = "2026-07";
const PRICES: Record<string, { in: number; out: number }> = {
  "anthropic/claude-opus-4":         { in: 15,   out: 75 },
  "anthropic/claude-sonnet-4":       { in: 3,    out: 15 },
  "anthropic/claude-3.5-haiku":      { in: 0.80, out: 4 },
  "openai/gpt-5":                    { in: 1.25, out: 10 },
  "openai/gpt-5-mini":               { in: 0.25, out: 2 },
  "google/gemini-2.5-pro":           { in: 1.25, out: 10 },
  "google/gemini-2.5-flash":         { in: 0.30, out: 2.50 },
  "google/gemini-2.5-flash-lite":    { in: 0.10, out: 0.40 },
  "mistralai/mistral-large-2411":    { in: 2,    out: 6 },
  "mistralai/mistral-large-2512":    { in: 2,    out: 6 },
  "mistralai/mistral-large-latest":  { in: 2,    out: 6 },
  "perplexity/sonar":                { in: 1,    out: 1 },
  "perplexity/sonar-pro":            { in: 3,    out: 15 },
  "deepseek/deepseek-chat-v3":       { in: 0.27, out: 1.10 },
  "meta-llama/llama-3.3-70b-instruct": { in: 0.13, out: 0.40 },
};

function priceFor(model: string | null | undefined) {
  if (!model) return null;
  const key = String(model).toLowerCase().split(",")[0].trim();
  return PRICES[key] || PRICES[key.replace(/^.*\//, "")] || null;
}

function tokensCost(model: string | null | undefined, ti: number, to: number): number {
  const p = priceFor(model);
  if (!p) return 0;
  return (ti * p.in + to * p.out) / 1_000_000;
}

// Группировка stage/functionName → функциональная категория
const STAGE_GROUP: Record<string, string> = {
  generate: "Генерация",
  commercial_block: "Генерация",
  deep_parse: "Генерация",
  humanize: "Humanize",
  polish: "Humanize",
  improve: "Humanize",
  quality_check: "Судьи",
  "quality-check": "Судьи",
  ai_detect: "Судьи",
  fact_check_llm: "Судьи",
  fact_check_web: "Судьи",
  anti_turgenev: "Тургенев",
};
function groupOf(stage: string) {
  return STAGE_GROUP[stage] || "Прочее";
}
// Маппинг имени функции (metadata.kind в cost_log) → категория.
function groupOfFunction(fn: string): string {
  const f = fn.toLowerCase();
  if (/humaniz|polish|improve/.test(f)) return "Humanize";
  if (/quality|detect-ai|fact.?check|judge|ai_detect|uniqueness|audit/.test(f)) return "Судьи";
  if (/turgenev/.test(f)) return "Тургенев";
  if (/generat|commercial|section|outline|research|deep|radar|geo|schema|title|topical|interlink|persona|nugget|content-plan|bulk|seed|site-config|site-content/.test(f)) return "Генерация";
  return "Прочее";
}

function fmtUsd(n: number) {
  if (!Number.isFinite(n) || n === 0) return "$0.00";
  return `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
}
function fmtNum(n: number) {
  return (n || 0).toLocaleString("ru-RU");
}

function toIso(d: Date) {
  return d.toISOString();
}
function localDate(daysAgo: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}
function dateInputVal(d: Date) {
  return d.toISOString().slice(0, 10);
}

type PipelineRow = { user_id: string | null; stage: string; model: string | null; tokens_in: number | null; tokens_out: number | null; cost_usd: number | null };
type CostRow = { user_id: string | null; operation_type: string; model: string | null; tokens_input: number; tokens_output: number; cost_usd: number; metadata: any };
type ProfileRow = { id: string; email: string | null; plan: string | null };

export function PeriodEconomicsTab() {
  const [from, setFrom] = useState<string>(dateInputVal(localDate(30)));
  const [to, setTo] = useState<string>(dateInputVal(localDate(-1))); // включая сегодня
  const [loading, setLoading] = useState(false);
  const [pipeline, setPipeline] = useState<PipelineRow[]>([]);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const fromIso = toIso(new Date(from + "T00:00:00"));
      const toIsoStr = toIso(new Date(to + "T23:59:59"));

      const [{ data: pe }, { data: cl }] = await Promise.all([
        supabase
          .from("pipeline_events")
          .select("user_id,stage,model,tokens_in,tokens_out,cost_usd")
          .gte("created_at", fromIso)
          .lte("created_at", toIsoStr)
          .limit(50000),
        supabase
          .from("cost_log")
          .select("user_id,operation_type,model,tokens_input,tokens_output,cost_usd,metadata")
          .gte("created_at", fromIso)
          .lte("created_at", toIsoStr)
          .limit(50000),
      ]);
      if (cancelled) return;
      const peRows = (pe || []) as PipelineRow[];
      const clRows = (cl || []) as CostRow[];
      setPipeline(peRows);
      setCosts(clRows);

      const ids = Array.from(new Set([
        ...peRows.map((r) => r.user_id).filter(Boolean),
        ...clRows.map((r) => r.user_id).filter(Boolean),
      ])) as string[];

      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id,email,plan")
          .in("id", ids);
        if (!cancelled) {
          const map: Record<string, ProfileRow> = {};
          (profs || []).forEach((p: any) => { map[p.id] = p; });
          setProfiles(map);
        }
      } else {
        setProfiles({});
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [from, to, tick]);

  // Стоимость события: если pipeline_events сам записал cost_usd — используем его,
  // иначе считаем из tokens_in/out по прайсу.
  const peWithCost = useMemo(() => pipeline.map((r) => {
    const stored = Number(r.cost_usd || 0);
    const computed = tokensCost(r.model, Number(r.tokens_in || 0), Number(r.tokens_out || 0));
    return { ...r, _cost: stored > 0 ? stored : computed };
  }), [pipeline]);

  // (1) По функциям
  // Основной источник — cost_log (реальные деньги). pipeline_events используем
  // только как дополнение для стадий, которые не пишут в cost_log (сейчас — почти
  // ничего, после фикса всё пишется). Для строк cost_log функция определяется
  // по metadata.kind (у новых llm_call) или по operation_type.
  const byGroup = useMemo(() => {
    const m = new Map<string, { calls: number; ti: number; to: number; cost: number }>();
    for (const r of costs) {
      const kind = String(r.metadata?.kind || "").trim();
      const g = kind ? groupOfFunction(kind) : (r.operation_type === "article_generation" ? "Генерация" : "Прочее");
      const cur = m.get(g) || { calls: 0, ti: 0, to: 0, cost: 0 };
      cur.calls += 1;
      cur.ti += r.tokens_input;
      cur.to += r.tokens_output;
      cur.cost += Number(r.cost_usd || 0);
      m.set(g, cur);
    }
    return Array.from(m.entries())
      .map(([group, v]) => ({ group, ...v }))
      .sort((a, b) => b.cost - a.cost || b.calls - a.calls);
  }, [costs]);

  // (3) По моделям — берём cost_log (реальные токены) + добавляем pipeline_events cost для стадий
  const byModel = useMemo(() => {
    const m = new Map<string, { calls: number; ti: number; to: number; cost: number }>();
    for (const r of costs) {
      const key = r.model || "(unknown)";
      const cur = m.get(key) || { calls: 0, ti: 0, to: 0, cost: 0 };
      cur.calls += 1;
      cur.ti += r.tokens_input;
      cur.to += r.tokens_output;
      cur.cost += Number(r.cost_usd || 0);
      m.set(key, cur);
    }
    for (const r of peWithCost) {
      if (!r.model) continue;
      const key = r.model;
      const cur = m.get(key) || { calls: 0, ti: 0, to: 0, cost: 0 };
      cur.calls += 1;
      cur.ti += Number(r.tokens_in || 0);
      cur.to += Number(r.tokens_out || 0);
      // Избегаем двойного учёта: pipeline cost добавляем ТОЛЬКО если стадия не совпадает
      // с логированной операцией (для стадий, где cost_log не пишется). Простое правило:
      // добавляем pipeline cost для стадий-судей/фактчека, где нет отдельного cost_log.
      if (["fact_check_llm","fact_check_web","commercial_block","quality_check","ai_detect"].includes(r.stage)) {
        cur.cost += r._cost;
      }
      m.set(key, cur);
    }
    return Array.from(m.entries())
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.cost - a.cost);
  }, [costs, peWithCost]);

  // (2) По пользователям
  const byUser = useMemo(() => {
    const m = new Map<string, { calls: number; ti: number; to: number; cost: number }>();
    for (const r of costs) {
      const uid = r.user_id || "(system)";
      const cur = m.get(uid) || { calls: 0, ti: 0, to: 0, cost: 0 };
      cur.calls += 1;
      cur.ti += r.tokens_input;
      cur.to += r.tokens_output;
      cur.cost += Number(r.cost_usd || 0);
      m.set(uid, cur);
    }
    for (const r of peWithCost) {
      const uid = r.user_id || "(system)";
      const cur = m.get(uid) || { calls: 0, ti: 0, to: 0, cost: 0 };
      cur.calls += 1;
      cur.ti += Number(r.tokens_in || 0);
      cur.to += Number(r.tokens_out || 0);
      if (["fact_check_llm","fact_check_web","commercial_block","quality_check","ai_detect"].includes(r.stage)) {
        cur.cost += r._cost;
      }
      m.set(uid, cur);
    }
    return Array.from(m.entries())
      .map(([uid, v]) => {
        const p = profiles[uid];
        return {
          uid,
          email: p?.email || (uid === "(system)" ? "(system)" : uid.slice(0, 8)),
          plan: p?.plan || "basic",
          ...v,
        };
      })
      .sort((a, b) => b.cost - a.cost);
  }, [costs, peWithCost, profiles]);

  const totals = useMemo(() => {
    const totalCalls = costs.length + peWithCost.length;
    const totalCost = byUser.reduce((s, u) => s + u.cost, 0);
    const payingCost = byUser
      .filter((u) => u.plan && u.plan !== "basic")
      .reduce((s, u) => s + u.cost, 0);
    const payingUsers = byUser.filter((u) => u.plan && u.plan !== "basic").length;
    const totalTokensIn = byUser.reduce((s, u) => s + u.ti, 0);
    const totalTokensOut = byUser.reduce((s, u) => s + u.to, 0);
    return { totalCalls, totalCost, payingCost, payingUsers, totalTokensIn, totalTokensOut };
  }, [byUser, costs.length, peWithCost.length]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4" /> Экономика за период
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">С</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[160px]" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">По</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[160px]" />
            </div>
            <Button variant="outline" size="sm" onClick={() => setTick((t) => t + 1)} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Обновить</span>
            </Button>
            <div className="ml-auto text-xs text-muted-foreground">
              Прайс OpenRouter актуален на {PRICES_UPDATED}
            </div>
          </div>

          {/* Итоги */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryTile label="Всего LLM-вызовов" value={fmtNum(totals.totalCalls)} />
            <SummaryTile label="Токенов in / out" value={`${fmtNum(totals.totalTokensIn)} / ${fmtNum(totals.totalTokensOut)}`} />
            <SummaryTile label="Расход всего" value={fmtUsd(totals.totalCost)} accent />
            <SummaryTile label={`Платящих (${totals.payingUsers})`} value={fmtUsd(totals.payingCost)} accent />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">По функциям</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Функция</TableHead>
                  <TableHead className="text-right">Вызовы</TableHead>
                  <TableHead className="text-right">Токенов</TableHead>
                  <TableHead className="text-right">Расход</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byGroup.map((g) => (
                  <TableRow key={g.group}>
                    <TableCell>{g.group}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(g.calls)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{fmtNum(g.ti + g.to)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtUsd(g.cost)}</TableCell>
                  </TableRow>
                ))}
                {byGroup.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6 text-sm">Нет данных</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">По моделям</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Модель</TableHead>
                  <TableHead className="text-right">Вызовы</TableHead>
                  <TableHead className="text-right">Токенов</TableHead>
                  <TableHead className="text-right">Расход</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byModel.map((m) => (
                  <TableRow key={m.model}>
                    <TableCell className="font-mono text-xs">{m.model}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(m.calls)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{fmtNum(m.ti + m.to)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtUsd(m.cost)}</TableCell>
                  </TableRow>
                ))}
                {byModel.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6 text-sm">Нет данных</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">По пользователям (top-30)</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Пользователь</TableHead>
                <TableHead>План</TableHead>
                <TableHead className="text-right">Вызовы</TableHead>
                <TableHead className="text-right">Токенов</TableHead>
                <TableHead className="text-right">Расход</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byUser.slice(0, 30).map((u) => (
                <TableRow key={u.uid}>
                  <TableCell className="truncate max-w-[280px]">{u.email}</TableCell>
                  <TableCell>
                    <span className={`uppercase text-[10px] px-1.5 py-0.5 rounded ${u.plan !== "basic" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {u.plan}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(u.calls)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{fmtNum(u.ti + u.to)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtUsd(u.cost)}</TableCell>
                </TableRow>
              ))}
              {byUser.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6 text-sm">Нет данных</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border border-border p-3 ${accent ? "bg-primary/5" : "bg-muted/30"}`}>
      <div className="text-[11px] uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${accent ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}