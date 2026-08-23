import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/shared/hooks/useI18n";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity, AlertTriangle, Bell, Building2, ExternalLink, Loader2, Radar,
  RefreshCw, Rocket, TrendingDown, TrendingUp, Users,
} from "lucide-react";

type Row = Record<string, any>;

const scoreColor = (v: number) =>
  v >= 70 ? "text-emerald-500" : v >= 30 ? "text-amber-500" : "text-destructive";

async function call(action: string, payload: Row = {}): Promise<Row> {
  const { data, error } = await supabase.functions.invoke("network-radar", {
    body: { action, ...payload },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as Row;
}

export default function NetworkRadarPage() {
  const { lang } = useI18n();
  const ru = lang === "ru";
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [stats, setStats] = useState<Row>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>("all");
  const [points, setPoints] = useState<Row[]>([]);
  const [queries, setQueries] = useState<Row[]>([]);
  const [queryInput, setQueryInput] = useState("");
  const [alerts, setAlerts] = useState<Row[]>([]);
  const [settings, setSettings] = useState<Row>({ primary_color: "#6E56CF", accent_color: "#0A0A0A", geo_drop_threshold: 5, alerts: {} });
  const [clients, setClients] = useState<Row[]>([]);
  const [clientEmail, setClientEmail] = useState("");
  const [clientProject, setClientProject] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [p, g, q, a, s, c] = await Promise.all([
        call("portfolio"), call("geo_timeline"), call("queries_list"),
        call("alerts_list"), call("settings_get"), call("clients_list"),
      ]);
      setStats(p.stats || {});
      setRows(p.rows || []);
      setPoints(g.points || []);
      setQueries(q.queries || []);
      setAlerts(a.alerts || []);
      if (s.settings) setSettings(s.settings);
      setClients(c.clients || []);
    } catch (e: any) {
      toast({ title: ru ? "Ошибка загрузки сети" : "Network load failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [ru, toast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (filter === "geo_drop") return r.flags?.geo_drop;
    if (filter === "needs_qa") return r.flags?.needs_qa;
    if (filter === "new_release") return r.flags?.new_release;
    if (filter === "index_errors") return r.flags?.index_errors;
    return true;
  }), [rows, filter]);

  const toggle = (id: string) => setSelected((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const runBulk = async (op: string) => {
    if (!selected.size) return;
    setBusy(op);
    try {
      const res = await call("bulk", { op, project_ids: Array.from(selected) });
      const ok = (res.results || []).filter((r: Row) => r.ok).length;
      toast({ title: ru ? "Задачи поставлены" : "Tasks queued", description: `${ok}/${(res.results || []).length}` });
      loadAll();
    } catch (e: any) {
      toast({ title: ru ? "Ошибка" : "Failed", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const runRadar = async () => {
    const ids = selected.size ? Array.from(selected) : rows.map((r) => r.id).slice(0, 10);
    if (!ids.length) return;
    setBusy("radar");
    try {
      const res = await call("radar_run", { project_ids: ids });
      const ins = (res.results || []).reduce((a: number, r: Row) => a + (r.inserted || 0), 0);
      toast({ title: ru ? "Радар отработал" : "Radar finished", description: ru ? `Проверок: ${ins}` : `Checks: ${ins}` });
      loadAll();
    } catch (e: any) {
      toast({ title: ru ? "Ошибка радара" : "Radar failed", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const saveQueries = async () => {
    const list = queryInput.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    setBusy("queries");
    try {
      const res = await call("queries_save", { queries: list });
      setQueries(res.queries || []);
      setQueryInput("");
    } catch (e: any) {
      toast({ title: ru ? "Ошибка" : "Failed", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const scanAlerts = async () => {
    setBusy("alerts");
    try {
      const res = await call("alerts_scan");
      toast({ title: ru ? "Проверка завершена" : "Scan finished", description: ru ? `Новых оповещений: ${res.created}` : `New alerts: ${res.created}` });
      const a = await call("alerts_list");
      setAlerts(a.alerts || []);
    } catch (e: any) {
      toast({ title: ru ? "Ошибка" : "Failed", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const saveSettings = async () => {
    setBusy("settings");
    try {
      await call("settings_save", settings);
      toast({ title: ru ? "Настройки сохранены" : "Settings saved" });
    } catch (e: any) {
      toast({ title: ru ? "Ошибка" : "Failed", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const grantClient = async () => {
    if (!clientEmail || !clientProject) return;
    setBusy("client");
    try {
      await call("client_grant", { email: clientEmail, project_id: clientProject });
      setClientEmail("");
      const c = await call("clients_list");
      setClients(c.clients || []);
      toast({ title: ru ? "Доступ выдан" : "Access granted" });
    } catch (e: any) {
      toast({ title: ru ? "Ошибка" : "Failed", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const maxGeo = Math.max(100, ...points.map((p) => Number(p.geo || 0)));

  const kpi = [
    { label: ru ? "Всего сайтов" : "Total sites", value: stats.total ?? 0 },
    { label: ru ? "Опубликовано" : "Published", value: stats.published ?? 0 },
    { label: ru ? "В работе" : "In progress", value: stats.in_progress ?? 0 },
    { label: "GEO Visibility", value: stats.geo ?? 0, colored: true },
    { label: ru ? "Средний SEO" : "Average SEO", value: stats.seo ?? 0, colored: true },
    { label: ru ? "Индексируемых URL" : "Indexable URLs", value: (stats.indexed_urls ?? 0).toLocaleString("ru-RU") },
  ];

  return (
    <div className="app-shell p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Radar className="h-6 w-6 text-primary" />
            AI Radar - {ru ? "сеть сайтов" : "site network"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {ru
              ? "Портфель всех проектов: SEO, GEO-видимость в LLM, релизы и массовые операции."
              : "Portfolio of every project: SEO, GEO visibility in LLMs, releases and bulk operations."}
          </p>
        </div>
        <Button variant="outline" onClick={loadAll} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {ru ? "Обновить" : "Refresh"}
        </Button>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpi.map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className={`text-2xl font-semibold mt-1 ${k.colored ? scoreColor(Number(k.value)) : ""}`}>
                {k.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="portfolio">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="portfolio" className="gap-1"><Activity className="h-3.5 w-3.5" />{ru ? "Портфель" : "Portfolio"}</TabsTrigger>
          <TabsTrigger value="radar" className="gap-1"><Radar className="h-3.5 w-3.5" />AI Radar</TabsTrigger>
          <TabsTrigger value="geo" className="gap-1"><TrendingUp className="h-3.5 w-3.5" />GEO Monitor</TabsTrigger>
          <TabsTrigger value="alerts" className="gap-1"><Bell className="h-3.5 w-3.5" />{ru ? "Оповещения" : "Alerts"}</TabsTrigger>
          <TabsTrigger value="brand" className="gap-1"><Building2 className="h-3.5 w-3.5" />White Label</TabsTrigger>
          <TabsTrigger value="clients" className="gap-1"><Users className="h-3.5 w-3.5" />{ru ? "Клиенты" : "Clients"}</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------- portfolio -- */}
        <TabsContent value="portfolio" className="space-y-4 mt-4">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { k: "all", l: ru ? "Все" : "All" },
              { k: "geo_drop", l: ru ? "Просадка GEO" : "GEO drop" },
              { k: "needs_qa", l: ru ? "Требуется QA" : "Needs QA" },
              { k: "new_release", l: ru ? "Новый релиз" : "New release" },
              { k: "index_errors", l: ru ? "Ошибки индексации" : "Index errors" },
            ].map((f) => (
              <Button key={f.k} size="sm" variant={filter === f.k ? "default" : "outline"} onClick={() => setFilter(f.k)}>
                {f.l}
              </Button>
            ))}
            <div className="ml-auto flex flex-wrap gap-2">
              {[
                { op: "seo", l: ru ? "Обновить SEO" : "Update SEO" },
                { op: "qa", l: ru ? "Пересчитать QA" : "Recheck QA" },
                { op: "articles", l: ru ? "Сгенерировать статьи" : "Generate articles" },
                { op: "deploy", l: ru ? "Деплой" : "Deploy" },
                { op: "zip", l: "ZIP" },
              ].map((b) => (
                <Button key={b.op} size="sm" variant="outline" disabled={!selected.size || !!busy} onClick={() => runBulk(b.op)}>
                  {busy === b.op ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                  {b.l}
                </Button>
              ))}
            </div>
          </div>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 w-8"></th>
                    <th className="text-left px-3 py-2 font-medium">{ru ? "Проект" : "Project"}</th>
                    <th className="text-left px-3 py-2 font-medium">SEO</th>
                    <th className="text-left px-3 py-2 font-medium">GEO</th>
                    <th className="text-left px-3 py-2 font-medium">Pages</th>
                    <th className="text-left px-3 py-2 font-medium">{ru ? "Индекс" : "Indexable"}</th>
                    <th className="text-left px-3 py-2 font-medium">Release</th>
                    <th className="text-left px-3 py-2 font-medium">{ru ? "Флаги" : "Flags"}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="p-6 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">{ru ? "Нет проектов" : "No projects"}</td></tr>
                  ) : filtered.map((r) => (
                    <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                      </td>
                      <td className="px-3 py-2 font-medium">
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" />{r.name}
                          </a>
                        ) : r.name}
                      </td>
                      <td className={`px-3 py-2 font-semibold ${scoreColor(r.seo)}`}>{r.seo || "-"}</td>
                      <td className={`px-3 py-2 font-semibold ${scoreColor(r.geo)}`}>
                        <span className="inline-flex items-center gap-1">
                          {r.geo || "-"}
                          {r.geo_delta ? (
                            r.geo_delta > 0
                              ? <TrendingUp className="h-3 w-3 text-emerald-500" />
                              : <TrendingDown className="h-3 w-3 text-destructive" />
                          ) : null}
                        </span>
                      </td>
                      <td className="px-3 py-2">{(r.pages || 0).toLocaleString("ru-RU")}</td>
                      <td className="px-3 py-2">{(r.indexed_urls || 0).toLocaleString("ru-RU")}</td>
                      <td className="px-3 py-2">{r.release || "-"}</td>
                      <td className="px-3 py-2 space-x-1">
                        {r.flags?.geo_drop && <Badge variant="destructive" className="text-[10px]">GEO</Badge>}
                        {r.flags?.needs_qa && <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-500">QA</Badge>}
                        {r.flags?.new_release && <Badge variant="outline" className="text-[10px]">new</Badge>}
                        {r.flags?.index_errors && <Badge variant="destructive" className="text-[10px]">index</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----------------------------------------------------------- radar -- */}
        <TabsContent value="radar" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{ru ? "Запросы радара" : "Radar queries"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                rows={4}
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder={ru ? "DIN 931\nзаклепки\nболты ГОСТ" : "one query per line"}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={saveQueries} disabled={busy === "queries"}>
                  {ru ? "Сохранить запросы" : "Save queries"}
                </Button>
                <Button size="sm" variant="outline" onClick={runRadar} disabled={!!busy} className="gap-2">
                  {busy === "radar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                  {ru ? "Проверить в ChatGPT / Gemini / Claude" : "Check in ChatGPT / Gemini / Claude"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {queries.map((q) => (
                  <Badge key={q.id} variant="outline" className="gap-2">
                    {q.query}
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      onClick={async () => { await call("queries_delete", { id: q.id }); setQueries((p) => p.filter((x) => x.id !== q.id)); }}
                    >x</button>
                  </Badge>
                ))}
                {!queries.length && <span className="text-xs text-muted-foreground">{ru ? "Запросов пока нет" : "No queries yet"}</span>}
              </div>
              <p className="text-xs text-muted-foreground">
                {ru
                  ? "Радар запускается по выбранным в портфеле проектам, история хранится и сравнивается по месяцам."
                  : "Radar runs for the projects selected in the portfolio, history is stored and compared monthly."}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------- geo -- */}
        <TabsContent value="geo" className="mt-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">GEO Monitor</CardTitle></CardHeader>
            <CardContent>
              {points.length === 0 ? (
                <p className="text-sm text-muted-foreground">{ru ? "Данных пока нет - запустите AI Radar." : "No data yet - run AI Radar."}</p>
              ) : (
                <div className="flex items-end gap-3 h-48">
                  {points.map((p) => (
                    <div key={p.month} className="flex-1 flex flex-col items-center gap-2">
                      <div className="text-xs font-medium">{p.geo}</div>
                      <div className="w-full bg-primary/70 rounded-t" style={{ height: `${(Number(p.geo) / maxGeo) * 100}%` }} />
                      <div className="text-[10px] text-muted-foreground">{p.month}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------- alerts -- */}
        <TabsContent value="alerts" className="space-y-3 mt-4">
          <div className="flex gap-2">
            <Button size="sm" onClick={scanAlerts} disabled={busy === "alerts"} className="gap-2">
              {busy === "alerts" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {ru ? "Проверить сеть" : "Scan network"}
            </Button>
            <Button size="sm" variant="outline" onClick={async () => { await call("alerts_read", {}); setAlerts((p) => p.map((a) => ({ ...a, is_read: true }))); }}>
              {ru ? "Отметить прочитанными" : "Mark all read"}
            </Button>
          </div>
          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ru ? "Оповещений нет." : "No alerts."}</p>
          ) : alerts.map((a) => (
            <Card key={a.id} className={a.is_read ? "opacity-60" : ""}>
              <CardContent className="p-3 flex items-start gap-3">
                <Badge variant={a.severity === "critical" ? "destructive" : "outline"} className="text-[10px] mt-0.5">
                  {a.alert_type}
                </Badge>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.message}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">{new Date(a.created_at).toLocaleString("ru-RU")}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ----------------------------------------------------- white label -- */}
        <TabsContent value="brand" className="mt-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">White Label</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{ru ? "Название агентства" : "Agency name"}</Label>
                <Input value={settings.agency_name || ""} onChange={(e) => setSettings({ ...settings, agency_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{ru ? "Логотип (URL)" : "Logo URL"}</Label>
                <Input value={settings.logo_url || ""} onChange={(e) => setSettings({ ...settings, logo_url: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{ru ? "Основной цвет" : "Primary color"}</Label>
                <Input value={settings.primary_color || ""} onChange={(e) => setSettings({ ...settings, primary_color: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{ru ? "Акцентный цвет" : "Accent color"}</Label>
                <Input value={settings.accent_color || ""} onChange={(e) => setSettings({ ...settings, accent_color: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Telegram chat ID</Label>
                <Input value={settings.telegram_chat_id || ""} onChange={(e) => setSettings({ ...settings, telegram_chat_id: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Email {ru ? "для оповещений" : "for alerts"}</Label>
                <Input value={settings.alert_email || ""} onChange={(e) => setSettings({ ...settings, alert_email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{ru ? "Порог падения GEO" : "GEO drop threshold"}</Label>
                <Input
                  type="number"
                  value={settings.geo_drop_threshold ?? 5}
                  onChange={(e) => setSettings({ ...settings, geo_drop_threshold: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                {[
                  { k: "geo_drop", l: ru ? "Падение GEO" : "GEO drop" },
                  { k: "qa_critical", l: "QA Critical" },
                  { k: "deploy_done", l: ru ? "Деплой завершен" : "Deploy finished" },
                ].map((o) => (
                  <div key={o.k} className="flex items-center justify-between">
                    <span className="text-sm">{o.l}</span>
                    <Switch
                      checked={settings.alerts?.[o.k] !== false}
                      onCheckedChange={(v) => setSettings({ ...settings, alerts: { ...(settings.alerts || {}), [o.k]: v } })}
                    />
                  </div>
                ))}
              </div>
              <div className="md:col-span-2">
                <Button onClick={saveSettings} disabled={busy === "settings"}>
                  {ru ? "Сохранить" : "Save"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --------------------------------------------------------- clients -- */}
        <TabsContent value="clients" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{ru ? "Клиентский кабинет" : "Client cabinet"}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 md:grid-cols-3">
                <Input placeholder="client@email.com" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} />
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={clientProject}
                  onChange={(e) => setClientProject(e.target.value)}
                >
                  <option value="">{ru ? "Выберите проект" : "Select project"}</option>
                  {rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <Button onClick={grantClient} disabled={busy === "client"}>{ru ? "Выдать доступ" : "Grant access"}</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {ru
                  ? "Клиент видит только Performance, статьи, релизы и отчеты по своим проектам - без доступа к Фабрике."
                  : "The client only sees performance, articles, releases and reports for their projects - no Factory access."}
              </p>
              <div className="space-y-2">
                {clients.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-sm border-t border-border pt-2">
                    <span>{c.profile?.email || c.client_user_id} - {rows.find((r) => r.id === c.project_id)?.name || c.project_id}</span>
                    <Button
                      size="sm" variant="ghost" className="text-destructive"
                      onClick={async () => { await call("client_revoke", { id: c.id }); setClients((p) => p.filter((x) => x.id !== c.id)); }}
                    >{ru ? "Отозвать" : "Revoke"}</Button>
                  </div>
                ))}
                {!clients.length && <span className="text-xs text-muted-foreground">{ru ? "Клиентов пока нет" : "No clients yet"}</span>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
