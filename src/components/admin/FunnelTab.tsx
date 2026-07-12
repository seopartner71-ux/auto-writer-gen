import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/shared/hooks/useI18n";

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const since = sinceFor(period);
      const counts: Record<string, { total: number; users: Set<string> }> = {};
      for (const ev of CANONICAL_EVENTS) {
        counts[ev] = { total: 0, users: new Set() };
      }

      const pageSize = 1000;
      let from = 0;
      let done = false;
      while (!done) {
        let q = supabase
          .from("activation_events")
          .select("event_name,user_id")
          .order("created_at", { ascending: true })
          .range(from, from + pageSize - 1);
        if (since) q = q.gte("created_at", since);
        const { data, error: e } = await q;
        if (e) throw e;
        const page = data || [];
        for (const r of page) {
          if (counts[r.event_name]) {
            counts[r.event_name].total++;
            counts[r.event_name].users.add(r.user_id);
          }
        }
        if (page.length < pageSize) done = true;
        from += pageSize;
      }

      setRows(
        CANONICAL_EVENTS.map((ev) => ({
          event: ev,
          total: counts[ev].total,
          unique: counts[ev].users.size,
        })),
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
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}

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
                        {t(`funnel.event.${r.event}` as keyof typeof t)}
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
