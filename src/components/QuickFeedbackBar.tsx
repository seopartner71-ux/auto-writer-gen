import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bug, Lightbulb, AlertTriangle, MessageSquarePlus, X, Sparkles } from "lucide-react";
import { toast } from "sonner";

type FeedbackType = "bug" | "error" | "idea";

const TYPES: { value: FeedbackType; label: string; tag: string; icon: typeof Bug }[] = [
  { value: "bug", label: "Баг в интерфейсе", tag: "БАГ", icon: Bug },
  { value: "error", label: "Ошибка системы", tag: "ОШИБКА", icon: AlertTriangle },
  { value: "idea", label: "Идея / рекомендация", tag: "ИДЕЯ", icon: Lightbulb },
];

export function QuickFeedbackBar() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState<boolean>(false);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("bug");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "quick_feedback_enabled")
        .maybeSingle();
      if (active) setEnabled((data?.value ?? "true") === "true");
    })();
    return () => { active = false; };
  }, []);

  if (!enabled || !user) return null;

  const submit = async () => {
    const text = message.trim();
    if (text.length < 5) {
      toast.error("Опишите проблему подробнее (минимум 5 символов)");
      return;
    }
    setSending(true);
    try {
      const cfg = TYPES.find((t) => t.value === type)!;
      const cleanSubject = subject.trim() || text.slice(0, 60);
      const ctx = [
        `URL: ${window.location.href}`,
        `UA: ${navigator.userAgent}`,
        `Время: ${new Date().toISOString()}`,
      ].join("\n");
      const { error } = await supabase.from("support_tickets").insert({
        user_id: user.id,
        subject: `[${cfg.tag}] ${cleanSubject}`.slice(0, 200),
        message: `${text}\n\n---\n${ctx}`,
        status: "open",
      });
      if (error) throw error;
      toast.success("Сообщение отправлено администратору");
      setOpen(false);
      setSubject("");
      setMessage("");
    } catch (e: any) {
      console.error("[quick-feedback]", e);
      toast.error(e?.message || "Не удалось отправить");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="sticky top-0 z-50 w-full border-b border-border bg-card">
        <div className="flex items-center gap-3 px-4 py-2 text-sm">
          <span className="flex items-center gap-1.5 shrink-0 rounded-full bg-primary/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground animate-pulse">
            <Sparkles className="h-3 w-3" />
            Beta
          </span>
          <MessageSquarePlus className="h-4 w-4 text-primary shrink-0 hidden sm:inline" />
          <span className="text-foreground/90 font-medium hidden md:inline">
            Идет бета-тестирование. Нашли баг, ошибку или есть идея? Сообщите админу одной кнопкой.
          </span>
          <span className="text-foreground/90 font-medium hidden sm:inline md:hidden">
            Бета-тест. Помогите сделать сервис лучше.
          </span>
          <span className="text-foreground/90 font-medium sm:hidden">Бета-тест</span>
          <Button
            size="sm"
            variant="default"
            className="h-7 px-3 text-xs ml-auto font-semibold"
            onClick={() => setOpen(true)}
          >
            Сообщить
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Быстрая связь с админом</DialogTitle>
            <DialogDescription>
              Сообщение попадет в систему тикетов. Админ получит уведомление.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Тип обращения</label>
              <Select value={type} onValueChange={(v) => setType(v as FeedbackType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => {
                    const Icon = t.icon;
                    return (
                      <SelectItem key={t.value} value={t.value}>
                        <span className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5" />
                          {t.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Заголовок (опционально)</label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Коротко о сути"
                maxLength={140}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Описание</label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                placeholder="Что произошло, что вы делали, что ожидали увидеть..."
                maxLength={4000}
              />
              <div className="text-[10px] text-muted-foreground text-right">
                {message.length}/4000
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={sending}>
              <X className="h-3.5 w-3.5 mr-1" /> Отмена
            </Button>
            <Button onClick={submit} disabled={sending}>
              {sending ? "Отправка..." : "Отправить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}