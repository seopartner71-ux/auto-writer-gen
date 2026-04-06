import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { PLAN_LIMITS } from "@/shared/api/types";
import {
  FileText, Search, BarChart3, Zap, TrendingUp, Hash, Trash2,
  CheckCircle2, AlertCircle, Clock, BookOpen, Send, Globe, Newspaper, PenTool,
  Users, UserCheck, UserX, CreditCard
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area
} from "recharts";
import { toast } from "sonner";
import { format, subDays, startOfDay } from "date-fns";
import { ru } from "date-fns/locale";

const STATUS_COLORS: Record<string, string> = {
  draft: "hsl(var(--muted-foreground))",
  review: "hsl(var(--warning, 45 93% 47%))",
  published: "hsl(var(--primary))",
};

/* ──────────── Admin Dashboard ──────────── */
function AdminDashboard() {
  const { data: profiles = [] } = useQuery({
    queryKey: ["admin-dashboard-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, email, full_name, plan, is_active, credits_amount, created_at");
      return data || [];
    },
  });

  const { data: allUsageLogs = [] } = useQuery({
    queryKey: ["admin-dashboard-usage"],
    queryFn: async () => {
      const { data } = await supabase.from("usage_logs").select("user_id, tokens_used, action, created_at");
      return data || [];
    },
  });

  const { data: allArticles = [] } = useQuery({
    queryKey: ["admin-dashboard-articles"],
    queryFn: async () => {
      const { data } = await supabase.from("articles").select("id, user_id, status, created_at").limit(1000);
      return data || [];
    },
  });

  const stats = useMemo(() => {
    const total = profiles.length;
    const active = profiles.filter((p: any) => p.is_active).length;
    const pending = profiles.filter((p: any) => !p.is_active).length;
    const totalCredits = profiles.reduce((s: number, p: any) => s + (p.credits_amount || 0), 0);
    const totalTokens = allUsageLogs.reduce((s: number, l: any) => s + (l.tokens_used || 0), 0);
    const totalArticles = allArticles.length;

    // Plan distribution
    const planMap: Record<string, number> = {};
    profiles.forEach((p: any) => {
      const plan = p.plan || "free";
      planMap[plan] = (planMap[plan] || 0) + 1;
    });

    // Registration chart — last 30 days
    const now = new Date();
    const regDays: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const day = startOfDay(subDays(now, i));
      const dayEnd = startOfDay(subDays(now, i - 1));
      const count = profiles.filter((p: any) => {
        const d = new Date(p.created_at);
        return d >= day && d < dayEnd;
      }).length;
      regDays.push({ date: format(day, "dd.MM", { locale: ru }), count });
    }

    // Top users by articles
    const userArticleCounts: Record<string, number> = {};
    allArticles.forEach((a: any) => {
      userArticleCounts[a.user_id] = (userArticleCounts[a.user_id] || 0) + 1;
    });
    const topUsers = Object.entries(userArticleCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([uid, count]) => {
        const p = profiles.find((pr: any) => pr.id === uid);
        return { email: p?.email || uid.slice(0, 8), name: p?.full_name || "—", count };
      });

    // Recent registrations
    const recentUsers = [...profiles]
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 6);

    return { total, active, pending, totalCredits, totalTokens, totalArticles, planMap, regDays, topUsers, recentUsers };
  }, [profiles, allUsageLogs, allArticles]);

  const planColors: Record<string, string> = {
    free: "hsl(var(--muted-foreground))",
    basic: "hsl(var(--primary))",
    pro: "hsl(210 100% 50%)",
  };

  const planChartData = Object.entries(stats.planMap).map(([name, value]) => ({
    name: name.toUpperCase(),
    value,
    fill: planColors[name] || "hsl(var(--muted-foreground))",
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Панель управления</h1>
        <p className="text-muted-foreground mt-1">Обзор платформы и пользователей</p>
      </div>

      {/* KPI */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Всего пользователей", value: stats.total, icon: Users, color: "text-primary" },
          { label: "Активных", value: stats.active, icon: UserCheck, color: "text-emerald-500" },
          { label: "Ожидают активации", value: stats.pending, icon: UserX, color: "text-yellow-500" },
          { label: "Всего статей", value: stats.totalArticles, icon: FileText, color: "text-accent" },
        ].map((s) => (
          <Card key={s.label} className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <CreditCard className="h-4 w-4" /> Кредиты в системе
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.totalCredits}</p>
            <p className="text-xs text-muted-foreground mt-1">Суммарный баланс всех пользователей</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Hash className="h-4 w-4" /> AI-токены
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.totalTokens.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">≈ ${((stats.totalTokens / 1000) * 0.002).toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Тарифы
            </CardTitle>
          </CardHeader>
          <CardContent>
            {planChartData.length > 0 ? (
              <div className="flex items-center gap-3">
                <ResponsiveContainer width={70} height={70}>
                  <PieChart>
                    <Pie data={planChartData} dataKey="value" cx="50%" cy="50%" innerRadius={18} outerRadius={32} strokeWidth={1.5}>
                      {planChartData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1">
                  {planChartData.map((d) => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
                      <span className="text-muted-foreground">{d.name}</span>
                      <span className="font-semibold ml-auto">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Нет данных</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Registration chart */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Регистрации за 30 дней</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={stats.regDays}>
              <defs>
                <linearGradient id="regGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="count" stroke="hsl(var(--primary))" fill="url(#regGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Bottom: top users + recent registrations */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Топ пользователей по статьям
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topUsers.length > 0 ? (
              <div className="space-y-2.5">
                {stats.topUsers.map((u, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-muted-foreground w-4">{i + 1}.</span>
                      <span className="font-mono text-xs truncate max-w-[200px]">{u.email}</span>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">{u.count} статей</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">Нет данных</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" /> Последние регистрации
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.recentUsers.length > 0 ? (
              <div className="space-y-2.5">
                {stats.recentUsers.map((u: any) => (
                  <div key={u.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs truncate max-w-[200px]">{u.email}</span>
                      {!u.is_active && (
                        <Badge variant="outline" className="text-[10px] border-yellow-500/50 text-yellow-500 px-1.5 py-0">
                          Ожидает
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {u.created_at ? format(new Date(u.created_at), "dd.MM.yy HH:mm", { locale: ru }) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">Нет данных</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ──────────── User Dashboard (existing) ──────────── */
export default function DashboardPage() {
  const { profile, role } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // Admin sees a completely different dashboard
  if (role === "admin") {
    return <AdminDashboard />;
  }

  const plan = (profile?.plan ?? "basic") as "basic" | "pro";
  const limits = PLAN_LIMITS[plan];

  const STATUS_LABELS: Record<string, string> = {
    draft: t("dashboard.statusDraft"),
    review: t("dashboard.statusReview"),
    published: t("dashboard.statusPublished"),
  };

  const { data: articles = [] } = useQuery({
    queryKey: ["dashboard-articles"],
    queryFn: async () => {
      const { data } = await supabase
        .from("articles")
        .select("id, title, status, seo_score, keyword_id, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(100);
      return data || [];
    },
  });

  const { data: keywords = [] } = useQuery({
    queryKey: ["dashboard-keywords"],
    queryFn: async () => {
      const { data } = await supabase
        .from("keywords")
        .select("id, seed_keyword, intent, volume, difficulty");
      return data || [];
    },
  });

  const { data: usageLogs = [] } = useQuery({
    queryKey: ["dashboard-usage"],
    queryFn: async () => {
      const { data } = await supabase
        .from("usage_logs")
        .select("id, tokens_used, action, created_at");
      return data || [];
    },
  });

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const stats = useMemo(() => {
    const totalArticles = articles.length;
    const totalKeywords = keywords.length;
    const totalGenerations = usageLogs.length;

    const scores = articles
      .map((a: any) => {
        const s = a.seo_score;
        if (!s) return null;
        const vals = [s.readability, s.keywordDensity, s.structure].filter(
          (v: any) => typeof v === "number"
        );
        return vals.length ? vals.reduce((sum: number, v: number) => sum + v, 0) / vals.length : null;
      })
      .filter((v: any) => v !== null) as number[];
    const avgSeo = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null;

    const totalWords = 0;
    const avgWords = 0;

    const totalTokens = usageLogs.reduce(
      (sum: number, l: any) => sum + (l.tokens_used || 0),
      0
    );

    const publishCounts: Record<string, number> = { telegraph: 0, ghost: 0, wordpress: 0 };
    usageLogs.forEach((l: any) => {
      if (l.action === "publish_telegraph") publishCounts.telegraph++;
      else if (l.action === "publish_ghost") publishCounts.ghost++;
      else if (l.action === "publish_wordpress") publishCounts.wordpress++;
    });
    const totalPublished = publishCounts.telegraph + publishCounts.ghost + publishCounts.wordpress;

    const statusMap: Record<string, number> = {};
    articles.forEach((a: any) => {
      const st = a.status || "draft";
      statusMap[st] = (statusMap[st] || 0) + 1;
    });

    const intentMap: Record<string, number> = {};
    keywords.forEach((k: any) => {
      const intent = k.intent || "unknown";
      intentMap[intent] = (intentMap[intent] || 0) + 1;
    });

    const topKeywords = [...keywords]
      .sort((a: any, b: any) => (b.volume || 0) - (a.volume || 0))
      .slice(0, 5);

    const recentArticles = [...articles]
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5);

    const now = Date.now();
    const weeklyData = Array.from({ length: 4 }, (_, i) => {
      const weekStart = now - (3 - i) * 7 * 24 * 3600 * 1000;
      const weekEnd = now - (2 - i) * 7 * 24 * 3600 * 1000;
      const count = articles.filter((a: any) => {
        const t = new Date(a.created_at).getTime();
        return i === 3 ? t >= weekStart : t >= weekStart && t < weekEnd;
      }).length;
      return { name: `${t("dashboard.week")} ${i + 1}`, count };
    });

    return {
      totalArticles, totalKeywords, totalGenerations, avgSeo,
      totalWords, avgWords, totalTokens, statusMap, intentMap,
      topKeywords, recentArticles, weeklyData, publishCounts, totalPublished,
    };
  }, [articles, keywords, usageLogs, t]);

  const statusChartData = Object.entries(stats.statusMap).map(([key, value]) => ({
    name: STATUS_LABELS[key] || key,
    value,
    fill: STATUS_COLORS[key] || "hsl(var(--muted-foreground))",
  }));

  const intentChartData = Object.entries(stats.intentMap).map(([key, value]) => ({
    name: key === "informational" ? t("dashboard.intentInfo") : key === "transactional" ? t("dashboard.intentTrans") : key === "navigational" ? t("dashboard.intentNav") : key,
    value,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("dashboard.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("dashboard.subtitle")}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: t("dashboard.totalArticles"), value: stats.totalArticles, icon: FileText, color: "text-primary" },
          { label: t("dashboard.keywords"), value: stats.totalKeywords, icon: Search, color: "text-accent" },
          { label: t("dashboard.avgSeo"), value: stats.avgSeo !== null ? `${stats.avgSeo}%` : "—", icon: BarChart3, color: "text-success" },
          { label: t("dashboard.generations"), value: stats.totalGenerations, icon: Zap, color: "text-warning" },
        ].map((s) => (
          <Card key={s.label} className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Secondary stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <BookOpen className="h-4 w-4" /> {t("dashboard.totalWords")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.totalWords.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">~{stats.avgWords} {t("dashboard.wordsPerArticle")}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Hash className="h-4 w-4" /> {t("dashboard.aiTokens")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.totalTokens.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("dashboard.allTime")}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> {t("dashboard.tariff")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold uppercase">{plan}</p>
            <p className="text-xs text-muted-foreground mt-1">{limits.maxGenerations} {t("dashboard.genPerMonth")}</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("dashboard.articleStatuses")}</CardTitle>
          </CardHeader>
          <CardContent>
            {statusChartData.length > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie data={statusChartData} dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={50} strokeWidth={2}>
                      {statusChartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5">
                  {statusChartData.map((d) => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
                      <span className="text-muted-foreground">{d.name}</span>
                      <span className="font-semibold ml-auto">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-6">{t("common.noData")}</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Send className="h-4 w-4" /> Публикации
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold mb-3">{stats.totalPublished}</div>
            <div className="space-y-2">
              {[
                { label: "Telegra.ph", count: stats.publishCounts.telegraph, icon: Globe, color: "text-blue-400" },
                { label: "WordPress", count: stats.publishCounts.wordpress, icon: Newspaper, color: "text-sky-400" },
                { label: "Ghost", count: stats.publishCounts.ghost, icon: PenTool, color: "text-green-400" },
              ].map((p) => (
                <div key={p.label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <p.icon className={`h-3.5 w-3.5 ${p.color}`} />
                    <span className="text-muted-foreground">{p.label}</span>
                  </div>
                  <span className="font-semibold">{p.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("dashboard.queryIntents")}</CardTitle>
          </CardHeader>
          <CardContent>
            {intentChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={intentChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-6">{t("common.noData")}</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("dashboard.activity")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={stats.weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Search className="h-4 w-4" /> {t("dashboard.topKeywords")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topKeywords.length > 0 ? (
              <div className="space-y-2">
                {stats.topKeywords.map((kw: any) => (
                  <div key={kw.id} className="flex items-center justify-between text-sm group">
                    <span className="font-medium truncate max-w-[50%]">{kw.seed_keyword}</span>
                    <div className="flex items-center gap-2">
                      {kw.intent && <Badge variant="outline" className="text-[10px]">{kw.intent}</Badge>}
                      {kw.volume != null && <span className="text-xs text-muted-foreground">{kw.volume} vol</span>}
                      {kw.difficulty != null && <Progress value={kw.difficulty} className="w-12 h-1.5" />}
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        title="Удалить"
                        onClick={async () => {
                          const { error } = await supabase.functions.invoke("delete-content", { body: { type: "keyword", id: kw.id } });
                          if (error) { toast.error("Ошибка: " + error.message); return; }
                          queryClient.invalidateQueries({ queryKey: ["dashboard-keywords"] });
                          queryClient.invalidateQueries({ queryKey: ["dashboard-articles"] });
                          toast.success("Ключевое слово удалено");
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">{t("dashboard.noKeywords")}</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" /> {t("dashboard.recentArticles")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.recentArticles.length > 0 ? (
              <div className="space-y-2">
                {stats.recentArticles.map((a: any) => {
                  const words = 0;
                  const statusLabel = STATUS_LABELS[a.status] || a.status;
                  return (
                    <div key={a.id} className="flex items-center justify-between text-sm group">
                      <span className="font-medium truncate max-w-[55%]">{a.title || t("common.noTitle")}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{words} {t("dashboard.wrd")}</span>
                        <Badge variant={a.status === "published" ? "default" : "secondary"} className="text-[10px]">{statusLabel}</Badge>
                        <button
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          title="Удалить"
                          onClick={async () => {
                            const { error } = await supabase.functions.invoke("delete-content", { body: { type: "article", id: a.id } });
                            if (error) { toast.error("Ошибка: " + error.message); return; }
                            queryClient.invalidateQueries({ queryKey: ["dashboard-articles"] });
                            toast.success("Статья удалена");
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">{t("dashboard.noArticles")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
