import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { BarChart3, Download, Loader2 } from "lucide-react";

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

    return {
      totalChecks,
      uniqueArticles,
      totalFindings,
      appliedPatches,
      totalCost,
      avgCost,
      avgScore,
      typeRows,
      sevCounts,
      verdictCounts,
      verifiedOnline,
      outdatedShare,
      appliedByCheck,
      totalPatchesByCheck,
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

  return (
    <div className="min-h-screen bg-background text-foreground p-6 md:p-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">DEV: Fact Check Stats</h1>
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
          <StatCard label="Средний Fact Score" value={stats.avgScore.toFixed(1)} />
          <StatCard
            label="Доля реальных ошибок"
            value={stats.verifiedOnline ? `${stats.outdatedShare.toFixed(1)}%` : "-"}
            hint={stats.verifiedOnline ? `OUTDATED / проверено онлайн (${stats.verifiedOnline})` : "нет онлайн-проверок"}
          />
        </div>

        {/* Types distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Распределение по типам находок</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats.typeRows.map((r) => {
              const pct = stats.totalFindings ? (r.count / stats.totalFindings) * 100 : 0;
              const w = (r.count / maxTypeCount) * 100;
              return (
                <div key={r.type} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono">{r.type}</span>
                    <span className="text-muted-foreground">
                      {r.count} · {pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 rounded bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${w}%` }} />
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
            <CardContent className="grid grid-cols-3 gap-3">
              {SEVERITIES.map((s) => {
                const c = stats.sevCounts[s] ?? 0;
                const pct = stats.totalFindings ? (c / stats.totalFindings) * 100 : 0;
                return (
                  <MiniCard key={s} label={s} value={c} sub={`${pct.toFixed(1)}%`} />
                );
              })}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">По вердиктам</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              {VERDICTS.map((v) => {
                const c = stats.verdictCounts[v] ?? 0;
                const pct = stats.totalFindings ? (c / stats.totalFindings) * 100 : 0;
                return (
                  <MiniCard key={v} label={v} value={c} sub={`${pct.toFixed(1)}%`} />
                );
              })}
            </CardContent>
          </Card>
        </div>

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

function MiniCard({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="rounded-lg border border-border p-3 space-y-1">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}