import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Database, Globe, Shield, RefreshCw, Loader2 } from "lucide-react";

interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  level: string;
  source: string;
  details?: string;
}

function formatTimestamp(ts: string) {
  try {
    return new Date(ts).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return ts;
  }
}

function levelBadge(level: string) {
  const l = level?.toLowerCase();
  if (l === "error" || l === "fatal") return <Badge variant="destructive" className="text-xs">{level}</Badge>;
  if (l === "warning" || l === "warn") return <Badge className="bg-warning/20 text-warning border-warning/30 text-xs">{level}</Badge>;
  return <Badge variant="secondary" className="text-xs">{level}</Badge>;
}

export function ErrorLogsTab() {
  const [activeTab, setActiveTab] = useState("db");

  const dbLogs = useQuery({
    queryKey: ["admin-error-logs", "db"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("health-check", {
        body: { action: "error-logs", source: "db" },
      });
      if (error) throw error;
      return (data?.logs || []) as LogEntry[];
    },
    refetchInterval: 30000,
  });

  const edgeLogs = useQuery({
    queryKey: ["admin-error-logs", "edge"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("health-check", {
        body: { action: "error-logs", source: "edge" },
      });
      if (error) throw error;
      return (data?.logs || []) as LogEntry[];
    },
    refetchInterval: 30000,
  });

  const authLogs = useQuery({
    queryKey: ["admin-error-logs", "auth"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("health-check", {
        body: { action: "error-logs", source: "auth" },
      });
      if (error) throw error;
      return (data?.logs || []) as LogEntry[];
    },
    refetchInterval: 30000,
  });

  const logsMap: Record<string, { data?: LogEntry[]; isLoading: boolean; refetch: () => void; icon: React.ReactNode; label: string }> = {
    db: { ...dbLogs, data: dbLogs.data, icon: <Database className="h-4 w-4" />, label: "База данных" },
    edge: { ...edgeLogs, data: edgeLogs.data, icon: <Globe className="h-4 w-4" />, label: "Edge Functions" },
    auth: { ...authLogs, data: authLogs.data, icon: <Shield className="h-4 w-4" />, label: "Авторизация" },
  };

  const current = logsMap[activeTab];
  const logs = current?.data || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Последние ошибки и предупреждения из логов системы. Обновление каждые 30 сек.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => current?.refetch()}
          disabled={current?.isLoading}
        >
          {current?.isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Обновить
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted border border-border">
          {Object.entries(logsMap).map(([key, val]) => (
            <TabsTrigger key={key} value={key} className="flex items-center gap-1.5">
              {val.icon}
              {val.label}
              {val.data && val.data.length > 0 && (
                <Badge variant="destructive" className="ml-1 text-xs px-1.5 py-0">
                  {val.data.length}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {Object.keys(logsMap).map((key) => (
          <TabsContent key={key} value={key} className="mt-4">
            <LogsList logs={logsMap[key].data || []} isLoading={logsMap[key].isLoading} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function LogsList({ logs, isLoading }: { logs: LogEntry[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Loader2 className="h-8 w-8 mx-auto mb-3 animate-spin opacity-50" />
        <p>Загрузка логов...</p>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <AlertTriangle className="h-12 w-12 mx-auto mb-3 opacity-20" />
        <p>Ошибок не найдено — всё работает штатно ✓</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[600px] overflow-y-auto">
      {logs.map((log, i) => (
        <Card key={log.id || i} className="bg-card border-border">
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                {levelBadge(log.level)}
                <span className="text-muted-foreground font-mono">{formatTimestamp(log.timestamp)}</span>
              </div>
              {log.source && (
                <span className="text-muted-foreground text-xs font-normal">{log.source}</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2 px-4">
            <p className="text-sm font-mono break-all whitespace-pre-wrap">{log.message}</p>
            {log.details && (
              <p className="text-xs text-muted-foreground mt-1 font-mono break-all">{log.details}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
