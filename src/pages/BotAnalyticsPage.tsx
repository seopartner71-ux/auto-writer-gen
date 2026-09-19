import { useEffect, useState } from "react";
import { Bot, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";

interface BotLog {
  id: string;
  project_name: string;
  bot_name: string;
  full_user_agent: string | null;
  ip_address: string | null;
  visited_at: string;
}

export default function BotAnalyticsPage() {
  const [logs, setLogs] = useState<BotLog[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("bot_analytics_logs")
      .select("id, project_name, bot_name, full_user_agent, ip_address, visited_at")
      .order("visited_at", { ascending: false })
      .limit(500);
    if (error) {
      toast({ title: "Не удалось загрузить данные", description: error.message, variant: "destructive" });
    } else {
      setLogs((data ?? []) as BotLog[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const byBot = logs.reduce<Record<string, number>>((acc, l) => {
    acc[l.bot_name] = (acc[l.bot_name] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Bot className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Аналитика ИИ-ботов</h1>
            <p className="text-sm text-muted-foreground">
              Визиты краулеров языковых моделей на опубликованные RAG-архивы
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(byBot)
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => (
            <Badge key={name} variant="secondary">
              {name}: {count}
            </Badge>
          ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Журнал визитов (последние 500)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Дата</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Бот</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>User-Agent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">
                      Пока нет визитов. Пиксель начнет собирать данные после публикации архива.
                    </TableCell>
                  </TableRow>
                )}
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(l.visited_at).toLocaleString("ru-RU")}
                    </TableCell>
                    <TableCell className="text-sm">{l.project_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{l.bot_name}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.ip_address || "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[420px] truncate">
                      {l.full_user_agent || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
