import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Download, RefreshCw, Plus, KeyRound, Trash2 } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { phpCollector, logShipper, INGEST_ENDPOINT } from "@/features/ai-traffic-monitor/collectors";
import { MetrikaCounterSelect } from "@/features/ai-traffic-monitor/MetrikaCounterSelect";
import { invokeErrorMessage } from "@/shared/utils/invokeError";
import { ReportDatePicker } from "@/features/ai-traffic-monitor/ReportDatePicker";

type Site = { id: string; name: string; domain: string; status: string; last_event_at: string | null; last_verified_at: string | null; metrika_counter_id?: string | null };
type MetrikaStats = {
  counter_id: string; period: { from: string; to: string; days: number };
  totals: { visits: number; users: number; pageviews: number };
  daily: { day: string; visits: number; users: number; pageviews: number }[];
  sources: { type: string; name: string; visits: number; users: number }[];
  landing_pages: { url: string; visits: number; users: number }[];
};
type Stats = {
  bot_requests: number; bot_unique_urls: number; referral_visits: number; referral_visitors: number;
  referral_sources: number; last_event_at: string | null;
  daily: { day: string; bot: number; referral: number }[];
  bots: { name: string; category: string; requests: number; unique_urls: number; last: string }[];
  bot_pages: { url: string; requests: number; bots: number; bot_names?: string[] }[];
  sources: { name: string; visits: number; visitors: number; last: string; detection: string }[];
  landing_pages: { url: string; visits: number; sources: string }[];
};
type Ev = { id: number; kind: string; bot_name: string | null; bot_category: string | null; source_name: string | null; url: string; http_status: number | null; user_agent: string | null; referrer: string | null; detection: string | null; occurred_at: string; site_id: string };

const CAT: Record<string, string> = { ai_crawler: "ИИ-сборщик", ai_search: "ИИ-поиск", ai_user_fetch: "Запрос пользователя ИИ", search: "Поисковый робот" };
const STATUS: Record<string, { label: string; v: "outline" | "secondary" | "default" }> = {
  not_connected: { label: "Не подключен", v: "outline" },
  awaiting_data: { label: "Ключ выдан, данных нет", v: "secondary" },
  connected: { label: "Данные поступают", v: "default" },
};
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("ru-RU") : "Нет данных");
const PAGE = 50;

function range(period: string, from: string, to: string) {
  const now = new Date();
  if (period === "custom" && from && to) return [new Date(from), new Date(new Date(to).getTime() + 86400000)];
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (period === "7") start.setDate(start.getDate() - 6);
  if (period === "30") start.setDate(start.getDate() - 29);
  return [start, new Date(now.getTime() + 60000)];
}

function csv(rows: Ev[]) {
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["occurred_at", "kind", "bot_or_source", "category", "url", "http_status", "user_agent", "referrer", "detection"];
  const body = rows.map((r) => [r.occurred_at, r.kind, r.bot_name || r.source_name, r.bot_category, r.url, r.http_status, r.user_agent, r.referrer, r.detection].map(esc).join(","));
  const blob = new Blob(["\uFEFF" + [head.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ai-traffic-${Date.now()}.csv`; a.click();
}

export default function AiTrafficMonitorPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [site, setSite] = useState("all");
  const [period, setPeriod] = useState("7");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [kind, setKind] = useState("all");
  const [name, setName] = useState("all");
  const [stats, setStats] = useState<Stats | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [page, setPage] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [names, setNames] = useState<string[]>([]);

  const [fromD, toD] = useMemo(() => range(period, from, to), [period, from, to]);

  const loadSites = useCallback(async () => {
    const { data, error } = await supabase.from("monitor_sites").select("id,name,domain,status,last_event_at,last_verified_at,metrika_counter_id").order("name");
    if (error) setErr(error.message); else setSites(data as Site[]);
    const [b, s] = await Promise.all([
      supabase.from("monitor_bot_signatures").select("name").eq("is_active", true),
      supabase.from("monitor_ai_sources").select("name").eq("is_active", true),
    ]);
    setNames([...new Set([...(b.data ?? []), ...(s.data ?? [])].map((x: any) => x.name))]);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const p = { p_site: site === "all" ? null : site, p_from: fromD.toISOString(), p_to: toD.toISOString(), p_kind: kind === "all" ? null : kind, p_name: name === "all" ? null : name };
    const { data, error } = await supabase.rpc("monitor_stats" as any, p as any);
    if (error) setErr(error.message); else setStats(data as unknown as Stats);
    let q = supabase.from("monitor_events").select("*").eq("is_test", false)
      .gte("occurred_at", p.p_from).lt("occurred_at", p.p_to).order("occurred_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (p.p_site) q = q.eq("site_id", p.p_site);
    if (p.p_kind) q = q.eq("kind", p.p_kind);
    if (p.p_name) q = q.or(`bot_name.eq."${p.p_name}",source_name.eq."${p.p_name}"`);
    const ev = await q;
    if (ev.error) setErr(ev.error.message); else setEvents(ev.data as Ev[]);
    setLoading(false);
  }, [site, fromD, toD, kind, name, page]);

  useEffect(() => { loadSites(); }, [loadSites]);
  useEffect(() => { load(); }, [load]);

  const exportAll = async () => {
    const rows: Ev[] = [];
    for (let i = 0; i < 20; i++) {
      let q = supabase.from("monitor_events").select("*").eq("is_test", false)
        .gte("occurred_at", fromD.toISOString()).lt("occurred_at", toD.toISOString())
        .order("occurred_at", { ascending: false }).range(i * 1000, i * 1000 + 999);
      if (site !== "all") q = q.eq("site_id", site);
      if (kind !== "all") q = q.eq("kind", kind);
      if (name !== "all") q = q.or(`bot_name.eq."${name}",source_name.eq."${name}"`);
      const { data } = await q; rows.push(...((data as Ev[]) ?? []));
      if (!data || data.length < 1000) break;
    }
    csv(rows);
  };

  const anyConnected = sites.some((s) => s.status === "connected");

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">AI Traffic Monitor</h1>
        <p className="text-sm text-muted-foreground">Мониторинг обращений ИИ-ботов и переходов из AI-источников</p>
      </div>

      {err && <Alert variant="destructive"><AlertDescription>Ошибка загрузки: {err}</AlertDescription></Alert>}
      {!anyConnected && (
        <Alert><AlertDescription>Ни один сайт пока не передает данные. Добавьте сайт во вкладке «Сайты и подключения» и установите сборщик. До этого показатели нулевые - это не сбой.</AlertDescription></Alert>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select value={period} onValueChange={(v) => { setPeriod(v); setPage(0); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Сегодня</SelectItem><SelectItem value="7">7 дней</SelectItem>
            <SelectItem value="30">30 дней</SelectItem><SelectItem value="custom">Свой диапазон</SelectItem>
          </SelectContent>
        </Select>
        <Select value={site} onValueChange={(v) => { setSite(v); setPage(0); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все сайты</SelectItem>
            {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.domain})</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={(v) => { setKind(v); setPage(0); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы активности</SelectItem>
            <SelectItem value="bot">Боты</SelectItem><SelectItem value="referral">Переходы из ИИ-чатов</SelectItem>
          </SelectContent>
        </Select>
        <Select value={name} onValueChange={(v) => { setName(v); setPage(0); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все боты и источники</SelectItem>
            {names.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading} className="flex-1"><RefreshCw className="mr-2 h-4 w-4" />Обновить</Button>
          <Button variant="outline" onClick={exportAll} title="CSV"><Download className="h-4 w-4" /></Button>
        </div>
      </div>
      {period === "custom" && (
        <div className="flex flex-wrap gap-3">
          <ReportDatePicker label="Начало периода ботов" value={from} onChange={setFrom} />
          <ReportDatePicker label="Конец периода ботов" value={to} onChange={setTo} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ["Запросы известных ботов", stats?.bot_requests ?? 0],
          ["Уникальные URL у ботов", stats?.bot_unique_urls ?? 0],
          ["Визиты из ИИ-источников", stats?.referral_visits ?? 0],
          ["ИИ-источников переходов", stats?.referral_sources ?? 0],
          ["Последнее событие", fmt(stats?.last_event_at ?? null)],
        ].map(([l, v]) => (
          <Card key={l as string}><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">{l}</div>
            <div className="mt-1 text-xl font-semibold">{v}</div>
          </CardContent></Card>
        ))}
      </div>

      <Tabs defaultValue="bots">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="bots">ИИ-боты</TabsTrigger>
          <TabsTrigger value="refs">Переходы из ИИ-чатов</TabsTrigger>
          <TabsTrigger value="metrika">Посещаемость сайта (Метрика)</TabsTrigger>
          <TabsTrigger value="events">Журнал событий</TabsTrigger>
          <TabsTrigger value="sites">Сайты и подключения</TabsTrigger>
          <TabsTrigger value="dict">Справочники</TabsTrigger>
          <TabsTrigger value="help">Инструкция и выгрузка</TabsTrigger>
        </TabsList>

        <TabsContent value="bots" className="space-y-4">
          <DailyChart data={stats?.daily ?? []} k="bot" title="Запросы ботов по дням" />
          <Card><CardHeader><CardTitle className="text-base">Боты</CardTitle></CardHeader><CardContent className="overflow-x-auto">
            <Table><TableHeader><TableRow><TableHead>Бот</TableHead><TableHead>Категория</TableHead><TableHead>Запросы</TableHead><TableHead>Уник. URL</TableHead><TableHead>Последний</TableHead></TableRow></TableHeader>
              <TableBody>{(stats?.bots ?? []).length === 0 ? <Empty cols={5} /> : stats!.bots.map((b) => (
                <TableRow key={b.name}><TableCell>{b.name}</TableCell><TableCell>{CAT[b.category] ?? b.category}</TableCell><TableCell>{b.requests}</TableCell><TableCell>{b.unique_urls}</TableCell><TableCell>{fmt(b.last)}</TableCell></TableRow>))}
              </TableBody></Table>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Страницы, запрошенные ботами</CardTitle></CardHeader><CardContent className="overflow-x-auto">
            <Table><TableHeader><TableRow><TableHead>URL</TableHead><TableHead>Запросы</TableHead><TableHead>Боты / ИИ</TableHead><TableHead>Ботов</TableHead></TableRow></TableHeader>
              <TableBody>{(stats?.bot_pages ?? []).length === 0 ? <Empty cols={4} /> : (stats?.bot_pages ?? []).map((p) => (
                <TableRow key={p.url}><TableCell className="max-w-md break-all whitespace-normal">{p.url}</TableCell><TableCell>{p.requests}</TableCell><TableCell className="min-w-40 whitespace-normal">{p.bot_names?.join(", ") || "Нет данных"}</TableCell><TableCell>{p.bots}</TableCell></TableRow>))}
              </TableBody></Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="refs" className="space-y-4">
          <Alert><AlertDescription>Часть переходов из ИИ-чатов не определяется: приложения и браузеры могут не передавать Referer, а редиректы его теряют. Цифры - нижняя граница. Посетители считаются по обезличенному суточному отпечатку и приблизительны.</AlertDescription></Alert>
          <DailyChart data={stats?.daily ?? []} k="referral" title="Визиты из ИИ по дням" />
          <Card><CardHeader><CardTitle className="text-base">Источники</CardTitle></CardHeader><CardContent className="overflow-x-auto">
            <Table><TableHeader><TableRow><TableHead>Источник</TableHead><TableHead>Визиты</TableHead><TableHead>Посетители (прибл.)</TableHead><TableHead>Последний визит</TableHead><TableHead>Как определен</TableHead></TableRow></TableHeader>
              <TableBody>{(stats?.sources ?? []).length === 0 ? <Empty cols={5} /> : stats!.sources.map((s) => (
                <TableRow key={s.name}><TableCell>{s.name}</TableCell><TableCell>{s.visits}</TableCell><TableCell>{s.visitors}</TableCell><TableCell>{fmt(s.last)}</TableCell><TableCell>{s.detection}</TableCell></TableRow>))}
              </TableBody></Table>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Посадочные страницы</CardTitle></CardHeader><CardContent className="overflow-x-auto">
            <Table><TableHeader><TableRow><TableHead>URL</TableHead><TableHead>Визиты</TableHead><TableHead>Источники</TableHead></TableRow></TableHeader>
              <TableBody>{(stats?.landing_pages ?? []).length === 0 ? <Empty cols={3} /> : stats!.landing_pages.map((p) => (
                <TableRow key={p.url}><TableCell className="max-w-md truncate">{p.url}</TableCell><TableCell>{p.visits}</TableCell><TableCell>{p.sources}</TableCell></TableRow>))}
              </TableBody></Table>
          </CardContent></Card>

        </TabsContent>

        <TabsContent value="metrika"><MetrikaCard sites={sites} siteId={site} /></TabsContent>

        <TabsContent value="events">
          <Card><CardContent className="overflow-x-auto p-4">
            <Table><TableHeader><TableRow><TableHead>Время</TableHead><TableHead>Тип</TableHead><TableHead>Бот / источник</TableHead><TableHead>URL</TableHead><TableHead>Статус</TableHead><TableHead>User-Agent / Referer</TableHead></TableRow></TableHeader>
              <TableBody>{events.length === 0 ? <Empty cols={6} /> : events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">{fmt(e.occurred_at)}</TableCell>
                  <TableCell>{e.kind === "bot" ? "Бот" : "Переход"}</TableCell>
                  <TableCell>{e.bot_name || e.source_name}</TableCell>
                  <TableCell className="max-w-xs truncate">{e.url}</TableCell>
                  <TableCell>{e.http_status ?? "-"}</TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{e.kind === "bot" ? e.user_agent : e.referrer}</TableCell>
                </TableRow>))}
              </TableBody></Table>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</Button>
              <Button variant="outline" size="sm" disabled={events.length < PAGE} onClick={() => setPage(page + 1)}>Далее</Button>
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="sites"><SitesTab sites={sites} reload={loadSites} /></TabsContent>
        <TabsContent value="dict"><DictTab /></TabsContent>
        <TabsContent value="help"><HelpTab exportAll={exportAll} /></TabsContent>
      </Tabs>
    </div>
  );
}

function MetrikaCard({ sites, siteId }: { sites: Site[]; siteId: string }) {
  const [data, setData] = useState<MetrikaStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState("7");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const connected = sites.filter(s => s.metrika_counter_id);
  const [selected, setSelected] = useState("");
  const target = siteId === "all" ? connected.find(s => s.id === selected) ?? connected[0] : sites.find(s => s.id === siteId);
  const counter = target?.metrika_counter_id ?? null;
  const custom = period === "custom";
  const invalid = custom && (!from || !to || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 >= 90);

  const load = useCallback(async () => {
    setData(null); setErr(null);
    if (!counter || invalid) return;
    setLoading(true);
    try {
      const { data: d, error } = await supabase.functions.invoke("metrika-stats", { body: { counter_id: counter, ...(custom ? { from, to } : { days: Number(period) }) } });
      if (error) setErr(await invokeErrorMessage(error, "Не удалось загрузить Метрику"));
      else if (d?.error) setErr(d.error);
      else setData(d as MetrikaStats);
    } finally { setLoading(false); }
  }, [counter, invalid, custom, from, to, period]);

  useEffect(() => { void load(); }, [load]);

  return <section className="space-y-4 pt-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Яндекс Метрика - посещаемость сайта</h2>
        <p className="text-sm text-muted-foreground">{target?.domain ?? "Сайт не выбран"}{counter ? ` · Счетчик ${counter}` : ""}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {siteId === "all" && connected.length > 0 && <Select value={target?.id} onValueChange={setSelected}>
          <SelectTrigger aria-label="Сайт отчета Метрики" className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>{connected.map(s => <SelectItem key={s.id} value={s.id}>{s.name} ({s.domain})</SelectItem>)}</SelectContent>
        </Select>}
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger aria-label="Период Метрики" className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="1">Сегодня</SelectItem><SelectItem value="7">7 дней</SelectItem><SelectItem value="30">30 дней</SelectItem><SelectItem value="90">90 дней</SelectItem><SelectItem value="custom">Выбрать даты</SelectItem></SelectContent>
        </Select>
        <Button variant="outline" size="icon" aria-label="Обновить Метрику" title="Обновить Метрику" onClick={load} disabled={loading || invalid || !counter}><RefreshCw className="h-4 w-4" /></Button>
      </div>
    </div>
    {custom && <div className="flex flex-wrap items-center gap-3">
      <ReportDatePicker label="Начало периода Метрики" value={from} onChange={setFrom} />
      <span className="text-muted-foreground">-</span>
      <ReportDatePicker label="Конец периода Метрики" value={to} onChange={setTo} />
      {invalid && <p className="text-sm text-muted-foreground">Укажите обе даты по порядку, до 90 дней.</p>}
    </div>}
    {!counter && <p className="text-sm text-muted-foreground">Метрика не подключена. Выберите счетчик во вкладке «Сайты и подключения».</p>}
    {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}
    {loading && <p className="text-sm text-muted-foreground">Загружаю данные из Метрики...</p>}
    {data && <>
      <p className="text-sm text-muted-foreground">{data.period.from.split("-").reverse().join(".")} - {data.period.to.split("-").reverse().join(".")} · Все источники посещаемости, не только ИИ · Атрибуция: последний переход</p>
      <div className="grid grid-cols-3 gap-3">{[["Визиты", data.totals.visits], ["Посетители", data.totals.users], ["Просмотры", data.totals.pageviews]].map(([l, v]) => <Card key={l}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{l}</div><div className="mt-1 text-xl font-mono tabular-nums">{v}</div></CardContent></Card>)}</div>
      <DailyChart data={data.daily.map(d => ({ day: d.day, bot: d.visits, referral: d.users }))} k="bot" title="Визиты по дням" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Откуда пришли посетители</CardTitle></CardHeader><CardContent className="overflow-x-auto">
          <Table><TableHeader><TableRow><TableHead>Тип трафика</TableHead><TableHead>Источник / сайт</TableHead><TableHead>Визиты</TableHead><TableHead>Посетители</TableHead></TableRow></TableHeader>
          <TableBody>{data.sources.length === 0 ? <Empty cols={4} /> : data.sources.map((s, i) => <TableRow key={`${s.type}-${s.name}-${i}`}><TableCell className="whitespace-normal">{s.type}</TableCell><TableCell className="whitespace-normal break-words">{s.name}</TableCell><TableCell>{s.visits}</TableCell><TableCell>{s.users}</TableCell></TableRow>)}</TableBody></Table>
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Страницы, с которых начался визит</CardTitle></CardHeader><CardContent className="overflow-x-auto">
          <Table><TableHeader><TableRow><TableHead>Страница входа</TableHead><TableHead>Визиты</TableHead><TableHead>Посетители</TableHead></TableRow></TableHeader>
          <TableBody>{data.landing_pages.length === 0 ? <Empty cols={3} /> : data.landing_pages.map(p => <TableRow key={p.url}><TableCell className="max-w-xs whitespace-normal break-all"><a href={/^https?:\/\//.test(p.url) ? p.url : undefined} target="_blank" rel="noopener noreferrer" className="text-primary underline">{p.url}</a></TableCell><TableCell>{p.visits}</TableCell><TableCell>{p.users}</TableCell></TableRow>)}</TableBody></Table>
        </CardContent></Card>
      </div>
    </>}
  </section>;
}

function HelpTab({ exportAll }: { exportAll: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); await exportAll(); setBusy(false); };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">Что это дает</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Раздел отвечает на три вопроса по каждому сайту клиента:</p>
          <p>1. Читают ли сайт боты ИИ (GPTBot, ClaudeBot, PerplexityBot и др.) и какие страницы они чаще всего забирают - это страницы, которые ИИ может цитировать в ответах.</p>
          <p>2. Приходят ли люди из ИИ-чатов (ChatGPT, Perplexity и др.) и на какие страницы.</p>
          <p>3. Какие поисковые роботы (Google, Яндекс, Bing) обходят сайт и как часто.</p>
          <p className="text-muted-foreground">Практическая польза: видно, какие страницы интересны ИИ, куда направлять усилия по GEO-оптимизации, и работают ли опубликованные архивы и материалы. Данные можно показывать клиенту как отчет об эффекте.</p>
        </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Насколько данные точные</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Бот определяется по строке User-Agent - описанию, которое бот сообщает о себе сам. Подлинность это не гарантирует: любой скрипт может назваться GPTBot. Поэтому цифры - это оценка, а не абсолют.</p>
          <p>Что учитывается надежно: запросы, прошедшие через сборщик, зафиксированы точно; дубли отбрасываются.</p>
          <p>Что может быть неполным: боты, читающие только текст (без картинок), пиксель не видит; часть переходов из чатов приходит без Referer и не засчитывается - цифры по переходам это нижняя граница; посетители считаются по обезличенному суточному отпечатку и приблизительны; события хранятся 180 дней, затем удаляются автоматически.</p>
        </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Как подключить сайт - 3 шага</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>1. Вкладка «Сайты и подключения» - добавьте название и домен клиента.</p>
          <p>2. Нажмите «Ключ» и скопируйте его сразу - повторно он не показывается.</p>
          <p>3. Установите сборщик: PHP-файл в корень сайта (хостинг) или скрипт чтения access.log (VPS). PHP-сборщик копит события в файле и отправляет пачкой не чаще раза в минуту, посетители сайта задержки не замечают. Он не заменяет журналы сервера.</p>
          <p className="text-muted-foreground">Статус «Данные поступают» появится после первой реальной отправки. До этого нули на странице - норма, а не сбой.</p>
        </CardContent></Card>
      <Card className="lg:col-span-2"><CardHeader><CardTitle className="text-base">Подробная установка PHP-сборщика (на примере Beget)</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="font-medium">Шаг 1. Получите файл сборщика</p>
          <p>Вкладка «Сайты и подключения» - нажмите «Ключ» у нужного сайта, скопируйте ключ (показывается один раз) и скачайте текст PHP-сборщика в файл с именем ai-monitor.php. Убедитесь, что в начале файла подставлен ваш ключ.</p>
          <p className="font-medium">Шаг 2. Закачайте файл в корень сайта</p>
          <p>Зайдите в панель Beget - раздел «Файловый менеджер» - откройте папку сайта (например seo-modul.pro/public_html) - нажмите «Загрузить» и выберите ai-monitor.php. Альтернатива: любой FTP-клиент (FileZilla), доступы для FTP - в разделе «FTP» панели Beget.</p>
          <p className="font-medium">Шаг 3. Подключите файл первой строкой</p>
          <p>В том же файловом менеджере откройте index.php в корне сайта на редактирование и самой первой строкой (после открывающего &lt;?php) добавьте:</p>
          <pre className="rounded bg-muted p-2 text-xs">require_once __DIR__ . '/ai-monitor.php';</pre>
          <p>Сохраните файл. Если сайт на WordPress - вместо index.php ту же строку можно добавить первой строкой в wp-config.php.</p>
          <p className="font-medium">Шаг 4. Проверьте</p>
          <p>Откройте любую страницу сайта в браузере - через пару минут у сайта появится статус «Данные поступают», а на вкладках «ИИ-боты» и «Журнал событий» - первые записи.</p>
          <p className="text-muted-foreground">Если сайт на VPS (nginx/apache) без PHP - используйте вариант со скриптом чтения access.log из окна «Ключ»; он отправляет обращения ботов раз в 5 минут, нужен SSH-доступ и путь к логу.</p>
        </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Выгрузка для аналитики</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>Кнопка ниже скачивает CSV за выбранный сверху период, сайт и фильтры - до 20 000 событий. Открывается в Excel, Google Таблицах и любой аналитике (Power BI, DataLens).</p>
          <p className="text-muted-foreground">Колонки: время, тип (бот / переход), бот или источник, категория, URL, HTTP-статус, User-Agent, Referer, способ определения.</p>
          <p className="text-muted-foreground">Для сводной аналитики без сырых событий используйте карточки и таблицы на вкладках «ИИ-боты» и «Переходы из ИИ-чатов» - их можно скопировать в отчет клиенту.</p>
          <Button onClick={run} disabled={busy}><Download className="mr-2 h-4 w-4" />{busy ? "Собираю..." : "Скачать CSV"}</Button>
        </CardContent></Card>
    </div>
  );
}

function Empty({ cols }: { cols: number }) {
  return <TableRow><TableCell colSpan={cols} className="text-center text-muted-foreground">Нет данных за выбранный период</TableCell></TableRow>;
}

function DailyChart({ data, k, title }: { data: Stats["daily"]; k: "bot" | "referral"; title: string }) {
  return (
    <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="h-56">
      {data.length === 0 ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Нет данных</div> : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
            <Line type="monotone" dataKey={k} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>)}
    </CardContent></Card>
  );
}

function SitesTab({ sites, reload }: { sites: Site[]; reload: () => void }) {
  const [n, setN] = useState(""); const [d, setD] = useState("");
  const [issued, setIssued] = useState<{ site: Site; key: string } | null>(null);

  const add = async () => {
    const domain = d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
    if (!n.trim() || !/^[a-z0-9.-]+\.[a-zа-я0-9-]+$/i.test(domain)) { toast({ title: "Укажите название и домен" }); return; }
    const { error } = await supabase.from("monitor_sites").insert({ name: n.trim(), domain });
    if (error) toast({ title: "Ошибка", description: error.message, variant: "destructive" }); else { setN(""); setD(""); reload(); }
  };
  const issue = async (s: Site) => {
    const { data, error } = await supabase.functions.invoke("monitor-admin", { body: { action: "create_key", site_id: s.id } });
    if (error || !data?.key) { toast({ title: "Не удалось выдать ключ", variant: "destructive" }); return; }
    setIssued({ site: s, key: data.key }); reload();
  };
  const del = async (s: Site) => {
    if (!confirm(`Удалить сайт ${s.domain} и все его события?`)) return;
    await supabase.from("monitor_sites").delete().eq("id", s.id); reload();
  };

  return (
    <div className="space-y-4">
      <Card><CardHeader><CardTitle className="text-base">Добавить сайт клиента</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Input placeholder="Название" value={n} onChange={(e) => setN(e.target.value)} />
          <Input placeholder="домен, например rdr71.ru" value={d} onChange={(e) => setD(e.target.value)} />
          <Button onClick={add}><Plus className="mr-2 h-4 w-4" />Добавить</Button>
        </CardContent></Card>

      {issued && (
        <Card><CardHeader><CardTitle className="text-base">Ключ для {issued.site.domain} - показывается один раз</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Скопируйте сейчас: в базе хранится только отпечаток ключа. Прежний ключ сайта отозван.</p>
            <Input readOnly value={issued.key} onFocus={(e) => e.target.select()} />
            <p className="font-medium">Вариант 1. Хостинг с PHP (WordPress и др.)</p>
            <p className="text-muted-foreground">Сохранить как ai-monitor.php в корне сайта и подключить первой строкой index.php. Нужен доступ к файлам сайта (FTP или панель хостинга).</p>
            <Textarea readOnly rows={8} value={phpCollector(issued.key)} className="font-mono text-xs" />
            <p className="font-medium">Вариант 2. VPS с nginx/apache</p>
            <p className="text-muted-foreground">Скрипт читает access.log и раз в 5 минут отправляет обращения ботов. Нужен SSH-доступ к серверу клиента. Укажите в скрипте путь к логу и домен.</p>
            <Textarea readOnly rows={8} value={logShipper(issued.key)} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">Адрес приема: {INGEST_ENDPOINT}. Статус «Данные поступают» появится только после первой реальной отправки.</p>
            <Button variant="outline" size="sm" onClick={() => setIssued(null)}>Скрыть</Button>
          </CardContent></Card>
      )}

      <Card><CardContent className="overflow-x-auto p-4">
        <Table><TableHeader><TableRow><TableHead>Сайт</TableHead><TableHead>Статус</TableHead><TableHead>Источники</TableHead><TableHead>Последнее событие</TableHead><TableHead>Последняя проверка</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>{sites.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Сайтов пока нет</TableCell></TableRow> : sites.map((s) => (
            <TableRow key={s.id}>
              <TableCell><div>{s.name}</div><div className="text-xs text-muted-foreground">{s.domain}</div></TableCell>
              <TableCell><Badge variant={STATUS[s.status]?.v ?? "outline"}>{STATUS[s.status]?.label ?? s.status}</Badge></TableCell>
              <TableCell className="text-xs space-y-2"><div>PHP-сборщик, access-логи VPS</div><div>Яндекс Метрика</div><MetrikaCounterSelect siteId={s.id} value={s.metrika_counter_id} onSaved={reload} /></TableCell>
              <TableCell>{fmt(s.last_event_at)}</TableCell>
              <TableCell>{fmt(s.last_verified_at)}</TableCell>
              <TableCell className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => issue(s)}><KeyRound className="mr-1 h-4 w-4" />Ключ</Button>
                <Button size="sm" variant="ghost" onClick={() => del(s)}><Trash2 className="h-4 w-4" /></Button>
              </TableCell>
            </TableRow>))}
          </TableBody></Table>
      </CardContent></Card>
    </div>
  );
}

function DictTab() {
  const [bots, setBots] = useState<any[]>([]); const [srcs, setSrcs] = useState<any[]>([]);
  const [b, setB] = useState({ name: "", ua_pattern: "", category: "ai_crawler" });
  const [s, setS] = useState({ name: "", referrer_pattern: "", utm_pattern: "" });
  const load = async () => {
    const [x, y] = await Promise.all([
      supabase.from("monitor_bot_signatures").select("*").order("priority"),
      supabase.from("monitor_ai_sources").select("*").order("name"),
    ]);
    setBots(x.data ?? []); setSrcs(y.data ?? []);
  };
  useEffect(() => { load(); }, []);
  const addBot = async () => {
    if (!b.name || !b.ua_pattern) return;
    const { error } = await supabase.from("monitor_bot_signatures").insert({ ...b, ua_pattern: b.ua_pattern.toLowerCase() });
    if (error) toast({ title: error.message, variant: "destructive" }); else { setB({ name: "", ua_pattern: "", category: "ai_crawler" }); load(); }
  };
  const addSrc = async () => {
    if (!s.name || !s.referrer_pattern) return;
    const { error } = await supabase.from("monitor_ai_sources").insert({ ...s, referrer_pattern: s.referrer_pattern.toLowerCase(), utm_pattern: s.utm_pattern || null });
    if (error) toast({ title: error.message, variant: "destructive" }); else { setS({ name: "", referrer_pattern: "", utm_pattern: "" }); load(); }
  };
  const toggle = async (t: "monitor_bot_signatures" | "monitor_ai_sources", id: string, v: boolean) => { await supabase.from(t).update({ is_active: v }).eq("id", id); load(); };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">Боты (признак в User-Agent)</CardTitle></CardHeader><CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input placeholder="Название" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} />
          <Input placeholder="признак UA" value={b.ua_pattern} onChange={(e) => setB({ ...b, ua_pattern: e.target.value })} />
          <Select value={b.category} onValueChange={(v) => setB({ ...b, category: v })}><SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(CAT).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
          <Button onClick={addBot}><Plus className="h-4 w-4" /></Button>
        </div>
        <p className="text-xs text-muted-foreground">PHP-сборщик и скрипт логов отбирают ботов по своему списку; новых ботов добавьте также в сборщик при переустановке.</p>
        <Table><TableBody>{bots.map((x) => (
          <TableRow key={x.id} className={x.is_active ? "" : "opacity-50"}><TableCell>{x.name}</TableCell><TableCell className="font-mono text-xs">{x.ua_pattern}</TableCell><TableCell>{CAT[x.category]}</TableCell>
            <TableCell><Button size="sm" variant="ghost" onClick={() => toggle("monitor_bot_signatures", x.id, !x.is_active)}>{x.is_active ? "Выкл" : "Вкл"}</Button></TableCell></TableRow>))}
        </TableBody></Table>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">ИИ-источники переходов</CardTitle></CardHeader><CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input placeholder="Название" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
          <Input placeholder="домен Referer" value={s.referrer_pattern} onChange={(e) => setS({ ...s, referrer_pattern: e.target.value })} />
          <Input placeholder="utm_source" value={s.utm_pattern} onChange={(e) => setS({ ...s, utm_pattern: e.target.value })} />
          <Button onClick={addSrc}><Plus className="h-4 w-4" /></Button>
        </div>
        <Table><TableBody>{srcs.map((x) => (
          <TableRow key={x.id} className={x.is_active ? "" : "opacity-50"}><TableCell>{x.name}</TableCell><TableCell className="font-mono text-xs">{x.referrer_pattern}</TableCell><TableCell className="font-mono text-xs">{x.utm_pattern ?? "-"}</TableCell>
            <TableCell><Button size="sm" variant="ghost" onClick={() => toggle("monitor_ai_sources", x.id, !x.is_active)}>{x.is_active ? "Выкл" : "Вкл"}</Button></TableCell></TableRow>))}
        </TableBody></Table>
      </CardContent></Card>
    </div>
  );
}
