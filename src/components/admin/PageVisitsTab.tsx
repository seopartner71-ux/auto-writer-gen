import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Stats = {
  today: number;
  yesterday: number;
  week: number;
  month: number;
  total: number;
  unique_today: number;
  unique_month: number;
  unique_total: number;
};

type Daily = { day: string; visits: number; uniques: number };

export function PageVisitsTab() {
  const [page, setPage] = useState("/utm-generator");
  const [stats, setStats] = useState<Stats | null>(null);
  const [daily, setDaily] = useState<Daily[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [s, d] = await Promise.all([
        supabase.rpc("get_page_visit_stats" as any, { p_page: page }),
        supabase.rpc("get_page_visit_daily" as any, { p_page: page, p_days: 30 }),
      ]);
      if (s.error) throw s.error;
      if (d.error) throw d.error;
      setStats((s.data as any) ?? null);
      setDaily((d.data as any) ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cards: Array<{ label: string; value: number | undefined; sub?: string }> = [
    { label: "Сегодня", value: stats?.today, sub: `уник.: ${stats?.unique_today ?? 0}` },
    { label: "Вчера", value: stats?.yesterday },
    { label: "7 дней", value: stats?.week },
    { label: "30 дней", value: stats?.month, sub: `уник.: ${stats?.unique_month ?? 0}` },
    { label: "Всего", value: stats?.total, sub: `уник.: ${stats?.unique_total ?? 0}` },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5 text-primary" />
          Счетчик посетителей страниц
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={page}
            onChange={(e) => setPage(e.target.value)}
            placeholder="/utm-generator"
            className="font-mono text-sm"
          />
          <Button onClick={load} disabled={loading} variant="default">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Обновить
          </Button>
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className="text-2xl font-semibold mt-1">
                {c.value === undefined ? "-" : c.value.toLocaleString("ru-RU")}
              </div>
              {c.sub && <div className="text-[11px] text-muted-foreground mt-0.5">{c.sub}</div>}
            </div>
          ))}
        </div>

        <div>
          <div className="text-sm font-medium mb-2">По дням (последние 30)</div>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead className="text-right">Визиты</TableHead>
                  <TableHead className="text-right">Уникальные</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {daily.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">
                      Нет данных
                    </TableCell>
                  </TableRow>
                )}
                {daily.map((d) => (
                  <TableRow key={d.day}>
                    <TableCell className="font-mono text-xs">{d.day}</TableCell>
                    <TableCell className="text-right">{Number(d.visits).toLocaleString("ru-RU")}</TableCell>
                    <TableCell className="text-right">{Number(d.uniques).toLocaleString("ru-RU")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}