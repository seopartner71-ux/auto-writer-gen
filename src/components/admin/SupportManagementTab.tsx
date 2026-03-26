import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import { Trash2, Send, ChevronDown, ChevronUp, User, ShieldCheck } from "lucide-react";

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
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);
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

  const { data: messages = [] } = useQuery({
    queryKey: ["admin-ticket-messages", expandedTicket],
    queryFn: async () => {
      if (!expandedTicket) return [];
      const { data, error } = await supabase
        .from("ticket_messages")
        .select("*")
        .eq("ticket_id", expandedTicket)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!expandedTicket,
  });

  const handleStatusChange = async (ticketId: string, status: string) => {
    const { error } = await supabase.from("support_tickets").update({ status }).eq("id", ticketId);
    if (error) toast.error("Ошибка: " + error.message);
    else {
      toast.success("Статус обновлён");
      queryClient.invalidateQueries({ queryKey: ["admin-support-tickets"] });
    }
  };

  const handleDelete = async (ticketId: string) => {
    if (!confirm("Удалить этот тикет и все сообщения?")) return;
    const { error } = await supabase.from("support_tickets").delete().eq("id", ticketId);
    if (error) toast.error("Ошибка: " + error.message);
    else {
      toast.success("Тикет удалён");
      if (expandedTicket === ticketId) setExpandedTicket(null);
      queryClient.invalidateQueries({ queryKey: ["admin-support-tickets"] });
    }
  };

  const handleReply = async (ticket: any) => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      // Insert admin message into thread
      const { error } = await supabase.from("ticket_messages").insert({
        ticket_id: ticket.id,
        sender_role: "admin",
        message: replyText.trim(),
      });
      if (error) throw error;

      // Update ticket status
      await supabase.from("support_tickets").update({ status: "in_progress" }).eq("id", ticket.id);

      // Send in-app notification to user
      await supabase.from("notifications").insert({
        user_id: ticket.user_id,
        title: "Ответ на ваш запрос 💬",
        message: `Тема: ${ticket.subject}\n\nОтвет: ${replyText.trim()}`,
      });

      toast.success("Ответ отправлен");
      setReplyText("");
      queryClient.invalidateQueries({ queryKey: ["admin-ticket-messages", ticket.id] });
      queryClient.invalidateQueries({ queryKey: ["admin-support-tickets"] });
    } catch (err: any) {
      toast.error("Ошибка: " + err.message);
    } finally {
      setSending(false);
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Загрузка...</p>;

  return (
    <div className="space-y-3">
      {tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Нет обращений</p>
      ) : (
        tickets.map((ticket: any) => {
          const cfg = statusConfig[ticket.status] ?? statusConfig.open;
          const isExpanded = expandedTicket === ticket.id;

          return (
            <Card key={ticket.id}>
              <button
                type="button"
                className="w-full p-4 flex items-start justify-between gap-3 text-left hover:bg-muted/30 transition-colors"
                onClick={() => { setExpandedTicket(isExpanded ? null : ticket.id); setReplyText(""); }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-sm">{ticket.subject}</h3>
                    <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{ticket.profile?.full_name || "—"}</span>
                    <span>{ticket.profile?.email}</span>
                    <span>{format(new Date(ticket.created_at), "dd.MM.yy HH:mm")}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Select value={ticket.status} onValueChange={(v) => { handleStatusChange(ticket.id, v); }}>
                    <SelectTrigger className="w-[120px] h-7 text-xs" onClick={(e) => e.stopPropagation()}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Удалить" onClick={(e) => { e.stopPropagation(); handleDelete(ticket.id); }}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </button>

              {isExpanded && (
                <CardContent className="border-t pt-3 space-y-3">
                  {/* Original message */}
                  <div className="bg-muted/50 rounded-md p-3 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">Исходный запрос:</span>
                    <p className="mt-1 whitespace-pre-wrap">{ticket.message}</p>
                  </div>

                  {/* Conversation thread */}
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {messages.map((msg: any) => (
                      <div key={msg.id} className={`flex ${msg.sender_role === "admin" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] rounded-lg p-3 ${msg.sender_role === "admin" ? "bg-primary/10" : "bg-muted"}`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            {msg.sender_role === "admin" ? (
                              <ShieldCheck className="h-3 w-3 text-primary" />
                            ) : (
                              <User className="h-3 w-3 text-muted-foreground" />
                            )}
                            <span className="text-xs font-medium">
                              {msg.sender_role === "admin" ? "Вы (админ)" : ticket.profile?.full_name || ticket.profile?.email || "Пользователь"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(msg.created_at), "dd.MM HH:mm")}
                            </span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Reply input */}
                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Написать ответ..."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={2}
                      maxLength={2000}
                      className="flex-1"
                    />
                    <Button
                      size="icon"
                      className="shrink-0 self-end"
                      disabled={sending || !replyText.trim()}
                      onClick={() => handleReply(ticket)}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
