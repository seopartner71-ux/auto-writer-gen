import { useState, useEffect, useCallback } from "react";
import { Activity, Wifi, WifiOff, Eye, Trophy, Zap, RefreshCw, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";

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
  total_views: number;
}

interface AnalyticsRow {
  url: string;
  count: number;
}

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
  const [indexedCounts, setIndexedCounts] = useState<Record<string, { sent: number; total: number }>>({});

  // Load projects
  const loadProjects = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("projects")
      .select("id, name, domain, hosting_platform, language, last_ping_status, last_ping_at, total_views")
      .eq("user_id", user.id);
    setProjects((data as any[]) || []);
    setLoading(false);
  }, [user]);

  // Load today's views per project
  const loadTodayViews = useCallback(async () => {
    if (!user) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("analytics_logs")
      .select("project_id")
      .gte("created_at", today.toISOString());

    const counts: Record<string, number> = {};
    (data || []).forEach((r: any) => {
      counts[r.project_id] = (counts[r.project_id] || 0) + 1;
    });
    setTodayViews(counts);
  }, [user]);

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
    loadTodayViews();
    loadIndexingStats();
  }, [loadProjects, loadTodayViews, loadIndexingStats]);

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

    const { data } = await supabase
      .from("analytics_logs")
      .select("url")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(500);

    const urlCounts: Record<string, number> = {};
    (data || []).forEach((r: any) => {
      urlCounts[r.url] = (urlCounts[r.url] || 0) + 1;
    });

    const sorted = Object.entries(urlCounts)
      .map(([url, count]) => ({ url, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    setTopPages((prev) => ({ ...prev, [projectId]: sorted }));
    setExpandedProject(projectId);
  };

  // Stats calculations
  const onlineCount = projects.filter((p) => p.last_ping_status === "online").length;
  const offlineCount = projects.filter((p) => p.last_ping_status === "offline").length;
  const totalViewsToday = Object.values(todayViews).reduce((a, b) => a + b, 0);
  const bestProject = projects.length > 0
    ? projects.reduce((best, p) => ((p.total_views || 0) > (best.total_views || 0) ? p : best), projects[0])
    : null;
  const totalIndexed = Object.values(indexedCounts).reduce((sum, b) => sum + b.sent, 0);
  const totalArticles = Object.values(indexedCounts).reduce((sum, b) => sum + b.total, 0);

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
              {lang === "ru" ? "Статус сайтов, трафик и индексация" : "Site status, traffic & indexing"}
            </p>
          </div>
        </div>
        <Button onClick={runHealthCheck} disabled={checking} size="sm" className="gap-2">
          <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
          {lang === "ru" ? "Проверить все" : "Check All"}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Wifi className="h-4 w-4" />
              {lang === "ru" ? "Статус сети" : "Network Status"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-green-400">{onlineCount}</span>
              <span className="text-muted-foreground text-sm">online</span>
              {offlineCount > 0 && (
                <>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-2xl font-bold text-destructive">{offlineCount}</span>
                  <span className="text-muted-foreground text-sm">offline</span>
                </>
              )}
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

      {/* Projects Table */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">
            {lang === "ru" ? "Проекты" : "Projects"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (<Skeleton key={i} className="h-12 w-full" />))}
            </div>
          ) : projects.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {lang === "ru" ? "Нет проектов" : "No projects"}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{lang === "ru" ? "Сайт" : "Site"}</TableHead>
                  <TableHead>{lang === "ru" ? "Платформа" : "Platform"}</TableHead>
                  <TableHead>{lang === "ru" ? "Статус" : "Status"}</TableHead>
                  <TableHead>{lang === "ru" ? "Сегодня" : "Today"}</TableHead>
                  <TableHead>{lang === "ru" ? "Всего" : "Total"}</TableHead>
                  <TableHead>GSC</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => {
                  const hr = healthResults.find((h) => h.id === project.id);
                  const pingStatus = hr?.status || project.last_ping_status || "unknown";
                  const isOnline = pingStatus === "online";
                  const isExpanded = expandedProject === project.id;

                  return (
                    <>
                      <TableRow key={project.id} className="cursor-pointer hover:bg-muted/30" onClick={() => loadTopPages(project.id)}>
                        <TableCell>
                          <div>
                            <span className="font-medium">{project.name}</span>
                            {project.domain && (
                              <span className="text-xs text-muted-foreground ml-2">{project.domain}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {project.hosting_platform || "—"}
                          </Badge>
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
                        <TableCell>
                          <span className="font-medium">{(todayViews[project.id] || 0).toLocaleString()}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-muted-foreground">{(project.total_views || 0).toLocaleString()}</span>
                        </TableCell>
                        <TableCell>
                          {project.domain ? (
                            <a
                              href={`https://search.google.com/search-console?resource_id=sc-domain:${project.domain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-primary hover:underline"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${project.id}-detail`}>
                          <TableCell colSpan={7} className="bg-muted/20 px-8 py-4">
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
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
