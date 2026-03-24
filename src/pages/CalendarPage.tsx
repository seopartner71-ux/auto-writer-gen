import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/shared/hooks/useI18n";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from "date-fns";
import { ru, enUS } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  CalendarDays, Plus, ChevronLeft, ChevronRight, Clock, Loader2,
  Trash2, CheckCircle2, AlertCircle, Timer, FileText
} from "lucide-react";
import { toast } from "sonner";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";
import { PlanGate } from "@/shared/components/PlanGate";
import { useIsMobile } from "@/hooks/use-mobile";

function DayDetailPanel({
  selectedDate,
  selectedDayTasks,
  scheduled,
  onAdd,
  onDelete,
  t,
  lang,
}: {
  selectedDate: Date | null;
  selectedDayTasks: any[];
  scheduled: any[];
  onAdd: () => void;
  onDelete: (id: string) => void;
  t: (k: string) => string;
  lang: string;
}) {
  const dateFnsLocale = lang === "en" ? enUS : ru;
  const pendingTasks = scheduled.filter((s: any) => s.status === "pending");

  const STATUS_CONFIG: Record<string, { label: string; icon: any; class: string }> = {
    pending: { label: t("calendar.statusPending"), icon: Timer, class: "bg-warning/15 text-warning border-warning/30" },
    processing: { label: t("calendar.statusProcessing"), icon: Loader2, class: "bg-primary/15 text-primary border-primary/30" },
    completed: { label: t("calendar.statusCompleted"), icon: CheckCircle2, class: "bg-success/15 text-success border-success/30" },
    failed: { label: t("calendar.statusFailed"), icon: AlertCircle, class: "bg-destructive/15 text-destructive border-destructive/30" },
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">
          {selectedDate ? format(selectedDate, "d MMM yyyy", { locale: dateFnsLocale }) : t("calendar.selectDay")}
        </span>
        {selectedDate && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onAdd}>
            <Plus className="h-3 w-3 mr-1" /> {t("common.add")}
          </Button>
        )}
      </div>

      {selectedDayTasks.length > 0 ? (
        <div className="space-y-2">
          {selectedDayTasks.map((task: any) => {
            const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
            const Icon = cfg.icon;
            return (
              <div key={task.id} className={`rounded-lg border p-2.5 space-y-1 ${cfg.class}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Icon className={`h-3 w-3 ${task.status === "processing" ? "animate-spin" : ""}`} />
                    <span className="text-[11px] font-medium">{cfg.label}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">{format(new Date(task.scheduled_at), "HH:mm")}</span>
                    {(task.status === "pending" || task.status === "failed") && (
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => onDelete(task.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs font-medium truncate">{task.keywords?.seed_keyword || "—"}</p>
                {task.author_profiles?.name && (
                  <p className="text-[10px] text-muted-foreground">{t("calendar.author")}: {task.author_profiles.name}</p>
                )}
                {task.status === "completed" && task.article_id && (
                  <Badge variant="outline" className="text-[10px] h-5">
                    <FileText className="h-2.5 w-2.5 mr-1" /> {t("calendar.articleCreated")}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-4">
          {selectedDate ? t("calendar.noScheduled") : t("calendar.clickDay")}
        </p>
      )}

      {pendingTasks.length > 0 && (
        <div className="pt-2 border-t border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("calendar.upcoming")}</span>
          <div className="mt-1.5 space-y-1 max-h-40 overflow-y-auto">
            {pendingTasks.slice(0, 8).map((s: any) => (
              <div key={s.id} className="flex items-center justify-between text-[11px] bg-muted/40 rounded px-2 py-1">
                <span className="font-medium truncate max-w-[60%]">{s.keywords?.seed_keyword}</span>
                <span className="text-muted-foreground">{format(new Date(s.scheduled_at), "dd.MM HH:mm")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CalendarPage() {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const { limits } = usePlanLimits();
  const isMobile = useIsMobile();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const [selKeywordId, setSelKeywordId] = useState("");
  const [selAuthorId, setSelAuthorId] = useState("");
  const [schedTime, setSchedTime] = useState("10:00");

  const dateFnsLocale = lang === "en" ? enUS : ru;
  const dayHeaders = [t("calendar.mon"), t("calendar.tue"), t("calendar.wed"), t("calendar.thu"), t("calendar.fri"), t("calendar.sat"), t("calendar.sun")];

  const { data: scheduled = [] } = useQuery({
    queryKey: ["scheduled-generations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("scheduled_generations").select("*, keywords(seed_keyword), author_profiles(name)").order("scheduled_at", { ascending: true });
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
      if (!selectedDate || !selKeywordId) throw new Error(t("calendar.selectDateKw"));
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const [hours, minutes] = schedTime.split(":").map(Number);
      const scheduledAt = new Date(selectedDate);
      scheduledAt.setHours(hours, minutes, 0, 0);
      if (scheduledAt <= new Date()) throw new Error(t("calendar.cantPast"));
      const { error } = await supabase.from("scheduled_generations").insert({
        user_id: user.id, keyword_id: selKeywordId, author_profile_id: selAuthorId || null, scheduled_at: scheduledAt.toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-generations"] });
      setCreateOpen(false); setSelKeywordId(""); setSelAuthorId(""); setSchedTime("10:00");
      toast.success(t("calendar.scheduled"));
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
      toast.success(t("calendar.deleted"));
    },
    onError: (e) => toast.error(e.message),
  });

  const triggerRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-scheduled");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-generations"] });
      queryClient.invalidateQueries({ queryKey: ["articles-list"] });
      toast.success(`${t("calendar.processed")}: ${data?.processed || 0}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDay = monthStart.getDay();
  const padStart = startDay === 0 ? 6 : startDay - 1;

  const scheduledByDate = useMemo(() => {
    const map: Record<string, typeof scheduled> = {};
    scheduled.forEach((s: any) => {
      const key = format(new Date(s.scheduled_at), "yyyy-MM-dd");
      if (!map[key]) map[key] = [];
      map[key].push(s);
    });
    return map;
  }, [scheduled]);

  const selectedDayTasks = selectedDate ? scheduledByDate[format(selectedDate, "yyyy-MM-dd")] || [] : [];
  const pendingCount = scheduled.filter((s: any) => s.status === "pending").length;

  const handleDayClick = (day: Date) => {
    setSelectedDate(day);
    if (isMobile) setDetailOpen(true);
  };

  if (!limits.hasCalendar) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">{t("nav.calendar")}</h1>
        </div>
        <PlanGate allowed={false} featureName={t("calendar.plannerFeature")} requiredPlan="PRO"><div /></PlanGate>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarDays className="h-5 w-5 text-primary shrink-0" />
          <h1 className="text-lg font-semibold truncate">{t("nav.calendar")}</h1>
        </div>
        {pendingCount > 0 && (
          <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={() => triggerRun.mutate()} disabled={triggerRun.isPending}>
            {triggerRun.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Clock className="h-3 w-3 mr-1" />}
            <span className="hidden sm:inline">{t("calendar.runNow")}</span> ({pendingCount})
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card className="bg-card border-border">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between mb-3">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="text-sm font-semibold capitalize">{format(currentMonth, "LLLL yyyy", { locale: dateFnsLocale })}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <div className="grid grid-cols-7 mb-0.5">
              {dayHeaders.map((d) => (
                <div key={d} className="text-center text-[10px] sm:text-xs font-medium text-muted-foreground py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px">
              {Array.from({ length: padStart }).map((_, i) => (<div key={`pad-${i}`} className="min-h-[44px] sm:min-h-[64px]" />))}
              {days.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const dayTasks = scheduledByDate[key] || [];
                const isSelected = selectedDate && isSameDay(day, selectedDate);
                const isToday = isSameDay(day, new Date());

                const STATUS_CONFIG_LOCAL: Record<string, { label: string; icon: any; class: string }> = {
                  pending: { label: t("calendar.statusPending"), icon: Timer, class: "bg-warning/15 text-warning border-warning/30" },
                  processing: { label: t("calendar.statusProcessing"), icon: Loader2, class: "bg-primary/15 text-primary border-primary/30" },
                  completed: { label: t("calendar.statusCompleted"), icon: CheckCircle2, class: "bg-success/15 text-success border-success/30" },
                  failed: { label: t("calendar.statusFailed"), icon: AlertCircle, class: "bg-destructive/15 text-destructive border-destructive/30" },
                };

                return (
                  <button key={key} className={`min-h-[44px] sm:min-h-[64px] p-0.5 sm:p-1 rounded text-left transition-all border ${isSelected ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-transparent hover:bg-muted/50"}`} onClick={() => handleDayClick(day)} onDoubleClick={() => { setSelectedDate(day); setCreateOpen(true); }}>
                    <span className={`text-[11px] sm:text-xs font-medium inline-flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 rounded-full ${isToday ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{format(day, "d")}</span>
                    {dayTasks.length > 0 && (
                      <div className="mt-0.5 space-y-px hidden sm:block">
                        {dayTasks.slice(0, 2).map((tt: any) => {
                          const cfg = STATUS_CONFIG_LOCAL[tt.status] || STATUS_CONFIG_LOCAL.pending;
                          return (<div key={tt.id} className={`text-[9px] leading-tight px-0.5 py-px rounded truncate border ${cfg.class}`}>{tt.keywords?.seed_keyword || "—"}</div>);
                        })}
                        {dayTasks.length > 2 && <span className="text-[9px] text-muted-foreground pl-0.5">+{dayTasks.length - 2}</span>}
                      </div>
                    )}
                    {dayTasks.length > 0 && (
                      <div className="flex gap-0.5 mt-0.5 sm:hidden justify-center">
                        {dayTasks.slice(0, 3).map((tt: any) => (
                          <span key={tt.id} className={`w-1.5 h-1.5 rounded-full ${tt.status === "completed" ? "bg-green-500" : tt.status === "failed" ? "bg-destructive" : tt.status === "processing" ? "bg-primary" : "bg-warning"}`} />
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {!isMobile && (
          <Card className="bg-card border-border h-fit">
            <CardContent className="p-3">
              <DayDetailPanel selectedDate={selectedDate} selectedDayTasks={selectedDayTasks} scheduled={scheduled} onAdd={() => setCreateOpen(true)} onDelete={(id) => deleteScheduled.mutate(id)} t={t} lang={lang} />
            </CardContent>
          </Card>
        )}
      </div>

      {isMobile && (
        <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
          <SheetContent side="bottom" className="rounded-t-2xl max-h-[70vh]">
            <SheetHeader className="pb-2"><SheetTitle className="text-sm">{t("calendar.selectDay")}</SheetTitle></SheetHeader>
            <div className="overflow-y-auto">
              <DayDetailPanel selectedDate={selectedDate} selectedDayTasks={selectedDayTasks} scheduled={scheduled} onAdd={() => { setDetailOpen(false); setCreateOpen(true); }} onDelete={(id) => deleteScheduled.mutate(id)} t={t} lang={lang} />
            </div>
          </SheetContent>
        </Sheet>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-base">{t("calendar.schedule")}</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("calendar.date")}</Label>
                <Input type="date" className="h-8 text-xs" value={selectedDate ? format(selectedDate, "yyyy-MM-dd") : ""} onChange={(e) => setSelectedDate(e.target.value ? new Date(e.target.value) : null)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("calendar.time")}</Label>
                <Input type="time" className="h-8 text-xs" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("calendar.keywordReq")}</Label>
              <Select value={selKeywordId} onValueChange={setSelKeywordId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("calendar.selectQuery")} /></SelectTrigger>
                <SelectContent>{keywords.map((k: any) => (<SelectItem key={k.id} value={k.id}>{k.seed_keyword}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("calendar.authorOpt")}</Label>
              <Select value={selAuthorId} onValueChange={setSelAuthorId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("calendar.selectAuthor")} /></SelectTrigger>
                <SelectContent>{authors.map((a: any) => (<SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <Button className="w-full h-8 text-xs" disabled={!selKeywordId || !selectedDate || createScheduled.isPending} onClick={() => createScheduled.mutate()}>
              {createScheduled.isPending ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <CalendarDays className="h-3 w-3 mr-1.5" />}
              {t("calendar.scheduleBtn")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
