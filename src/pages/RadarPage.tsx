import { useState, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/shared/hooks/useI18n";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Radar as RadarIcon, Plus, Loader2, Search, TrendingUp, TrendingDown,
  Eye, Trash2, RefreshCw, Shield, AlertTriangle,
  Sparkles, Globe, ArrowUpRight, Minus, CheckCircle2, XCircle, ChevronDown,
  Lightbulb, Wand2, Languages, BarChart3, Target, Zap
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

const MODEL_LABELS: Record<string, string> = {
  gemini_flash: "Gemini Flash",
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  claude: "Claude",
};

const MODEL_COLORS: Record<string, string> = {
  gemini_flash: "#4285F4",
  chatgpt: "#10A37F",
  perplexity: "#20808D",
  claude: "#D97706",
};

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightBrand(text: string, brandName: string, domain: string): string {
  let html = escapeHtml(text);
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase();
  const domainBase = cleanDomain.replace(/\.[a-z]{2,}$/, "");
  const terms = new Set<string>();
  if (brandName) terms.add(brandName.toLowerCase());
  if (cleanDomain) terms.add(cleanDomain);
  if (domainBase) terms.add(domainBase);
  if (domainBase.length >= 4) {
    for (let i = 2; i <= domainBase.length - 2; i++) {
      terms.add(domainBase.slice(0, i) + " " + domainBase.slice(i));
    }
  }
  const sorted = Array.from(terms).filter(t => t.length >= 3).sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    html = html.replace(regex, `<mark class="bg-purple-500/30 text-purple-300 rounded px-0.5">$1</mark>`);
  }
  return html;
}

function getRadialColor(value: number): string {
  if (value >= 60) return "#22c55e";
  if (value >= 30) return "#eab308";
  if (value > 0) return "#ef4444";
  return "hsl(var(--muted-foreground))";
}

function RadialChart({ value, label, color, subtitle }: { value: number; label: string; color?: string; subtitle?: string }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (value / 100) * circumference;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-[88px] h-[88px]">
        <svg className="w-[88px] h-[88px] -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={radius} stroke="hsl(var(--muted))" strokeWidth="5" fill="none" />
          <motion.circle cx="40" cy="40" r={radius} stroke={color || getRadialColor(value)} strokeWidth="5" fill="none" strokeLinecap="round" initial={{ strokeDashoffset: circumference }} animate={{ strokeDashoffset }} transition={{ duration: 1.2, ease: "easeOut" }} style={{ strokeDasharray: circumference }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-base font-bold text-foreground">{value}%</span>
        </div>
      </div>
      <span className="text-[11px] text-muted-foreground font-medium text-center leading-tight">{label}</span>
      {subtitle && <span className="text-[10px] text-muted-foreground/60">{subtitle}</span>}
    </div>
  );
}

function SkeletonCard({ className }: { className?: string }) {
  return (
    <Card className={`bg-card/50 border-border backdrop-blur-sm ${className || ""}`}>
      <CardHeader className="pb-3"><Skeleton className="h-4 w-32" /></CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </CardContent>
    </Card>
  );
}

const SMART_PROMPT_TYPES = {
  direct: { ru: "Прямое исследование", en: "Direct Research" },
  comparison: { ru: "Сравнение с конкурентами", en: "Comparison with Competitors" },
  solution: { ru: "Поиск решения", en: "Solution Finding" },
  toplist: { ru: "Топ-лист", en: "Top-List" },
  authority: { ru: "Авторитетность бренда", en: "Brand Authority" },
};

function generateSmartPrompts(brandName: string, domain: string, nuggets: string[], language: string): { type: string; prompt: string }[] {
  const niche = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\.[a-z]{2,}$/, "");
  if (language === "ru") {
    return [
      { type: "direct", prompt: `Что такое ${brandName} и для чего это используется?` },
      { type: "comparison", prompt: `Лучшие альтернативы ${brandName} в ${new Date().getFullYear()} году` },
      { type: "solution", prompt: `Как решить проблему ${nuggets[0] || niche}?` },
      { type: "toplist", prompt: `Топ-5 сервисов в нише ${niche}` },
      { type: "authority", prompt: `${brandName} отзывы и обзор ${new Date().getFullYear()}` },
    ];
  }
  return [
    { type: "direct", prompt: `What is ${brandName} and what is it used for?` },
    { type: "comparison", prompt: `Best ${brandName} alternatives in ${new Date().getFullYear()}` },
    { type: "solution", prompt: `How to solve ${nuggets[0] || niche} problem?` },
    { type: "toplist", prompt: `Top 5 ${niche} tools and services` },
    { type: "authority", prompt: `${brandName} review and comparison ${new Date().getFullYear()}` },
  ];
}

export default function RadarPage() {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const { isPro } = usePlanLimits();
  const [showAddProject, setShowAddProject] = useState(false);
  const [newBrand, setNewBrand] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [newNuggets, setNewNuggets] = useState("");
  const [newLanguage, setNewLanguage] = useState<"ru" | "en">("en");
  const [newKeyword, setNewKeyword] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkKeywords, setBulkKeywords] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showSmartPrompts, setShowSmartPrompts] = useState(false);
  const [scanningKeywordId, setScanningKeywordId] = useState<string | null>(null);
  const [viewResponseData, setViewResponseData] = useState<{
    model: string; text: string; date: string;
    brand_mentioned: boolean; domain_linked: boolean;
    matched_snippets: string[]; status: string; keyword: string;
  } | null>(null);
  const [responseOpen, setResponseOpen] = useState(false);
  const responseRef = useRef<HTMLDivElement>(null);

  const { data: projects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ["radar-projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("radar_projects").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const activeProject = projects.find((p: any) => p.id === selectedProjectId) || projects[0];
  const projectLang = (activeProject as any)?.language || "en";

  const { data: keywords = [], refetch: refetchKeywords } = useQuery({
    queryKey: ["radar-keywords", activeProject?.id],
    queryFn: async () => {
      if (!activeProject) return [];
      const { data, error } = await supabase.from("radar_keywords").select("*").eq("project_id", activeProject.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeProject,
  });

  const keywordIdsKey = keywords.map((k: any) => k.id).sort().join(",");
  const { data: results = [], isLoading: loadingResults, refetch: refetchResults } = useQuery({
    queryKey: ["radar-results", activeProject?.id, keywordIdsKey],
    queryFn: async () => {
      if (!activeProject) return [];
      const kwIds = keywords.map((k: any) => k.id);
      if (kwIds.length === 0) return [];
      const { data, error } = await supabase.from("radar_results").select("*").in("keyword_id", kwIds).order("checked_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeProject && keywords.length > 0,
  });

  // SoM data
  const somData = useMemo(() => {
    const models = ["gemini_flash", "chatgpt", "perplexity", "claude"];
    return models.map(model => {
      const modelResults = results.filter((r: any) => r.model === model);
      if (modelResults.length === 0) return { model, label: MODEL_LABELS[model], value: 0, status: "opportunity" as const };
      const latestByKw: Record<string, any> = {};
      modelResults.forEach((r: any) => {
        if (!latestByKw[r.keyword_id] || r.checked_at > latestByKw[r.keyword_id].checked_at) latestByKw[r.keyword_id] = r;
      });
      const latest = Object.values(latestByKw);
      const captured = latest.filter((r: any) => r.status === "captured").length;
      const value = Math.round((captured / latest.length) * 100);
      const status = value >= 60 ? "captured" as const : value > 0 ? "displaced" as const : "opportunity" as const;
      return { model, label: MODEL_LABELS[model], value, status };
    });
  }, [results]);

  // Message Resonance (nugget adoption per model)
  const resonanceData = useMemo(() => {
    if (!activeProject) return [];
    const nuggets = (activeProject as any).data_nuggets || [];
    if (nuggets.length === 0) return [];
    const models = ["gemini_flash", "chatgpt", "perplexity", "claude"];
    return models.map(model => {
      const modelResults = results.filter((r: any) => r.model === model);
      if (modelResults.length === 0) return { model, label: MODEL_LABELS[model], percentage: 0 };
      // Check latest results for each keyword
      const latestByKw: Record<string, any> = {};
      modelResults.forEach((r: any) => {
        if (!latestByKw[r.keyword_id] || r.checked_at > latestByKw[r.keyword_id].checked_at) latestByKw[r.keyword_id] = r;
      });
      const latestArr = Object.values(latestByKw);
      let nuggetMentions = 0;
      let totalChecks = 0;
      for (const r of latestArr) {
        const responseText = (r.ai_response_text || "").toLowerCase();
        for (const nugget of nuggets) {
          if (!nugget) continue;
          totalChecks++;
          const words = nugget.toLowerCase().split(/\s+/).filter((w: string) => w.length > 4);
          const matchCount = words.filter((w: string) => responseText.includes(w)).length;
          if (words.length > 0 && matchCount / words.length >= 0.5) nuggetMentions++;
        }
      }
      return { model, label: MODEL_LABELS[model], percentage: totalChecks > 0 ? Math.round((nuggetMentions / totalChecks) * 100) : 0 };
    });
  }, [results, activeProject]);

  const topCompetitors = useMemo(() => {
    const counts: Record<string, number> = {};
    const latestByKwModel: Record<string, any> = {};
    results.forEach((r: any) => {
      const key = `${r.keyword_id}_${r.model}`;
      if (!latestByKwModel[key] || r.checked_at > latestByKwModel[key].checked_at) latestByKwModel[key] = r;
    });
    Object.values(latestByKwModel).forEach((r: any) => {
      (r.competitor_domains || []).forEach((d: string) => { counts[d] = (counts[d] || 0) + 1; });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([domain, count]) => ({ domain, count }));
  }, [results]);

  const keywordSummary = useMemo(() => {
    return keywords.map((kw: any) => {
      const kwResults = results.filter((r: any) => r.keyword_id === kw.id);
      const latestByModel: Record<string, any> = {};
      kwResults.forEach((r: any) => {
        if (!latestByModel[r.model] || r.checked_at > latestByModel[r.model].checked_at) latestByModel[r.model] = r;
      });
      const latest = Object.values(latestByModel);
      const prevByModel: Record<string, any> = {};
      kwResults.forEach((r: any) => {
        const latestCheck = latestByModel[r.model]?.checked_at;
        if (r.checked_at !== latestCheck) {
          if (!prevByModel[r.model] || r.checked_at > prevByModel[r.model].checked_at) prevByModel[r.model] = r;
        }
      });
      const capturedCount = latest.filter((r: any) => r.status === "captured").length;
      const prevCapturedCount = Object.values(prevByModel).filter((r: any) => r.status === "captured").length;
      const trend = capturedCount > prevCapturedCount ? "up" : capturedCount < prevCapturedCount ? "down" : "stable";
      const mainStatus = capturedCount > 0 ? "captured" : latest.some((r: any) => r.status === "displaced") ? "displaced" : "opportunity";
      return { ...kw, latestResults: latest, mainStatus, trend };
    });
  }, [keywords, results]);

  // GEO Strategy
  const geoStrategy = useMemo(() => {
    const overallCaptured = somData.reduce((s, d) => s + d.value, 0) / (somData.length || 1);
    if (results.length === 0) return null;
    const weakModels = somData.filter(d => d.value < 30).map(d => d.label);
    const strongModels = somData.filter(d => d.value >= 60).map(d => d.label);
    const topComp = topCompetitors.slice(0, 3).map(c => c.domain);
    
    if (projectLang === "ru") {
      const tips: string[] = [];
      if (weakModels.length > 0) tips.push(`Создайте 5+ статей с упоминанием бренда для обучения: ${weakModels.join(", ")}`);
      if (topComp.length > 0) tips.push(`Проанализируйте контент конкурентов: ${topComp.join(", ")}`);
      if (overallCaptured < 30) tips.push("Увеличьте присутствие бренда в авторитетных источниках (Wikipedia, отраслевые обзоры)");
      if (strongModels.length > 0) tips.push(`Модели ${strongModels.join(", ")} уже знают ваш бренд — фокусируйтесь на слабых`);
      if (tips.length === 0) tips.push("Запустите сканирование для получения рекомендаций");
      return { overallCaptured: Math.round(overallCaptured), tips };
    }
    
    const tips: string[] = [];
    if (weakModels.length > 0) tips.push(`Create 5+ brand-mention articles to train: ${weakModels.join(", ")}`);
    if (topComp.length > 0) tips.push(`Analyze competitor content: ${topComp.join(", ")}`);
    if (overallCaptured < 30) tips.push("Increase brand presence in authoritative sources (Wikipedia, industry reviews)");
    if (strongModels.length > 0) tips.push(`Models ${strongModels.join(", ")} already know your brand — focus on weak ones`);
    if (tips.length === 0) tips.push("Run a scan to get recommendations");
    return { overallCaptured: Math.round(overallCaptured), tips };
  }, [somData, topCompetitors, results, projectLang]);

  const addProject = useMutation({
    mutationFn: async () => {
      const session = await supabase.auth.getSession();
      const userId = session.data.session?.user?.id;
      if (!userId) throw new Error("Not authenticated");
      const nuggets = newNuggets.split("\n").filter(n => n.trim());
      const { data, error } = await supabase.from("radar_projects").insert({
        user_id: userId, brand_name: newBrand, domain: newDomain,
        data_nuggets: nuggets, language: newLanguage,
      } as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["radar-projects"] });
      setSelectedProjectId(data.id);
      setShowAddProject(false);
      setNewBrand(""); setNewDomain(""); setNewNuggets(""); setNewLanguage("en");
      toast.success(t("radar.projectCreated"));
    },
    onError: (e: any) => toast.error(e.message),
  });

  const addKeyword = useMutation({
    mutationFn: async () => {
      const session = await supabase.auth.getSession();
      const userId = session.data.session?.user?.id;
      if (!userId || !activeProject) throw new Error("Not authenticated");
      const keywordsToAdd = bulkMode
        ? bulkKeywords.split("\n").map(k => k.trim()).filter(k => k.length > 0).slice(0, 30)
        : [newKeyword.trim()].filter(k => k.length > 0);
      if (keywordsToAdd.length === 0) throw new Error(t("radar.noQueriesError"));
      if (keywordsToAdd.length > 30) throw new Error(t("radar.maxQueriesError"));
      const rows = keywordsToAdd.map(keyword => ({ user_id: userId, project_id: activeProject.id, keyword }));
      const { error } = await supabase.from("radar_keywords").insert(rows);
      if (error) throw error;
      return keywordsToAdd.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["radar-keywords"] });
      setNewKeyword(""); setBulkKeywords(""); setBulkMode(false);
      toast.success(`${t("radar.queriesAdded")}: ${count}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const checkKeyword = useMutation({
    mutationFn: async (keywordId: string) => {
      setScanningKeywordId(keywordId);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/radar-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ keyword_id: keywordId, project_id: activeProject?.id }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: t("radar.checkError") }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      return resp.json();
    },
    onSuccess: async () => {
      setScanningKeywordId(null);
      await refetchKeywords(); await refetchResults();
      queryClient.invalidateQueries({ queryKey: ["radar-results"] });
      toast.success(t("radar.checkComplete"));
    },
    onError: (e: any) => { setScanningKeywordId(null); toast.error(e.message); },
  });

  const deleteProject = useMutation({
    mutationFn: async (projectId: string) => {
      const { data: kwData } = await supabase.from("radar_keywords").select("id").eq("project_id", projectId);
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
      toast.success(t("radar.projectDeleted"));
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteKeyword = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("radar_keywords").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["radar-keywords"] });
      queryClient.invalidateQueries({ queryKey: ["radar-results"] });
      toast.success(t("radar.queryDeleted"));
    },
  });

  const statusLabel = (status: string) => {
    const map: Record<string, Record<string, string>> = {
      captured: { ru: "Захвачено", en: "Captured" },
      displaced: { ru: "Вытеснено", en: "Displaced" },
      opportunity: { ru: "Возможность", en: "Opportunity" },
    };
    return map[status]?.[projectLang] || status;
  };

  const STATUS_CONFIG: Record<string, { color: string; icon: any }> = {
    captured: { color: "bg-green-500/20 text-green-400 border-green-500/30", icon: Shield },
    displaced: { color: "bg-destructive/20 text-destructive border-destructive/30", icon: AlertTriangle },
    opportunity: { color: "bg-muted text-muted-foreground border-border", icon: Sparkles },
  };

  if (!isPro) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10"><RadarIcon className="h-6 w-6 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-semibold">GEO Radar</h1>
            <p className="text-sm text-muted-foreground">{t("radar.subtitle")}</p>
          </div>
        </div>
        <PlanGate allowed={false} featureName="GEO Radar" requiredPlan="PRO"><div /></PlanGate>
      </div>
    );
  }

  const overallCaptured = somData.reduce((s, d) => s + d.value, 0) / (somData.length || 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <motion.div
            className="p-2.5 rounded-xl bg-gradient-to-br from-primary/20 to-purple-500/20 border border-primary/20"
            animate={{ boxShadow: ["0 0 0px hsl(var(--primary) / 0)", "0 0 20px hsl(var(--primary) / 0.3)", "0 0 0px hsl(var(--primary) / 0)"] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <RadarIcon className="h-6 w-6 text-primary" />
          </motion.div>
          <div>
            <h1 className="text-2xl font-semibold bg-gradient-to-r from-foreground to-primary bg-clip-text text-transparent">GEO Radar</h1>
            <p className="text-sm text-muted-foreground">{t("radar.geoSubtitle")}</p>
          </div>
        </div>
        <Button onClick={() => setShowAddProject(true)} className="gap-2 bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90">
          <Plus className="h-4 w-4" />{t("radar.newProject")}
        </Button>
      </div>

      {/* Project tabs */}
      {projects.length >= 1 && (
        <div className="flex gap-2 flex-wrap items-center">
          {projects.map((p: any) => (
            <Button key={p.id} variant={activeProject?.id === p.id ? "default" : "outline"} size="sm" onClick={() => setSelectedProjectId(p.id)} className="gap-1.5">
              <Globe className="h-3 w-3" />{p.brand_name}
              <Badge variant="outline" className="ml-1 text-[10px] h-4 px-1">{(p as any).language?.toUpperCase() || "EN"}</Badge>
            </Button>
          ))}
          {activeProject && (
            <>
              <Select value={projectLang} onValueChange={async (v) => {
                await supabase.from("radar_projects").update({ language: v } as any).eq("id", activeProject.id);
                queryClient.invalidateQueries({ queryKey: ["radar-projects"] });
                toast.success(v === "ru" ? "Язык проекта: Русский" : "Project language: English");
              }}>
                <SelectTrigger className="w-[90px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ru">🇷🇺 RU</SelectItem>
                  <SelectItem value="en">🇬🇧 EN</SelectItem>
                </SelectContent>
              </Select>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive gap-1">
                    <Trash2 className="h-3 w-3" />{t("radar.deleteProject")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("radar.deleteProject")} «{activeProject.brand_name}»?</AlertDialogTitle>
                    <AlertDialogDescription>{t("radar.deleteProjectConfirm")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteProject.mutate(activeProject.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      {deleteProject.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{t("common.delete")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      )}

      {!activeProject ? (
        <Card className="bg-card/50 border-border backdrop-blur-sm">
          <CardContent className="py-16 text-center">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5 }}>
              <RadarIcon className="h-16 w-16 text-primary/20 mx-auto mb-4" />
              <p className="text-muted-foreground mb-2">{t("radar.createMonitoring")}</p>
              <p className="text-xs text-muted-foreground/60 mb-4">{t("radar.geoDesc")}</p>
              <Button onClick={() => setShowAddProject(true)} variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />{t("radar.createProject")}
              </Button>
            </motion.div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Bento Grid Dashboard */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Share of Model - spans 2 cols */}
            <Card className="bg-card/80 border-border backdrop-blur-sm md:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  {t("radar.shareOfModel")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingResults && results.length === 0 ? (
                  <div className="flex items-center justify-around py-4">
                    {[1,2,3,4,5].map(i => <Skeleton key={i} className="w-[88px] h-[120px] rounded-full" />)}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-around py-4">
                      {somData.map((d) => (
                        <RadialChart
                          key={d.model}
                          value={d.value}
                          label={d.label}
                          color={MODEL_COLORS[d.model] || getRadialColor(d.value)}
                          subtitle={statusLabel(d.status)}
                        />
                      ))}
                      <RadialChart
                        value={Math.round(overallCaptured)}
                        label={t("radar.overall")}
                        color={getRadialColor(Math.round(overallCaptured))}
                      />
                    </div>
                    <Separator className="my-3" />
                    <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-green-500" /> {statusLabel("captured")}</span>
                      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-destructive" /> {statusLabel("displaced")}</span>
                      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-muted-foreground" /> {statusLabel("opportunity")}</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Competitor Alert */}
            <Card className="bg-card/80 border-border backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />{t("radar.competitorAlert")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingResults && results.length === 0 ? (
                  <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
                ) : topCompetitors.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">{t("radar.runCheck")}</p>
                ) : (
                  <div className="space-y-2">
                    {topCompetitors.map((c, i) => (
                      <motion.div key={c.domain} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-5">#{i + 1}</span>
                          <span className="text-sm font-medium truncate max-w-[140px]">{c.domain}</span>
                        </div>
                        <Badge variant="outline" className="text-xs border-destructive/30 text-destructive">{c.count} {t("radar.mentions")}</Badge>
                      </motion.div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Message Resonance */}
            <Card className="bg-card/80 border-border backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="h-4 w-4 text-purple-400" />{t("radar.messageResonance")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {resonanceData.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">{t("radar.addNuggetsHint")}</p>
                ) : loadingResults && results.length === 0 ? (
                  <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-6 w-full" />)}</div>
                ) : (
                  <div className="space-y-3">
                    {resonanceData.map((d) => (
                      <div key={d.model} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{d.label}</span>
                          <span className="font-medium" style={{ color: MODEL_COLORS[d.model] }}>{d.percentage}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ backgroundColor: MODEL_COLORS[d.model] }}
                            initial={{ width: 0 }}
                            animate={{ width: `${d.percentage}%` }}
                            transition={{ duration: 1, ease: "easeOut" }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* GEO Strategy Card - spans 2 cols */}
            <Card className="bg-gradient-to-br from-card/80 to-primary/5 border-primary/20 backdrop-blur-sm md:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-yellow-400" />{t("radar.geoStrategy")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!geoStrategy || results.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">{t("radar.runScanForStrategy")}</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`text-xs font-bold px-3 py-1 rounded-full ${geoStrategy.overallCaptured >= 60 ? "bg-green-500/20 text-green-400" : geoStrategy.overallCaptured >= 30 ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400"}`}>
                        {t("radar.overall")}: {geoStrategy.overallCaptured}%
                      </div>
                    </div>
                    {geoStrategy.tips.map((tip, i) => (
                      <motion.div key={i} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="flex items-start gap-2 text-sm">
                        <Zap className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <span className="text-muted-foreground">{tip}</span>
                      </motion.div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Add keywords + Smart Prompts */}
          <Card className="bg-card/80 border-border backdrop-blur-sm">
            <CardContent className="pt-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">{bulkMode ? t("radar.bulkAdd") : t("radar.addQuery")}</Label>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => setShowSmartPrompts(!showSmartPrompts)}>
                      <Wand2 className="h-3 w-3" />{t("radar.smartPrompts")}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setBulkMode(!bulkMode)}>
                      {bulkMode ? t("radar.singleMode") : t("radar.bulkMode")}
                    </Button>
                  </div>
                </div>

                <AnimatePresence>
                  {showSmartPrompts && activeProject && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 p-3 rounded-lg bg-muted/20 border border-border">
                        {generateSmartPrompts(activeProject.brand_name, activeProject.domain, activeProject.data_nuggets || [], projectLang).map((sp) => (
                          <button key={sp.type} onClick={() => { setNewKeyword(sp.prompt); setShowSmartPrompts(false); setBulkMode(false); }} className="text-left p-2.5 rounded-md bg-background/50 border border-border hover:border-primary/40 hover:bg-primary/5 transition-all text-xs">
                            <div className="font-medium text-foreground mb-0.5">{SMART_PROMPT_TYPES[sp.type as keyof typeof SMART_PROMPT_TYPES]?.[projectLang as "ru" | "en"] || sp.type}</div>
                            <div className="text-muted-foreground truncate">{sp.prompt}</div>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {bulkMode ? (
                  <div className="space-y-2">
                    <Textarea placeholder={projectLang === "ru" ? "лучший CRM для бизнеса\nкак выбрать CRM\nCRM для ecommerce\n..." : "best CRM for small business\nhow to choose CRM\nCRM for ecommerce\n..."} value={bulkKeywords} onChange={(e) => setBulkKeywords(e.target.value)} rows={6} />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{bulkKeywords.split("\n").filter(k => k.trim()).length} / 30 {t("radar.queries")}</span>
                      <Button onClick={() => addKeyword.mutate()} disabled={!bulkKeywords.trim() || addKeyword.isPending} size="sm">
                        {addKeyword.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                        <Plus className="h-4 w-4 mr-1.5" />{t("radar.addAll")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Input placeholder={t("radar.queryPlaceholder")} value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && newKeyword.trim() && addKeyword.mutate()} />
                    </div>
                    <Button onClick={() => addKeyword.mutate()} disabled={!newKeyword.trim() || addKeyword.isPending}>
                      {addKeyword.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                      <Plus className="h-4 w-4 mr-1.5" />{t("common.add")}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Active Keywords / Recent Mentions */}
          <Card className="bg-card/80 border-border backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />{t("radar.activeKeywords")}
                <Badge variant="secondary" className="ml-auto">{keywords.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {keywords.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">{t("radar.addKeywords")}</p>
              ) : (
                <div className="space-y-2">
                  {keywordSummary.map((kw: any) => {
                    const statusConf = STATUS_CONFIG[kw.mainStatus as keyof typeof STATUS_CONFIG];
                    const StatusIcon = statusConf?.icon || Sparkles;
                    const isScanning = scanningKeywordId === kw.id;
                    return (
                      <motion.div key={kw.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className={`flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition-all ${isScanning ? "border-primary/40 bg-primary/5" : ""}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{kw.keyword}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {kw.latestResults.map((r: any) => {
                              const sc = STATUS_CONFIG[r.status as keyof typeof STATUS_CONFIG];
                              return (
                                <button key={r.model} onClick={() => setViewResponseData({
                                  model: MODEL_LABELS[r.model] || r.model, text: r.ai_response_text || "",
                                  date: new Date(r.checked_at).toLocaleString(), brand_mentioned: r.brand_mentioned || false,
                                  domain_linked: r.domain_linked || false, matched_snippets: r.matched_snippets || [],
                                  status: r.status || "opportunity", keyword: kw.keyword,
                                })} className={`text-[10px] px-2 py-0.5 rounded-full border cursor-pointer hover:opacity-80 transition-opacity ${sc?.color || ""}`}>
                                  {MODEL_LABELS[r.model] || r.model}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <Badge className={`${statusConf?.color || ""} gap-1`}><StatusIcon className="h-3 w-3" />{statusLabel(kw.mainStatus)}</Badge>
                        <div className="w-8 flex justify-center">
                          {kw.trend === "up" ? <TrendingUp className="h-4 w-4 text-green-500" /> : kw.trend === "down" ? <TrendingDown className="h-4 w-4 text-destructive" /> : <Minus className="h-4 w-4 text-muted-foreground" />}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={checkKeyword.isPending} onClick={() => checkKeyword.mutate(kw.id)}>
                            {isScanning ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => deleteKeyword.mutate(kw.id)}>
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

      {/* Create Project Dialog */}
      <Dialog open={showAddProject} onOpenChange={setShowAddProject}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              {t("radar.newMonitoringProject")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><Languages className="h-3.5 w-3.5" />{t("radar.projectLanguage")}</Label>
              <Select value={newLanguage} onValueChange={(v) => setNewLanguage(v as "ru" | "en")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">🇬🇧 English</SelectItem>
                  <SelectItem value="ru">🇷🇺 Русский</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">{t("radar.languageHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("radar.brandName")}</Label>
              <Input placeholder={t("radar.brandPlaceholder")} value={newBrand} onChange={(e) => setNewBrand(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("radar.domain")}</Label>
              <Input placeholder="example.com" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("radar.dataNuggets")}</Label>
              <textarea className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder={newLanguage === "ru" ? "73% компаний используют AI в маркетинге\nROI контент-маркетинга вырос на 42%" : "73% of companies use AI in marketing\nContent marketing ROI grew by 42%"} value={newNuggets} onChange={(e) => setNewNuggets(e.target.value)} />
            </div>
            <Button onClick={() => addProject.mutate()} disabled={!newBrand.trim() || !newDomain.trim() || addProject.isPending} className="w-full bg-gradient-to-r from-primary to-purple-600">
              {addProject.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{t("radar.createProject")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Response Dialog */}
      <Dialog open={!!viewResponseData} onOpenChange={() => setViewResponseData(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" />{t("radar.response")} {viewResponseData?.model}
              <span className="text-xs text-muted-foreground font-normal ml-2">{viewResponseData?.date}</span>
            </DialogTitle>
            <DialogDescription>{t("radar.query")}: <span className="font-medium text-foreground">{viewResponseData?.keyword}</span></DialogDescription>
          </DialogHeader>

          {(() => {
            const text = (viewResponseData?.text || "").toLowerCase();
            const brandName = activeProject?.brand_name || "";
            const domain = activeProject?.domain || "";
            const cleanDomain = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
            const domainBase = cleanDomain.replace(/\.[a-z]{2,}$/, "");
            const variants: string[] = [];
            if (brandName) variants.push(brandName.toLowerCase());
            if (domainBase) variants.push(domainBase);
            if (domainBase.length >= 4) { for (let i = 2; i <= domainBase.length - 2; i++) variants.push(domainBase.slice(0, i) + " " + domainBase.slice(i)); }
            const actualBrand = variants.some(v => text.includes(v));
            const actualDomain = text.includes(cleanDomain);
            return (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className={`p-3 rounded-lg border ${actualBrand ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {actualBrand ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                    <span className="text-sm font-medium">{t("radar.brand")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{actualBrand ? t("radar.mentioned") : t("radar.notMentioned")}</p>
                </div>
                <div className={`p-3 rounded-lg border ${actualDomain ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {actualDomain ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                    <span className="text-sm font-medium">{t("radar.domainLabel")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{actualDomain ? t("radar.linkFound") : t("radar.linkNotFound")}</p>
                </div>
              </div>
            );
          })()}

          {viewResponseData?.matched_snippets && viewResponseData.matched_snippets.length > 0 && (
            <div className="mt-3">
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5"><Search className="h-3.5 w-3.5" />{t("radar.foundMentions")}</h4>
              <div className="space-y-2">
                {viewResponseData.matched_snippets.map((s, i) => (
                  <button key={i} className="w-full text-left p-2.5 rounded-md bg-primary/5 border border-primary/20 text-xs leading-relaxed hover:bg-primary/10 transition-colors cursor-pointer" onClick={() => {
                    setResponseOpen(true);
                    setTimeout(() => {
                      const el = responseRef.current;
                      if (!el) return;
                      const cleanSnippet = s.replace(/^\[Data Nugget\]\s*/, "").slice(0, 40);
                      const marks = el.querySelectorAll("mark");
                      for (const mark of marks) {
                        if (mark.textContent?.toLowerCase().includes(cleanSnippet.slice(0, 20).toLowerCase())) {
                          mark.scrollIntoView({ behavior: "smooth", block: "center" });
                          mark.classList.add("ring-2", "ring-primary");
                          setTimeout(() => mark.classList.remove("ring-2", "ring-primary"), 2000);
                          break;
                        }
                      }
                    }, 150);
                  }}>
                    <span className="flex items-center gap-1.5"><ArrowUpRight className="h-3 w-3 text-primary shrink-0" />{s}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <Collapsible open={responseOpen} onOpenChange={setResponseOpen} className="mt-3">
            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              <ChevronDown className="h-3.5 w-3.5" />{t("radar.showFullResponse")}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div ref={responseRef} className="mt-2 p-4 rounded-lg bg-muted/30 border border-border text-xs leading-relaxed whitespace-pre-wrap max-h-[40vh] overflow-y-auto" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(highlightBrand(viewResponseData?.text || t("radar.noData"), activeProject?.brand_name || "", activeProject?.domain || "")) }} />
            </CollapsibleContent>
          </Collapsible>
        </DialogContent>
      </Dialog>
    </div>
  );
}
