import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Receipt, TrendingUp } from "lucide-react";
import { format } from "date-fns";

interface PaymentLog {
  id: string;
  user_id: string;
  email: string | null;
  plan_id: string | null;
  amount_rub: number;
  order_id: string | null;
  status: string;
  created_at: string;
}

const PLAN_LABELS: Record<string, string> = {
  free: "NANO",
  basic: "PRO",
  pro: "FACTORY",
};

export function PaymentLogsTab() {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["admin-payment-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as PaymentLog[];
    },
    refetchInterval: 30_000,
  });

  const totalRevenue = logs.reduce((sum, l) => sum + (l.status === "success" ? l.amount_rub : 0), 0);
  const successCount = logs.filter((l) => l.status === "success").length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="bg-card border-border">
          <CardContent className="flex items-center gap-3 py-4">
            <Receipt className="h-8 w-8 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Всего транзакций</p>
              <p className="text-2xl font-bold">{logs.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="flex items-center gap-3 py-4">
            <TrendingUp className="h-8 w-8 text-emerald-500" />
            <div>
              <p className="text-xs text-muted-foreground">Успешных</p>
              <p className="text-2xl font-bold">{successCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="flex items-center gap-3 py-4">
            <Receipt className="h-8 w-8 text-amber-500" />
            <div>
              <p className="text-xs text-muted-foreground">Общий доход</p>
              <p className="text-2xl font-bold">{totalRevenue.toLocaleString("ru-RU")} ₽</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            Журнал платежей
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {logs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Платежей пока нет</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead>Дата</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Тариф</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Order ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} className="border-border">
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(log.created_at), "dd.MM.yyyy HH:mm")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.email || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {PLAN_LABELS[log.plan_id || ""] || log.plan_id || "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">
                      {log.amount_rub.toLocaleString("ru-RU")} ₽
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={log.status === "success" ? "default" : "destructive"}
                        className="text-xs"
                      >
                        {log.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {log.order_id || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
