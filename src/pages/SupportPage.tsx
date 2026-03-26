import { useState } from "react";
import { useAuth } from "@/shared/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { LifeBuoy, Send, Clock, CheckCircle2, AlertCircle, MessageCircle, ChevronDown, ChevronUp, User, ShieldCheck } from "lucide-react";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Clock }> = {
  open: { label: "Открыт", variant: "default", icon: Clock },
  in_progress: { label: "В работе", variant: "secondary", icon: AlertCircle },
  resolved: { label: "Решён", variant: "outline", icon: CheckCircle2 },
};

export default function SupportPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyingSending, setReplyingSending] = useState(false);

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["support-tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["ticket-messages", expandedTicket],
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !subject.trim() || !message.trim()) return;

    setSending(true);
    try {
      const { data: ticket, error } = await supabase
        .from("support_tickets")
        .insert({ user_id: user.id, subject: subject.trim(), message: message.trim() })
        .select()
        .single();
      if (error) throw error;

      // Insert initial message into thread
      await supabase.from("ticket_messages").insert({
        ticket_id: ticket.id,
        sender_role: "user",
        message: message.trim(),
      });

      // Notify admin via telegram (fire & forget)
      supabase.functions.invoke("telegram-notify", {
        body: {
          type: "new_support_ticket",
          data: { email: user.email, subject: subject.trim(), message: message.trim() },
        },
      });

      toast.success("Запрос отправлен! Мы ответим в ближайшее время.");
      setSubject("");
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    } catch (err: any) {
      toast.error("Ошибка при отправке: " + err.message);
    } finally {
      setSending(false);
    }
  };

  const handleUserReply = async (ticketId: string) => {
    if (!replyText.trim()) return;
    setReplyingSending(true);
    try {
      await supabase.from("ticket_messages").insert({
        ticket_id: ticketId,
        sender_role: "user",
        message: replyText.trim(),
      });

      // Reopen ticket when user replies
      await supabase.from("support_tickets").update({ status: "open" }).eq("id", ticketId);

      // Notify admin
      const ticket = tickets.find((t) => t.id === ticketId);
      supabase.functions.invoke("telegram-notify", {
        body: {
          type: "support_user_reply",
          data: { email: user?.email, subject: ticket?.subject, message: replyText.trim() },
        },
      });

      toast.success("Сообщение отправлено");
      setReplyText("");
      queryClient.invalidateQueries({ queryKey: ["ticket-messages", ticketId] });
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    } catch (err: any) {
      toast.error("Ошибка: " + err.message);
    } finally {
      setReplyingSending(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <LifeBuoy className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Поддержка</h1>
          <p className="text-sm text-muted-foreground">Опишите проблему или задайте вопрос — мы поможем</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Send className="h-4 w-4" />
            Новый запрос
          </CardTitle>
          <CardDescription>Заполните форму и мы свяжемся с вами</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subject">Тема</Label>
              <Input id="subject" placeholder="Кратко опишите проблему..." value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Сообщение</Label>
              <Textarea id="message" placeholder="Опишите подробнее, что произошло..." value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={2000} required />
            </div>
            <Button type="submit" disabled={sending || !subject.trim() || !message.trim()}>
              {sending ? "Отправка..." : "Отправить запрос"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            Мои обращения
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Загрузка...</p>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">У вас пока нет обращений</p>
          ) : (
            <div className="space-y-3">
              {tickets.map((ticket) => {
                const cfg = statusConfig[ticket.status] ?? statusConfig.open;
                const StatusIcon = cfg.icon;
                const isExpanded = expandedTicket === ticket.id;
                return (
                  <div key={ticket.id} className="border rounded-lg overflow-hidden">
                    <button
                      type="button"
                      className="w-full p-4 flex items-start justify-between gap-2 text-left hover:bg-muted/30 transition-colors"
                      onClick={() => setExpandedTicket(isExpanded ? null : ticket.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm">{ticket.subject}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(ticket.created_at!).toLocaleString("ru-RU")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant={cfg.variant} className="flex items-center gap-1">
                          <StatusIcon className="h-3 w-3" />
                          {cfg.label}
                        </Badge>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t px-4 py-3 space-y-3">
                        {/* Chat messages */}
                        <div className="space-y-2 max-h-[400px] overflow-y-auto">
                          {messages.map((msg: any) => (
                            <div
                              key={msg.id}
                              className={`flex ${msg.sender_role === "user" ? "justify-end" : "justify-start"}`}
                            >
                              <div className={`max-w-[80%] rounded-lg p-3 ${msg.sender_role === "user" ? "bg-primary/10 text-foreground" : "bg-muted"}`}>
                                <div className="flex items-center gap-1.5 mb-1">
                                  {msg.sender_role === "admin" ? (
                                    <ShieldCheck className="h-3 w-3 text-primary" />
                                  ) : (
                                    <User className="h-3 w-3 text-muted-foreground" />
                                  )}
                                  <span className="text-xs font-medium">
                                    {msg.sender_role === "admin" ? "Поддержка" : "Вы"}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(msg.created_at).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                                  </span>
                                </div>
                                <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Reply input */}
                        {ticket.status !== "resolved" && (
                          <div className="flex gap-2">
                            <Textarea
                              placeholder="Написать сообщение..."
                              value={replyText}
                              onChange={(e) => setReplyText(e.target.value)}
                              rows={2}
                              maxLength={2000}
                              className="flex-1"
                            />
                            <Button
                              size="icon"
                              className="shrink-0 self-end"
                              disabled={replyingSending || !replyText.trim()}
                              onClick={() => handleUserReply(ticket.id)}
                            >
                              <Send className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                        {ticket.status === "resolved" && (
                          <p className="text-xs text-muted-foreground text-center">Обращение закрыто. Создайте новый запрос если нужна помощь.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
