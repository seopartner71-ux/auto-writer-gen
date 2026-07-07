import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Sparkles, Wrench, Bug, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CHANGELOG, type ChangelogType, type ChangelogRelease } from "@/data/changelog";

const TYPE_META: Record<ChangelogType, { label: string; cls: string; Icon: typeof Sparkles }> = {
  new:         { label: "НОВОЕ",       cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", Icon: Sparkles },
  improvement: { label: "УЛУЧШЕНИЕ",   cls: "bg-blue-500/15 text-blue-400 border-blue-500/30",         Icon: Wrench },
  fix:         { label: "ИСПРАВЛЕНИЕ", cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",   Icon: Bug },
  breaking:    { label: "ВАЖНОЕ",      cls: "bg-red-500/15 text-red-400 border-red-500/30",            Icon: AlertTriangle },
};

const FILTERS: { key: "all" | ChangelogType; label: string }[] = [
  { key: "all",         label: "Все" },
  { key: "new",         label: "Новое" },
  { key: "improvement", label: "Улучшение" },
  { key: "fix",         label: "Исправление" },
  { key: "breaking",    label: "Важное" },
];

export default function ChangelogPage() {
  const [filter, setFilter] = useState<typeof FILTERS[number]["key"]>("all");
  const releases: ChangelogRelease[] = CHANGELOG;

  // Отмечаем последнюю версию как просмотренную, чтобы точка в сайдбаре исчезла.
  useEffect(() => {
    if (releases.length) {
      localStorage.setItem("changelog_last_seen", releases[0].version);
      window.dispatchEvent(new Event("changelog:seen"));
    }
  }, [releases]);

  const latest = releases[0];
  const filtered = useMemo(() => {
    if (filter === "all") return releases;
    return releases
      .map((r) => ({ ...r, items: r.items.filter((i) => i.type === filter) }))
      .filter((r) => r.items.length > 0);
  }, [releases, filter]);

  const fmtDate = (d: string) => format(new Date(d), "d MMMM yyyy", { locale: ru });

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">История обновлений</h1>
          <p className="text-muted-foreground mt-1">Что нового в СЕО-Модуле</p>
          {latest && (
            <div className="mt-4 flex items-baseline gap-3">
              <span className="text-4xl font-bold text-primary">v{latest.version}</span>
              <span className="text-sm text-muted-foreground">{fmtDate(latest.date)}</span>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
              filter === f.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-transparent text-muted-foreground border-border hover:bg-muted/50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-6">
        {filtered.map((r) => (
          <Card key={r.version} className="p-6">
            <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
              <div className="flex items-baseline gap-3">
                <h2 className="text-2xl font-bold">v{r.version}</h2>
                <span className="text-sm text-muted-foreground">{fmtDate(r.date)}</span>
              </div>
              <p className="text-sm text-muted-foreground">{r.title}</p>
            </div>
            <ul className="space-y-3">
              {r.items.map((it, i) => {
                const meta = TYPE_META[it.type];
                const Icon = meta.Icon;
                return (
                  <li key={i} className="flex items-start gap-3">
                    <Badge variant="outline" className={`shrink-0 ${meta.cls}`}>
                      <Icon className="h-3 w-3 mr-1" />
                      {meta.label}
                    </Badge>
                    <span className="text-sm leading-relaxed pt-0.5">{it.text}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-muted-foreground py-12">Записей по этому фильтру пока нет.</p>
        )}
      </div>
    </div>
  );
}
