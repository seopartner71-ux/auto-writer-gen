import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DollarSign, Calendar, TrendingUp, Layers, Download, Loader2, FileText, PenLine, Factory } from "lucide-react";
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

  const byUser = useQuery({
    queryKey: ["cost-by-user", filterParams],
    queryFn: () => callAnalytics("by_user", filterParams as any),
    staleTime: 60_000,
  });

  const forecast = useQuery({
    queryKey: ["cost-forecast"],
    queryFn: () => callAnalytics("forecast"),
    staleTime: 60_000,
  });

  // Отдельная статистика только по генерации статей (без учёта остальных фильтров)
  const articlesOnly = useQuery({
    queryKey: ["cost-articles-only"],
    queryFn: () => callAnalytics("by_type", { operation_type: "article_generation" }),
    staleTime: 60_000,
  });

  const articlesBreakdown = useQuery({
    queryKey: ["cost-articles-breakdown"],
    queryFn: () => callAnalytics("articles_breakdown"),
    staleTime: 60_000,
  });
  const fullArticleCost = useQuery({
    queryKey: ["cost-full-article"],
    queryFn: () => callAnalytics("full_article_cost"),
    staleTime: 60_000,
  });
  const articlesStat = useMemo(() => {
    const item = (articlesOnly.data?.items || []).find((it: any) => it.operation_type === "article_generation");
    return {
      total_usd: Number(item?.total_usd || 0),
      count: Number(item?.count || 0),
      avg_usd: Number(item?.avg_usd || 0),
    };
  }, [articlesOnly.data]);

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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Всего потрачено"
          icon={<DollarSign className="h-4 w-4" />}
          usd={summary.data?.total_usd || 0}
          rate={rate}
          loading={summary.isLoading}
        />
        <KpiCard
          label={`Только статьи${articlesStat.count ? ` (${articlesStat.count})` : ""}`}
          icon={<FileText className="h-4 w-4" />}
          usd={articlesStat.total_usd}
          rate={rate}
          loading={articlesOnly.isLoading}
          hint={articlesStat.count ? `Средняя: ${fmtUsd(articlesStat.avg_usd)} / статью` : undefined}
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

      {/* Articles breakdown: manual (AI Writer page) vs Factory */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Стоимость генерации статей: вручную против фабрики</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <PenLine className="h-4 w-4" /> Через страницу AI Writer (без проекта)
            </div>
            {articlesBreakdown.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ul className="space-y-1 text-sm">
                <li>Статей: <span className="font-medium">{articlesBreakdown.data?.manual?.count ?? 0}</span></li>
                <li>Итого: <span className="font-medium">{fmtUsd(articlesBreakdown.data?.manual?.total_usd || 0)}</span> <span className="text-muted-foreground">{fmtRub(articlesBreakdown.data?.manual?.total_usd || 0, rate)}</span></li>
                <li>Средняя за статью: <span className="font-medium">{fmtUsd(articlesBreakdown.data?.manual?.avg_usd || 0)}</span></li>
              </ul>
            )}
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <Factory className="h-4 w-4" /> Через фабрику / автопост (с проектом)
            </div>
            {articlesBreakdown.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ul className="space-y-1 text-sm">
                <li>Статей: <span className="font-medium">{articlesBreakdown.data?.factory?.count ?? 0}</span></li>
                <li>Итого: <span className="font-medium">{fmtUsd(articlesBreakdown.data?.factory?.total_usd || 0)}</span> <span className="text-muted-foreground">{fmtRub(articlesBreakdown.data?.factory?.total_usd || 0, rate)}</span></li>
                <li>Средняя за статью: <span className="font-medium">{fmtUsd(articlesBreakdown.data?.factory?.avg_usd || 0)}</span></li>
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Per-AI-model breakdown for article generation + refinements */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Средняя цена статьи и доработок по модели ИИ</CardTitle>
        </CardHeader>
        <CardContent>
          {articlesBreakdown.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : !articlesBreakdown.data?.by_model?.length ? (
            <div className="text-sm text-muted-foreground">Данных пока нет</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left py-2 pr-4">Модель</th>
                    <th className="text-right py-2 px-2">Статей</th>
                    <th className="text-right py-2 px-2">Ср. за статью</th>
                    <th className="text-right py-2 px-2">Доработок</th>
                    <th className="text-right py-2 px-2">Ср. за доработку</th>
                    <th className="text-right py-2 px-2">Ср. полная (статья + доработки)</th>
                    <th className="text-right py-2 pl-2">Итого</th>
                  </tr>
                </thead>
                <tbody>
                  {articlesBreakdown.data.by_model.map((m: any) => (
                    <tr key={m.model} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">{m.model}</td>
                      <td className="text-right py-2 px-2">{m.main_count}</td>
                      <td className="text-right py-2 px-2">
                        {fmtUsd(m.avg_main_usd)}
                        <div className="text-[11px] text-muted-foreground">{fmtRub(m.avg_main_usd, rate)}</div>
                      </td>
                      <td className="text-right py-2 px-2">{m.refine_count}</td>
                      <td className="text-right py-2 px-2">
                        {fmtUsd(m.avg_refine_usd)}
                        <div className="text-[11px] text-muted-foreground">{fmtRub(m.avg_refine_usd, rate)}</div>
                      </td>
                      <td className="text-right py-2 px-2">
                        {fmtUsd(m.avg_total_per_article_usd)}
                        <div className="text-[11px] text-muted-foreground">{fmtRub(m.avg_total_per_article_usd, rate)}</div>
                      </td>
                      <td className="text-right py-2 pl-2">
                        {fmtUsd(m.total_usd)}
                        <div className="text-[11px] text-muted-foreground">{fmtRub(m.total_usd, rate)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-3">
                Статей - основные генерации (full / посекционно). Доработок - inline-правки, проверки качества, перегенерация структуры. "Ср. полная" - сумма всех расходов на одну статью с учетом её доработок (доработки могут идти на других моделях).
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Полная стоимость доведения статьи до публикации */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Полная стоимость доведения статьи до публикации</CardTitle>
        </CardHeader>
        <CardContent>
          {fullArticleCost.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : !fullArticleCost.data ? (
            <div className="text-sm text-muted-foreground">Данных пока нет</div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground mb-1">Основная генерация</div>
                  <div className="font-semibold">{fmtUsd(fullArticleCost.data.main?.total_usd || 0)}</div>
                  <div className="text-[11px] text-muted-foreground">{fmtRub(fullArticleCost.data.main?.total_usd || 0, rate)}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">Запусков: {fullArticleCost.data.main?.count || 0}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground mb-1">Доработки (правки/QA)</div>
                  <div className="font-semibold">{fmtUsd(fullArticleCost.data.refinements?.total_usd || 0)}</div>
                  <div className="text-[11px] text-muted-foreground">{fmtRub(fullArticleCost.data.refinements?.total_usd || 0, rate)}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">Операций: {fullArticleCost.data.refinements?.count || 0}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground mb-1">Картинки FAL AI</div>
                  <div className="font-semibold">{fmtUsd(fullArticleCost.data.photos?.total_usd || 0)}</div>
                  <div className="text-[11px] text-muted-foreground">{fmtRub(fullArticleCost.data.photos?.total_usd || 0, rate)}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">Картинок: {fullArticleCost.data.photos?.count || 0}</div>
                </div>
                <div className="rounded-lg border p-3 bg-primary/5">
                  <div className="text-xs text-muted-foreground mb-1">Итого / средняя за статью</div>
                  <div className="font-semibold">{fmtUsd(fullArticleCost.data.full?.total_usd || 0)}</div>
                  <div className="text-[11px] text-muted-foreground">{fmtRub(fullArticleCost.data.full?.total_usd || 0, rate)}</div>
                  <div className="text-sm font-medium mt-2">
                    Ср.: {fmtUsd(fullArticleCost.data.full?.avg_per_article_usd || 0)}
                    <span className="text-[11px] text-muted-foreground ml-1">{fmtRub(fullArticleCost.data.full?.avg_per_article_usd || 0, rate)}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">База: {fullArticleCost.data.articles_count} статей в БД</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Полная стоимость = основная генерация + все доработки (inline-правки, QA, перегенерация секций) + сгенерированные картинки. Research/парсинг конкурентов уже включены в основную генерацию (один вызов AI). Средняя считается на общее число статей в системе.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

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

      {/* By user */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Расходы по пользователям</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Пользователь</TableHead>
                <TableHead className="text-right">Статей</TableHead>
                <TableHead className="text-right">Сайтов</TableHead>
                <TableHead className="text-right">Фото</TableHead>
                <TableHead className="text-right">Деплои</TableHead>
                <TableHead className="text-right">Автопост</TableHead>
                <TableHead className="text-right">Итого $</TableHead>
                <TableHead className="text-right">≈ ₽</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(byUser.data?.items || []).map((it: any) => (
                <TableRow key={it.user_id}>
                  <TableCell>
                    <div className="font-medium">{it.full_name || it.email || "(без имени)"}</div>
                    <div className="text-xs text-muted-foreground">{it.email || it.user_id}</div>
                  </TableCell>
                  <TableCell className="text-right font-medium">{it.articles}</TableCell>
                  <TableCell className="text-right">{it.sites}</TableCell>
                  <TableCell className="text-right">{it.photos}</TableCell>
                  <TableCell className="text-right">{it.deploys}</TableCell>
                  <TableCell className="text-right">{it.auto_post}</TableCell>
                  <TableCell className="text-right font-medium">{fmtUsd(it.total_usd)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{fmtRub(it.total_usd, rate)}</TableCell>
                </TableRow>
              ))}
              {!byUser.isLoading && (byUser.data?.items || []).length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Данных пока нет</TableCell></TableRow>
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

function KpiCard({ label, icon, usd, rate, loading, hint }: { label: string; icon: React.ReactNode; usd: number; rate: number; loading: boolean; hint?: string }) {
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
            {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
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