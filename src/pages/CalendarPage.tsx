import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/shared/api/supabase";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, addMonths, subMonths } from "date-fns";
import { ru } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CalendarDays, Plus, ChevronLeft, ChevronRight, Clock, Loader2,
  Trash2, CheckCircle2, AlertCircle, Timer, FileText
} from "lucide-react";
import { toast } from "sonner";

const STATUS_CONFIG: Record<string, { label: string; icon: any; class: string }> = {
  pending: { label: "Ожидает", icon: Timer, class: "bg-warning/15 text-warning border-warning/30" },
  processing: { label: "Генерация...", icon: Loader2, class: "bg-primary/15 text-primary border-primary/30" },
  completed: { label: "Готово", icon: CheckCircle2, class: "bg-success/15 text-success border-success/30" },
  failed: { label: "Ошибка", icon: AlertCircle, class: "bg-destructive/15 text-destructive border-destructive/30" },
};

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Form state
  const [selKeywordId, setSelKeywordId] = useState("");
  const [selAuthorId, setSelAuthorId] = useState("");
  const [schedTime, setSchedTime] = useState("10:00");

  const { data: scheduled = [] } = useQuery({
    queryKey: ["scheduled-generations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scheduled_generations")
        .select("*, keywords(seed_keyword), author_profiles(name)")
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: keywords = [] } = useQuery({
    queryKey: ["keywords-for-calendar"],
    queryFn: async () => {
      const { data } = await supabase.from("keywords").select("id, seed_keyword").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: authors = [] } = useQuery({
    queryKey: ["authors-for-calendar"],
    queryFn: async () => {
      const { data } = await supabase.from("author_profiles").select("id, name").order("name");
      return data || [];
    },
  });

  const createScheduled = useMutation({
    mutationFn: async () => {
      if (!selectedDate || !selKeywordId) throw new Error("Выберите дату и ключевое слово");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const [hours, minutes] = schedTime.split(":").map(Number);
      const scheduledAt = new Date(selectedDate);
      scheduledAt.setHours(hours, minutes, 0, 0);

      if (scheduledAt <= new Date()) throw new Error("Нельзя запланировать в прошлом");

      const { error } = await supabase.from("scheduled_generations").insert({
        user_id: user.id,
        keyword_id: selKeywordId,
        author_profile_id: selAuthorId || null,
        scheduled_at: scheduledAt.toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-generations"] });
      setCreateOpen(false);
      setSelKeywordId("");
      setSelAuthorId("");
      setSchedTime("10:00");
      toast.success("Генерация запланирована");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteScheduled = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("scheduled_generations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-generations"] });
      toast.success("Удалено");
    },
    onError: (e) => toast.error(e.message),
  });

  // Trigger manual run
  const triggerRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-scheduled");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-generations"] });
      queryClient.invalidateQueries({ queryKey: ["articles-list"] });
      toast.success(`Обработано задач: ${data?.processed || 0}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // Calendar grid
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Pad start to Monday
  const startDay = monthStart.getDay();
  const padStart = (startDay === 0 ? 6 : startDay - 1);

  const scheduledByDate = useMemo(() => {
    const map: Record<string, typeof scheduled> = {};
    scheduled.forEach((s: any) => {
      const key = format(new Date(s.scheduled_at), "yyyy-MM-dd");
      if (!map[key]) map[key] = [];
      map[key].push(s);
    });
    return map;
  }, [scheduled]);

  const selectedDayTasks = selectedDate
    ? scheduledByDate[format(selectedDate, "yyyy-MM-dd")] || []
    : [];

  const pendingCount = scheduled.filter((s: any) => s.status === "pending").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Контент-календарь</h1>
            <p className="text-sm text-muted-foreground">
              Планируйте автоматическую генерацию статей
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {pendingCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => triggerRun.mutate()}
              disabled={triggerRun.isPending}
            >
              {triggerRun.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Clock className="h-4 w-4 mr-1" />}
              Запустить сейчас ({pendingCount})
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Calendar Grid */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <CardTitle className="text-base capitalize">
                {format(currentMonth, "LLLL yyyy", { locale: ru })}
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-px mb-1">
              {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
                <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">
                  {d}
                </div>
              ))}
            </div>
            {/* Day cells */}
            <div className="grid grid-cols-7 gap-px">
              {Array.from({ length: padStart }).map((_, i) => (
                <div key={`pad-${i}`} className="min-h-[80px]" />
              ))}
              {days.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const dayTasks = scheduledByDate[key] || [];
                const isSelected = selectedDate && isSameDay(day, selectedDate);
                const isToday = isSameDay(day, new Date());

                return (
                  <button
                    key={key}
                    className={`min-h-[80px] p-1.5 rounded-md text-left transition-colors border ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:bg-muted/50"
                    }`}
                    onClick={() => setSelectedDate(day)}
                    onDoubleClick={() => {
                      setSelectedDate(day);
                      setCreateOpen(true);
                    }}
                  >
                    <span
                      className={`text-xs font-medium inline-flex items-center justify-center w-6 h-6 rounded-full ${
                        isToday ? "bg-primary text-primary-foreground" : "text-foreground"
                      }`}
                    >
                      {format(day, "d")}
                    </span>
                    <div className="mt-0.5 space-y-0.5">
                      {dayTasks.slice(0, 3).map((t: any) => {
                        const cfg = STATUS_CONFIG[t.status] || STATUS_CONFIG.pending;
                        return (
                          <div
                            key={t.id}
                            className={`text-[10px] leading-tight px-1 py-0.5 rounded truncate border ${cfg.class}`}
                          >
                            {t.keywords?.seed_keyword || "—"}
                          </div>
                        );
                      })}
                      {dayTasks.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">+{dayTasks.length - 3}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Right sidebar — selected day details */}
        <div className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>
                  {selectedDate ? format(selectedDate, "d MMMM yyyy", { locale: ru }) : "Выберите день"}
                </span>
                {selectedDate && (
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-3 w-3 mr-1" />
                    Добавить
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selectedDayTasks.length > 0 ? (
                <div className="space-y-2">
                  {selectedDayTasks.map((task: any) => {
                    const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
                    const Icon = cfg.icon;
                    return (
                      <div key={task.id} className={`rounded-lg border p-3 space-y-1.5 ${cfg.class}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Icon className={`h-3.5 w-3.5 ${task.status === "processing" ? "animate-spin" : ""}`} />
                            <span className="text-xs font-medium">{cfg.label}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">
                              {format(new Date(task.scheduled_at), "HH:mm")}
                            </span>
                            {(task.status === "pending" || task.status === "failed") && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => deleteScheduled.mutate(task.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <p className="text-sm font-medium truncate">
                          {task.keywords?.seed_keyword || "—"}
                        </p>
                        {task.author_profiles?.name && (
                          <p className="text-[10px] text-muted-foreground">
                            Автор: {task.author_profiles.name}
                          </p>
                        )}
                        {task.status === "completed" && task.article_id && (
                          <Badge variant="outline" className="text-[10px] mt-1">
                            <FileText className="h-3 w-3 mr-1" />
                            Статья создана
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-6">
                  {selectedDate ? "Нет запланированных генераций" : "Кликните на день в календаре"}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Upcoming list */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Ближайшие генерации</CardTitle>
            </CardHeader>
            <CardContent>
              {scheduled.filter((s: any) => s.status === "pending").length > 0 ? (
                <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
                  {scheduled
                    .filter((s: any) => s.status === "pending")
                    .slice(0, 10)
                    .map((s: any) => (
                      <div key={s.id} className="flex items-center justify-between text-xs bg-muted/50 rounded-md px-2 py-1.5">
                        <span className="font-medium truncate max-w-[55%]">{s.keywords?.seed_keyword}</span>
                        <span className="text-muted-foreground">
                          {format(new Date(s.scheduled_at), "dd.MM HH:mm")}
                        </span>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Нет ожидающих задач
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Запланировать генерацию</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Дата</Label>
              <Input
                type="date"
                value={selectedDate ? format(selectedDate, "yyyy-MM-dd") : ""}
                onChange={(e) => setSelectedDate(e.target.value ? new Date(e.target.value) : null)}
              />
            </div>
            <div className="space-y-2">
              <Label>Время</Label>
              <Input
                type="time"
                value={schedTime}
                onChange={(e) => setSchedTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Ключевое слово *</Label>
              <Select value={selKeywordId} onValueChange={setSelKeywordId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите запрос" />
                </SelectTrigger>
                <SelectContent>
                  {keywords.map((k: any) => (
                    <SelectItem key={k.id} value={k.id}>{k.seed_keyword}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Автор (опционально)</Label>
              <Select value={selAuthorId} onValueChange={setSelAuthorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Без автора" />
                </SelectTrigger>
                <SelectContent>
                  {authors.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              disabled={!selKeywordId || !selectedDate || createScheduled.isPending}
              onClick={() => createScheduled.mutate()}
            >
              {createScheduled.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CalendarDays className="h-4 w-4 mr-2" />
              )}
              Запланировать
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
