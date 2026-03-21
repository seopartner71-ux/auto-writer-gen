import { FileText } from "lucide-react";

export default function ArticlesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileText className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">Статьи</h1>
      </div>
      <p className="text-muted-foreground">
        Создание и управление статьями будет доступно здесь.
      </p>
    </div>
  );
}
