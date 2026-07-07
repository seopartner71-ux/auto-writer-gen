import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, TrendingDown, Wand2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from "recharts";

type ArticleRow = {
  id: string;
  user_id: string;
  turgenev_score: number | null;
  turgenev_auto_fixed: boolean | null;
  language: string | null;
  created_at: string;
  email: string | null;
  plan: string | null;
};

const SCORE_BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: "0-2", min: 0, max: 2 },
  { label: "3-5", min: 3, max: 5 },
  { label: "6-8", min: 6, max: 8 },
  { label: "9-12", min: 9, max: 12 },
  { label: "13+", min: 13, max: 999 },
];

function bucketFor(score: number) {
  return SCORE_BUCKETS.find((b) => score >= b.min && score <= b.max)?.label ?? "13+";
}

export function TurgenevAnalyticsTab() {
  const [emailFilter, setEmailFilter] = useState("");
  const [planFilter, setPlanFilter] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["turgenev-analytics"],
    queryFn: async () => {
      // Admin RLS allows reading all articles + profiles.
      const { data: arts, error: e1 } = await supabase
        .from("articles")
        .select("id,user_id,turgenev_score,turgenev_auto_fixed,language,created_at")
        .not("turgenev_score", "is", null)
        .eq("language", "ru")
        .eq("is_ab_test", false)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (e1) throw e1;
      const userIds = Array.from(new Set((arts ?? []).map((a) => a.user_id)));
      let profMap = new Map<string, { email: string | null; plan: string | null }>();
      if (userIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id,email,plan")
          .in("id", userIds);
        profMap = new Map((profs ?? []).map((p) => [p.id, { email: p.email, plan: p.plan }]));
      }
      return (arts ?? []).map((a) => ({
        ...a,
        email: profMap.get(a.user_id)?.email ?? null,
        plan: profMap.get(a.user_id)?.plan ?? null,
      })) as ArticleRow[];
    },
    refetchInterval: 60_000,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const emailQ = emailFilter.trim().toLowerCase();
    return data.filter((r) => {
      if (emailQ && !(r.email || "").toLowerCase().includes(emailQ)) return false;
      if (planFilter !== "all" && (r.plan || "basic") !== planFilter) return false;
      return true;
    });
  }, [data, emailFilter, planFilter]);

  const before = filtered.filter((r) => r.turgenev_auto_fixed !== true);
  const after = filtered.filter((r) => r.turgenev_auto_fixed === true);

  const avg = (arr: ArticleRow[]) =>
    arr.length ? arr.reduce((s, r) => s + (r.turgenev_score ?? 0), 0) / arr.length : 0;
  const shareGood = (arr: ArticleRow[]) =>
    arr.length ? (arr.filter((r) => (r.turgenev_score ?? 99) <= 5).length / arr.length) * 100 : 0;

  const avgBefore = avg(before);
  const avgAfter = avg(after);
  const goodBefore = shareGood(before);
  const goodAfter = shareGood(after);

  const histData = useMemo(() => {
    return SCORE_BUCKETS.map((b) => ({
      bucket: b.label,
      Before: before.filter((r) => bucketFor(r.turgenev_score ?? 0) === b.label).length,
      After: after.filter((r) => bucketFor(r.turgenev_score ?? 0) === b.label).length,
    }));
  }, [before, after]);

  const trendData = useMemo(() => {
    const byDay = new Map<string, { date: string; b: number[]; a: number[] }>();
    for (const r of filtered) {
      const d = r.created_at.slice(0, 10);
      const e = byDay.get(d) || { date: d, b: [], a: [] };
      if (r.turgenev_auto_fixed) e.a.push(r.turgenev_score ?? 0);
      else e.b.push(r.turgenev_score ?? 0);
      byDay.set(d, e);
    }
    const arr = Array.from(byDay.values()).sort((x, y) => x.date.localeCompare(y.date));
    return arr.slice(-30).map((e) => ({
      date: e.date.slice(5),
      "Без Auto-Fix": e.b.length ? +(e.b.reduce((s, x) => s + x, 0) / e.b.length).toFixed(2) : null,
      "После Auto-Fix": e.a.length ? +(e.a.reduce((s, x) => s + x, 0) / e.a.length).toFixed(2) : null,
    }));
  }, [filtered]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="pt-6 flex flex-wrap gap-3 items-center">
          <Input
            placeholder="Поиск по email пользователя"
            value={emailFilter}
            onChange={(e) => setEmailFilter(e.target.value)}
            className="max-w-xs"
          />
          <Select value={planFilter} onValueChange={setPlanFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Тариф" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все тарифы</SelectItem>
              <SelectItem value="basic">basic</SelectItem>
              <SelectItem value="pro">pro</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="outline" className="ml-auto">
            Статей в выборке: {filtered.length}
          </Badge>
        </CardContent>
      </Card>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<TrendingDown className="h-4 w-4" />}
          label="Средний балл (без Auto-Fix)"
          value={avgBefore.toFixed(2)}
          sub={`${before.length} статей`}
        />
        <KpiCard
          icon={<Wand2 className="h-4 w-4 text-primary" />}
          label="Средний балл (после Auto-Fix)"
          value={avgAfter.toFixed(2)}
          sub={`${after.length} статей`}
          highlight
        />
        <KpiCard
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Доля ≤5 (без Auto-Fix)"
          value={`${goodBefore.toFixed(1)}%`}
          sub="Низкий риск Баден-Баден"
        />
        <KpiCard
          icon={<ShieldCheck className="h-4 w-4 text-primary" />}
          label="Доля ≤5 (после Auto-Fix)"
          value={`${goodAfter.toFixed(1)}%`}
          sub={
            avgBefore > 0
              ? `${goodAfter - goodBefore >= 0 ? "+" : ""}${(goodAfter - goodBefore).toFixed(1)} п.п.`
              : "-"
          }
          highlight
        />
      </div>

      {/* Histogram */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Распределение по баллам Тургенева</CardTitle>
        </CardHeader>
        <CardContent className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={histData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="bucket" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                }}
              />
              <Legend />
              <Bar dataKey="Before" name="Без Auto-Fix" fill="hsl(0, 70%, 55%)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="After" name="После Auto-Fix" fill="hsl(142, 70%, 45%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Средний балл по дням (последние 30 дней)</CardTitle>
        </CardHeader>
        <CardContent className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="Без Auto-Fix"
                stroke="hsl(0, 70%, 55%)"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="После Auto-Fix"
                stroke="hsl(142, 70%, 45%)"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  icon, label, value, sub, highlight,
}: { icon: React.ReactNode; label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-primary/40" : undefined}>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          {icon}
          <span>{label}</span>
        </div>
        <div className="text-2xl font-semibold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}