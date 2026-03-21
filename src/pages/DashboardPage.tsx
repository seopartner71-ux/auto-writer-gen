import { FileText, Search, BarChart3, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/shared/hooks/useAuth";
import { PLAN_LIMITS } from "@/shared/api/types";

const stats = [
  { label: "Статьи", value: "0", icon: FileText, color: "text-primary" },
  { label: "Ключевые слова", value: "0", icon: Search, color: "text-accent" },
  { label: "Средний SEO Score", value: "—", icon: BarChart3, color: "text-success" },
  { label: "Генерации", value: "0", icon: Zap, color: "text-warning" },
];

export default function DashboardPage() {
  const { profile } = useAuth();
  const plan = profile?.plan ?? "basic";
  const limits = PLAN_LIMITS[plan];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Дашборд</h1>
        <p className="text-muted-foreground mt-1">
          Обзор вашего контента и аналитики
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {s.label}
              </CardTitle>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg">Ваш тариф</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">План</span>
            <span className="font-medium text-primary uppercase">{plan}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Лимит генераций</span>
            <span>{limits.maxGenerations} / мес</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Доступные модели</span>
            <span className="text-right font-mono text-xs">
              {limits.models.length} шт.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
