import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Send, Copy, Link as LinkIcon, ClipboardCheck, Loader2, ArrowLeft, UserCheck } from "lucide-react";

type Tab = "blog" | "links" | "trust";
const TABS: { id: Tab; label: string }[] = [
  { id: "blog", label: "Блог" },
  { id: "links", label: "Биржи ссылок" },
  { id: "trust", label: "Трастовые ресурсы" },
];

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  awaiting:    { label: "Ожидает тем",     cls: "bg-muted text-muted-foreground" },
  review:      { label: "На согласовании", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  responded:   { label: "Получен ответ",   cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  in_progress: { label: "В работе",        cls: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
  done:        { label: "Завершён",        cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
};

const TOPIC_COLOR: Record<string, string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10",
  rev: "border-amber-500/40 bg-amber-500/10",
  no: "border-red-500/40 bg-red-500/10",
};
const TOPIC_BADGE: Record<string, string> = {
  ok: "Согласовано",
  rev: "На доработке",
  no: "Не подходит",
};

interface ProjectLite { id: string; name: string; domain: string }
interface Plan {
  id: string; project_id: string; month: number; year: number;
  status: string; public_uuid: string; created_at: string; client_responded_at: string | null;
}
interface Topic { id: string; plan_id: string; tab: Tab; title: string; position: number; status: string | null; comment: string | null; }

export default function ContentPlanPage() {
  const { role } = useAuth();
  const allowed = role === "admin" || role === "staff";

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [creatorOpen, setCreatorOpen] = useState<{ projectId?: string } | null>(null);

  if (!allowed) {
    return (
      <div className="container max-w-5xl py-10">
        <Card><CardContent className="py-10 text-center text-muted-foreground">Доступ только для администраторов и сотрудников.</CardContent></Card>
      </div>
    );
  }

  if (selectedPlanId) {
    return <PlanDetail planId={selectedPlanId} onBack={() => setSelectedPlanId(null)} />;
  }

  return (
    <>
      <ProjectsList
        onCreate={(pid) => setCreatorOpen({ projectId: pid })}
        onOpenPlan={(plan) => setSelectedPlanId(plan.id)}
      />
      {creatorOpen && (
        <PlanCreatorDialog
          initialProjectId={creatorOpen.projectId}
          onClose={() => setCreatorOpen(null)}
          onCreated={(planId) => { setCreatorOpen(null); setSelectedPlanId(planId); }}
        />
      )}
    </>
  );
}

function ProjectsList({ onCreate, onOpenPlan }: { onCreate: (projectId: string) => void; onOpenPlan: (p: Plan) => void }) {
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["cp-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, domain, user_id, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<ProjectLite & { user_id: string }>;
    },
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["cp-plans-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_plans")
        .select("id, project_id, month, year, status, public_uuid, created_at, client_responded_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Plan[];
    },
  });

  const now = new Date();
  const currentPlanByProject = useMemo(() => {
    const map = new Map<string, Plan>();
    for (const p of plans) {
      if (!map.has(p.project_id)) map.set(p.project_id, p);
    }
    return map;
  }, [plans]);

  return (
    <div className="container max-w-6xl py-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Контент-план</h1>
          <p className="text-sm text-muted-foreground">Планы публикаций по проектам клиентов с согласованием через публичную ссылку.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : projects.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Нет проектов</CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const plan = currentPlanByProject.get(p.id);
            const st = plan ? STATUS_LABEL[plan.status] : STATUS_LABEL.awaiting;
            return (
              <Card key={p.id} className="bg-card border-border">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{p.name}</CardTitle>
                      <CardDescription className="truncate">{p.domain}</CardDescription>
                    </div>
                    <Badge variant="outline" className={`text-[10px] ${st.cls}`}>{st.label}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  {plan && (
                    <div className="text-xs text-muted-foreground">
                      Текущий план: {String(plan.month).padStart(2, "0")}/{plan.year}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" variant="default" className="flex-1" onClick={() => onCreate(p.id)}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Создать план
                    </Button>
                    {plan && (
                      <Button size="sm" variant="outline" onClick={() => onOpenPlan(plan)}>Открыть</Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlanCreatorDialog({ initialProjectId, onClose, onCreated }: { initialProjectId?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient();
  const now = new Date();
  const [projectId, setProjectId] = useState<string>(initialProjectId ?? "");
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [tab, setTab] = useState<Tab>("blog");
  const [byTab, setByTab] = useState<Record<Tab, string[]>>({ blog: [""], links: [""], trust: [""] });

  const { data: projects = [] } = useQuery({
    queryKey: ["cp-projects-mini"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id, name, domain").order("name");
      if (error) throw error;
      return (data ?? []) as ProjectLite[];
    },
  });

  const setTitle = (t: Tab, idx: number, val: string) =>
    setByTab((s) => ({ ...s, [t]: s[t].map((v, i) => (i === idx ? val : v)) }));
  const addRow = (t: Tab) => setByTab((s) => ({ ...s, [t]: [...s[t], ""] }));
  const delRow = (t: Tab, idx: number) =>
    setByTab((s) => ({ ...s, [t]: s[t].filter((_, i) => i !== idx).concat(s[t].length === 1 ? [""] : []) }));

  const create = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("Выберите проект");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Нет авторизации");
      const { data: plan, error } = await supabase
        .from("content_plans")
        .insert({ project_id: projectId, month, year, status: "review", created_by: user.id })
        .select("id")
        .single();
      if (error) throw error;
      const rows: Array<{ plan_id: string; tab: Tab; title: string; position: number }> = [];
      (Object.keys(byTab) as Tab[]).forEach((t) => {
        byTab[t].map((title) => title.trim()).filter(Boolean).forEach((title, i) => {
          rows.push({ plan_id: plan.id, tab: t, title, position: i });
        });
      });
      if (rows.length === 0) throw new Error("Добавьте хотя бы одну тему");
      const { error: e2 } = await supabase.from("content_topics").insert(rows);
      if (e2) throw e2;
      return plan.id as string;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["cp-plans-all"] });
      toast.success("План создан и отправлен на согласование");
      onCreated(id);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - 1 + i);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Новый контент-план</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1 space-y-1">
              <Label>Клиент / проект</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue placeholder="Выберите проект" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} — {p.domain}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Месяц</Label>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{months.map((m) => <SelectItem key={m} value={String(m)}>{String(m).padStart(2, "0")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Год</Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList className="grid grid-cols-3 w-full">
              {TABS.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
            </TabsList>
            {TABS.map((t) => (
              <TabsContent key={t.id} value={t.id} className="space-y-2 pt-3">
                {byTab[t.id].map((val, idx) => (
                  <div key={idx} className="flex gap-2 items-start">
                    <Textarea
                      value={val}
                      onChange={(e) => setTitle(t.id, idx, e.target.value)}
                      placeholder={`Тема ${idx + 1}`}
                      className="min-h-[48px]"
                    />
                    <Button type="button" size="icon" variant="ghost" onClick={() => delRow(t.id, idx)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" onClick={() => addRow(t.id)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Добавить тему
                </Button>
              </TabsContent>
            ))}
          </Tabs>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
            Отправить на согласование
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanDetail({ planId, onBack }: { planId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["cp-plan", planId],
    queryFn: async () => {
      const { data: plan, error } = await supabase
        .from("content_plans")
        .select("id, project_id, month, year, status, public_uuid, client_responded_at, projects(name, domain)")
        .eq("id", planId)
        .single();
      if (error) throw error;
      const { data: topics, error: e2 } = await supabase
        .from("content_topics")
        .select("id, plan_id, tab, title, position, status, comment")
        .eq("plan_id", planId)
        .order("position");
      if (e2) throw e2;
      return { plan, topics: (topics ?? []) as Topic[] };
    },
  });

  const setInProgress = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("content_plans").update({ status: "in_progress" }).eq("id", planId);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["cp-plan", planId] }); toast.success("План передан в работу"); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const { plan, topics } = data as any;
  const publicUrl = `${window.location.origin}/approval/${plan.public_uuid}`;
  const groupedTopics: Record<Tab, Topic[]> = { blog: [], links: [], trust: [] };
  for (const t of topics) groupedTopics[t.tab as Tab].push(t);
  const st = STATUS_LABEL[plan.status] ?? STATUS_LABEL.awaiting;

  return (
    <div className="container max-w-5xl py-6 space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" /> Назад</Button>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-lg">{plan.projects?.name} — {String(plan.month).padStart(2, "0")}/{plan.year}</CardTitle>
              <CardDescription>{plan.projects?.domain}</CardDescription>
            </div>
            <Badge variant="outline" className={`text-xs ${st.cls}`}>{st.label}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-[260px] flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
              <LinkIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{publicUrl}</span>
            </div>
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(publicUrl); toast.success("Ссылка скопирована"); }}>
              <Copy className="h-3.5 w-3.5 mr-1" /> Копировать
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={publicUrl} target="_blank" rel="noreferrer">Открыть</a>
            </Button>
            {plan.status === "responded" && (
              <Button size="sm" onClick={() => setInProgress.mutate()}>
                <UserCheck className="h-3.5 w-3.5 mr-1" /> Передать копирайтеру
              </Button>
            )}
          </div>

          <Tabs defaultValue="blog">
            <TabsList className="grid grid-cols-3 w-full">
              {TABS.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label} ({groupedTopics[t.id].length})</TabsTrigger>)}
            </TabsList>
            {TABS.map((t) => (
              <TabsContent key={t.id} value={t.id} className="pt-3 space-y-2">
                {groupedTopics[t.id].length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6">Тем нет</div>
                ) : groupedTopics[t.id].map((topic) => (
                  <div key={topic.id} className={`rounded-md border p-3 ${topic.status ? TOPIC_COLOR[topic.status] : "border-border bg-card"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm whitespace-pre-wrap">{topic.title}</div>
                      {topic.status && (
                        <Badge variant="outline" className="text-[10px] shrink-0">{TOPIC_BADGE[topic.status]}</Badge>
                      )}
                    </div>
                    {topic.comment && (
                      <div className="mt-2 text-xs text-muted-foreground border-t border-border/40 pt-2 whitespace-pre-wrap">
                        Комментарий клиента: {topic.comment}
                      </div>
                    )}
                  </div>
                ))}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}