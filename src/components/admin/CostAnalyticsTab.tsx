import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DollarSign, Calendar, TrendingUp, Layers, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

const OP_LABELS: Record<string, string> = {
  site_generation: "Генерация сайта",
  article_generation: "Генерация статьи",
  fal_ai_photo: "FAL AI фото",
  fal_ai_portrait: "FAL AI портрет",
  fal_ai_logo: "FAL AI логотип",
  cloudflare_deploy: "Деплой Cloudflare",
  auto_post_cron: "Автопостинг",
};

const OP_COLORS: Record<string, string> = {
  site_generation: "hsl(217, 91%, 60%)",
  article_generation: "hsl(217, 91%, 60%)",
  fal_ai_photo: "hsl(270, 70%, 65%)",
  fal_ai_portrait: "hsl(270, 70%, 65%)",
  fal_ai_logo: "hsl(270, 70%, 65%)",
  cloudflare_deploy: "hsl(142, 70%, 45%)",
  auto_post_cron: "hsl(28, 90%, 55%)",
};

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}
function fmtRub(n: number, rate: number): string {
  if (!Number.isFinite(n)) return "0 ₽";
  return `≈ ${Math.round(n * rate).toLocaleString("ru-RU")} ₽`;
}

async function callAnalytics(action: string, params: Record<string, string | null> = {}) {
  const qs = new URLSearchParams({ action });
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const { data, error } = await supabase.functions.invoke(`cost-analytics?${qs.toString()}`, { method: "GET" });
  if (error) throw error;
  return data;
}

export function CostAnalyticsTab() {
  const [granularity, setGranularity] = useState<"day" | "week" | "month">("day");
  const [filterProject, setFilterProject] = useState<string>("");
  const [filterOp, setFilterOp] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const filterParams = useMemo(() => ({
    project_id: filterProject || null,
    operation_type: filterOp || null,
    date_from: dateFrom ? new Date(dateFrom).toISOString() : null,
    date_to: dateTo ? new Date(dateTo + "T23:59:59").toISOString() : null,
  }), [filterProject, filterOp, dateFrom, dateTo]);

  const summary = useQuery({
    queryKey: ["cost-summary"],
    queryFn: () => callAnalytics("summary"),
    staleTime: 60_000,
  });

  const byType = useQuery({
    queryKey: ["cost-by-type", filterParams],
    queryFn: () => callAnalytics("by_type", filterParams as any),
    staleTime: 60_000,
  });

  const series = useQuery({
    queryKey: ["cost-series", granularity, filterParams],
    queryFn: () => callAnalytics("timeseries", { ...filterParams, granularity } as any),
    staleTime: 60_000,
  });

  const byProject = useQuery({
    queryKey: ["cost-by-project", filterParams],
    queryFn: () => callAnalytics("by_project", filterParams as any),
    staleTime: 60_000,
  });

  const forecast = useQuery({
    queryKey: ["cost-forecast"],
    queryFn: () => callAnalytics("forecast"),
    staleTime: 60_000,
  });

  const rate = (summary.data?.usd_to_rub as number) || 90;

  const downloadCsv = async () => {
    try {
      const qs = new URLSearchParams({ action: "export_csv" });
      for (const [k, v] of Object.entries(filterParams)) if (v) qs.set(k, String(v));
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token || "";
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cost-analytics?${qs.toString()}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `cost-report-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Отчёт загружен");
    } catch (e: any) {
      toast.error(e.message || "Ошибка экспорта");
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Всего потрачено"
          icon={<DollarSign className="h-4 w-4" />}
          usd={summary.data?.total_usd || 0}
          rate={rate}
          loading={summary.isLoading}
        />
        <KpiCard
          label="За этот месяц"
          icon={<Calendar className="h-4 w-4" />}
          usd={summary.data?.month_usd || 0}
          rate={rate}
          loading={summary.isLoading}
        />
        <KpiCard
          label="За сегодня"
          icon={<TrendingUp className="h-4 w-4" />}
          usd={summary.data?.today_usd || 0}
          rate={rate}
          loading={summary.isLoading}
        />
        <KpiCard
          label="Средний на сайт"
          icon={<Layers className="h-4 w-4" />}
          usd={summary.data?.avg_per_project_usd || 0}
          rate={rate}
          loading={summary.isLoading}
        />
      </div>

      {/* Filters + export */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Тип операции</label>
            <Select value={filterOp || "all"} onValueChange={(v) => setFilterOp(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Все" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                {Object.entries(OP_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Проект (UUID)</label>
            <Input value={filterProject} onChange={(e) => setFilterProject(e.target.value)} placeholder="опционально" className="w-[260px]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">С даты</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[160px]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">По дату</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[160px]" />
          </div>
          <Button onClick={downloadCsv} variant="outline" className="ml-auto gap-2">
            <Download className="h-4 w-4" /> Скачать CSV
          </Button>
        </CardContent>
      </Card>

      {/* By type */}
      <Card>
        <CardHeader><CardTitle className="text-base">Расходы по типам операций</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Операция</TableHead>
                <TableHead className="text-right">Кол-во</TableHead>
                <TableHead className="text-right">Средняя</TableHead>
                <TableHead className="text-right">Итого</TableHead>
                <TableHead className="text-right">В рублях</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(byType.data?.items || []).map((it: any) => (
                <TableRow key={it.operation_type}>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: OP_COLORS[it.operation_type] || "#888" }} />
                      {OP_LABELS[it.operation_type] || it.operation_type}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{it.count}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{fmtUsd(it.avg_usd)}</TableCell>
                  <TableCell className="text-right font-medium">{fmtUsd(it.total_usd)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{fmtRub(it.total_usd, rate)}</TableCell>
                </TableRow>
              ))}
              {!byType.isLoading && (byType.data?.items || []).length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Данных пока нет</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Timeseries chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Расходы по времени</CardTitle>
          <Tabs value={granularity} onValueChange={(v) => setGranularity(v as any)}>
            <TabsList>
              <TabsTrigger value="day">День</TabsTrigger>
              <TabsTrigger value="week">Неделя</TabsTrigger>
              <TabsTrigger value="month">Месяц</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          <TimeseriesChart series={series.data?.series || []} />
        </CardContent>
      </Card>

      {/* By project */}
      <Card>
        <CardHeader><CardTitle className="text-base">Расходы по проектам</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Сайт</TableHead>
                <TableHead className="text-right">Статей</TableHead>
                <TableHead className="text-right">Фото</TableHead>
                <TableHead className="text-right">Деплои</TableHead>
                <TableHead className="text-right">Автопост</TableHead>
                <TableHead className="text-right">Итого $</TableHead>
                <TableHead className="text-right">≈ ₽</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(byProject.data?.items || []).map((it: any) => (
                <TableRow key={it.project_id}>
                  <TableCell>
                    <div className="font-medium">{it.name}</div>
                    <div className="text-xs text-muted-foreground">{it.domain || it.project_id}</div>
                  </TableCell>
                  <TableCell className="text-right">{it.article_generation}</TableCell>
                  <TableCell className="text-right">{it.photos}</TableCell>
                  <TableCell className="text-right">{it.deploys}</TableCell>
                  <TableCell className="text-right">{it.auto_post}</TableCell>
                  <TableCell className="text-right font-medium">{fmtUsd(it.total_usd)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{fmtRub(it.total_usd, rate)}</TableCell>
                </TableRow>
              ))}
              {!byProject.isLoading && (byProject.data?.items || []).length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Данных пока нет</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Forecast */}
      <Card>
        <CardHeader><CardTitle className="text-base">Прогноз</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-4">
            <div className="text-sm text-muted-foreground mb-2">При текущем темпе за месяц:</div>
            {forecast.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ul className="space-y-1 text-sm">
                <li>Статей: <span className="font-medium">{forecast.data?.current_pace?.articles_per_month ?? 0}</span></li>
                <li>Фото: <span className="font-medium">{forecast.data?.current_pace?.photos_per_month ?? 0}</span></li>
                <li>Расходы: <span className="font-medium">{fmtUsd(forecast.data?.current_pace?.expected_cost_usd || 0)}</span> <span className="text-muted-foreground">{fmtRub(forecast.data?.current_pace?.expected_cost_usd || 0, rate)}</span></li>
              </ul>
            )}
          </div>
          <div className="rounded-lg border p-4">
            <div className="text-sm text-muted-foreground mb-2">При масштабировании до 50 сайтов:</div>
            {forecast.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ul className="space-y-1 text-sm">
                <li>Создание: <span className="font-medium">{fmtUsd(forecast.data?.scaling_50_sites?.one_time_cost_usd || 0)}</span> <span className="text-muted-foreground">{fmtRub(forecast.data?.scaling_50_sites?.one_time_cost_usd || 0, rate)}</span></li>
                <li>Ежемесячно (автопостинг): <span className="font-medium">{fmtUsd(forecast.data?.scaling_50_sites?.monthly_cost_usd || 0)}</span> <span className="text-muted-foreground">{fmtRub(forecast.data?.scaling_50_sites?.monthly_cost_usd || 0, rate)}</span></li>
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Курс: 1$ ≈ {rate}₽. Цены: Claude Sonnet 4 — $3/$15 за 1M токенов. FAL AI — $0.003/фото. Cloudflare Pages — $0.
      </p>
    </div>
  );
}

function KpiCard({ label, icon, usd, rate, loading }: { label: string; icon: React.ReactNode; usd: number; rate: number; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <div className="text-2xl font-bold">{fmtUsd(usd)}</div>
            <div className="text-xs text-muted-foreground">{fmtRub(usd, rate)}</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TimeseriesChart({ series }: { series: any[] }) {
  if (!series || series.length === 0) {
    return <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">Нет данных за выбранный период</div>;
  }
  const W = 800;
  const H = 220;
  const padL = 40;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const maxY = Math.max(0.0001, ...series.map((p) => Number(p.total) || 0));
  const stepX = (W - padL - padR) / Math.max(1, series.length - 1);
  const toX = (i: number) => padL + i * stepX;
  const toY = (v: number) => padT + (H - padT - padB) * (1 - v / maxY);

  const path = series.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(Number(p.total) || 0).toFixed(1)}`).join(" ");
  const area = `${path} L ${toX(series.length - 1).toFixed(1)} ${toY(0).toFixed(1)} L ${toX(0).toFixed(1)} ${toY(0).toFixed(1)} Z`;

  // X labels — show ~6 evenly spaced
  const labelStep = Math.max(1, Math.floor(series.length / 6));

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[240px]">
        <defs>
          <linearGradient id="costGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="hsl(217, 91%, 60%)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="hsl(217, 91%, 60%)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* gridlines */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={padL} x2={W - padR} y1={padT + (H - padT - padB) * f} y2={padT + (H - padT - padB) * f}
            stroke="currentColor" strokeOpacity="0.08" />
        ))}
        <path d={area} fill="url(#costGrad)" />
        <path d={path} fill="none" stroke="hsl(217, 91%, 60%)" strokeWidth="2" />
        {series.map((p, i) => (
          <circle key={i} cx={toX(i)} cy={toY(Number(p.total) || 0)} r="2.5" fill="hsl(217, 91%, 60%)" />
        ))}
        {/* x labels */}
        {series.map((p, i) => (i % labelStep === 0 || i === series.length - 1) ? (
          <text key={`x-${i}`} x={toX(i)} y={H - 8} fontSize="10" textAnchor="middle" fill="currentColor" fillOpacity="0.6">{p.date}</text>
        ) : null)}
        {/* y axis max */}
        <text x={padL - 6} y={padT + 8} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity="0.6">${maxY.toFixed(2)}</text>
        <text x={padL - 6} y={H - padB} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity="0.6">$0</text>
      </svg>
    </div>
  );
}