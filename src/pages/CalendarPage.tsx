import { CalendarDays } from "lucide-react";

export default function CalendarPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <CalendarDays className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">Контент-календарь</h1>
      </div>
      <p className="text-muted-foreground">
        Канбан-доска для планирования контента будет доступна здесь.
      </p>
    </div>
  );
}
