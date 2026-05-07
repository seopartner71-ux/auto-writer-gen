import { useState, useEffect, useCallback, useMemo } from "react";
import { Activity, Wifi, WifiOff, Eye, Trophy, Zap, RefreshCw, ExternalLink, ChevronDown, ChevronUp, Plus, Trash2, Cloud, Loader2, AlertTriangle, Network, Send, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { Link } from "react-router-dom";
import { getSiteLanguageMeta } from "@/shared/utils/siteLanguages";

interface HealthResult {
  id: string;
  domain: string;
  name: string;
  status: string;
  statusCode: number | null;
  responseTime: number | null;
}

interface ProjectRow {
  id: string;
  name: string;
  domain: string;
  hosting_platform: string | null;
  language: string;
  last_ping_status: string | null;
  last_ping_at: string | null;
  last_deploy_at: string | null;
  total_views: number;
  last_search_ping_at?: string | null;
  last_search_ping_status?: string | null;
}

interface PingLogRow {
  id: string;
  provider: string;
  status: string;
  response_code: number | null;
  response_message: string | null;
  url: string;
  created_at: string;
}

interface AnalyticsRow {
  url: string;
  count: number;
}

interface CfStat { requests_24h: number; requests_7d: number; requests_30d: number; configured: boolean }

export default function NetworkMonitorPage() {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [healthResults, setHealthResults] = useState<HealthResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [topPages, setTopPages] = useState<Record<string, AnalyticsRow[]>>({});
  const [todayViews, setTodayViews] = useState<Record<string, number>>({});
  const [weekViews, setWeekViews] = useState<Record<string, number>>({});
  const [articleCounts, setArticleCounts] = useState<Record<string, { total: number; lastAt: string | null }>>({});
  const [cfStats, setCfStats] = useState<Record<string, CfStat>>({});
  const [cfConfigured, setCfConfigured] = useState<boolean>(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [indexedCounts, setIndexedCounts] = useState<Record<string, { sent: number; total: number }>>({});
  const [ipMap, setIpMap] = useState<Record<string, string>>({}); // host -> IP
  const [resolvingIps, setResolvingIps] = useState(false);
  const [pingingId, setPingingId] = useState<string | null>(null);
  const [pingHistory, setPingHistory] = useState<Record<string, PingLogRow[]>>({});

  // Load projects
  const loadProjects = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("projects")
      .select("id, name, domain, hosting_platform, language, last_ping_status, last_ping_at, last_deploy_at, total_views, last_search_ping_at, last_search_ping_status")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setProjects((data as any[]) || []);
    setLoading(false);
  }, [user]);

  // Load today's + 7d views per project (own pixel)
  const loadPixelViews = useCallback(async () => {
    if (!user) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 86400_000);

    const [todayRes, weekRes] = await Promise.all([
      supabase.from("analytics_logs").select("project_id").gte("created_at", today.toISOString()).limit(10000),
      supabase.from("analytics_logs").select("project_id").gte("created_at", weekAgo.toISOString()).limit(10000),
    ]);

    const todayCounts: Record<string, number> = {};
    (todayRes.data || []).forEach((r: any) => { todayCounts[r.project_id] = (todayCounts[r.project_id] || 0) + 1; });
    setTodayViews(todayCounts);

    const wCounts: Record<string, number> = {};
    (weekRes.data || []).forEach((r: any) => { wCounts[r.project_id] = (wCounts[r.project_id] || 0) + 1; });
    setWeekViews(wCounts);
  }, [user]);

  // Article counts + last article date per project
  const loadArticleCounts = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("articles")
      .select("project_id, created_at")
      .eq("user_id", user.id)
      .not("project_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(5000);
    const map: Record<string, { total: number; lastAt: string | null }> = {};
    (data || []).forEach((a: any) => {
      const k = a.project_id;
      if (!map[k]) map[k] = { total: 0, lastAt: a.created_at };
      map[k].total++;
    });
    setArticleCounts(map);
  }, [user]);

  // Cloudflare aggregated stats
  const loadCloudflareStats = useCallback(async () => {
    if (!user) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await supabase.functions.invoke("cloudflare-analytics", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (resp.data?.stats) {
        setCfStats(resp.data.stats);
        setCfConfigured(!!resp.data.configured);
      }
    } catch (_e) { /* ignore */ }
  }, [user]);

  // legacy ‘topPages’ helper still works against analytics_logs
  const _legacyTopUrls = useCallback(async (projectId: string) => {
    const { data } = await supabase
      .from("analytics_logs")
      .select("url")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(500);
    const urlCounts: Record<string, number> = {};
    (data || []).forEach((r: any) => { urlCounts[r.url] = (urlCounts[r.url] || 0) + 1; });
    return Object.entries(urlCounts).map(([url, count]) => ({ url, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  }, []);

  // Load indexing stats per project
  const loadIndexingStats = useCallback(async () => {
    if (!user) return;
    // Get articles per project
    const { data: articles } = await supabase
      .from("articles")
      .select("id, project_id, status")
      .eq("user_id", user.id);

    // Get indexing logs
    const { data: logs } = await supabase
      .from("indexing_logs")
      .select("article_id, status")
      .eq("user_id", user.id);

    const sentArticleIds = new Set((logs || []).filter((l: any) => l.status === "success").map((l: any) => l.article_id));

    const stats: Record<string, { sent: number; total: number }> = {};
    (articles || []).forEach((a: any) => {
      if (!a.project_id) return;
      if (!stats[a.project_id]) stats[a.project_id] = { sent: 0, total: 0 };
      stats[a.project_id].total++;
      if (sentArticleIds.has(a.id)) stats[a.project_id].sent++;
    });
    setIndexedCounts(stats);
  }, [user]);

  useEffect(() => {
    loadProjects();
    loadPixelViews();
    loadArticleCounts();
    loadCloudflareStats();
    loadIndexingStats();
  }, [loadProjects, loadPixelViews, loadArticleCounts, loadCloudflareStats, loadIndexingStats]);

  // Resolve A-records of all CF site domains via Google DoH (no CORS issues)
  useEffect(() => {
    const hosts = Array.from(new Set(
      projects
        .map((p) => (p.domain || "").replace(/^https?:\/\//, "").split("/")[0])
        .filter((h) => h && !h.endsWith(".pages.dev"))
    ));
    if (!hosts.length) return;
    let cancelled = false;
    setResolvingIps(true);
    (async () => {
      const next: Record<string, string> = {};
      for (const host of hosts) {
        try {
          const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`);
          const data = await res.json();
          const ip = (data?.Answer || []).find((a: any) => a.type === 1)?.data;
          if (ip) next[host] = ip;
        } catch { /* ignore */ }
        if (cancelled) return;
      }
      if (!cancelled) setIpMap(next);
      setResolvingIps(false);
    })();
    return () => { cancelled = true; };
  }, [projects]);

  // Group hosts by IP, find clusters
  const ipClusters = useMemo(() => {
    const byIp: Record<string, string[]> = {};
    Object.entries(ipMap).forEach(([host, ip]) => {
      if (!byIp[ip]) byIp[ip] = [];
      byIp[ip].push(host);
    });
    return Object.entries(byIp)
      .filter(([, hosts]) => hosts.length >= 3)
      .sort((a, b) => b[1].length - a[1].length);
  }, [ipMap]);

  // Run health check
  const runHealthCheck = async () => {
    setChecking(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await supabase.functions.invoke("site-health-check", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (resp.data?.results) {
        setHealthResults(resp.data.results);
        // Refresh projects to get updated ping status
        loadProjects();
      }
      toast({ title: lang === "ru" ? "Проверка завершена" : "Health check complete" });
    } catch (e) {
      toast({ title: lang === "ru" ? "Ошибка проверки" : "Check failed", variant: "destructive" });
    }
    setChecking(false);
  };

  // Load top pages for a project
  const loadTopPages = async (projectId: string) => {
    if (topPages[projectId]) {
      setExpandedProject(expandedProject === projectId ? null : projectId);
      return;
    }
    const sorted = await _legacyTopUrls(projectId);
    setTopPages((prev) => ({ ...prev, [projectId]: sorted }));
    setExpandedProject(projectId);
  };

  const deleteSite = async (projectId: string, host: string) => {
    setDeletingId(projectId);
    try {
      const { data, error } = await supabase.functions.invoke("delete-cloudflare-site", {
        body: { project_id: projectId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({ title: lang === "ru" ? "Сайт удалён" : "Site deleted", description: host });
      loadProjects();
    } catch (e: any) {
      toast({ title: lang === "ru" ? "Ошибка удаления" : "Delete failed", description: e?.message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  // Stats calculations
  const cloudflareSites = useMemo(() => projects.filter((p) => p.hosting_platform === "cloudflare" && p.domain), [projects]);
  const onlineCount = cloudflareSites.filter((p) => p.last_ping_status === "online").length;
  const offlineCount = cloudflareSites.filter((p) => p.last_ping_status === "offline").length;
  const totalViewsToday = Object.values(todayViews).reduce((a, b) => a + b, 0);
  const bestProject = cloudflareSites.length > 0
    ? cloudflareSites.reduce((best, p) => ((p.total_views || 0) > (best.total_views || 0) ? p : best), cloudflareSites[0])
    : null;
  const totalIndexed = Object.values(indexedCounts).reduce((sum, b) => sum + b.sent, 0);
  const totalArticles = Object.values(indexedCounts).reduce((sum, b) => sum + b.total, 0);

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US") : "—";
  const hostOf = (domain: string) => (domain || "").replace(/^https?:\/\//, "").split("/")[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">
              {lang === "ru" ? "Мониторинг сети" : "Network Monitor"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {lang === "ru" ? "Cloudflare сайты: статус, трафик, индексация" : "Cloudflare sites: status, traffic & indexing"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => { loadProjects(); loadPixelViews(); loadArticleCounts(); loadCloudflareStats(); loadIndexingStats(); }} variant="outline" size="sm" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            {lang === "ru" ? "Обновить" : "Refresh"}
          </Button>
          <Button onClick={runHealthCheck} disabled={checking} size="sm" className="gap-2">
            <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
            {lang === "ru" ? "Проверить все" : "Check All"}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Cloud className="h-4 w-4" />
              {lang === "ru" ? "Cloudflare сети" : "Cloudflare sites"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{cloudflareSites.length}</span>
              <span className="text-muted-foreground text-sm">{lang === "ru" ? "всего" : "total"}</span>
              <span className="ml-2 text-green-400 text-sm">●&nbsp;{onlineCount}</span>
              {offlineCount > 0 && <span className="text-destructive text-sm">●&nbsp;{offlineCount}</span>}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Eye className="h-4 w-4" />
              {lang === "ru" ? "Трафик (24ч)" : "Traffic (24h)"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">{totalViewsToday.toLocaleString()}</span>
            <span className="text-muted-foreground text-sm ml-2">
              {lang === "ru" ? "просмотров" : "views"}
            </span>
            <p className="text-[11px] text-muted-foreground mt-1">{lang === "ru" ? "по своему пикселю" : "via own pixel"}</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Trophy className="h-4 w-4" />
              {lang === "ru" ? "Лучший проект" : "Top Project"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-lg font-bold truncate block">
              {bestProject?.name || "—"}
            </span>
            <span className="text-muted-foreground text-xs">
              {bestProject ? `${(bestProject.total_views || 0).toLocaleString()} ${lang === "ru" ? "просмотров" : "views"}` : ""}
            </span>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Zap className="h-4 w-4" />
              {lang === "ru" ? "Индекс" : "Index"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-primary">{totalIndexed}</span>
              <span className="text-muted-foreground text-sm">/ {totalArticles}</span>
            </div>
            <span className="text-muted-foreground text-xs">
              {lang === "ru" ? "отправлено в Google" : "sent to Google"}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* IP Distribution / Footprint Warning */}
      {(ipClusters.length > 0 || resolvingIps) && (
        <Card className={`${ipClusters.length > 0 ? "border-warning/40 bg-warning/5" : "border-border/50 bg-card/50"}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              {ipClusters.length > 0 ? (
                <AlertTriangle className="h-4 w-4 text-warning" />
              ) : (
                <Network className="h-4 w-4 text-muted-foreground" />
              )}
              {lang === "ru" ? "IP-разнесение сети" : "IP Footprint"}
              {resolvingIps && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ipClusters.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {lang === "ru"
                  ? "Все домены проверены - кластеризации по IP не найдено."
                  : "All domains checked - no IP clustering detected."}
              </p>
            ) : (
              <>
                <p className="text-xs text-foreground">
                  {lang === "ru"
                    ? `Найдено ${ipClusters.length} IP-адресов с 3+ сайтами. Это упрощает Google склейку сети - переместите часть сайтов на другой хостинг.`
                    : `Found ${ipClusters.length} IPs hosting 3+ sites. This makes the network easier for Google to cluster - move some sites to a different host.`}
                </p>
                <div className="space-y-1.5 mt-2">
                  {ipClusters.map(([ip, hosts]) => (
                    <div key={ip} className="text-xs">
                      <span className="font-mono text-warning">{ip}</span>
                      <span className="text-muted-foreground ml-2">→ {hosts.length} {lang === "ru" ? "сайтов" : "sites"}:</span>
                      <span className="text-muted-foreground ml-1">{hosts.slice(0, 5).join(", ")}{hosts.length > 5 ? ` +${hosts.length - 5}` : ""}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Projects Table */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">
              {lang === "ru" ? "Cloudflare сайты" : "Cloudflare sites"}
            </CardTitle>
            {!cfConfigured && (
              <Badge variant="outline" className="text-[10px]">
                {lang === "ru" ? "Cloudflare Analytics не настроены" : "Cloudflare Analytics not configured"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (<Skeleton key={i} className="h-12 w-full" />))}
            </div>
          ) : cloudflareSites.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {lang === "ru" ? "Нет Cloudflare сайтов. Создайте сетку через Фабрику сайтов." : "No Cloudflare sites yet. Create one in Site Factory."}
            </p>
          ) : (
            <div className="overflow-x-auto"><Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{lang === "ru" ? "Сайт" : "Site"}</TableHead>
                  <TableHead>{lang === "ru" ? "Статус" : "Status"}</TableHead>
                  <TableHead>{lang === "ru" ? "Сегодня" : "Today"}</TableHead>
                  <TableHead>{lang === "ru" ? "7 дн." : "7d"}</TableHead>
                  <TableHead>CF&nbsp;30д</TableHead>
                  <TableHead>{lang === "ru" ? "Статьи" : "Posts"}</TableHead>
                  <TableHead>{lang === "ru" ? "Деплой" : "Deploy"}</TableHead>
                  <TableHead className="text-right">{lang === "ru" ? "Действия" : "Actions"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cloudflareSites.map((project) => {
                  const hr = healthResults.find((h) => h.id === project.id);
                  const pingStatus = hr?.status || project.last_ping_status || "unknown";
                  const isOnline = pingStatus === "online";
                  const isExpanded = expandedProject === project.id;
                  const host = hostOf(project.domain);
                  const url = host ? `https://${host}` : null;
                  const cf = cfStats[project.id];
                  const ac = articleCounts[project.id];

                  return (
                    <>
                      <TableRow key={project.id} className="hover:bg-muted/30">
                        <TableCell className="cursor-pointer" onClick={() => loadTopPages(project.id)}>
                          <div>
                            <span className="font-medium">{project.name}</span>
                            <Badge variant="outline" className="ml-2 text-[10px] h-4 px-1">
                              {getSiteLanguageMeta(project.language).iso}
                            </Badge>
                            {host && <span className="text-xs text-muted-foreground ml-2">{host}</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {isOnline ? (
                              <Wifi className="h-4 w-4 text-green-400" />
                            ) : pingStatus === "offline" ? (
                              <WifiOff className="h-4 w-4 text-destructive" />
                            ) : (
                              <Activity className="h-4 w-4 text-muted-foreground" />
                            )}
                            <span className={`text-xs font-medium ${isOnline ? "text-green-400" : pingStatus === "offline" ? "text-destructive" : "text-muted-foreground"}`}>
                              {hr?.statusCode ? `${hr.statusCode}` : isOnline ? "200 OK" : pingStatus === "offline" ? "Offline" : "—"}
                            </span>
                            {hr?.responseTime && (
                              <span className="text-xs text-muted-foreground">{hr.responseTime}ms</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell><span className="font-medium">{(todayViews[project.id] || 0).toLocaleString()}</span></TableCell>
                        <TableCell><span className="text-muted-foreground">{(weekViews[project.id] || 0).toLocaleString()}</span></TableCell>
                        <TableCell>
                          {cf ? (
                            <span className="text-xs text-muted-foreground">{cf.requests_30d.toLocaleString()}</span>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <div className="text-xs">
                            <div className="font-medium">{ac?.total ?? 0}</div>
                            <div className="text-muted-foreground">{fmtDate(ac?.lastAt ?? null)}</div>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDate(project.last_deploy_at)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 justify-end">
                            {url && (
                              <Button asChild variant="ghost" size="icon" className="h-7 w-7" title={lang === "ru" ? "Открыть сайт" : "Open site"}>
                                <a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
                              </Button>
                            )}
                            <Button asChild variant="ghost" size="icon" className="h-7 w-7" title={lang === "ru" ? "Добавить статью" : "Add article"}>
                              <Link to={`/plan-builder?project=${project.id}`}><Plus className="h-3.5 w-3.5" /></Link>
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" disabled={deletingId === project.id} className="h-7 w-7 text-destructive hover:text-destructive" title={lang === "ru" ? "Удалить сайт" : "Delete site"}>
                                  {deletingId === project.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{lang === "ru" ? `Удалить сайт ${host || project.name}?` : `Delete site ${host || project.name}?`}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {lang === "ru" ? "Cloudflare-проект, запись и все статьи будут удалены безвозвратно." : "Cloudflare project, record and all articles will be permanently removed."}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{lang === "ru" ? "Отмена" : "Cancel"}</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteSite(project.id, host || project.name)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                    {lang === "ru" ? "Удалить" : "Delete"}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => loadTopPages(project.id)}>
                              {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${project.id}-detail`}>
                          <TableCell colSpan={8} className="bg-muted/20 px-8 py-4">
                            <div>
                              <p className="text-sm font-medium mb-3">
                                {lang === "ru" ? "Топ-5 страниц" : "Top 5 Pages"}
                              </p>
                              {(topPages[project.id] || []).length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  {lang === "ru" ? "Нет данных" : "No data yet"}
                                </p>
                              ) : (
                                <div className="space-y-1.5">
                                  {(topPages[project.id] || []).map((page, idx) => (
                                    <div key={idx} className="flex items-center justify-between text-sm">
                                      <span className="text-muted-foreground truncate max-w-[400px]">{page.url || "/"}</span>
                                      <Badge variant="secondary" className="text-xs">{page.count} {lang === "ru" ? "просм." : "views"}</Badge>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
