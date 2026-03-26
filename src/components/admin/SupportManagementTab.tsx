import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { Trash2, MessageSquareReply, CheckCircle2, Clock, AlertCircle } from "lucide-react";

const statusOptions = [
  { value: "open", label: "Открыт" },
  { value: "in_progress", label: "В работе" },
  { value: "resolved", label: "Решён" },
];

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  open: { label: "Открыт", variant: "default" },
  in_progress: { label: "В работе", variant: "secondary" },
  resolved: { label: "Решён", variant: "outline" },
};

export function SupportManagementTab() {
  const queryClient = useQueryClient();
  const [replyTicket, setReplyTicket] = useState<any | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["admin-support-tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      if (!data || data.length === 0) return [];

      const userIds = [...new Set(data.map((t) => t.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds);

      const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
      return data.map((t) => ({ ...t, profile: profileMap.get(t.user_id) }));
    },
  });

  const handleStatusChange = async (ticketId: string, status: string) => {
    const { error } = await supabase
      .from("support_tickets")
      .update({ status })
      .eq("id", ticketId);
    if (error) {
      toast.error("Ошибка: " + error.message);
    } else {
      toast.success("Статус обновлён");
      queryClient.invalidateQueries({ queryKey: ["admin-support-tickets"] });
    }
  };

  const handleDelete = async (ticketId: string) => {
    if (!confirm("Удалить этот тикет?")) return;
    const { error } = await supabase
      .from("support_tickets")
      .delete()
      .eq("id", ticketId);
    if (error) {
      toast.error("Ошибка: " + error.message);
    } else {
      toast.success("Тикет удалён");
      queryClient.invalidateQueries({ queryKey: ["admin-support-tickets"] });
    }
  };

  const handleReply = async () => {
    if (!replyTicket || !replyText.trim()) return;
    setSending(true);
    try {
      const { error } = await supabase
        .from("support_tickets")
        .update({
          admin_reply: replyText.trim(),
          replied_at: new Date().toISOString(),
          status: "resolved",
        })
        .eq("id", replyTicket.id);
      if (error) throw error;

      // Send in-app notification to user
      await supabase.from("notifications").insert({
        user_id: replyTicket.user_id,
        title: "Ответ на ваш запрос 💬",
        message: `Тема: ${replyTicket.subject}\n\nОтвет: ${replyText.trim()}`,
      });

      toast.success("Ответ отправлен");
      setReplyTicket(null);
      setReplyText("");
      queryClient.invalidateQueries({ queryKey: ["admin-support-tickets"] });
    } catch (err: any) {
      toast.error("Ошибка: " + err.message);
    } finally {
      setSending(false);
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Загрузка...</p>;

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Пользователь</TableHead>
                <TableHead>Тема</TableHead>
                <TableHead>Сообщение</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Нет обращений
                  </TableCell>
                </TableRow>
              ) : (
                tickets.map((ticket: any) => {
                  const cfg = statusConfig[ticket.status] ?? statusConfig.open;
                  return (
                    <TableRow key={ticket.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {format(new Date(ticket.created_at), "dd.MM.yy HH:mm")}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{ticket.profile?.full_name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{ticket.profile?.email}</div>
                      </TableCell>
                      <TableCell className="text-sm font-medium max-w-[200px] truncate">{ticket.subject}</TableCell>
                      <TableCell className="text-sm max-w-[300px] truncate">{ticket.message}</TableCell>
                      <TableCell>
                        <Select value={ticket.status} onValueChange={(v) => handleStatusChange(ticket.id, v)}>
                          <SelectTrigger className="w-[130px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {statusOptions.map((o) => (
                              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Ответить"
                          onClick={() => { setReplyTicket(ticket); setReplyText(ticket.admin_reply ?? ""); }}
                        >
                          <MessageSquareReply className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Удалить"
                          onClick={() => handleDelete(ticket.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Reply dialog */}
      <Dialog open={!!replyTicket} onOpenChange={(open) => { if (!open) setReplyTicket(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ответить на запрос</DialogTitle>
          </DialogHeader>
          {replyTicket && (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Тема:</span>{" "}
                <span className="font-medium">{replyTicket.subject}</span>
              </div>
              <div className="text-sm bg-muted p-3 rounded-md whitespace-pre-wrap">{replyTicket.message}</div>
              <Textarea
                placeholder="Введите ответ..."
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={4}
                maxLength={2000}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplyTicket(null)}>Отмена</Button>
            <Button onClick={handleReply} disabled={sending || !replyText.trim()}>
              {sending ? "Отправка..." : "Отправить ответ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
