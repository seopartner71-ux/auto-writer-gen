import { BarChart3 } from "lucide-react";

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">Аналитика</h1>
      </div>
      <p className="text-muted-foreground">
        Графики позиций ключевых слов будут доступны здесь.
      </p>
    </div>
  );
}
