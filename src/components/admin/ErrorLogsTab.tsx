import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { AlertTriangle, Database, Globe, Shield, RefreshCw, Loader2, Search, CalendarIcon, X } from "lucide-react";

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
  const [searchText, setSearchText] = useState("");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();

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

  const filterLogs = useMemo(() => {
    const logs = current?.data || [];
    const query = searchText.toLowerCase().trim();

    return logs.filter((log) => {
      // Text search
      if (query) {
        const haystack = `${log.message} ${log.details || ""} ${log.source} ${log.level}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      // Date from
      if (dateFrom) {
        const logDate = new Date(log.timestamp);
        const from = new Date(dateFrom);
        from.setHours(0, 0, 0, 0);
        if (logDate < from) return false;
      }
      // Date to
      if (dateTo) {
        const logDate = new Date(log.timestamp);
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (logDate > to) return false;
      }
      return true;
    });
  }, [current?.data, searchText, dateFrom, dateTo]);

  const hasFilters = searchText || dateFrom || dateTo;

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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по тексту ошибки..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("h-9 gap-1.5", dateFrom && "text-foreground")}>
              <CalendarIcon className="h-3.5 w-3.5" />
              {dateFrom ? format(dateFrom, "dd.MM.yy") : "С даты"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateFrom}
              onSelect={setDateFrom}
              disabled={(date) => date > new Date()}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("h-9 gap-1.5", dateTo && "text-foreground")}>
              <CalendarIcon className="h-3.5 w-3.5" />
              {dateTo ? format(dateTo, "dd.MM.yy") : "По дату"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateTo}
              onSelect={setDateTo}
              disabled={(date) => date > new Date()}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1 text-muted-foreground"
            onClick={() => { setSearchText(""); setDateFrom(undefined); setDateTo(undefined); }}
          >
            <X className="h-3.5 w-3.5" />
            Сбросить
          </Button>
        )}

        {hasFilters && (
          <span className="text-xs text-muted-foreground ml-auto">
            Найдено: {filterLogs.length} из {current?.data?.length || 0}
          </span>
        )}
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
            <LogsList
              logs={key === activeTab ? filterLogs : (logsMap[key].data || [])}
              isLoading={logsMap[key].isLoading}
            />
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
