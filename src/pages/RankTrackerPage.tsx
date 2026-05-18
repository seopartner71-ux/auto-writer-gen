import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, RefreshCw, Trash2, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { toast } from "sonner";
import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip } from "recharts";
import { Textarea } from "@/components/ui/textarea";

interface Tracked {
  id: string;
  keyword: string;
  target_domain: string;
  engine: "google" | "yandex";
  region: string;
  city: string | null;
  last_checked_at: string | null;
  last_position: number | null;
  last_url: string | null;
  article_id?: string | null;
  project_id?: string | null;
}

interface HistoryPoint {
  tracked_keyword_id: string;
  position: number | null;
  checked_at: string;
}

interface ArticleOption {
  id: string;
  title: string | null;
  published_url: string | null;
  telegraph_url: string | null;
  blogger_post_url: string | null;
  created_at: string;
}

interface SerpOutcome {
  article_id: string;
  title: string | null;
  public_url: string | null;
  article_created_at: string;
  tracked_keywords_count: number;
  best_position: number | null;
  latest_position: number | null;
  last_checked_at: string | null;
  first_top10_at: string | null;
  first_top3_at: string | null;
}

function posColor(pos: number | null): string {
  if (pos == null) return "text-muted-foreground";
  if (pos <= 3) return "text-emerald-500";
  if (pos <= 10) return "text-yellow-500";
  if (pos <= 30) return "text-orange-500";
  return "text-rose-500";
}

function daysBetween(from: string, to: string | null): number | null {
  if (!to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.max(1, Math.round(ms / 86400000));
}

export default function RankTrackerPage() {
  const { user, role } = useAuth();
  const isAdmin = role === "admin";
  const { lang } = useI18n();
  const isRu = lang === "ru";
  const qc = useQueryClient();

  const [kw, setKw] = useState("");
  const [domain, setDomain] = useState("");
  const [engine, setEngine] = useState<"google" | "yandex" | "both">("both");
  const [region, setRegion] = useState("ru");
  const [city, setCity] = useState("");
  const [articleId, setArticleId] = useState<string>("");
  const [viewUserId, setViewUserId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [filterProjectId, setFilterProjectId] = useState<string>("");

  const effectiveUserId = isAdmin && viewUserId ? viewUserId : user?.id ?? "";
  const isImpersonating = isAdmin && !!viewUserId && viewUserId !== user?.id;

  const { data: allUsers = [] } = useQuery({
    queryKey: ["rank-tracker-all-users"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,email,full_name")
        .order("email", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; email: string | null; full_name: string | null }>;
    },
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["rank-tracker-projects", effectiveUserId],
    enabled: !!effectiveUserId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,name,domain,custom_domain")
        .eq("user_id", effectiveUserId)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; domain: string | null; custom_domain: string | null }>;
    },
  });

  const { data: tracked = [], isLoading } = useQuery({
    queryKey: ["tracked-keywords", effectiveUserId],
    enabled: !!effectiveUserId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracked_keywords")
        .select("*")
        .eq("user_id", effectiveUserId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Tracked[];
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["rank-history", effectiveUserId],
    enabled: !!effectiveUserId && tracked.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rank_history")
        .select("tracked_keyword_id,position,checked_at")
        .eq("user_id", effectiveUserId)
        .order("checked_at", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as HistoryPoint[];
    },
  });

  // Published articles to attach a tracked keyword to.
  const { data: articles = [] } = useQuery({
    queryKey: ["rank-tracker-articles", effectiveUserId],
    enabled: !!effectiveUserId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("id,title,published_url,telegraph_url,blogger_post_url,created_at")
        .eq("user_id", effectiveUserId)
        .or("published_url.not.is.null,telegraph_url.not.is.null,blogger_post_url.not.is.null")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ArticleOption[];
    },
  });

  // Per-article SERP outcomes view.
  const { data: outcomes = [] } = useQuery({
    queryKey: ["serp-outcomes", effectiveUserId],
    enabled: !!effectiveUserId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("article_serp_outcomes" as never)
        .select("*")
        .eq("user_id", effectiveUserId)
        .order("article_created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SerpOutcome[];
    },
  });

  const addMut = useMutation({
    mutationFn: async () => {
      const cleanDomain = domain.trim().toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/.*$/, "")
        .replace(/[?#].*$/, "");
      const keywords = kw.split("\n").map(s => s.trim()).filter(Boolean);
      if (keywords.length === 0 || !cleanDomain) throw new Error(isRu ? "Заполните ключи и домен" : "Fill keywords and domain");
      const engines: Array<"google" | "yandex"> = engine === "both" ? ["google", "yandex"] : [engine];
      const rows = keywords.flatMap(k => engines.map(eng => ({
        user_id: user!.id,
        keyword: k,
        target_domain: cleanDomain,
        engine: eng,
        region: region.trim().toLowerCase() || "ru",
        city: city.trim() || null,
        article_id: articleId || null,
        project_id: projectId || null,
      })));
      const { data, error } = await supabase
        .from("tracked_keywords")
        .upsert(rows, { onConflict: "user_id,keyword,target_domain,engine,region,city", ignoreDuplicates: true })
        .select("id");
      if (error) throw error;
      const inserted = data?.length ?? 0;
      return { inserted, skipped: rows.length - inserted };
    },
    onSuccess: ({ inserted, skipped }: { inserted: number; skipped: number }) => {
      setKw(""); setCity(""); setArticleId("");
      const msg = isRu
        ? `Добавлено: ${inserted}${skipped > 0 ? `, пропущено дублей: ${skipped}` : ""}`
        : `Added: ${inserted}${skipped > 0 ? `, duplicates skipped: ${skipped}` : ""}`;
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ["tracked-keywords"] });
      qc.invalidateQueries({ queryKey: ["serp-outcomes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tracked_keywords").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracked-keywords"] });
      qc.invalidateQueries({ queryKey: ["rank-history"] });
      qc.invalidateQueries({ queryKey: ["serp-outcomes"] });
    },
  });

  const refreshMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("rank-tracker-run", { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d: { processed?: number; missing?: { serper: boolean; yandex: boolean } }) => {
      toast.success(isRu ? `Проверено: ${d.processed ?? 0}` : `Checked: ${d.processed ?? 0}`);
      if (d.missing?.serper) toast.warning(isRu ? "Не настроен Serper ключ - Google недоступен" : "Serper key missing - Google disabled");
      if (d.missing?.yandex) toast.warning(isRu ? "Не настроены Yandex XML ключи" : "Yandex XML credentials missing");
      qc.invalidateQueries({ queryKey: ["tracked-keywords"] });
      qc.invalidateQueries({ queryKey: ["rank-history"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filteredTracked = filterProjectId
    ? tracked.filter(t => t.project_id === filterProjectId)
    : tracked;

  const historyByKw = history.reduce<Record<string, HistoryPoint[]>>((acc, p) => {
    (acc[p.tracked_keyword_id] ||= []).push(p);
    return acc;
  }, {});

  const trendFor = (id: string): { delta: number | null } => {
    const arr = historyByKw[id] ?? [];
    if (arr.length < 2) return { delta: null };
    const last = arr[arr.length - 1].position;
    const prev = arr[arr.length - 2].position;
    if (last == null || prev == null) return { delta: null };
    return { delta: prev - last };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRu ? "Трекер позиций" : "Rank Tracker"}</h1>
          <p className="text-sm text-muted-foreground">{isRu ? "Ежедневный мониторинг позиций в Google и Яндекс" : "Daily Google and Yandex position monitoring"}</p>
        </div>
        <Button onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending || tracked.length === 0 || isImpersonating}>
          {refreshMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          {isRu ? "Проверить сейчас" : "Check now"}
        </Button>
      </div>

      {isAdmin && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wide text-primary">Admin</span>
              <span className="text-sm text-muted-foreground">
                {isRu ? "Просмотр трекера от имени пользователя:" : "View rank tracker as user:"}
              </span>
              <div className="min-w-[280px] flex-1 max-w-md">
                <Select value={viewUserId || "__self__"} onValueChange={(v) => setViewUserId(v === "__self__" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__self__">{isRu ? "Я (мои данные)" : "Me (my data)"}</SelectItem>
                    {allUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.email || u.full_name || u.id.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isImpersonating && (
                <Badge variant="outline" className="border-yellow-500/50 text-yellow-500">
                  {isRu ? "Режим просмотра (read-only)" : "View-only mode"}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isRu ? "Добавить ключ" : "Add keyword"}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-6">
            <div className="md:col-span-6">
              <Select value={projectId || "__none__"} onValueChange={(v) => {
                if (v === "__none__") { setProjectId(""); return; }
                setProjectId(v);
                const p = projects.find(x => x.id === v);
                if (p) setDomain(p.custom_domain || p.domain || "");
              }}>
                <SelectTrigger>
                  <SelectValue placeholder={isRu ? "Проект (сайт) — опционально" : "Project (site) — optional"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{isRu ? "Без проекта" : "No project"}</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} {p.custom_domain || p.domain ? `— ${p.custom_domain || p.domain}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              className="md:col-span-4 min-h-[90px]"
              placeholder={isRu ? "Ключевые запросы (по одному на строку)" : "Keywords (one per line)"}
              value={kw}
              onChange={e => setKw(e.target.value)}
            />
            <Input className="md:col-span-2" placeholder="example.com" value={domain} onChange={e => setDomain(e.target.value)} />
            <Select value={engine} onValueChange={(v) => setEngine(v as "google" | "yandex" | "both")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="both">{isRu ? "Google + Yandex" : "Google + Yandex"}</SelectItem>
                <SelectItem value="google">Google</SelectItem>
                <SelectItem value="yandex">Yandex</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder={engine === "yandex" ? "lr (213)" : "ru"} value={region} onChange={e => setRegion(e.target.value)} />
            <Input className="md:col-span-5" placeholder={isRu ? "Город (опционально, только Google)" : "City (optional, Google only)"} value={city} onChange={e => setCity(e.target.value)} />
            <Button onClick={() => addMut.mutate()} disabled={addMut.isPending || isImpersonating}>
              {addMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-2" />{isRu ? "Добавить" : "Add"}</>}
            </Button>
            <div className="md:col-span-6">
              <Select value={articleId || "__none__"} onValueChange={(v) => setArticleId(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={isRu ? "Привязать к статье (опционально)" : "Attach to article (optional)"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{isRu ? "Без привязки" : "Not attached"}</SelectItem>
                  {articles.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {(a.title || "—").slice(0, 80)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {isRu
                  ? "Привязка покажет реальный SEO-итог: дни до ТОП-10/ТОП-3 после публикации."
                  : "Attaching reveals real SEO outcome: days-to-TOP-10/TOP-3 after publish."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {outcomes.length > 0 && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              {isRu ? "Результаты статей в SERP" : "Article SERP outcomes"}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {isRu
                ? "Реальный ROI: за сколько дней статья вышла в ТОП-10 и ТОП-3 после публикации."
                : "Real ROI: days from publish to TOP-10 and TOP-3."}
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-border">
                  <tr className="[&_th]:p-2 [&_th]:text-left">
                    <th>{isRu ? "Статья" : "Article"}</th>
                    <th>{isRu ? "Ключи" : "Keys"}</th>
                    <th>{isRu ? "Лучшая" : "Best"}</th>
                    <th>{isRu ? "Сейчас" : "Latest"}</th>
                    <th>{isRu ? "До ТОП-10" : "To TOP-10"}</th>
                    <th>{isRu ? "До ТОП-3" : "To TOP-3"}</th>
                    <th>{isRu ? "Возраст" : "Age"}</th>
                  </tr>
                </thead>
                <tbody className="[&_td]:p-2 [&_tr]:border-b [&_tr]:border-border/40">
                  {outcomes.map((o) => {
                    const ageDays = daysBetween(o.article_created_at, new Date().toISOString());
                    const top10Days = daysBetween(o.article_created_at, o.first_top10_at);
                    const top3Days = daysBetween(o.article_created_at, o.first_top3_at);
                    return (
                      <tr key={o.article_id}>
                        <td className="max-w-[280px]">
                          {o.public_url ? (
                            <a href={o.public_url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline truncate block">
                              {o.title || o.public_url}
                            </a>
                          ) : (
                            <span className="font-medium">{o.title || "—"}</span>
                          )}
                        </td>
                        <td className="text-muted-foreground">{o.tracked_keywords_count}</td>
                        <td className={`font-bold ${posColor(o.best_position == null ? null : Number(o.best_position))}`}>
                          {o.best_position == null ? "—" : `#${o.best_position}`}
                        </td>
                        <td className={`font-bold ${posColor(o.latest_position == null ? null : Number(o.latest_position))}`}>
                          {o.latest_position == null ? "—" : `#${o.latest_position}`}
                        </td>
                        <td>
                          {top10Days == null
                            ? <span className="text-xs text-muted-foreground">{isRu ? "не достигнут" : "not reached"}</span>
                            : <Badge variant="outline" className="border-yellow-500/50 text-yellow-500">{top10Days} {isRu ? "дн" : "d"}</Badge>}
                        </td>
                        <td>
                          {top3Days == null
                            ? <span className="text-xs text-muted-foreground">{isRu ? "не достигнут" : "not reached"}</span>
                            : <Badge variant="outline" className="border-emerald-500/50 text-emerald-500">{top3Days} {isRu ? "дн" : "d"}</Badge>}
                        </td>
                        <td className="text-xs text-muted-foreground">{ageDays ?? "—"} {isRu ? "дн" : "d"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base">{isRu ? "Отслеживаемые ключи" : "Tracked keywords"}</CardTitle>
            {projects.length > 0 && (
              <div className="min-w-[240px]">
                <Select value={filterProjectId || "__all__"} onValueChange={(v) => setFilterProjectId(v === "__all__" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{isRu ? "Все проекты" : "All projects"}</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : filteredTracked.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{isRu ? "Пока нет отслеживаемых ключей" : "No tracked keywords yet"}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-border">
                  <tr className="[&_th]:p-2 [&_th]:text-left">
                    <th>{isRu ? "Запрос" : "Keyword"}</th>
                    <th>{isRu ? "Домен" : "Domain"}</th>
                    <th>{isRu ? "Поисковик" : "Engine"}</th>
                    <th>{isRu ? "Позиция" : "Position"}</th>
                    <th>{isRu ? "Страница в ТОП" : "Ranking page"}</th>
                    <th>{isRu ? "Тренд" : "Trend"}</th>
                    <th>{isRu ? "История (30 дн)" : "History (30d)"}</th>
                    <th>{isRu ? "Проверено" : "Checked"}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="[&_td]:p-2 [&_tr]:border-b [&_tr]:border-border/40">
                  {filteredTracked.map((row) => {
                    const trend = trendFor(row.id);
                    const sparkData = (historyByKw[row.id] ?? []).slice(-30).map(p => ({
                      d: new Date(p.checked_at).toLocaleDateString("ru", { day: "2-digit", month: "2-digit" }),
                      pos: p.position ?? 101,
                    }));
                    return (
                      <tr key={row.id}>
                        <td className="font-medium">{row.keyword}</td>
                        <td className="text-muted-foreground">{row.target_domain}</td>
                        <td><Badge variant="outline" className="uppercase text-[10px]">{row.engine}</Badge></td>
                        <td className={`font-bold ${posColor(row.last_position)}`}>
                          {row.last_position == null ? "—" : `#${row.last_position}`}
                        </td>
                        <td className="max-w-[240px]">
                          {row.last_url ? (
                            <a href={row.last_url} target="_blank" rel="noopener noreferrer"
                               className="text-xs text-primary hover:underline truncate block"
                               title={row.last_url}>
                              {row.last_url.replace(/^https?:\/\//, "").slice(0, 50)}
                            </a>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td>
                          {trend.delta == null ? <Minus className="h-4 w-4 text-muted-foreground" />
                            : trend.delta > 0 ? <span className="text-emerald-500 flex items-center gap-1 text-xs"><TrendingUp className="h-3 w-3" />+{trend.delta}</span>
                            : trend.delta < 0 ? <span className="text-rose-500 flex items-center gap-1 text-xs"><TrendingDown className="h-3 w-3" />{trend.delta}</span>
                            : <Minus className="h-4 w-4 text-muted-foreground" />}
                        </td>
                        <td className="w-32 h-10">
                          {sparkData.length > 1 ? (
                            <ResponsiveContainer width="100%" height={36}>
                              <LineChart data={sparkData}>
                                <YAxis reversed domain={[1, 100]} hide />
                                <XAxis dataKey="d" hide />
                                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }} formatter={(v: number) => v === 101 ? "—" : `#${v}`} />
                                <Line type="monotone" dataKey="pos" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="text-xs text-muted-foreground">
                          {row.last_checked_at ? new Date(row.last_checked_at).toLocaleDateString("ru") : "—"}
                        </td>
                        <td>
                          <Button size="icon" variant="ghost" onClick={() => delMut.mutate(row.id)} disabled={isImpersonating}>
                            <Trash2 className="h-4 w-4 text-rose-500" />
                          </Button>
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
  );
}