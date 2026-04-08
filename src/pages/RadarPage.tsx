import { useState, useMemo, useRef, useEffect, lazy, Suspense } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";
import { PlanGate } from "@/shared/components/PlanGate";
import {
  Radar as RadarIcon, Plus, Loader2, Search, TrendingUp, TrendingDown,
  Eye, Trash2, RefreshCw, Shield, AlertTriangle,
  Sparkles, Globe, ArrowUpRight, Minus, CheckCircle2, XCircle, ChevronDown,
  Lightbulb, Wand2, Languages, BarChart3, Target, Zap, ExternalLink,
  Check, CircleDot, Crosshair, MessageSquareText, Link2
} from "lucide-react";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Radar as RechartsRadar, ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, Cell, PieChart, Pie, Legend
} from "recharts";

const MentionsPage = lazy(() => import("@/pages/MentionsPage"));
const PromptsPage = lazy(() => import("@/pages/PromptsPage"));
const SourcesPage = lazy(() => import("@/pages/SourcesPage"));

/* ── Constants ── */
const MODEL_LABELS: Record<string, string> = {
  gemini_flash: "Gemini",
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

const MODEL_ICONS: Record<string, string> = {
  gemini_flash: "✦",
  chatgpt: "◉",
  perplexity: "⬡",
  claude: "◈",
};

const SENTIMENT_COLORS = {
  positive: "hsl(142 71% 45%)",
  neutral: "hsl(220 9% 46%)",
  negative: "hsl(0 84% 60%)",
};

/* ── Helpers ── */
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
  const sorted = Array.from(terms).filter(t => t.length >= 3).sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    html = html.replace(regex, `<mark class="bg-purple-500/30 text-purple-300 rounded px-0.5">$1</mark>`);
  }
  return html;
}

const SMART_PROMPT_TYPES = {
  direct: { ru: "Прямое исследование", en: "Direct Research" },
  comparison: { ru: "Сравнение с конкурентами", en: "Comparison" },
  solution: { ru: "Поиск решения", en: "Solution Finding" },
  toplist: { ru: "Топ-лист", en: "Top-List" },
  authority: { ru: "Авторитетность бренда", en: "Brand Authority" },
};

function generateSmartPrompts(brandName: string, domain: string, nuggets: string[], language: string) {
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

/* ── Stepper Component ── */
const STEPS = [
  { key: "launch", ru: "Запуск", en: "Launch Check" },
  { key: "visibility", ru: "Видимость", en: "Analyze Visibility" },
  { key: "competitors", ru: "Конкуренты", en: "Competitors" },
  { key: "traffic", ru: "Трафик", en: "Traffic" },
  { key: "prompts", ru: "Промпт-группы", en: "Prompt Groups" },
  { key: "recommendations", ru: "Рекомендации", en: "Recommendations" },
];

function VisibilityStepper({ activeStep, lang }: { activeStep: number; lang: string }) {
  return (
    <div className="flex items-center justify-between w-full">
      {STEPS.map((step, i) => {
        const done = i < activeStep;
        const active = i === activeStep;
        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                done ? "bg-green-500 text-white" : active ? "bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2 ring-offset-background" : "bg-muted text-muted-foreground"
              }`}>
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`text-[10px] whitespace-nowrap ${active ? "text-primary font-semibold" : done ? "text-green-500" : "text-muted-foreground"}`}>
                {lang === "ru" ? step.ru : step.en}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-2 mt-[-16px] ${done ? "bg-green-500" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Model Toggle Button ── */
function ModelToggle({ model, active, onClick }: { model: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
        active
          ? "border-primary/50 bg-primary/10 text-primary shadow-sm shadow-primary/10"
          : "border-border bg-card/50 text-muted-foreground hover:bg-muted/50"
      }`}
    >
      <span className="text-sm">{MODEL_ICONS[model] || "●"}</span>
      {MODEL_LABELS[model] || model}
    </button>
  );
}

/* ── Empty State ── */
function EmptySetupCard({ lang, onStart }: { lang: string; onStart: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="bg-card/50 border-border backdrop-blur-sm max-w-lg w-full">
        <CardContent className="py-16 text-center space-y-4">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            <div className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <RadarIcon className="h-10 w-10 text-primary/40" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              {lang === "ru" ? "Начните анализ видимости" : "Start Visibility Analysis"}
            </h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
              {lang === "ru"
                ? "Узнайте, как ваш бренд представлен в ответах ИИ-моделей (ChatGPT, Perplexity, Claude, Gemini)"
                : "Discover how your brand appears in AI model responses (ChatGPT, Perplexity, Claude, Gemini)"}
            </p>
            <Button onClick={onStart} className="gap-2 bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90">
              <Plus className="h-4 w-4" />
              {lang === "ru" ? "Создать проект" : "Create Project"}
            </Button>
          </motion.div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Main Component ── */
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
  const [activeModels, setActiveModels] = useState<string[]>(["gemini_flash", "chatgpt", "perplexity", "claude"]);
  const [viewResponseData, setViewResponseData] = useState<any>(null);
  const [responseOpen, setResponseOpen] = useState(false);
  const responseRef = useRef<HTMLDivElement>(null);

  /* ── Queries ── */
  const { data: projects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ["radar-projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("radar_projects").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const activeProject = projects.find((p: any) => p.id === selectedProjectId) || projects[0];

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

  /* ── Filtered results by active models ── */
  const filteredResults = useMemo(() => results.filter((r: any) => activeModels.includes(r.model)), [results, activeModels]);

  /* ── Computed Data ── */
  const somData = useMemo(() => {
    const models = ["gemini_flash", "chatgpt", "perplexity", "claude"];
    return models.map(model => {
      const modelResults = filteredResults.filter((r: any) => r.model === model);
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
  }, [filteredResults]);

  // Radar chart data (5 axes)
  const radarChartData = useMemo(() => {
    if (filteredResults.length === 0) return [];
    const latestByKwModel: Record<string, any> = {};
    filteredResults.forEach((r: any) => {
      const key = `${r.keyword_id}_${r.model}`;
      if (!latestByKwModel[key] || r.checked_at > latestByKwModel[key].checked_at) latestByKwModel[key] = r;
    });
    const latest = Object.values(latestByKwModel);
    const total = latest.length || 1;
    const brandMentioned = latest.filter((r: any) => r.is_brand_found || r.brand_mentioned).length;
    const domainLinked = latest.filter((r: any) => r.is_domain_found || r.domain_linked).length;
    const positiveSent = latest.filter((r: any) => r.sentiment === "positive").length;
    const captured = latest.filter((r: any) => r.status === "captured").length;
    const competitorCount = new Set(latest.flatMap((r: any) => r.competitor_domains || [])).size;
    return [
      { axis: lang === "ru" ? "Ситуационный" : "Situational", value: Math.round((brandMentioned / total) * 100) },
      { axis: lang === "ru" ? "Сравнительный" : "Comparative", value: Math.min(100, Math.round((competitorCount > 0 ? captured / Math.max(competitorCount, 1) : captured / total) * 100)) },
      { axis: lang === "ru" ? "Репутационный" : "Reputational", value: Math.round((positiveSent / total) * 100) },
      { axis: lang === "ru" ? "Поисковый" : "Search", value: Math.round((captured / total) * 100) },
      { axis: lang === "ru" ? "Рекомендательный" : "Recommendation", value: Math.round((domainLinked / total) * 100) },
    ];
  }, [filteredResults, lang]);

  // Bar chart data (visibility per model)
  const visibilityBarData = useMemo(() => {
    return somData.map(d => ({
      name: d.label,
      value: d.value,
      fill: MODEL_COLORS[d.model] || "hsl(var(--primary))",
    }));
  }, [somData]);

  // Sentiment donut
  const sentimentDonut = useMemo(() => {
    if (filteredResults.length === 0) return [];
    const latestByKwModel: Record<string, any> = {};
    filteredResults.forEach((r: any) => {
      const key = `${r.keyword_id}_${r.model}`;
      if (!latestByKwModel[key] || r.checked_at > latestByKwModel[key].checked_at) latestByKwModel[key] = r;
    });
    const latest = Object.values(latestByKwModel);
    const counts = { positive: 0, neutral: 0, negative: 0 };
    latest.forEach((r: any) => {
      const s = r.sentiment || "neutral";
      if (s in counts) counts[s as keyof typeof counts]++;
      else counts.neutral++;
    });
    const total = latest.length || 1;
    return [
      { name: lang === "ru" ? "Позитивный" : "Positive", value: counts.positive, fill: SENTIMENT_COLORS.positive, pct: Math.round((counts.positive / total) * 100) },
      { name: lang === "ru" ? "Нейтральный" : "Neutral", value: counts.neutral, fill: SENTIMENT_COLORS.neutral, pct: Math.round((counts.neutral / total) * 100) },
      { name: lang === "ru" ? "Негативный" : "Negative", value: counts.negative, fill: SENTIMENT_COLORS.negative, pct: Math.round((counts.negative / total) * 100) },
    ];
  }, [filteredResults, lang]);

  // Share of Voice donut
  const sovDonut = useMemo(() => {
    if (filteredResults.length === 0) return [];
    const latestByKwModel: Record<string, any> = {};
    filteredResults.forEach((r: any) => {
      const key = `${r.keyword_id}_${r.model}`;
      if (!latestByKwModel[key] || r.checked_at > latestByKwModel[key].checked_at) latestByKwModel[key] = r;
    });
    const latest = Object.values(latestByKwModel);
    const brandCount = latest.filter((r: any) => r.is_brand_found || r.brand_mentioned).length;
    const competitorMentions = latest.reduce((sum: number, r: any) => sum + (r.competitor_domains?.length || 0), 0);
    const total = brandCount + competitorMentions || 1;
    return [
      { name: activeProject?.brand_name || "Brand", value: brandCount, fill: "hsl(var(--primary))", pct: Math.round((brandCount / total) * 100) },
      { name: lang === "ru" ? "Конкуренты" : "Competitors", value: competitorMentions, fill: "hsl(var(--destructive))", pct: Math.round((competitorMentions / total) * 100) },
    ];
  }, [filteredResults, activeProject, lang]);

  // Competitor leaderboard
  const competitorLeaderboard = useMemo(() => {
    const latestByKwModel: Record<string, any> = {};
    filteredResults.forEach((r: any) => {
      const key = `${r.keyword_id}_${r.model}`;
      if (!latestByKwModel[key] || r.checked_at > latestByKwModel[key].checked_at) latestByKwModel[key] = r;
    });
    const latest = Object.values(latestByKwModel);
    const counts: Record<string, { mentions: number; positive: number; negative: number; neutral: number }> = {};

    // Add own brand
    const brandName = activeProject?.brand_name || "Brand";
    counts[brandName] = { mentions: 0, positive: 0, negative: 0, neutral: 0 };
    latest.forEach((r: any) => {
      if (r.is_brand_found || r.brand_mentioned) {
        counts[brandName].mentions++;
        const s = r.sentiment || "neutral";
        if (s === "positive") counts[brandName].positive++;
        else if (s === "negative") counts[brandName].negative++;
        else counts[brandName].neutral++;
      }
      (r.competitor_domains || []).forEach((d: string) => {
        if (!counts[d]) counts[d] = { mentions: 0, positive: 0, negative: 0, neutral: 0 };
        counts[d].mentions++;
      });
    });

    const total = latest.length || 1;
    return Object.entries(counts)
      .map(([name, data]) => ({
        name,
        visibility: Math.round((data.mentions / total) * 100),
        sentiment: data.positive >= data.negative ? "positive" : data.negative > data.positive ? "negative" : "neutral",
        isBrand: name === brandName,
      }))
      .sort((a, b) => b.visibility - a.visibility)
      .slice(0, 10);
  }, [filteredResults, activeProject]);

  // Keyword summary
  const keywordSummary = useMemo(() => {
    return keywords.map((kw: any) => {
      const kwResults = filteredResults.filter((r: any) => r.keyword_id === kw.id);
      const latestByModel: Record<string, any> = {};
      kwResults.forEach((r: any) => {
        if (!latestByModel[r.model] || r.checked_at > latestByModel[r.model].checked_at) latestByModel[r.model] = r;
      });
      const latest = Object.values(latestByModel);
      const capturedCount = latest.filter((r: any) => r.status === "captured").length;
      const fullCaptureCount = latest.filter((r: any) => r.is_brand_found && r.is_domain_found).length;
      const mainStatus = fullCaptureCount > 0 ? "full_capture" : capturedCount > 0 ? "captured" : latest.some((r: any) => r.status === "displaced") ? "displaced" : "opportunity";
      return { ...kw, latestResults: latest, mainStatus };
    });
  }, [keywords, filteredResults]);

  // Determine stepper step
  const currentStep = useMemo(() => {
    if (!activeProject) return 0;
    if (keywords.length === 0) return 0;
    if (results.length === 0) return 1;
    const hasCompetitors = competitorLeaderboard.length > 1;
    if (!hasCompetitors) return 2;
    return 3;
  }, [activeProject, keywords, results, competitorLeaderboard]);

  const overallVisibility = useMemo(() => {
    const vals = somData.map(d => d.value);
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  }, [somData]);

  /* ── Mutations ── */
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
        const err = await resp.json().catch(() => ({ error: "Check error" }));
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

  const scanAll = useMutation({
    mutationFn: async () => {
      for (const kw of keywords) {
        setScanningKeywordId(kw.id);
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Not authenticated");
        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/radar-check`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
          body: JSON.stringify({ keyword_id: kw.id, project_id: activeProject?.id }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          console.warn(`Scan failed for ${kw.keyword}:`, err);
        }
      }
    },
    onSuccess: async () => {
      setScanningKeywordId(null);
      await refetchKeywords(); await refetchResults();
      queryClient.invalidateQueries({ queryKey: ["radar-results"] });
      toast.success(lang === "ru" ? "Полное сканирование завершено" : "Full scan complete");
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
    },
  });

  const toggleModel = (model: string) => {
    setActiveModels(prev =>
      prev.includes(model)
        ? prev.filter(m => m !== model)
        : [...prev, model]
    );
  };

  const statusLabel = (status: string) => {
    const map: Record<string, Record<string, string>> = {
      full_capture: { ru: "Полный захват", en: "Full Capture" },
      captured: { ru: "Захвачено", en: "Captured" },
      displaced: { ru: "Вытеснено", en: "Displaced" },
      opportunity: { ru: "Возможность", en: "Opportunity" },
    };
    return map[status]?.[lang] || status;
  };

  const STATUS_CONFIG: Record<string, { color: string; icon: any }> = {
    full_capture: { color: "bg-green-500/20 text-green-400 border-green-500/30", icon: Shield },
    captured: { color: "bg-green-500/20 text-green-400 border-green-500/30", icon: Shield },
    displaced: { color: "bg-destructive/20 text-destructive border-destructive/30", icon: AlertTriangle },
    opportunity: { color: "bg-muted text-muted-foreground border-border", icon: Sparkles },
  };

  /* ── Guard: PRO only ── */
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

  /* ── Empty state ── */
  if (!activeProject && !loadingProjects) {
    return (
      <>
        <EmptySetupCard lang={lang} onStart={() => setShowAddProject(true)} />
        <CreateProjectDialog
          open={showAddProject} onOpenChange={setShowAddProject}
          lang={lang} t={t}
          newBrand={newBrand} setNewBrand={setNewBrand}
          newDomain={newDomain} setNewDomain={setNewDomain}
          newNuggets={newNuggets} setNewNuggets={setNewNuggets}
          newLanguage={newLanguage} setNewLanguage={setNewLanguage}
          onSubmit={() => addProject.mutate()} isPending={addProject.isPending}
        />
      </>
    );
  }

  const hasData = results.length > 0;

  /* ── Main Dashboard ── */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <motion.div
            className="p-2.5 rounded-xl bg-gradient-to-br from-primary/20 to-purple-500/20 border border-primary/20"
            animate={{ boxShadow: ["0 0 0px hsl(var(--primary) / 0)", "0 0 20px hsl(var(--primary) / 0.3)", "0 0 0px hsl(var(--primary) / 0)"] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <RadarIcon className="h-6 w-6 text-primary" />
          </motion.div>
          <div>
            <h1 className="text-2xl font-semibold bg-gradient-to-r from-foreground to-primary bg-clip-text text-transparent">
              GEO Radar
            </h1>
            <p className="text-sm text-muted-foreground">{t("radar.geoSubtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => scanAll.mutate()} disabled={scanAll.isPending || keywords.length === 0} className="gap-1.5">
            {scanAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {lang === "ru" ? "Сканировать всё" : "Scan All"}
          </Button>
          <Button onClick={() => setShowAddProject(true)} size="sm" className="gap-1.5 bg-gradient-to-r from-primary to-purple-600">
            <Plus className="h-3.5 w-3.5" />{t("radar.newProject")}
          </Button>
        </div>
      </div>

      {/* Project tabs */}
      {projects.length >= 1 && (
        <div className="flex gap-2 flex-wrap items-center">
          {projects.map((p: any) => (
            <Button key={p.id} variant={activeProject?.id === p.id ? "default" : "outline"} size="sm" onClick={() => setSelectedProjectId(p.id)} className="gap-1.5">
              <Globe className="h-3 w-3" />{p.brand_name}
            </Button>
          ))}
          {activeProject && (
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
                  <AlertDialogAction onClick={() => deleteProject.mutate(activeProject.id)} className="bg-destructive text-destructive-foreground">
                    {deleteProject.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{t("common.delete")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}

      {/* Module Tabs */}
      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList className="bg-muted/50 border border-border p-1 h-auto flex-wrap">
          <TabsTrigger value="dashboard" className="gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <RadarIcon className="h-3.5 w-3.5" />
            {lang === "ru" ? "Дашборд" : "Dashboard"}
          </TabsTrigger>
          <TabsTrigger value="mentions" className="gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Crosshair className="h-3.5 w-3.5" />
            {lang === "ru" ? "Позиции" : "Positions"}
          </TabsTrigger>
          <TabsTrigger value="prompts" className="gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <MessageSquareText className="h-3.5 w-3.5" />
            {lang === "ru" ? "Промпты" : "Prompts"}
          </TabsTrigger>
          <TabsTrigger value="sources" className="gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Link2 className="h-3.5 w-3.5" />
            {lang === "ru" ? "Источники" : "Sources"}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6 mt-0">

      {/* Stepper */}
      <Card className="bg-card/50 border-border backdrop-blur-sm">
        <CardContent className="py-4">
          <VisibilityStepper activeStep={currentStep} lang={lang} />
        </CardContent>
      </Card>

      {/* Control Bar: Model Toggles */}
      <Card className="bg-card/50 border-border backdrop-blur-sm">
        <CardContent className="py-3 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">{lang === "ru" ? "Модели:" : "Models:"}</span>
          {["gemini_flash", "chatgpt", "perplexity", "claude"].map(model => (
            <ModelToggle key={model} model={model} active={activeModels.includes(model)} onClick={() => toggleModel(model)} />
          ))}
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {lang === "ru" ? "Видимость" : "Visibility"}: {overallVisibility}%
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Dashboard Grid */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-12">
        {/* Widget 1: GEO Radar Chart (large, center) */}
        <Card className="bg-card/80 border-border backdrop-blur-sm lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              {lang === "ru" ? "GEO Радар" : "GEO Radar Chart"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!hasData ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <RadarIcon className="h-12 w-12 mb-3 opacity-20" />
                <p className="text-xs">{lang === "ru" ? "Недостаточно данных" : "Insufficient data"}</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <RadarChart data={radarChartData} cx="50%" cy="50%" outerRadius="70%">
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="axis" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9 }} stroke="hsl(var(--border))" />
                  <RechartsRadar
                    dataKey="value"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary))"
                    fillOpacity={0.2}
                    strokeWidth={2}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number) => [`${value}%`, ""]}
                  />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Widget 2: Brand Visibility (bar chart) */}
        <Card className="bg-card/80 border-border backdrop-blur-sm lg:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              {lang === "ru" ? "Видимость бренда" : "Brand Visibility"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!hasData ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <BarChart3 className="h-12 w-12 mb-3 opacity-20" />
                <p className="text-xs">{lang === "ru" ? "Недостаточно данных" : "Insufficient data"}</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={visibilityBarData} layout="vertical" margin={{ left: 0, right: 20 }}>
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={80} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number) => [`${value}%`, lang === "ru" ? "Видимость" : "Visibility"]}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                    {visibilityBarData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Widget 3: Sentiment & Share of Voice */}
        <Card className="bg-card/80 border-border backdrop-blur-sm lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-400" />
              {lang === "ru" ? "Тональность & SoV" : "Sentiment & SoV"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!hasData ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <CircleDot className="h-12 w-12 mb-3 opacity-20" />
                <p className="text-xs">{lang === "ru" ? "Недостаточно данных" : "Insufficient data"}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div>
                  <p className="text-[10px] text-muted-foreground text-center mb-1">{lang === "ru" ? "Тональность" : "Sentiment"}</p>
                  <ResponsiveContainer width="100%" height={110}>
                    <PieChart>
                      <Pie data={sentimentDonut} dataKey="value" cx="50%" cy="50%" innerRadius={28} outerRadius={45} paddingAngle={2} strokeWidth={0}>
                        {sentimentDonut.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                        formatter={(value: number, name: string, item: any) => [`${item.payload.pct}%`, name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex justify-center gap-3 text-[10px]">
                    {sentimentDonut.map(s => (
                      <span key={s.name} className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.fill }} />
                        {s.pct}%
                      </span>
                    ))}
                  </div>
                </div>
                <Separator />
                <div>
                  <p className="text-[10px] text-muted-foreground text-center mb-1">Share of Voice</p>
                  <ResponsiveContainer width="100%" height={110}>
                    <PieChart>
                      <Pie data={sovDonut} dataKey="value" cx="50%" cy="50%" innerRadius={28} outerRadius={45} paddingAngle={2} strokeWidth={0}>
                        {sovDonut.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                        formatter={(value: number, name: string, item: any) => [`${item.payload.pct}%`, name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex justify-center gap-3 text-[10px]">
                    {sovDonut.map(s => (
                      <span key={s.name} className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.fill }} />
                        {s.name} {s.pct}%
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Widget 4: Competitor Leaderboard */}
        <Card className="bg-card/80 border-border backdrop-blur-sm lg:col-span-7">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              {lang === "ru" ? "Таблица конкурентов" : "Competitor Leaderboard"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!hasData || competitorLeaderboard.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{lang === "ru" ? "Запустите сканирование" : "Run a scan first"}</p>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">{lang === "ru" ? "Бренд" : "Brand"}</TableHead>
                      <TableHead className="text-xs text-right">{lang === "ru" ? "Видимость" : "Visibility"}</TableHead>
                      <TableHead className="text-xs text-center">{lang === "ru" ? "Тональность" : "Sentiment"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {competitorLeaderboard.map((c, i) => (
                      <TableRow key={c.name} className={c.isBrand ? "bg-primary/5" : ""}>
                        <TableCell className="font-medium text-sm flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-5">#{i + 1}</span>
                          <span className="truncate max-w-[180px]">{c.name}</span>
                          {c.isBrand && <Badge variant="default" className="text-[10px] py-0 px-1.5">{lang === "ru" ? "Ваш бренд" : "Your Brand"}</Badge>}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold">{c.visibility}%</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={`text-[10px] ${
                            c.sentiment === "positive" ? "border-green-500/30 text-green-400" :
                            c.sentiment === "negative" ? "border-destructive/30 text-destructive" :
                            "border-border text-muted-foreground"
                          }`}>
                            {c.sentiment === "positive" ? "✅" : c.sentiment === "negative" ? "⚠️" : "➖"} {c.sentiment}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* GEO Strategy Card */}
        <Card className="bg-gradient-to-br from-card/80 to-primary/5 border-primary/20 backdrop-blur-sm lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-yellow-400" />
              {lang === "ru" ? "GEO Стратегия" : "GEO Strategy"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!hasData ? (
              <p className="text-sm text-muted-foreground text-center py-4">{lang === "ru" ? "Запустите сканирование" : "Run a scan"}</p>
            ) : (
              <div className="space-y-3">
                <div className={`text-xs font-bold px-3 py-1 rounded-full inline-block ${
                  overallVisibility >= 60 ? "bg-green-500/20 text-green-400" :
                  overallVisibility >= 30 ? "bg-yellow-500/20 text-yellow-400" :
                  "bg-red-500/20 text-red-400"
                }`}>
                  {lang === "ru" ? "Общая видимость" : "Overall Visibility"}: {overallVisibility}%
                </div>
                {(() => {
                  const weakModels = somData.filter(d => d.value < 30).map(d => d.label);
                  const strongModels = somData.filter(d => d.value >= 60).map(d => d.label);
                  const topComp = competitorLeaderboard.filter(c => !c.isBrand).slice(0, 3).map(c => c.name);
                  const tips: string[] = [];
                  if (lang === "ru") {
                    if (weakModels.length > 0) tips.push(`Создайте контент для: ${weakModels.join(", ")}`);
                    if (topComp.length > 0) tips.push(`Анализируйте контент: ${topComp.join(", ")}`);
                    if (overallVisibility < 30) tips.push("Увеличьте присутствие в авторитетных источниках");
                    if (strongModels.length > 0) tips.push(`${strongModels.join(", ")} знают ваш бренд`);
                  } else {
                    if (weakModels.length > 0) tips.push(`Create content for: ${weakModels.join(", ")}`);
                    if (topComp.length > 0) tips.push(`Analyze competitor: ${topComp.join(", ")}`);
                    if (overallVisibility < 30) tips.push("Increase presence in authoritative sources");
                    if (strongModels.length > 0) tips.push(`${strongModels.join(", ")} know your brand`);
                  }
                  if (tips.length === 0) tips.push(lang === "ru" ? "Запустите сканирование" : "Run a scan");
                  return tips.map((tip, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <Zap className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">{tip}</span>
                    </div>
                  ));
                })()}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add Keywords Section */}
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
                    {generateSmartPrompts(activeProject.brand_name, activeProject.domain, activeProject.data_nuggets || [], lang).map((sp) => (
                      <button key={sp.type} onClick={() => { setNewKeyword(sp.prompt); setShowSmartPrompts(false); setBulkMode(false); }} className="text-left p-2.5 rounded-md bg-background/50 border border-border hover:border-primary/40 hover:bg-primary/5 transition-all text-xs">
                        <div className="font-medium text-foreground mb-0.5">{SMART_PROMPT_TYPES[sp.type as keyof typeof SMART_PROMPT_TYPES]?.[lang as "ru" | "en"] || sp.type}</div>
                        <div className="text-muted-foreground truncate">{sp.prompt}</div>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {bulkMode ? (
              <div className="space-y-2">
                <Textarea placeholder={lang === "ru" ? "лучший CRM для бизнеса\nкак выбрать CRM\n..." : "best CRM for small business\nhow to choose CRM\n..."} value={bulkKeywords} onChange={(e) => setBulkKeywords(e.target.value)} rows={5} />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{bulkKeywords.split("\n").filter(k => k.trim()).length} / 30</span>
                  <Button onClick={() => addKeyword.mutate()} disabled={!bulkKeywords.trim() || addKeyword.isPending} size="sm">
                    {addKeyword.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                    <Plus className="h-4 w-4 mr-1.5" />{t("radar.addAll")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                <Input className="flex-1" placeholder={t("radar.queryPlaceholder")} value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && newKeyword.trim() && addKeyword.mutate()} />
                <Button onClick={() => addKeyword.mutate()} disabled={!newKeyword.trim() || addKeyword.isPending}>
                  {addKeyword.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  <Plus className="h-4 w-4 mr-1.5" />{t("common.add")}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Active Keywords Table */}
      <Card className="bg-card/80 border-border backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            {lang === "ru" ? "Активные запросы" : "Active Queries"}
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
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {kw.latestResults.map((r: any) => {
                          const sc = STATUS_CONFIG[r.status as keyof typeof STATUS_CONFIG];
                          const isBrand = r.is_brand_found || r.brand_mentioned;
                          const isDomain = r.is_domain_found || r.domain_linked;
                          return (
                            <button key={r.model} onClick={() => setViewResponseData({
                              model: MODEL_LABELS[r.model] || r.model, text: r.ai_response_text || "",
                              date: new Date(r.checked_at).toLocaleString(), brand_mentioned: isBrand,
                              domain_linked: isDomain, matched_snippets: r.matched_snippets || [],
                              status: r.status || "opportunity", keyword: kw.keyword,
                              sentiment: r.sentiment || "unknown",
                            })} className={`text-[10px] px-2 py-0.5 rounded-full border cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1 ${sc?.color || ""}`}>
                              {isBrand && <span>🏷️</span>}
                              {isDomain && <span>🌐</span>}
                              {MODEL_LABELS[r.model] || r.model}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <Badge className={`${statusConf?.color || ""} gap-1`}><StatusIcon className="h-3 w-3" />{statusLabel(kw.mainStatus)}</Badge>
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

        </TabsContent>

        <TabsContent value="mentions" className="mt-0">
          <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
            <MentionsPage projectId={activeProject?.id} />
          </Suspense>
        </TabsContent>

        <TabsContent value="prompts" className="mt-0">
          <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
            <PromptsPage projectId={activeProject?.id} />
          </Suspense>
        </TabsContent>

        <TabsContent value="sources" className="mt-0">
          <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
            <SourcesPage projectId={activeProject?.id} />
          </Suspense>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <CreateProjectDialog
        open={showAddProject} onOpenChange={setShowAddProject}
        lang={lang} t={t}
        newBrand={newBrand} setNewBrand={setNewBrand}
        newDomain={newDomain} setNewDomain={setNewDomain}
        newNuggets={newNuggets} setNewNuggets={setNewNuggets}
        newLanguage={newLanguage} setNewLanguage={setNewLanguage}
        onSubmit={() => addProject.mutate()} isPending={addProject.isPending}
      />

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

          {viewResponseData && (() => {
            const actualBrand = viewResponseData.brand_mentioned || false;
            const actualDomain = viewResponseData.domain_linked || false;
            const sentiment = viewResponseData.sentiment || "unknown";
            const isFullCapture = actualBrand && actualDomain;
            return (
              <div className="space-y-3 mt-3">
                {isFullCapture && (
                  <div className="p-3 rounded-lg border bg-green-500/10 border-green-500/30 text-center">
                    <span className="text-sm font-semibold text-green-400">🎯 {lang === "ru" ? "ПОЛНЫЙ ЗАХВАТ" : "FULL CAPTURE"}</span>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <div className={`p-3 rounded-lg border ${actualBrand ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                    <span className="text-lg">{actualBrand ? "🏷️" : "❌"}</span>
                    <p className="text-xs mt-1">{t("radar.brand")}</p>
                  </div>
                  <div className={`p-3 rounded-lg border ${actualDomain ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                    <span className="text-lg">{actualDomain ? "🌐" : "❌"}</span>
                    <p className="text-xs mt-1">{t("radar.domainLabel")}</p>
                  </div>
                  <div className={`p-3 rounded-lg border ${sentiment === "positive" ? "bg-green-500/10 border-green-500/30" : sentiment === "negative" ? "bg-red-500/10 border-red-500/30" : "bg-muted/30 border-border"}`}>
                    <span className="text-lg">{sentiment === "positive" ? "✅" : sentiment === "negative" ? "⚠️" : "➖"}</span>
                    <p className="text-xs mt-1">{sentiment}</p>
                  </div>
                </div>
              </div>
            );
          })()}

          {viewResponseData?.matched_snippets?.length > 0 && (
            <div className="mt-3 space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-1.5"><Search className="h-3.5 w-3.5" />{t("radar.foundMentions")}</h4>
              {viewResponseData.matched_snippets.map((s: string, i: number) => (
                <div key={i} className="p-2.5 rounded-md bg-primary/5 border border-primary/20 text-xs flex items-center gap-1.5">
                  <ArrowUpRight className="h-3 w-3 text-primary shrink-0" />{s}
                </div>
              ))}
            </div>
          )}

          <Collapsible open={responseOpen} onOpenChange={setResponseOpen} className="mt-3">
            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              <ChevronDown className="h-3.5 w-3.5" />{t("radar.showFullResponse")}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div ref={responseRef} className="mt-2 p-4 rounded-lg bg-muted/30 border border-border text-xs leading-relaxed whitespace-pre-wrap max-h-[40vh] overflow-y-auto" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(highlightBrand(viewResponseData?.text || "", activeProject?.brand_name || "", activeProject?.domain || "")) }} />
            </CollapsibleContent>
          </Collapsible>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Create Project Dialog (extracted) ── */
function CreateProjectDialog({
  open, onOpenChange, lang, t,
  newBrand, setNewBrand, newDomain, setNewDomain,
  newNuggets, setNewNuggets, newLanguage, setNewLanguage,
  onSubmit, isPending,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  lang: string; t: (k: string) => string;
  newBrand: string; setNewBrand: (v: string) => void;
  newDomain: string; setNewDomain: (v: string) => void;
  newNuggets: string; setNewNuggets: (v: string) => void;
  newLanguage: "ru" | "en"; setNewLanguage: (v: "ru" | "en") => void;
  onSubmit: () => void; isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                <SelectItem value="en">EN English</SelectItem>
                <SelectItem value="ru">RU Русский</SelectItem>
              </SelectContent>
            </Select>
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
            <Textarea className="min-h-[80px]" placeholder={newLanguage === "ru" ? "73% компаний используют AI в маркетинге\nROI контент-маркетинга вырос на 42%" : "73% of companies use AI in marketing\nContent marketing ROI grew by 42%"} value={newNuggets} onChange={(e) => setNewNuggets(e.target.value)} />
          </div>
          <Button onClick={onSubmit} disabled={!newBrand.trim() || !newDomain.trim() || isPending} className="w-full bg-gradient-to-r from-primary to-purple-600">
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{t("radar.createProject")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
