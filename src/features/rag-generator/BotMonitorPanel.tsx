import { useCallback, useEffect, useState } from "react";
import { Bot, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface BotLog {
  id: string;
  project_name: string;
  bot_name: string;
  requested_file: string | null;
  repository_name: string | null;
  full_user_agent: string | null;
  visited_at: string;
}

const FILTERS = ["GPTBot", "ClaudeBot", "PerplexityBot", "YandexBot"] as const;

const SELECT_COLS =
  "id, project_name, bot_name, requested_file, repository_name, full_user_agent, visited_at";

export function BotMonitorPanel() {
  const [logs, setLogs] = useState<BotLog[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("bot_analytics_logs")
      .select(SELECT_COLS)
      .order("visited_at", { ascending: false })
      .limit(100);
    setLogs((data ?? []) as BotLog[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("rag-bot-monitor")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bot_analytics_logs" },
        (payload) => {
          setLogs((prev) => [payload.new as BotLog, ...prev].slice(0, 100));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const visible = filter
    ? logs.filter((l) => l.bot_name.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-mono uppercase tracking-wide">
          <Bot className="h-4 w-4 text-primary" />
          Мониторинг ИИ-ботов 24/7
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge
            variant={filter === null ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setFilter(null)}
          >
            Все ({logs.length})
          </Badge>
          {FILTERS.map((name) => (
            <Badge
              key={name}
              variant={filter === name ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setFilter(filter === name ? null : name)}
            >
              {name} ({logs.filter((l) => l.bot_name.toLowerCase().includes(name.toLowerCase())).length})
            </Badge>
          ))}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Время</TableHead>
                <TableHead>Бот</TableHead>
                <TableHead>Файл</TableHead>
                <TableHead>Репозиторий</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={4} className="text-xs text-muted-foreground">
                    Заходов пока нет. Данные появятся после публикации архива.
                  </TableCell>
                </TableRow>
              )}
              {visible.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {new Date(l.visited_at).toLocaleString("ru-RU")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{l.bot_name}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{l.requested_file || "-"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {l.repository_name || l.project_name}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
