import { useMemo, useState } from "react";
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
  created_at?: string | null;
}

interface TrackedGroup {
  key: string;
  keyword: string;
  target_domain: string;
  region: string;
  city: string | null;
  rows: Tracked[];
  byEngine: Partial<Record<"google" | "yandex", Tracked>>;
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

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function buildSerpUrl(engine: "google" | "yandex", keyword: string, region: string, city: string | null): string {
  const q = encodeURIComponent([keyword, city].filter(Boolean).join(" "));
  if (engine === "google") {
    const gl = (region || "ru").toLowerCase();
    const hl = gl === "ru" ? "ru" : "en";
    return `https://www.google.com/search?q=${q}&num=30&hl=${hl}&gl=${gl}&pws=0`;
  }
  const lr = /^\d+$/.test((region || "").trim()) ? region.trim() : "";
  return `https://yandex.ru/search/?text=${q}${lr ? `&lr=${lr}` : ""}`;
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
  const [viewUserId, setViewUserId] = useState<string>("");
  const [domainFilter, setDomainFilter] = useState<string>("all");

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

  const addMut = useMutation({
    mutationFn: async () => {
      const currentUserId = user?.id;
      if (!currentUserId) throw new Error(isRu ? "Войдите в аккаунт" : "Sign in first");
      const cleanDomain = domain.trim().toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/.*$/, "")
        .replace(/[?#].*$/, "");
      const keywordMap = new Map<string, string>();
      kw.split("\n").map(s => s.trim()).filter(Boolean).forEach((item) => {
        const key = item.toLowerCase();
        if (!keywordMap.has(key)) keywordMap.set(key, item);
      });
      const keywords = Array.from(keywordMap.values());
      if (keywords.length === 0 || !cleanDomain) throw new Error(isRu ? "Заполните ключи и домен" : "Fill keywords and domain");
      const engines: Array<"google" | "yandex"> = engine === "both" ? ["google", "yandex"] : [engine];
      const cleanRegion = region.trim().toLowerCase() || "ru";
      const cleanCity = city.trim() || null;
      const rows = keywords.flatMap(k => engines.map(eng => ({
        user_id: currentUserId,
        keyword: k,
        target_domain: cleanDomain,
        engine: eng,
        region: cleanRegion,
        city: cleanCity,
      })));

      const { data, error } = await (supabase as any).rpc("add_tracked_keywords", { _rows: rows });
      if (error) {
        console.error("[rank-tracker] add failed", error);
        throw new Error(error.message || (isRu ? "Ошибка добавления" : "Insert failed"));
      }
      const result = Array.isArray(data) ? data[0] : data;
      const inserted = Number(result?.inserted ?? 0);
      const skipped = Number(result?.skipped ?? Math.max(rows.length - inserted, 0));
      return { inserted, skipped };
    },
    onSuccess: ({ inserted, skipped }: { inserted: number; skipped: number }) => {
      setKw(""); setCity("");
      const msg = isRu
        ? `Добавлено: ${inserted}${skipped > 0 ? `, пропущено дублей: ${skipped}` : ""}`
        : `Added: ${inserted}${skipped > 0 ? `, duplicates skipped: ${skipped}` : ""}`;
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ["tracked-keywords"] });
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, isRu ? "Не удалось добавить ключ" : "Could not add keyword")),
  });

  const delMut = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("tracked_keywords").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracked-keywords"] });
      qc.invalidateQueries({ queryKey: ["rank-history"] });
    },
  });

  const refreshMut = useMutation({
    mutationFn: async () => {
      const payload: { target_domain?: string } = {};
      if (domainFilter !== "all") payload.target_domain = domainFilter;
      const { data, error } = await supabase.functions.invoke("rank-tracker-run", { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d: { processed?: number; missing?: { serper: boolean; yandex: boolean } }) => {
      toast.success(isRu ? `Проверено: ${d.processed ?? 0}` : `Checked: ${d.processed ?? 0}`);
      if (d.missing?.serper) toast.warning(isRu ? "Не настроен Serper ключ - Google недоступен" : "Serper key missing - Google disabled");
      if (d.missing?.yandex) toast.warning(isRu ? "Не настроены Yandex Cloud ключи" : "Yandex Cloud credentials missing");
      qc.invalidateQueries({ queryKey: ["tracked-keywords"] });
      qc.invalidateQueries({ queryKey: ["rank-history"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filteredTracked = tracked;

  const groupedTracked = useMemo<TrackedGroup[]>(() => {
    const map = new Map<string, TrackedGroup>();

    filteredTracked.forEach((item) => {
      const key = [
        item.keyword.trim().toLowerCase(),
        item.target_domain.trim().toLowerCase(),
        item.region.trim().toLowerCase(),
        item.city?.trim().toLowerCase() ?? "",
      ].join("::");
      const group = map.get(key) ?? {
        key,
        keyword: item.keyword,
        target_domain: item.target_domain,
        region: item.region,
        city: item.city,
        rows: [],
        byEngine: {},
      };

      group.rows.push(item);
      const current = group.byEngine[item.engine];
      const currentDate = current?.last_checked_at ?? current?.created_at ?? "";
      const itemDate = item.last_checked_at ?? item.created_at ?? "";
      if (!current || itemDate >= currentDate) group.byEngine[item.engine] = item;
      map.set(key, group);
    });

    return Array.from(map.values());
  }, [filteredTracked]);

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

  const renderTrend = (id?: string) => {
    if (!id) return <Minus className="h-4 w-4 text-muted-foreground" />;
    const trend = trendFor(id);
    return trend.delta == null ? <Minus className="h-4 w-4 text-muted-foreground" />
      : trend.delta > 0 ? <span className="text-emerald-500 flex items-center gap-1 text-xs"><TrendingUp className="h-3 w-3" />+{trend.delta}</span>
      : trend.delta < 0 ? <span className="text-rose-500 flex items-center gap-1 text-xs"><TrendingDown className="h-3 w-3" />{trend.delta}</span>
      : <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  const renderPosition = (row?: Tracked) => {
    if (!row) return <span className="text-xs text-muted-foreground">-</span>;
    return (
      <span className={`font-bold ${posColor(row.last_position)}`}>
        {row.last_position == null ? (row.last_checked_at ? ">30" : "-") : `#${row.last_position}`}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRu ? "Трекер позиций" : "Rank Tracker"}</h1>
          <p className="text-sm text-muted-foreground">{isRu ? "Ежедневный мониторинг позиций в Google и Яндекс до ТОП-30" : "Daily Google and Yandex position monitoring up to TOP-30"}</p>
        </div>
        <Button onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending || tracked.length === 0 || isImpersonating}>
          {refreshMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          {domainFilter !== "all"
            ? (isRu ? `Проверить: ${domainFilter}` : `Check: ${domainFilter}`)
            : (isRu ? "Проверить все домены" : "Check all domains")}
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
            <Input
              className="md:col-span-6"
              placeholder={isRu ? "Домен сайта (example.com)" : "Site domain (example.com)"}
              value={domain}
              onChange={e => setDomain(e.target.value)}
            />
            <Textarea
              className="md:col-span-6 min-h-[110px]"
              placeholder={isRu ? "Ключевые запросы (по одному на строку) - будут привязаны к домену выше" : "Keywords (one per line) - will be attached to the domain above"}
              value={kw}
              onChange={e => setKw(e.target.value)}
            />
            <Select value={engine} onValueChange={(v) => setEngine(v as "google" | "yandex" | "both")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="both">{isRu ? "Google + Yandex" : "Google + Yandex"}</SelectItem>
                <SelectItem value="google">Google</SelectItem>
                <SelectItem value="yandex">Yandex</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder={engine === "yandex" ? "lr (213)" : "ru"} value={region} onChange={e => setRegion(e.target.value)} />
            <Input className="md:col-span-2" placeholder={isRu ? "Город (для Google/Yandex)" : "City (Google/Yandex)"} value={city} onChange={e => setCity(e.target.value)} />
            <Button className="md:col-span-1" onClick={() => addMut.mutate()} disabled={addMut.isPending || isImpersonating}>
              {addMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-2" />{isRu ? "Добавить" : "Add"}</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base">{isRu ? "Отслеживаемые ключи" : "Tracked keywords"}</CardTitle>
            {(() => {
              const domains = Array.from(new Set(groupedTracked.map(g => g.target_domain))).sort();
              if (domains.length === 0) return null;
              return (
                <Select value={domainFilter} onValueChange={setDomainFilter}>
                  <SelectTrigger className="w-[240px] h-9">
                    <SelectValue placeholder={isRu ? "Все домены" : "All domains"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{isRu ? "Все домены" : "All domains"} ({domains.length})</SelectItem>
                    {domains.map(d => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            })()}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : groupedTracked.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{isRu ? "Пока нет отслеживаемых ключей" : "No tracked keywords yet"}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-border">
                  <tr className="[&_th]:p-2 [&_th]:text-left">
                    <th>{isRu ? "Запрос" : "Keyword"}</th>
                    <th>{isRu ? "Домен" : "Domain"}</th>
                    <th>Google</th>
                    <th>Yandex</th>
                    <th>{isRu ? "Страницы в ТОП" : "Ranking pages"}</th>
                    <th>{isRu ? "Выдача" : "SERP"}</th>
                    <th>{isRu ? "История (30 дн)" : "History (30d)"}</th>
                    <th>{isRu ? "Дата размещения" : "Placed on"}</th>
                    <th>{isRu ? "Проверено" : "Checked"}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="[&_td]:p-2 [&_tr]:border-b [&_tr]:border-border/40">
                  {groupedTracked.filter(g => domainFilter === "all" || g.target_domain === domainFilter).map((group) => {
                    const google = group.byEngine.google;
                    const yandex = group.byEngine.yandex;
                    const latestRow = [...group.rows].sort((a, b) => {
                      const aTime = new Date(a.last_checked_at ?? a.created_at ?? 0).getTime();
                      const bTime = new Date(b.last_checked_at ?? b.created_at ?? 0).getTime();
                      return bTime - aTime;
                    })[0];
                    const placedAt = group.rows
                      .map(r => r.created_at)
                      .filter(Boolean)
                      .sort()[0];
                    const sparkData = group.rows.flatMap(row => (historyByKw[row.id] ?? []).slice(-30).map(p => ({
                      d: new Date(p.checked_at).toLocaleDateString("ru", { day: "2-digit", month: "2-digit" }),
                      [row.engine]: p.position ?? 31,
                    })));
                    return (
                      <tr key={group.key}>
                        <td className="font-medium">{group.keyword}</td>
                        <td className="text-muted-foreground">{group.target_domain}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            {renderPosition(google)}
                            {renderTrend(google?.id)}
                          </div>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            {renderPosition(yandex)}
                            {renderTrend(yandex?.id)}
                          </div>
                        </td>
                        <td className="max-w-[260px]">
                          <div className="space-y-1">
                            {google?.last_url && (
                              <a href={google.last_url} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline truncate block"
                                title={google.last_url}>
                                Google: {google.last_url.replace(/^https?:\/\//, "").slice(0, 48)}
                              </a>
                            )}
                            {yandex?.last_url && (
                              <a href={yandex.last_url} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline truncate block"
                                title={yandex.last_url}>
                                Yandex: {yandex.last_url.replace(/^https?:\/\//, "").slice(0, 48)}
                              </a>
                            )}
                            {!google?.last_url && !yandex?.last_url && <span className="text-xs text-muted-foreground">-</span>}
                          </div>
                        </td>
                        <td>
                          <div className="flex flex-col gap-1">
                            <a href={buildSerpUrl("google", group.keyword, group.region, group.city)}
                              target="_blank" rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline">
                              Google ↗
                            </a>
                            <a href={buildSerpUrl("yandex", group.keyword, group.region, group.city)}
                              target="_blank" rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline">
                              Yandex ↗
                            </a>
                          </div>
                        </td>
                        <td className="w-32 h-10">
                          {sparkData.length > 1 ? (
                            <ResponsiveContainer width="100%" height={36}>
                              <LineChart data={sparkData}>
                                <YAxis reversed domain={[1, 31]} hide />
                                <XAxis dataKey="d" hide />
                                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }} formatter={(v: number) => v === 31 ? ">30" : `#${v}`} />
                                <Line type="monotone" dataKey="google" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} connectNulls />
                                <Line type="monotone" dataKey="yandex" stroke="hsl(var(--destructive))" strokeWidth={1.5} dot={false} connectNulls />
                              </LineChart>
                            </ResponsiveContainer>
                          ) : <span className="text-xs text-muted-foreground">-</span>}
                        </td>
                        <td className="text-xs text-muted-foreground">
                          {placedAt ? new Date(placedAt).toLocaleDateString("ru") : "-"}
                        </td>
                        <td className="text-xs text-muted-foreground">
                          {latestRow?.last_checked_at ? new Date(latestRow.last_checked_at).toLocaleDateString("ru") : "-"}
                        </td>
                        <td>
                          <Button size="icon" variant="ghost" onClick={() => delMut.mutate(group.rows.map(row => row.id))} disabled={isImpersonating}>
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