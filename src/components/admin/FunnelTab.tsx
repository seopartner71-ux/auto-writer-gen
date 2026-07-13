import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, Filter, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/shared/hooks/useI18n";
import { Download } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  LabelList,
} from "recharts";

const CANONICAL_EVENTS = [
  "registration_completed",
  "first_session_start",
  "onboarding_modal_shown",
  "onboarding_quick_path_clicked",
  "onboarding_manual_path_clicked",
  "onboarding_skipped",
  "keyword_entered",
  "generation_started",
  "generation_stage_completed",
  "generation_failed",
  "generation_completed",
  "article_editor_opened",
  "article_copied",
  "article_downloaded",
  "stealth_pass_clicked",
  "tab_closed_during_generation",
  "session_ended",
] as const;

type Period = "24h" | "7d" | "30d" | "90d" | "all";

function sinceFor(period: Period): string | null {
  if (period === "all") return null;
  const ms = {
    "24h": 24 * 3600 * 1000,
    "7d": 7 * 24 * 3600 * 1000,
    "30d": 30 * 24 * 3600 * 1000,
    "90d": 90 * 24 * 3600 * 1000,
  }[period];
  return new Date(Date.now() - ms).toISOString();
}

type RowData = {
  event: string;
  total: number;
  unique: number;
};

export function FunnelTab() {
  const { t } = useI18n();
  const [period, setPeriod] = useState<Period>("7d");
  const [rows, setRows] = useState<RowData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orphans, setOrphans] = useState<{ orphan_users: number; real_registrations: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const since = sinceFor(period);
      const [statsRes, orphanRes] = await Promise.all([
        supabase.rpc("get_funnel_stats", { _since: since }),
        supabase.rpc("get_funnel_orphans", { _since: since }),
      ]);
      if (statsRes.error) throw statsRes.error;
      if (orphanRes.error) throw orphanRes.error;

      const byName = new Map<string, { total: number; unique: number }>();
      for (const r of (statsRes.data ?? []) as Array<{ event_name: string; total: number; unique_users: number }>) {
        byName.set(r.event_name, { total: Number(r.total), unique: Number(r.unique_users) });
      }
      setRows(
        CANONICAL_EVENTS.map((ev) => ({
          event: ev,
          total: byName.get(ev)?.total ?? 0,
          unique: byName.get(ev)?.unique ?? 0,
        })),
      );

      const o = (orphanRes.data ?? [])[0] as
        | { orphan_users: number; real_registrations: number }
        | undefined;
      setOrphans(
        o
          ? {
              orphan_users: Number(o.orphan_users),
              real_registrations: Number(o.real_registrations),
            }
          : null,
      );
    } catch (e: any) {
      setError(e?.message ?? t("common.loading"));
    } finally {
      setLoading(false);
    }
  }, [period, t]);

  useEffect(() => {
    load();
  }, [load]);

  const base = rows[0]?.unique ?? 0;
  const hasData = rows.some((r) => r.total > 0);

  const completedUnique = useMemo(
    () => rows.find((r) => r.event === "generation_completed")?.unique ?? 0,
    [rows],
  );
  const editorUnique = useMemo(
    () => rows.find((r) => r.event === "article_editor_opened")?.unique ?? 0,
    [rows],
  );

  const chartData = useMemo(
    () =>
      rows.map((r, i) => {
        const prevUnique = i > 0 ? rows[i - 1].unique : r.unique;
        const fromReg = base ? Math.round((r.unique / base) * 100) : 0;
        const fromPrev = i === 0 ? 100 : prevUnique ? Math.round((r.unique / prevUnique) * 100) : 0;
        return {
          idx: i + 1,
          key: r.event,
          label: t(`funnel.event.${r.event}` as string),
          shortLabel: `${i + 1}. ${t(`funnel.event.${r.event}` as string)}`,
          total: r.total,
          unique: r.unique,
          fromReg,
          fromPrev,
        };
      }),
    [rows, base, t],
  );

  const exportCsv = useCallback(() => {
    const header = ["#", "event_key", "event_label", "total", "unique", "conv_from_reg_%", "conv_from_prev_%"];
    const lines = [header.join(",")];
    chartData.forEach((r) => {
      lines.push(
        [
          r.idx,
          r.key,
          `"${r.label.replace(/"/g, '""')}"`,
          r.total,
          r.unique,
          r.fromReg,
          r.fromPrev,
        ].join(","),
      );
    });
    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `funnel_${period}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [chartData, period]);

  const exportJson = useCallback(() => {
    const payload = {
      period,
      exported_at: new Date().toISOString(),
      orphans,
      rows: chartData,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `funnel_${period}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [chartData, orphans, period]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Filter className="h-5 w-5 text-primary" />
          {t("funnel.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t("funnel.period")}</label>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">{t("funnel.period24h")}</SelectItem>
                <SelectItem value="7d">{t("funnel.period7d")}</SelectItem>
                <SelectItem value="30d">{t("funnel.period30d")}</SelectItem>
                <SelectItem value="90d">{t("funnel.period90d")}</SelectItem>
                <SelectItem value="all">{t("funnel.periodAll")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={load} disabled={loading} variant="outline" size="sm">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {t("funnel.refresh")}
            </Button>
          </div>
          <div className="flex items-end gap-2 sm:ml-auto">
            <Button onClick={exportCsv} disabled={!hasData} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              CSV
            </Button>
            <Button onClick={exportJson} disabled={!hasData} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              JSON
            </Button>
          </div>
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}

        {orphans && orphans.orphan_users > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium text-yellow-500">
                Осиротевшие регистрации: {orphans.orphan_users}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                За период найдено {orphans.orphan_users} событий registered без соответствующего профиля
                (обычно - неподтверждённые email, аккаунты удалены Supabase). Реальных регистраций:{" "}
                {orphans.real_registrations}. Воронка ниже показывает только реальных пользователей.
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Kpi
            label={t("funnel.registrations")}
            value={base}
            sub={t("funnel.uniqueUsers")}
          />
          <Kpi
            label={t("funnel.event.generation_completed")}
            value={completedUnique}
            sub={base ? `${Math.round((completedUnique / base) * 100)}% ${t("funnel.convFromReg").toLowerCase()}` : "-"}
          />
          <Kpi
            label={t("funnel.event.article_editor_opened")}
            value={editorUnique}
            sub={base ? `${Math.round((editorUnique / base) * 100)}% ${t("funnel.convFromReg").toLowerCase()}` : "-"}
          />
        </div>

        {hasData && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="text-xs text-muted-foreground mb-2 px-1">
                {t("funnel.uniqueUsers")} — {t("funnel.title")}
              </div>
              <ResponsiveContainer width="100%" height={Math.max(320, chartData.length * 26)}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="shortLabel"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    width={220}
                    interval={0}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number, _n, p: any) => [`${v} (${p?.payload?.fromReg ?? 0}%)`, t("funnel.uniqueUsers")]}
                  />
                  <Bar dataKey="unique" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="unique" position="right" fill="hsl(var(--foreground))" fontSize={11} />
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={d.unique === 0 ? "hsl(var(--muted))" : "hsl(var(--primary))"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="text-xs text-muted-foreground mb-2 px-1">
                {t("funnel.convFromPrev")} (%)
              </div>
              <ResponsiveContainer width="100%" height={Math.max(320, chartData.length * 26)}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} unit="%" />
                  <YAxis
                    type="category"
                    dataKey="shortLabel"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    width={220}
                    interval={0}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [`${v}%`, t("funnel.convFromPrev")]}
                  />
                  <Bar dataKey="fromPrev" radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="fromPrev" position="right" formatter={(v: number) => `${v}%`} fill="hsl(var(--foreground))" fontSize={11} />
                    {chartData.map((d, i) => {
                      const v = d.fromPrev / 100;
                      const color = v >= 0.7 ? "hsl(142 71% 45%)" : v >= 0.3 ? "hsl(48 96% 53%)" : "hsl(0 84% 60%)";
                      return <Cell key={i} fill={color} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead>{t("funnel.event")}</TableHead>
                <TableHead className="text-right">{t("funnel.total")}</TableHead>
                <TableHead className="text-right">{t("funnel.uniqueUsers")}</TableHead>
                <TableHead className="text-right">{t("funnel.convFromReg")}</TableHead>
                <TableHead className="text-right">{t("funnel.convFromPrev")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!hasData ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-sm text-muted-foreground py-8"
                  >
                    {t("funnel.noData")}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r, i) => {
                  const prevUnique = i > 0 ? rows[i - 1].unique : r.unique;
                  const fromReg = base ? r.unique / base : 0;
                  const fromPrev = i === 0 ? 1 : prevUnique ? r.unique / prevUnique : 0;
                  return (
                    <TableRow key={r.event}>
                      <TableCell className="text-center text-muted-foreground text-xs">
                        {i + 1}
                      </TableCell>
                      <TableCell className="font-medium">
                        {t(`funnel.event.${r.event}` as string)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {r.total.toLocaleString("ru-RU")}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {r.unique.toLocaleString("ru-RU")}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {base ? `${Math.round(fromReg * 100)}%` : "-"}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${convColor(fromPrev)}`}
                      >
                        {i === 0 ? "100%" : prevUnique ? `${Math.round(fromPrev * 100)}%` : "-"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value.toLocaleString("ru-RU")}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function convColor(v: number): string {
  if (v >= 0.7) return "text-green-500";
  if (v >= 0.3) return "text-yellow-500";
  return "text-red-500";
}
