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
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Plus, Trash2, Send, Copy, Link as LinkIcon, Loader2, ArrowLeft, UserCheck, Sparkles, FileText, Play, CheckCircle2, AlertCircle, Settings2, RotateCcw } from "lucide-react";
import { Switch } from "@/components/ui/switch";

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

const TAB_BADGE_CLS: Record<Tab, string> = {
  blog:  "bg-blue-500/15 text-blue-300 border-blue-500/30",
  links: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  trust: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

interface AuthorProfileLite {
  id: string;
  name: string;
  type: string | null;
  avatar_icon: string | null;
  description: string | null;
}

interface ClientLite { id: string; name: string; domain: string; niche: string | null }
interface Plan {
  id: string; client_id: string | null; project_id: string | null; month: number; year: number;
  status: string; public_uuid: string; created_at: string; client_responded_at: string | null;
}
interface Topic {
  id: string; plan_id: string; tab: Tab; title: string; position: number;
  status: string | null; comment: string | null;
  gen_status?: string | null; article_markdown?: string | null;
  article_title?: string | null; gen_error?: string | null; attempts?: number | null;
  article_id?: string | null; updated_at?: string | null;
}

interface TemplateSettings {
  persona_id: string;
  length: "short" | "medium" | "long";
  language: "ru" | "en";
  stealth: boolean;
  extra_instructions: string;
}
const DEFAULT_SETTINGS: TemplateSettings = {
  persona_id: "freeform", length: "medium", language: "ru", stealth: false, extra_instructions: "",
};
const PERSONA_OPTIONS = [
  { value: "freeform",    label: "Свободный стиль" },
  { value: "agency",      label: "Агентство" },
  { value: "inhouse",     label: "Inhouse-маркетолог" },
  { value: "brand_owner", label: "Владелец бренда" },
  { value: "expert",      label: "Эксперт ниши" },
];
const LENGTH_OPTIONS = [
  { value: "short",  label: "Короткая (~800)" },
  { value: "medium", label: "Средняя (~1500)" },
  { value: "long",   label: "Длинная (~2500)" },
];

export default function ContentPlanPage() {
  const { role } = useAuth();
  const allowed = role === "admin" || role === "staff";

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [creatorOpen, setCreatorOpen] = useState<{ clientId?: string } | null>(null);
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [writingPlanId, setWritingPlanId] = useState<string | null>(null);

  if (!allowed) {
    return (
      <div className="container max-w-5xl py-10">
        <Card><CardContent className="py-10 text-center text-muted-foreground">Доступ только для администраторов и сотрудников.</CardContent></Card>
      </div>
    );
  }

  if (writingPlanId) {
    return <WritingScreen planId={writingPlanId} onBack={() => setWritingPlanId(null)} />;
  }

  if (selectedPlanId) {
    return <PlanDetail planId={selectedPlanId} onBack={() => setSelectedPlanId(null)} onOpenWriting={(id) => { setSelectedPlanId(null); setWritingPlanId(id); }} />;
  }

  return (
    <>
      <ClientsList
        onCreate={(cid) => setCreatorOpen({ clientId: cid })}
        onOpenPlan={(plan) => setSelectedPlanId(plan.id)}
        onNewClient={() => setNewClientOpen(true)}
      />
      {creatorOpen && (
        <PlanCreatorDialog
          initialClientId={creatorOpen.clientId}
          onClose={() => setCreatorOpen(null)}
          onCreated={(planId) => { setCreatorOpen(null); setSelectedPlanId(planId); }}
        />
      )}
      {newClientOpen && <NewClientDialog onClose={() => setNewClientOpen(false)} />}
    </>
  );
}

function ClientsList({ onCreate, onOpenPlan, onNewClient }: { onCreate: (clientId: string) => void; onOpenPlan: (p: Plan) => void; onNewClient: () => void }) {
  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["cp-clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_clients")
        .select("id, name, domain, niche, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ClientLite[];
    },
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["cp-plans-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_plans")
        .select("id, client_id, project_id, month, year, status, public_uuid, created_at, client_responded_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Plan[];
    },
  });

  const currentPlanByClient = useMemo(() => {
    const map = new Map<string, Plan>();
    for (const p of plans) {
      const key = p.client_id || p.project_id;
      if (key && !map.has(key)) map.set(key, p);
    }
    return map;
  }, [plans]);

  return (
    <div className="container max-w-6xl py-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Контент-план</h1>
          <p className="text-sm text-muted-foreground">Клиенты, контент-планы и написание статей.</p>
        </div>
        <Button onClick={onNewClient} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Новый клиент
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : clients.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Пока нет клиентов. Создайте первого через кнопку «Новый клиент».</CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((p) => {
            const plan = currentPlanByClient.get(p.id);
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
                  {p.niche && <div className="text-xs text-muted-foreground line-clamp-2">{p.niche}</div>}
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

function NewClientDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [niche, setNiche] = useState("");
  const [email, setEmail] = useState("");
  const m = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2 || domain.trim().length < 3) throw new Error("Заполните название и домен");
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("content_clients").insert({
        name: name.trim(), domain: domain.trim(), niche: niche.trim() || null,
        contact_email: email.trim() || null, created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cp-clients"] });
      toast.success("Клиент добавлен");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Новый клиент</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Название компании</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1"><Label>Домен</Label><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.ru" /></div>
          <div className="space-y-1"><Label>Ниша / тематика</Label><Textarea value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Кратко: чем занимается клиент, для кого" /></div>
          <div className="space-y-1"><Label>Email клиента (для отправки ссылки согласования)</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanCreatorDialog({ initialClientId, onClose, onCreated }: { initialClientId?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient();
  const now = new Date();
  const [clientId, setClientId] = useState<string>(initialClientId ?? "");
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [tab, setTab] = useState<Tab>("blog");
  const [planId, setPlanId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState<Tab | null>(null);
  const [drafts, setDrafts] = useState<Record<Tab, string>>({ blog: "", links: "", trust: "" });
  const [submitting, setSubmitting] = useState(false);

  const { data: clients = [] } = useQuery({
    queryKey: ["cp-clients-mini"],
    queryFn: async () => {
      const { data, error } = await supabase.from("content_clients").select("id, name, domain, niche").order("name");
      if (error) throw error;
      return (data ?? []) as ClientLite[];
    },
  });
  const currentClient = clients.find((c) => c.id === clientId);

  // Ensure draft plan exists for current client/month/year. Reuses any
  // existing 'awaiting' plan or creates a new one. Returns plan id.
  const ensurePlan = async (): Promise<string> => {
    if (planId) return planId;
    if (!clientId) throw new Error("Выберите клиента");
    const { data: existing } = await supabase
      .from("content_plans")
      .select("id")
      .eq("client_id", clientId).eq("month", month).eq("year", year)
      .eq("status", "awaiting")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.id) { setPlanId(existing.id); return existing.id; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Нет авторизации");
    const { data: plan, error } = await supabase
      .from("content_plans")
      .insert({ client_id: clientId, month, year, status: "awaiting", created_by: user.id })
      .select("id").single();
    if (error) throw error;
    setPlanId(plan.id);
    queryClient.invalidateQueries({ queryKey: ["cp-plans-all"] });
    return plan.id;
  };

  // Reset plan reference when client/month/year change (different plan target)
  useEffect(() => { setPlanId(null); }, [clientId, month, year]);

  // Live topics from DB for current draft plan
  const { data: topics = [] } = useQuery({
    queryKey: ["cp-creator-topics", planId],
    enabled: !!planId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_topics")
        .select("id, plan_id, tab, title, position, status, comment")
        .eq("plan_id", planId!)
        .order("tab").order("position");
      if (error) throw error;
      return (data ?? []) as Topic[];
    },
  });

  const topicsByTab: Record<Tab, Topic[]> = useMemo(() => {
    const g: Record<Tab, Topic[]> = { blog: [], links: [], trust: [] };
    for (const t of topics) g[t.tab as Tab].push(t);
    return g;
  }, [topics]);

  const refreshTopics = () => queryClient.invalidateQueries({ queryKey: ["cp-creator-topics", planId] });

  const addTopic = async (t: Tab, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      const pid = await ensurePlan();
      const pos = (topicsByTab[t]?.length ?? 0);
      const { error } = await supabase
        .from("content_topics")
        .insert({ plan_id: pid, tab: t, title: trimmed, position: pos });
      if (error) throw error;
      setDrafts((s) => ({ ...s, [t]: "" }));
      refreshTopics();
    } catch (e: any) {
      toast.error(e.message || "Не удалось добавить");
    }
  };

  const updateTopic = async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const { error } = await supabase.from("content_topics").update({ title: trimmed }).eq("id", id);
    if (error) toast.error(error.message);
    refreshTopics();
  };

  const deleteTopic = async (id: string) => {
    const { error } = await supabase.from("content_topics").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    refreshTopics();
  };

  const suggestAi = async (t: Tab) => {
    if (!currentClient) { toast.error("Выберите клиента"); return; }
    if (!currentClient.niche) { toast.error("У клиента не заполнена ниша"); return; }
    setAiLoading(t);
    try {
      const { data, error } = await supabase.functions.invoke("content-plan-suggest-topics", {
        body: { kind: t, domain: currentClient.domain, niche: currentClient.niche, count: 8 },
      });
      if (error) throw new Error(error.message);
      const suggestions: string[] = (data as any)?.topics ?? [];
      if (!suggestions.length) throw new Error("AI не вернул темы, попробуйте еще раз");
      const pid = await ensurePlan();
      const baseLen = topicsByTab[t]?.length ?? 0;
      const rows = suggestions.map((title, i) => ({ plan_id: pid, tab: t, title: title.trim(), position: baseLen + i })).filter(r => r.title);
      if (rows.length) {
        const { error: insErr } = await supabase.from("content_topics").insert(rows);
        if (insErr) throw insErr;
      }
      refreshTopics();
      toast.success(`Подобрано ${rows.length} тем`);
    } catch (e: any) {
      toast.error(e.message || "Не удалось подобрать темы");
    } finally {
      setAiLoading(null);
    }
  };

  const submitForReview = async () => {
    setSubmitting(true);
    try {
      if (!planId || topics.length === 0) throw new Error("Добавьте хотя бы одну тему");
      const { error } = await supabase.from("content_plans").update({ status: "review" }).eq("id", planId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["cp-plans-all"] });
      toast.success("План отправлен на согласование");
      onCreated(planId);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

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
              <Label>Клиент</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger><SelectValue placeholder="Выберите клиента" /></SelectTrigger>
                <SelectContent>
                  {clients.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} — {p.domain}</SelectItem>)}
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
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label} {topicsByTab[t.id]?.length ? `(${topicsByTab[t.id].length})` : ""}
                </TabsTrigger>
              ))}
            </TabsList>
            {TABS.map((t) => (
              <TabsContent key={t.id} value={t.id} className="space-y-2 pt-3">
                <div className="flex justify-end">
                  <Button type="button" size="sm" variant="outline" disabled={!!aiLoading} onClick={() => suggestAi(t.id)}>
                    {aiLoading === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                    Подобрать темы через AI
                  </Button>
                </div>
                {topicsByTab[t.id].length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-2">Тем нет — добавьте первую ниже</div>
                )}
                {topicsByTab[t.id].map((topic, idx) => (
                  <div key={topic.id} className="flex gap-2 items-start">
                    <Textarea
                      defaultValue={topic.title}
                      onBlur={(e) => { if (e.target.value.trim() !== topic.title) updateTopic(topic.id, e.target.value); }}
                      placeholder={`Тема ${idx + 1}`}
                      className="min-h-[48px]"
                    />
                    <Button type="button" size="icon" variant="ghost" onClick={() => deleteTopic(topic.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2 items-start pt-2 border-t border-border/40">
                  <Textarea
                    value={drafts[t.id]}
                    onChange={(e) => setDrafts((s) => ({ ...s, [t.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addTopic(t.id, drafts[t.id]); }
                    }}
                    placeholder="Новая тема — введите и нажмите «Добавить»"
                    className="min-h-[48px]"
                  />
                  <Button type="button" size="sm" onClick={() => addTopic(t.id, drafts[t.id])} disabled={!drafts[t.id].trim() || !clientId}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Добавить
                  </Button>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Закрыть</Button>
          <Button onClick={submitForReview} disabled={submitting || !planId || topics.length === 0}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
            Отправить на согласование
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanDetail({ planId, onBack, onOpenWriting }: { planId: string; onBack: () => void; onOpenWriting: (planId: string) => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["cp-plan", planId],
    queryFn: async () => {
      const { data: plan, error } = await supabase
        .from("content_plans")
        .select("id, client_id, project_id, month, year, status, public_uuid, client_responded_at, content_clients(name, domain), projects(name, domain)")
        .eq("id", planId)
        .single();
      if (error) throw error;
      const { data: topics, error: e2 } = await supabase
        .from("content_topics")
        .select("id, plan_id, tab, title, position, status, comment, gen_status")
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cp-plan", planId] });
      toast.success("План передан в работу");
      onOpenWriting(planId);
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const { plan, topics } = data as any;
  const owner = plan.content_clients ?? plan.projects ?? { name: "-", domain: "-" };
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
              <CardTitle className="text-lg">{owner.name} — {String(plan.month).padStart(2, "0")}/{plan.year}</CardTitle>
              <CardDescription>{owner.domain}</CardDescription>
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
            {plan.status === "in_progress" && (
              <Button size="sm" onClick={() => onOpenWriting(planId)}>
                <FileText className="h-3.5 w-3.5 mr-1" /> Открыть написание статей
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

// ===================== Writing screen =====================

const GEN_LABEL: Record<string, { label: string; cls: string }> = {
  pending:    { label: "Ожидает",   cls: "bg-muted text-muted-foreground" },
  queued:     { label: "В очереди", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  processing: { label: "В работе",  cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  done:       { label: "Готово",    cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  error:      { label: "Ошибка",    cls: "bg-red-500/15 text-red-400 border-red-500/30" },
};

function WritingScreen({ planId, onBack }: { planId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [openTopic, setOpenTopic] = useState<Topic | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<{ topicIds?: string[] } | null>(null);
  const [starting, setStarting] = useState(false);
  const [retryingTopicId, setRetryingTopicId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const { data, isLoading } = useQuery({
    queryKey: ["cp-writing", planId],
    queryFn: async () => {
      const { data: plan, error } = await supabase
        .from("content_plans")
        .select("id, client_id, month, year, status, template_settings, content_clients(name, domain, niche), projects(name, domain)")
        .eq("id", planId).single();
      if (error) throw error;
      const { data: topics, error: e2 } = await supabase
        .from("content_topics")
        .select("id, plan_id, tab, title, position, status, comment, gen_status, article_title, article_markdown, gen_error, attempts, article_id, updated_at")
        .eq("plan_id", planId).eq("status", "ok")
        .order("tab").order("position");
      if (e2) throw e2;
      return { plan, topics: (topics ?? []) as Topic[] };
    },
  });

  const plan = data?.plan as any;
  const topics = data?.topics ?? [];
  const owner = plan?.content_clients ?? plan?.projects ?? { name: "-", domain: "-", niche: "" };
  const total = topics.length;
  const done = topics.filter((t) => t.gen_status === "done").length;
  const inFlight = topics.some((t) => t.gen_status === "queued" || t.gen_status === "processing");
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isStuck = (t: Topic) => {
    const status = t.gen_status ?? "pending";
    if (status !== "queued" && status !== "processing") return false;
    const updatedAt = t.updated_at ? new Date(t.updated_at).getTime() : 0;
    return updatedAt > 0 && nowMs - updatedAt > 10 * 60 * 1000;
  };

  const startQueue = async (settings: TemplateSettings, topicIds?: string[]) => {
    setStarting(true);
    try {
      const { error } = await supabase.functions.invoke("content-plan-start-queue", {
        body: { plan_id: planId, settings, topic_ids: topicIds },
      });
      if (error) throw new Error(error.message);
      toast.success(topicIds?.length ? "Тема поставлена в очередь" : "Очередь запущена");
      qc.invalidateQueries({ queryKey: ["cp-writing", planId] });
    } catch (e: any) {
      toast.error(e.message || "Не удалось запустить");
    } finally {
      setStarting(false);
      setSettingsOpen(null);
    }
  };

  const retryTopic = async (topic: Topic) => {
    setRetryingTopicId(topic.id);
    try {
      const { error: updateError } = await supabase
        .from("content_topics")
        .update({ gen_status: "queued", gen_error: null })
        .eq("id", topic.id);
      if (updateError) throw updateError;

      const { error: invokeError } = await supabase.functions.invoke("content-plan-process-next", {
        body: { plan_id: planId, topic_id: topic.id },
      });
      if (invokeError) throw new Error(invokeError.message);

      toast.success("Тема повторно отправлена в очередь");
      qc.invalidateQueries({ queryKey: ["cp-writing", planId] });
    } catch (e: any) {
      toast.error(e.message || "Не удалось повторить");
    } finally {
      setRetryingTopicId(null);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`content_topics:${planId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "content_topics", filter: `plan_id=eq.${planId}` }, () => {
        qc.invalidateQueries({ queryKey: ["cp-writing", planId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [planId, qc]);

  if (isLoading || !plan) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="container max-w-5xl py-6 space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" /> Назад</Button>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-lg">Написание статей — {owner.name}</CardTitle>
              <CardDescription>{owner.domain} · {String(plan.month).padStart(2, "0")}/{plan.year}</CardDescription>
            </div>
            <Button size="sm" onClick={() => setSettingsOpen({})} disabled={starting || total === 0 || done === total}>
              {starting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Settings2 className="h-4 w-4 mr-1" />}
              Настроить и запустить все
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Написано {done} из {total}{inFlight ? " · в работе" : ""}</span>
              <span>{progressPct}%</span>
            </div>
            <Progress value={progressPct} className="h-2" />
          </div>

          {total === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-6">Нет согласованных тем</div>
          ) : (
            <div className="space-y-2">
              {topics.map((t) => {
                const status = t.gen_status ?? "pending";
                const gs = GEN_LABEL[status] ?? GEN_LABEL.pending;
                const tabLabel = TABS.find((x) => x.id === t.tab)?.label ?? t.tab;
                const busy = status === "queued" || status === "processing";
                const stuck = isStuck(t);
                const retrying = retryingTopicId === t.id;
                return (
                  <div key={t.id} className="rounded-md border border-border bg-card p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground mb-0.5">{tabLabel}</div>
                        <div className="text-sm">{t.title}</div>
                      </div>
                      <Badge variant="outline" className={`text-[10px] shrink-0 inline-flex items-center gap-1 ${gs.cls}`}>
                        {status === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}
                        {gs.label}
                      </Badge>
                    </div>
                    {t.gen_error && (
                      <div className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {t.gen_error}</div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {status !== "done" && (
                        <Button size="sm" variant="outline" disabled={busy || starting} onClick={() => setSettingsOpen({ topicIds: [t.id] })}>
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                          {status === "error" ? "Повторить" : "Написать"}
                        </Button>
                      )}
                      {stuck && (
                        <Button size="sm" variant="outline" disabled={retrying || starting} onClick={() => retryTopic(t)}>
                          {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
                          Повторить
                        </Button>
                      )}
                      {status === "done" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => {
                            if (t.article_id) window.open(`/articles?edit=${t.article_id}`, "_blank");
                            else setOpenTopic(t);
                          }}>
                            <FileText className="h-3.5 w-3.5 mr-1" /> Открыть
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => {
                            navigator.clipboard.writeText(t.article_markdown ?? "");
                            toast.success("Скопировано");
                          }}>
                            <Copy className="h-3.5 w-3.5 mr-1" /> Скопировать
                          </Button>
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 self-center" />
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {settingsOpen && (
        <WritingSettingsDialog
          initial={(plan?.template_settings as TemplateSettings) ?? DEFAULT_SETTINGS}
          singleTopic={!!settingsOpen.topicIds?.length}
          onClose={() => setSettingsOpen(null)}
          onSubmit={(s) => startQueue(s, settingsOpen.topicIds)}
          submitting={starting}
        />
      )}

      {openTopic && (
        <Dialog open onOpenChange={(o) => !o && setOpenTopic(null)}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{openTopic.article_title ?? openTopic.title}</DialogTitle>
            </DialogHeader>
            <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">{openTopic.article_markdown}</pre>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                navigator.clipboard.writeText(openTopic.article_markdown ?? "");
                toast.success("Скопировано");
              }}><Copy className="h-3.5 w-3.5 mr-1" /> Скопировать</Button>
              <Button onClick={() => setOpenTopic(null)}>Закрыть</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function WritingSettingsDialog({ initial, singleTopic, onClose, onSubmit, submitting }: {
  initial: TemplateSettings; singleTopic: boolean; onClose: () => void;
  onSubmit: (s: TemplateSettings) => void; submitting: boolean;
}) {
  const [s, setS] = useState<TemplateSettings>({ ...DEFAULT_SETTINGS, ...(initial ?? {}) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{singleTopic ? "Параметры для темы" : "Параметры написания"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Автор</Label>
            <Select value={s.persona_id} onValueChange={(v) => setS({ ...s, persona_id: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERSONA_OPTIONS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Длина</Label>
              <Select value={s.length} onValueChange={(v) => setS({ ...s, length: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LENGTH_OPTIONS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Язык</Label>
              <Select value={s.language} onValueChange={(v) => setS({ ...s, language: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ru">Русский</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <div className="text-sm">Stealth Engine</div>
              <div className="text-xs text-muted-foreground">Маскировка под человеческий стиль</div>
            </div>
            <Switch checked={s.stealth} onCheckedChange={(v) => setS({ ...s, stealth: !!v })} />
          </div>
          <div className="space-y-1">
            <Label>Дополнительные инструкции</Label>
            <Textarea value={s.extra_instructions} onChange={(e) => setS({ ...s, extra_instructions: e.target.value })}
              placeholder="Тон, акценты, что упомянуть или избегать"
              className="min-h-[90px]" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={() => onSubmit(s)} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Запустить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}