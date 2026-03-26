import { useState } from "react";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { LifeBuoy, Send, Clock, CheckCircle2, AlertCircle, MessageCircle } from "lucide-react";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Clock }> = {
  open: { label: "Открыт", variant: "default", icon: Clock },
  in_progress: { label: "В работе", variant: "secondary", icon: AlertCircle },
  resolved: { label: "Решён", variant: "outline", icon: CheckCircle2 },
};

export default function SupportPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !subject.trim() || !message.trim()) return;

    setSending(true);
    try {
      const { error } = await supabase.from("support_tickets").insert({
        user_id: user.id,
        subject: subject.trim(),
        message: message.trim(),
      });
      if (error) throw error;

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

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <LifeBuoy className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Поддержка</h1>
          <p className="text-sm text-muted-foreground">Опишите проблему или задайте вопрос — мы поможем</p>
        </div>
      </div>

      {/* New ticket form */}
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
              <Input
                id="subject"
                placeholder="Кратко опишите проблему..."
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Сообщение</Label>
              <Textarea
                id="message"
                placeholder="Опишите подробнее, что произошло..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                maxLength={2000}
                required
              />
            </div>
            <Button type="submit" disabled={sending || !subject.trim() || !message.trim()}>
              {sending ? "Отправка..." : "Отправить запрос"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Ticket history */}
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
                return (
                  <div
                    key={ticket.id}
                    className="border rounded-lg p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-medium text-sm">{ticket.subject}</h3>
                      <Badge variant={cfg.variant} className="shrink-0 flex items-center gap-1">
                        <StatusIcon className="h-3 w-3" />
                        {cfg.label}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{ticket.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(ticket.created_at!).toLocaleString("ru-RU")}
                    </p>
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
