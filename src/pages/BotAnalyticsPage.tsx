import { useEffect, useState } from "react";
import { Bot, RefreshCw, Download, Trash2 } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";

interface BotLog {
  id: string;
  project_name: string;
  bot_name: string;
  full_user_agent: string | null;
  ip_address: string | null;
  visited_at: string;
}

function escapeCsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const needsQuotes = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function downloadCsv(rows: BotLog[]): void {
  const headers = ["Дата", "Клиент", "Бот", "IP", "User-Agent"];
  const lines = [headers.join(",")];
  for (const l of rows) {
    lines.push(
      [
        escapeCsvCell(new Date(l.visited_at).toLocaleString("ru-RU")),
        escapeCsvCell(l.project_name),
        escapeCsvCell(l.bot_name),
        escapeCsvCell(l.ip_address),
        escapeCsvCell(l.full_user_agent),
      ].join(",")
    );
  }
  const csv = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "bot_analytics.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function BotAnalyticsPage() {
  const [logs, setLogs] = useState<BotLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

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

  const handleExport = () => {
    if (logs.length === 0) {
      toast({ title: "Нет данных для экспорта" });
      return;
    }
    downloadCsv(logs);
    toast({ title: "CSV экспортирован", description: `${logs.length} записей` });
  };

  const handleClear = async () => {
    setClearing(true);
    const { error } = await supabase.from("bot_analytics_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) {
      toast({ title: "Не удалось очистить логи", description: error.message, variant: "destructive" });
    } else {
      setLogs([]);
      toast({ title: "Логи очищены" });
    }
    setClearing(false);
  };

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
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={loading || logs.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Скачать CSV
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={clearing || logs.length === 0}>
                <Trash2 className="h-4 w-4 mr-2" />
                {clearing ? "Очистка..." : "Очистить логи"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Удалить все логи?</AlertDialogTitle>
                <AlertDialogDescription>
                  Вы уверены, что хотите удалить все логи? Это действие нельзя отменить.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleClear}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Удалить всё
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Обновить
          </Button>
        </div>
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
