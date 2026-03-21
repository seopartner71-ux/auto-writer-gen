import { Search } from "lucide-react";

export default function KeywordsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Search className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">Ключевые слова</h1>
      </div>
      <p className="text-muted-foreground">
        Исследование ключевых слов и SERP-анализ будут доступны здесь.
      </p>
    </div>
  );
}
