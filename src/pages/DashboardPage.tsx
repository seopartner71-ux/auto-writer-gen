import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/shared/api/supabase";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { PLAN_LIMITS } from "@/shared/api/types";
import {
  FileText, Search, BarChart3, Zap, TrendingUp, Hash, Trash2,
  CheckCircle2, AlertCircle, Clock, BookOpen
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid
} from "recharts";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  draft: "hsl(var(--muted-foreground))",
  review: "hsl(var(--warning, 45 93% 47%))",
  published: "hsl(var(--primary))",
};

export default function DashboardPage() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
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
        .select("id, title, content, status, seo_score, keyword_id, created_at, updated_at");
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

    const wordCounts = articles.map((a: any) =>
      a.content ? a.content.trim().split(/\s+/).length : 0
    );
    const totalWords = wordCounts.reduce((a: number, b: number) => a + b, 0);
    const avgWords = totalArticles ? Math.round(totalWords / totalArticles) : 0;

    const totalTokens = usageLogs.reduce(
      (sum: number, l: any) => sum + (l.tokens_used || 0),
      0
    );

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
      totalArticles,
      totalKeywords,
      totalGenerations,
      avgSeo,
      totalWords,
      avgWords,
      totalTokens,
      statusMap,
      intentMap,
      topKeywords,
      recentArticles,
      weeklyData,
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
        <p className="text-muted-foreground mt-1">
          {t("dashboard.subtitle")}
        </p>
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
      <div className="grid gap-4 md:grid-cols-3">
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
                      {statusChartData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
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
                      {kw.intent && (
                        <Badge variant="outline" className="text-[10px]">{kw.intent}</Badge>
                      )}
                      {kw.volume != null && (
                        <span className="text-xs text-muted-foreground">{kw.volume} vol</span>
                      )}
                      {kw.difficulty != null && (
                        <Progress value={kw.difficulty} className="w-12 h-1.5" />
                      )}
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        title="Удалить"
                        onClick={async () => {
                          const { error } = await supabase.functions.invoke("delete-content", { body: { type: "keyword", id: kw.id } });
                          if (error) { console.error(error); toast.error("Ошибка: " + error.message); return; }
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
                  const words = a.content ? a.content.trim().split(/\s+/).length : 0;
                  const statusLabel = STATUS_LABELS[a.status] || a.status;
                  return (
                    <div key={a.id} className="flex items-center justify-between text-sm group">
                      <span className="font-medium truncate max-w-[55%]">
                        {a.title || t("common.noTitle")}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{words} {t("dashboard.wrd")}</span>
                        <Badge variant={a.status === "published" ? "default" : "secondary"} className="text-[10px]">
                          {statusLabel}
                        </Badge>
                        <button
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          title="Удалить"
                          onClick={async () => {
                            const { error } = await supabase.functions.invoke("delete-content", { body: { type: "article", id: a.id } });
                            if (error) { console.error(error); toast.error("Ошибка: " + error.message); return; }
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
