import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Radar as RadarIcon, Plus, Loader2, Search, TrendingUp, TrendingDown,
  Eye, ExternalLink, Trash2, RefreshCw, Shield, AlertTriangle,
  Sparkles, Globe, ChevronRight, ArrowUpRight, Minus, CheckCircle2, XCircle, ChevronDown
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";
import { PlanGate } from "@/shared/components/PlanGate";

// Status config
const STATUS_CONFIG = {
  captured: { label: "Captured", color: "bg-purple-500/20 text-purple-400 border-purple-500/30", icon: Shield },
  displaced: { label: "Displaced", color: "bg-destructive/20 text-destructive border-destructive/30", icon: AlertTriangle },
  opportunity: { label: "Opportunity", color: "bg-muted text-muted-foreground border-border", icon: Sparkles },
};

const MODEL_LABELS: Record<string, string> = {
  gemini_flash: "Gemini Flash",
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  claude: "Claude",
};

// Radial chart component
function RadialChart({ value, label, color }: { value: number; label: string; color: string }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (value / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-24 h-24">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={radius} stroke="hsl(var(--muted))" strokeWidth="6" fill="none" />
          <motion.circle
            cx="40" cy="40" r={radius}
            stroke={color}
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1, ease: "easeOut" }}
            style={{ strokeDasharray: circumference }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold text-foreground">{value}%</span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
    </div>
  );
}

export default function RadarPage() {
  const queryClient = useQueryClient();
  const { isPro } = usePlanLimits();
  const [showAddProject, setShowAddProject] = useState(false);
  const [newBrand, setNewBrand] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [newNuggets, setNewNuggets] = useState("");
  const [newKeyword, setNewKeyword] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkKeywords, setBulkKeywords] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [viewResponseData, setViewResponseData] = useState<{
    model: string; text: string; date: string;
    brand_mentioned: boolean; domain_linked: boolean;
    matched_snippets: string[]; status: string; keyword: string;
  } | null>(null);
  const [responseOpen, setResponseOpen] = useState(false);
  const responseRef = useRef<HTMLDivElement>(null);

  // Fetch projects
  const { data: projects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ["radar-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("radar_projects")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const activeProject = projects.find((p: any) => p.id === selectedProjectId) || projects[0];

  // Fetch keywords for active project
  const { data: keywords = [] } = useQuery({
    queryKey: ["radar-keywords", activeProject?.id],
    queryFn: async () => {
      if (!activeProject) return [];
      const { data, error } = await supabase
        .from("radar_keywords")
        .select("*")
        .eq("project_id", activeProject.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeProject,
  });

  // Fetch results
  const { data: results = [] } = useQuery({
    queryKey: ["radar-results", activeProject?.id],
    queryFn: async () => {
      if (!activeProject) return [];
      const kwIds = keywords.map((k: any) => k.id);
      if (kwIds.length === 0) return [];
      const { data, error } = await supabase
        .from("radar_results")
        .select("*")
        .in("keyword_id", kwIds)
        .order("checked_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: keywords.length > 0,
  });

  // Share of Model calculations
  const somData = useMemo(() => {
    const models = ["gemini_flash", "chatgpt", "perplexity", "claude"];
    return models.map(model => {
      const modelResults = results.filter((r: any) => r.model === model);
      if (modelResults.length === 0) return { model, label: MODEL_LABELS[model], value: 0 };
      // Get latest result per keyword
      const latestByKw: Record<string, any> = {};
      modelResults.forEach((r: any) => {
        if (!latestByKw[r.keyword_id] || r.checked_at > latestByKw[r.keyword_id].checked_at) {
          latestByKw[r.keyword_id] = r;
        }
      });
      const latest = Object.values(latestByKw);
      const captured = latest.filter((r: any) => r.status === "captured").length;
      const pct = Math.round((captured / latest.length) * 100);
      return { model, label: MODEL_LABELS[model], value: pct };
    });
  }, [results]);

  // Competitor aggregation
  const topCompetitors = useMemo(() => {
    const counts: Record<string, number> = {};
    const latestByKwModel: Record<string, any> = {};
    results.forEach((r: any) => {
      const key = `${r.keyword_id}_${r.model}`;
      if (!latestByKwModel[key] || r.checked_at > latestByKwModel[key].checked_at) {
        latestByKwModel[key] = r;
      }
    });
    Object.values(latestByKwModel).forEach((r: any) => {
      (r.competitor_domains || []).forEach((d: string) => {
        counts[d] = (counts[d] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([domain, count]) => ({ domain, count }));
  }, [results]);

  // Keyword status summary
  const keywordSummary = useMemo(() => {
    return keywords.map((kw: any) => {
      const kwResults = results.filter((r: any) => r.keyword_id === kw.id);
      const latestByModel: Record<string, any> = {};
      kwResults.forEach((r: any) => {
        if (!latestByModel[r.model] || r.checked_at > latestByModel[r.model].checked_at) {
          latestByModel[r.model] = r;
        }
      });
      const latest = Object.values(latestByModel);
      const prevByModel: Record<string, any> = {};
      kwResults.forEach((r: any) => {
        const latestCheck = latestByModel[r.model]?.checked_at;
        if (r.checked_at !== latestCheck) {
          if (!prevByModel[r.model] || r.checked_at > prevByModel[r.model].checked_at) {
            prevByModel[r.model] = r;
          }
        }
      });

      const capturedCount = latest.filter((r: any) => r.status === "captured").length;
      const prevCapturedCount = Object.values(prevByModel).filter((r: any) => r.status === "captured").length;
      const trend = capturedCount > prevCapturedCount ? "up" : capturedCount < prevCapturedCount ? "down" : "stable";
      const mainStatus = capturedCount > 0 ? "captured" : latest.some((r: any) => r.status === "displaced") ? "displaced" : "opportunity";

      return { ...kw, latestResults: latest, mainStatus, trend };
    });
  }, [keywords, results]);

  // Mutations
  const addProject = useMutation({
    mutationFn: async () => {
      const session = await supabase.auth.getSession();
      const userId = session.data.session?.user?.id;
      if (!userId) throw new Error("Not authenticated");
      const nuggets = newNuggets.split("\n").filter(n => n.trim());
      const { data, error } = await supabase.from("radar_projects").insert({
        user_id: userId,
        brand_name: newBrand,
        domain: newDomain,
        data_nuggets: nuggets,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["radar-projects"] });
      setSelectedProjectId(data.id);
      setShowAddProject(false);
      setNewBrand("");
      setNewDomain("");
      setNewNuggets("");
      toast.success("Проект создан");
    },
    onError: (e) => toast.error(e.message),
  });

  const addKeyword = useMutation({
    mutationFn: async () => {
      const session = await supabase.auth.getSession();
      const userId = session.data.session?.user?.id;
      if (!userId || !activeProject) throw new Error("Not authenticated");

      const keywordsToAdd = bulkMode
        ? bulkKeywords.split("\n").map(k => k.trim()).filter(k => k.length > 0).slice(0, 30)
        : [newKeyword.trim()].filter(k => k.length > 0);

      if (keywordsToAdd.length === 0) throw new Error("Нет запросов для добавления");
      if (keywordsToAdd.length > 30) throw new Error("Максимум 30 запросов за раз");

      const rows = keywordsToAdd.map(keyword => ({
        user_id: userId,
        project_id: activeProject.id,
        keyword,
      }));

      const { error } = await supabase.from("radar_keywords").insert(rows);
      if (error) throw error;
      return keywordsToAdd.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["radar-keywords"] });
      setNewKeyword("");
      setBulkKeywords("");
      setBulkMode(false);
      toast.success(`Добавлено запросов: ${count}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const checkKeyword = useMutation({
    mutationFn: async (keywordId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/radar-check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ keyword_id: keywordId, project_id: activeProject?.id }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Ошибка проверки" }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["radar-results"] });
      queryClient.invalidateQueries({ queryKey: ["radar-keywords"] });
      toast.success("Проверка завершена");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteProject = useMutation({
    mutationFn: async (projectId: string) => {
      // Delete keywords & results first (cascade not set up)
      const { data: kwData } = await supabase
        .from("radar_keywords")
        .select("id")
        .eq("project_id", projectId);
      const kwIds = (kwData || []).map((k: any) => k.id);
      if (kwIds.length > 0) {
        await supabase.from("radar_results").delete().in("keyword_id", kwIds);
        await supabase.from("radar_keywords").delete().eq("project_id", projectId);
      }
      const { error } = await supabase.from("radar_projects").delete().eq("id", projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["radar-projects"] });
      queryClient.invalidateQueries({ queryKey: ["radar-keywords"] });
      queryClient.invalidateQueries({ queryKey: ["radar-results"] });
      setSelectedProjectId(null);
      toast.success("Проект удалён");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteKeyword = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("radar_keywords").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["radar-keywords"] });
      queryClient.invalidateQueries({ queryKey: ["radar-results"] });
      toast.success("Запрос удалён");
    },
  });

  if (!isPro) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <RadarIcon className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">AI Radar</h1>
            <p className="text-sm text-muted-foreground">Мониторинг упоминаний бренда в ответах ИИ</p>
          </div>
        </div>
        <PlanGate allowed={false} featureName="AI Radar" requiredPlan="PRO">
          <div />
        </PlanGate>
      </div>
    );
  }

  const overallCaptured = somData.reduce((s, d) => s + d.value, 0) / (somData.length || 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <RadarIcon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">AI Radar</h1>
            <p className="text-sm text-muted-foreground">
              Мониторинг цитируемости бренда в ответах ИИ-моделей
            </p>
          </div>
        </div>
        <Button onClick={() => setShowAddProject(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Новый проект
        </Button>
      </div>

      {/* Project selector */}
      {projects.length >= 1 && (
        <div className="flex gap-2 flex-wrap">
          {projects.map((p: any) => (
            <Button
              key={p.id}
              variant={activeProject?.id === p.id ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedProjectId(p.id)}
            >
              <Globe className="h-3 w-3 mr-1.5" />
              {p.brand_name}
            </Button>
          ))}
          {activeProject && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive gap-1">
                  <Trash2 className="h-3 w-3" />
                  Удалить проект
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Удалить проект «{activeProject.brand_name}»?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Все ключевые слова и результаты проверок будут удалены. Это действие нельзя отменить.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteProject.mutate(activeProject.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleteProject.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Удалить
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}

      {!activeProject ? (
        <Card className="bg-card border-border">
          <CardContent className="py-16 text-center">
            <RadarIcon className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">Создайте проект мониторинга для начала работы</p>
            <Button onClick={() => setShowAddProject(true)} variant="outline" className="mt-4 gap-2">
              <Plus className="h-4 w-4" /> Создать проект
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Share of Model Dashboard */}
          <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Share of Model (SoM)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-around py-4">
                  {somData.map((d) => (
                    <RadialChart
                      key={d.model}
                      value={d.value}
                      label={d.label}
                      color={d.value > 30 ? "hsl(var(--primary))" : d.value > 0 ? "hsl(var(--warning))" : "hsl(var(--muted-foreground))"}
                    />
                  ))}
                  <RadialChart
                    value={Math.round(overallCaptured)}
                    label="Общий"
                    color="hsl(var(--primary))"
                  />
                </div>
                <Separator className="my-3" />
                <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-primary" /> Captured
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-destructive" /> Displaced
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground" /> Opportunity
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Competitor Alert */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Competitor Alert
                </CardTitle>
              </CardHeader>
              <CardContent>
                {topCompetitors.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Запустите проверку для отслеживания конкурентов
                  </p>
                ) : (
                  <div className="space-y-2">
                    {topCompetitors.map((c, i) => (
                      <div key={c.domain} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/30">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-5">#{i + 1}</span>
                          <span className="text-sm font-medium truncate max-w-[200px]">{c.domain}</span>
                        </div>
                        <Badge variant="outline" className="text-xs border-destructive/30 text-destructive">
                          {c.count} упоминаний
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Add keyword */}
          <Card className="bg-card border-border">
            <CardContent className="pt-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">
                    {bulkMode ? `Массовое добавление (до 30 запросов, по одному на строку)` : "Добавить запрос"}
                  </Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => setBulkMode(!bulkMode)}
                  >
                    {bulkMode ? "Одиночный режим" : "Массовое добавление"}
                  </Button>
                </div>
                {bulkMode ? (
                  <div className="space-y-2">
                    <Textarea
                      placeholder={"лучший CRM для малого бизнеса\nкак выбрать CRM систему\nCRM для интернет-магазина\n..."}
                      value={bulkKeywords}
                      onChange={(e) => setBulkKeywords(e.target.value)}
                      rows={6}
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {bulkKeywords.split("\n").filter(k => k.trim()).length} / 30 запросов
                      </span>
                      <Button
                        onClick={() => addKeyword.mutate()}
                        disabled={!bulkKeywords.trim() || addKeyword.isPending}
                        size="sm"
                      >
                        {addKeyword.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                        <Plus className="h-4 w-4 mr-1.5" />
                        Добавить все
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Input
                        placeholder="Введите поисковый запрос для мониторинга..."
                        value={newKeyword}
                        onChange={(e) => setNewKeyword(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && newKeyword.trim() && addKeyword.mutate()}
                      />
                    </div>
                    <Button
                      onClick={() => addKeyword.mutate()}
                      disabled={!newKeyword.trim() || addKeyword.isPending}
                    >
                      {addKeyword.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                      <Plus className="h-4 w-4 mr-1.5" />
                      Добавить
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Active Keywords Table */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                Active Keywords
                <Badge variant="secondary" className="ml-auto">{keywords.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {keywords.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Добавьте ключевые запросы для мониторинга
                </p>
              ) : (
                <div className="space-y-2">
                  {keywordSummary.map((kw: any) => {
                    const statusConf = STATUS_CONFIG[kw.mainStatus as keyof typeof STATUS_CONFIG];
                    const StatusIcon = statusConf?.icon || Sparkles;
                    return (
                      <motion.div
                        key={kw.id}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{kw.keyword}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {kw.latestResults.map((r: any) => {
                              const sc = STATUS_CONFIG[r.status as keyof typeof STATUS_CONFIG];
                              return (
                                <button
                                  key={r.model}
                                  onClick={() => setViewResponseData({
                                    model: MODEL_LABELS[r.model] || r.model,
                                    text: r.ai_response_text || "",
                                    date: new Date(r.checked_at).toLocaleString("ru"),
                                    brand_mentioned: r.brand_mentioned || false,
                                    domain_linked: r.domain_linked || false,
                                    matched_snippets: r.matched_snippets || [],
                                    status: r.status || "opportunity",
                                    keyword: kw.keyword,
                                  })}
                                  className={`text-[10px] px-2 py-0.5 rounded-full border cursor-pointer hover:opacity-80 ${sc?.color || ""}`}
                                >
                                  {MODEL_LABELS[r.model] || r.model}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Status badge */}
                        <Badge className={`${statusConf?.color || ""} gap-1`}>
                          <StatusIcon className="h-3 w-3" />
                          {statusConf?.label}
                        </Badge>

                        {/* Trend */}
                        <div className="w-8 flex justify-center">
                          {kw.trend === "up" ? (
                            <TrendingUp className="h-4 w-4 text-primary" />
                          ) : kw.trend === "down" ? (
                            <TrendingDown className="h-4 w-4 text-destructive" />
                          ) : (
                            <Minus className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            disabled={checkKeyword.isPending}
                            onClick={() => checkKeyword.mutate(kw.id)}
                          >
                            {checkKeyword.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            onClick={() => deleteKeyword.mutate(kw.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Add Project Dialog */}
      <Dialog open={showAddProject} onOpenChange={setShowAddProject}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Новый проект мониторинга</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Название бренда</Label>
              <Input
                placeholder="Например: SERPblueprint"
                value={newBrand}
                onChange={(e) => setNewBrand(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Домен сайта</Label>
              <Input
                placeholder="example.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data Nuggets (уникальные тезисы, по одному на строку)</Label>
              <textarea
                className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder={"73% компаний используют ИИ в маркетинге\nROI контент-маркетинга вырос на 42%"}
                value={newNuggets}
                onChange={(e) => setNewNuggets(e.target.value)}
              />
            </div>
            <Button
              onClick={() => addProject.mutate()}
              disabled={!newBrand.trim() || !newDomain.trim() || addProject.isPending}
              className="w-full"
            >
              {addProject.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Создать проект
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View AI Response Dialog */}
      <Dialog open={!!viewResponseData} onOpenChange={() => setViewResponseData(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Ответ {viewResponseData?.model}
              <span className="text-xs text-muted-foreground font-normal ml-2">{viewResponseData?.date}</span>
            </DialogTitle>
            <DialogDescription>
              Запрос: <span className="font-medium text-foreground">{viewResponseData?.keyword}</span>
            </DialogDescription>
          </DialogHeader>

          {/* Status summary cards */}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className={`p-3 rounded-lg border ${viewResponseData?.brand_mentioned ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
              <div className="flex items-center gap-2 mb-1">
                {viewResponseData?.brand_mentioned ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                <span className="text-sm font-medium">Бренд</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {viewResponseData?.brand_mentioned ? "Упомянут в ответе" : "Не упомянут"}
              </p>
            </div>
            <div className={`p-3 rounded-lg border ${viewResponseData?.domain_linked ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
              <div className="flex items-center gap-2 mb-1">
                {viewResponseData?.domain_linked ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                <span className="text-sm font-medium">Домен</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {viewResponseData?.domain_linked ? "Ссылка найдена" : "Ссылка не найдена"}
              </p>
            </div>
          </div>

          {/* Matched snippets */}
          {viewResponseData?.matched_snippets && viewResponseData.matched_snippets.length > 0 && (
            <div className="mt-3">
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5" />
                Найденные упоминания
              </h4>
              <div className="space-y-2">
                {viewResponseData.matched_snippets.map((s, i) => (
                  <button
                    key={i}
                    className="w-full text-left p-2.5 rounded-md bg-primary/5 border border-primary/20 text-xs leading-relaxed hover:bg-primary/10 transition-colors cursor-pointer"
                    onClick={() => {
                      // Open the full response and scroll to the snippet
                      setResponseOpen(true);
                      setTimeout(() => {
                        const el = responseRef.current;
                        if (!el) return;
                        const cleanSnippet = s.replace(/^\[Data Nugget\]\s*/, "").slice(0, 40);
                        const idx = el.textContent?.toLowerCase().indexOf(cleanSnippet.toLowerCase()) ?? -1;
                        if (idx >= 0) {
                          // Find the highlighted mark element
                          const marks = el.querySelectorAll("mark");
                          for (const mark of marks) {
                            if (mark.textContent?.toLowerCase().includes(cleanSnippet.slice(0, 20).toLowerCase())) {
                              mark.scrollIntoView({ behavior: "smooth", block: "center" });
                              mark.classList.add("ring-2", "ring-primary");
                              setTimeout(() => mark.classList.remove("ring-2", "ring-primary"), 2000);
                              break;
                            }
                          }
                        }
                      }, 150);
                    }}
                  >
                    <span className="flex items-center gap-1.5">
                      <ArrowUpRight className="h-3 w-3 text-primary shrink-0" />
                      {s}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Collapsible raw response with brand highlighting */}
          <Collapsible open={responseOpen} onOpenChange={setResponseOpen} className="mt-3">
            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              <ChevronDown className="h-3.5 w-3.5" />
              Показать полный ответ ИИ
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div
                ref={responseRef}
                className="mt-2 p-4 rounded-lg bg-muted/30 border border-border text-xs leading-relaxed whitespace-pre-wrap max-h-[40vh] overflow-y-auto"
                dangerouslySetInnerHTML={{
                  __html: highlightBrand(
                    viewResponseData?.text || "Нет данных",
                    selectedProject?.brand_name || "",
                    selectedProject?.domain || "",
                  ),
                }}
              />
            </CollapsibleContent>
          </Collapsible>
        </DialogContent>
      </Dialog>
    </div>
  );
}
