import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { BarChart3, Download, Loader2 } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";

type FactCheckRow = {
  id: string;
  article_id: string;
  status: string;
  fact_score: number | null;
  cost_usd: number | null;
  created_at: string;
  layer1_findings: any;
  critic_findings: any;
  factcheck_findings: any;
};

type PatchRow = { id: string; fact_check_id: string | null; applied: boolean | null };

type ArticleRow = { id: string; title: string | null };

const FINDING_TYPES = [
  "anon_expert",
  "outdated_fact",
  "invented_fact",
  "logic_break",
  "self_repeat",
  "seam",
  "keyword_stuffing",
  "client_slot",
] as const;

const SEVERITIES = ["critical", "major", "minor"] as const;
const VERDICTS = ["CONFIRMED", "OUTDATED", "UNVERIFIABLE", "без проверки"] as const;

const TYPE_LABELS: Record<string, string> = {
  anon_expert: "Безымянные эксперты",
  outdated_fact: "Устаревшие факты",
  invented_fact: "Выдуманные факты",
  logic_break: "Логические ошибки",
  self_repeat: "Самоповторы",
  seam: "Швы и обрывы",
  keyword_stuffing: "Переспам ключей",
  client_slot: "Нужны данные клиента",
};

const VERDICT_LABELS: Record<string, string> = {
  CONFIRMED: "Подтверждено",
  OUTDATED: "Устарело",
  UNVERIFIABLE: "Не удалось проверить",
  "без проверки": "Без онлайн-проверки",
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: "Критично",
  major: "Важно",
  minor: "Косметика",
};

function typeLabel(t: string): string {
  return TYPE_LABELS[t] ?? t;
}

const VERDICT_COLORS: Record<string, string> = {
  CONFIRMED: "hsl(142 71% 45%)",
  OUTDATED: "hsl(0 72% 51%)",
  UNVERIFIABLE: "hsl(28 90% 55%)",
  "без проверки": "hsl(220 9% 55%)",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "hsl(0 72% 51%)",
  major: "hsl(28 90% 55%)",
  minor: "hsl(220 9% 55%)",
};

const TYPE_COLORS: Record<string, string> = {
  outdated_fact: "hsl(0 72% 51%)",
  invented_fact: "hsl(0 65% 42%)",
  logic_break: "hsl(28 90% 55%)",
  seam: "hsl(28 78% 45%)",
  anon_expert: "hsl(270 60% 60%)",
  self_repeat: "hsl(270 55% 50%)",
  keyword_stuffing: "hsl(285 55% 55%)",
  client_slot: "hsl(215 85% 55%)",
};

function typeColor(t: string): string {
  return TYPE_COLORS[t] ?? "hsl(220 9% 55%)";
}

function toArr(v: any): any[] {
  return Array.isArray(v) ? v : [];
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(name: string, rows: string[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FactStatsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<FactCheckRow[]>([]);
  const [patches, setPatches] = useState<PatchRow[]>([]);
  const [articles, setArticles] = useState<Map<string, string>>(new Map());
  const [scoreMode, setScoreMode] = useState<"all" | "latest">("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setError("Не авторизован");
          setLoading(false);
          return;
        }
        const [fcRes, patchRes] = await Promise.all([
          supabase
            .from("fact_checks")
            .select("id, article_id, status, fact_score, cost_usd, created_at, layer1_findings, critic_findings, factcheck_findings")
            .eq("status", "done")
            .order("created_at", { ascending: false })
            .limit(2000),
          supabase
            .from("fact_check_patches")
            .select("id, fact_check_id, applied")
            .limit(5000),
        ]);
        if (fcRes.error) throw fcRes.error;
        if (patchRes.error) throw patchRes.error;
        const rows = (fcRes.data ?? []) as FactCheckRow[];
        setChecks(rows);
        setPatches((patchRes.data ?? []) as PatchRow[]);

        const ids = Array.from(new Set(rows.map((r) => r.article_id)));
        if (ids.length) {
          const { data: arts } = await supabase
            .from("articles")
            .select("id, title")
            .in("id", ids);
          const m = new Map<string, string>();
          (arts ?? []).forEach((a: ArticleRow) => m.set(a.id, a.title ?? ""));
          setArticles(m);
        }
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stats = useMemo(() => {
    const allFindings: any[] = [];
    for (const c of checks) {
      allFindings.push(...toArr(c.layer1_findings));
      allFindings.push(...toArr(c.critic_findings));
      allFindings.push(...toArr(c.factcheck_findings));
    }
    const totalChecks = checks.length;
    const uniqueArticles = new Set(checks.map((c) => c.article_id)).size;
    const totalFindings = allFindings.length;
    const appliedPatches = patches.filter((p) => p.applied).length;
    const totalCost = checks.reduce((s, c) => s + Number(c.cost_usd ?? 0), 0);
    const avgCost = totalChecks ? totalCost / totalChecks : 0;
    const scored = checks.filter((c) => typeof c.fact_score === "number");
    const avgScore = scored.length
      ? scored.reduce((s, c) => s + (c.fact_score as number), 0) / scored.length
      : 0;

    // Latest-only avg: pick most recent scored check per article
    const latestByArticle = new Map<string, FactCheckRow>();
    for (const c of checks) {
      if (typeof c.fact_score !== "number") continue;
      const prev = latestByArticle.get(c.article_id);
      if (!prev || new Date(c.created_at) > new Date(prev.created_at)) {
        latestByArticle.set(c.article_id, c);
      }
    }
    const latestScored = Array.from(latestByArticle.values());
    const avgScoreLatest = latestScored.length
      ? latestScored.reduce((s, c) => s + (c.fact_score as number), 0) / latestScored.length
      : 0;

    const typeCounts = new Map<string, number>();
    for (const f of allFindings) {
      const t = String(f?.type ?? "other");
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }
    const typeRows: Array<{ type: string; count: number }> = FINDING_TYPES.map((t) => ({
      type: t as string,
      count: typeCounts.get(t) ?? 0,
    }));
    // include "other" if present
    const knownSet = new Set<string>(FINDING_TYPES);
    for (const [k, v] of typeCounts) if (!knownSet.has(k)) typeRows.push({ type: k, count: v });

    const sevCounts: Record<string, number> = { critical: 0, major: 0, minor: 0 };
    for (const f of allFindings) {
      const s = String(f?.severity ?? "").toLowerCase();
      if (s in sevCounts) sevCounts[s]++;
    }

    // verdicts only among findings that had verification (factcheck_findings)
    const verdictCounts: Record<string, number> = {
      CONFIRMED: 0,
      OUTDATED: 0,
      UNVERIFIABLE: 0,
      "без проверки": 0,
    };
    let verifiedOnline = 0;
    for (const f of allFindings) {
      const v = f?.verification ? String(f.verification).toUpperCase() : null;
      if (v && v in verdictCounts) {
        verdictCounts[v]++;
        verifiedOnline++;
      } else {
        verdictCounts["без проверки"]++;
      }
    }
    const outdatedShare = verifiedOnline ? (verdictCounts.OUTDATED / verifiedOnline) * 100 : 0;

    // per-check aggregates for table + patches by fact_check_id
    const appliedByCheck = new Map<string, number>();
    const totalPatchesByCheck = new Map<string, number>();
    for (const p of patches) {
      if (!p.fact_check_id) continue;
      totalPatchesByCheck.set(p.fact_check_id, (totalPatchesByCheck.get(p.fact_check_id) ?? 0) + 1);
      if (p.applied) appliedByCheck.set(p.fact_check_id, (appliedByCheck.get(p.fact_check_id) ?? 0) + 1);
    }

    // Timeline by day
    const byDay = new Map<string, { checks: number; scoreSum: number; scoreCount: number }>();
    for (const c of checks) {
      const d = c.created_at.slice(0, 10);
      const cur = byDay.get(d) ?? { checks: 0, scoreSum: 0, scoreCount: 0 };
      cur.checks++;
      if (typeof c.fact_score === "number") {
        cur.scoreSum += c.fact_score;
        cur.scoreCount++;
      }
      byDay.set(d, cur);
    }
    const timeline = Array.from(byDay.entries())
      .map(([date, v]) => ({
        date,
        checks: v.checks,
        avgScore: v.scoreCount ? +(v.scoreSum / v.scoreCount).toFixed(1) : null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalChecks,
      uniqueArticles,
      totalFindings,
      appliedPatches,
      totalCost,
      avgCost,
      avgScore,
      avgScoreLatest,
      latestScoredCount: latestScored.length,
      scoredCount: scored.length,
      typeRows,
      sevCounts,
      verdictCounts,
      verifiedOnline,
      outdatedShare,
      appliedByCheck,
      totalPatchesByCheck,
      timeline,
    };
  }, [checks, patches]);

  const recent = checks.slice(0, 20);

  const exportCsv = () => {
    const rows: string[][] = [];
    rows.push(["=== SUMMARY ==="]);
    rows.push(["metric", "value"]);
    rows.push(["total_checks", String(stats.totalChecks)]);
    rows.push(["unique_articles", String(stats.uniqueArticles)]);
    rows.push(["total_findings", String(stats.totalFindings)]);
    rows.push(["applied_patches", String(stats.appliedPatches)]);
    rows.push(["total_cost_usd", stats.totalCost.toFixed(4)]);
    rows.push(["avg_cost_usd", stats.avgCost.toFixed(4)]);
    rows.push(["avg_fact_score", stats.avgScore.toFixed(2)]);
    rows.push(["outdated_share_pct", stats.outdatedShare.toFixed(2)]);
    rows.push([]);
    rows.push(["=== BY TYPE ==="]);
    rows.push(["type", "count"]);
    stats.typeRows.forEach((r) => rows.push([r.type, String(r.count)]));
    rows.push([]);
    rows.push(["=== BY SEVERITY ==="]);
    SEVERITIES.forEach((s) => rows.push([s, String(stats.sevCounts[s] ?? 0)]));
    rows.push([]);
    rows.push(["=== BY VERDICT ==="]);
    VERDICTS.forEach((v) => rows.push([v, String(stats.verdictCounts[v] ?? 0)]));
    rows.push([]);
    rows.push(["=== RECENT CHECKS ==="]);
    rows.push(["created_at", "article_id", "article_title", "fact_score", "findings", "applied_patches", "cost_usd"]);
    recent.forEach((c) => {
      const findings =
        toArr(c.layer1_findings).length +
        toArr(c.critic_findings).length +
        toArr(c.factcheck_findings).length;
      rows.push([
        c.created_at,
        c.article_id,
        articles.get(c.article_id) ?? "",
        c.fact_score == null ? "" : String(c.fact_score),
        String(findings),
        String(stats.appliedByCheck.get(c.id) ?? 0),
        c.cost_usd == null ? "" : String(c.cost_usd),
      ]);
    });
    downloadCsv(`fact-stats-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background p-6">
        <p className="text-destructive">Ошибка: {error}</p>
      </div>
    );
  }

  const maxTypeCount = Math.max(1, ...stats.typeRows.map((r) => r.count));
  const displayedScore = scoreMode === "latest" ? stats.avgScoreLatest : stats.avgScore;
  const displayedScoreCount = scoreMode === "latest" ? stats.latestScoredCount : stats.scoredCount;

  const verdictData = VERDICTS
    .map((v) => ({ name: v, value: stats.verdictCounts[v] ?? 0, color: VERDICT_COLORS[v] }))
    .filter((d) => d.value > 0);
  const verdictTotal = verdictData.reduce((s, d) => s + d.value, 0);

  const sevTotal = SEVERITIES.reduce((s, k) => s + (stats.sevCounts[k] ?? 0), 0);

  return (
    <div className="min-h-screen bg-background text-foreground p-6 md:p-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Статистика Глубокой проверки</h1>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-2" />
            Экспорт CSV
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Всего проверок" value={stats.totalChecks} />
          <StatCard label="Проверено статей" value={stats.uniqueArticles} />
          <StatCard label="Всего находок" value={stats.totalFindings} />
          <StatCard label="Применено правок" value={stats.appliedPatches} />
          <StatCard label="Суммарный cost, $" value={stats.totalCost.toFixed(4)} />
          <StatCard label="Средний cost, $" value={stats.avgCost.toFixed(4)} />
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">Средний Fact Score</div>
                <div className="inline-flex rounded-md border border-border overflow-hidden text-[10px]">
                  <button
                    onClick={() => setScoreMode("all")}
                    className={`px-2 py-0.5 ${scoreMode === "all" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground"}`}
                  >
                    все
                  </button>
                  <button
                    onClick={() => setScoreMode("latest")}
                    className={`px-2 py-0.5 ${scoreMode === "latest" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground"}`}
                  >
                    последний
                  </button>
                </div>
              </div>
              <div className="text-2xl font-semibold tabular-nums">
                {displayedScoreCount ? displayedScore.toFixed(1) : "-"}
              </div>
              <div className="text-xs text-muted-foreground">
                {scoreMode === "latest"
                  ? `по ${displayedScoreCount} статьям (последний прогон)`
                  : `по ${displayedScoreCount} прогонам`}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Accent hero card — Доля реальных ошибок */}
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wider text-primary">Главная метрика</div>
              <div className="text-lg font-medium">Доля реальных ошибок</div>
              <div className="text-sm text-muted-foreground max-w-md">
                Процент утверждений с вердиктом OUTDATED от всех проверенных онлайн - сколько фактов действительно устарело.
              </div>
            </div>
            <div className="text-right">
              <div className="text-5xl font-bold tabular-nums text-primary">
                {stats.verifiedOnline ? `${stats.outdatedShare.toFixed(1)}%` : "-"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {stats.verifiedOnline
                  ? `${stats.verdictCounts.OUTDATED} из ${stats.verifiedOnline} проверенных`
                  : "нет онлайн-проверок"}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Types distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Распределение по типам находок</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats.typeRows.map((r) => {
              const pct = stats.totalFindings ? (r.count / stats.totalFindings) * 100 : 0;
              const w = (r.count / maxTypeCount) * 100;
              const color = typeColor(r.type);
              return (
                <div key={r.type} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono flex items-center gap-2">
                      <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />
                      {typeLabel(r.type)}
                    </span>
                    <span className="text-muted-foreground">
                      {r.count} · {pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 rounded bg-muted overflow-hidden">
                    <div className="h-full" style={{ width: `${w}%`, background: color }} />
                  </div>
                </div>
              );
            })}
            {stats.totalFindings === 0 && (
              <p className="text-sm text-muted-foreground">Нет находок</p>
            )}
          </CardContent>
        </Card>

        {/* Severity + Verdicts */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">По severity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {sevTotal === 0 ? (
                <p className="text-sm text-muted-foreground">Нет данных</p>
              ) : (
                <>
                  <div className="flex h-6 w-full overflow-hidden rounded-md border border-border">
                    {SEVERITIES.map((s) => {
                      const c = stats.sevCounts[s] ?? 0;
                      const pct = sevTotal ? (c / sevTotal) * 100 : 0;
                      if (!pct) return null;
                      return (
                        <div
                          key={s}
                          style={{ width: `${pct}%`, background: SEVERITY_COLORS[s] }}
                          title={`${s}: ${c} (${pct.toFixed(1)}%)`}
                        />
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    {SEVERITIES.map((s) => {
                      const c = stats.sevCounts[s] ?? 0;
                      const pct = sevTotal ? (c / sevTotal) * 100 : 0;
                      return (
                        <div key={s} className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: SEVERITY_COLORS[s] }} />
                            <span className="text-muted-foreground">{SEVERITY_LABELS[s]}</span>
                          </div>
                          <div className="font-semibold tabular-nums">{c}</div>
                          <div className="text-xs text-muted-foreground">{pct.toFixed(1)}%</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">По вердиктам</CardTitle>
            </CardHeader>
            <CardContent>
              {verdictTotal === 0 ? (
                <p className="text-sm text-muted-foreground">Нет данных</p>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="relative h-[180px] w-[180px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={verdictData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={55}
                          outerRadius={80}
                          paddingAngle={2}
                          stroke="none"
                        >
                          {verdictData.map((d) => (
                            <Cell key={d.name} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: 6,
                            fontSize: 12,
                          }}
                          formatter={(v: any, n: any) => [`${v}`, n]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <div className="text-2xl font-bold tabular-nums leading-none">
                        {stats.verifiedOnline ? `${stats.outdatedShare.toFixed(0)}%` : "-"}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">реальных ошибок</div>
                    </div>
                  </div>
                  <div className="flex-1 space-y-1.5 text-sm">
                    {VERDICTS.map((v) => {
                      const c = stats.verdictCounts[v] ?? 0;
                      const pct = verdictTotal ? (c / verdictTotal) * 100 : 0;
                      return (
                        <div key={v} className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                              style={{ background: VERDICT_COLORS[v] }}
                            />
                             <span className="truncate">{VERDICT_LABELS[v] ?? v}</span>
                          </div>
                          <span className="text-muted-foreground tabular-nums">
                            {c} · {pct.toFixed(1)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Timeline combo chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Динамика</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет данных</p>
            ) : (
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={stats.timeline} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                    <YAxis yAxisId="right" orientation="right" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="left" dataKey="checks" name="Проверок" fill="hsl(var(--primary))" opacity={0.6} radius={[3, 3, 0, 0]} />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="avgScore"
                      name="Средний Fact Score"
                      stroke="hsl(142 71% 45%)"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent checks */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Последние 20 проверок</CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет данных</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Дата</th>
                      <th className="py-2 pr-3 font-medium">Статья</th>
                      <th className="py-2 pr-3 font-medium text-right">Fact Score</th>
                      <th className="py-2 pr-3 font-medium text-right">Находок</th>
                      <th className="py-2 pr-3 font-medium text-right">Применено</th>
                      <th className="py-2 pr-3 font-medium text-right">cost, $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((c) => {
                      const findings =
                        toArr(c.layer1_findings).length +
                        toArr(c.critic_findings).length +
                        toArr(c.factcheck_findings).length;
                      const applied = stats.appliedByCheck.get(c.id) ?? 0;
                      const title = articles.get(c.article_id) || c.article_id.slice(0, 8);
                      return (
                        <tr key={c.id} className="border-b border-border/50">
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {new Date(c.created_at).toLocaleString()}
                          </td>
                          <td className="py-2 pr-3 max-w-[380px] truncate" title={title}>
                            {title}
                          </td>
                          <td className="py-2 pr-3 text-right">
                            {c.fact_score == null ? "-" : (
                              <Badge variant="outline">{c.fact_score}</Badge>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right">{findings}</td>
                          <td className="py-2 pr-3 text-right">{applied}</td>
                          <td className="py-2 pr-3 text-right font-mono">
                            {c.cost_usd == null ? "-" : Number(c.cost_usd).toFixed(4)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}