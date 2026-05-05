import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import DOMPurify from "dompurify";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePublishingState, useSchemaFaqState } from "./articles/usePublishingState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Wand2, Loader2, Hash, FileText, Save, Code2, Trash2, History,
  CheckCircle2, Circle, BarChart3, BookOpen, Copy, Check, Download, Eye, Pencil, User, Target, Factory, Gem, Shield, ShieldAlert, CreditCard, AlertTriangle, Send, Link2, MessageSquarePlus, UserPlus
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "sonner";
import { useI18n } from "@/shared/hooks/useI18n";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";
import { useAuth } from "@/shared/hooks/useAuth";
import { PlanGate } from "@/shared/components/PlanGate";
import { SeoBenchmark } from "@/features/seo-analysis/SeoBenchmark";
import { fetchAndAnalyze, buildAnalysisContext } from "@/entities/competitor/analysisService";
import MyArticlesPage from "@/pages/MyArticlesPage";
import { BulkGenerationMode } from "@/components/bulk/BulkGenerationMode";
import { ProImageGenerator } from "@/features/pro-image-gen/ProImageGenerator";
import { HumanScorePanel, getFixInstructions } from "@/components/article/HumanScorePanel";
import { detectContentLanguage } from "@/components/article/humanScore/constants";
import { QualityCheckPanel } from "@/components/article/QualityCheckPanel";
import { SeoTipTicker } from "@/components/article/SeoTipTicker";
import { AuthorComplianceCard, type ComplianceResult, type ComplianceDeviation } from "@/components/article/AuthorComplianceCard";
import { MiralinksWidget, type MiralinksLink } from "@/components/article/MiralinksWidget";
import { validateContent, applyEnStealthPostProcessing } from "@/shared/utils/contentValidator";
import { GoGetLinksWidget, type GoGetLinksLink } from "@/components/article/GoGetLinksWidget";
import { InlineAIToolbar } from "@/components/article/InlineAIToolbar";
import { SectionedGeneratorMount } from "@/pages/articles/SectionedGeneratorMount";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";
import { useArticleVersions } from "@/features/article-versions/useArticleVersions";
import { VersionsBlock } from "@/features/article-versions/VersionsBlock";
import { QualityBadge } from "@/features/article-quality/QualityBadge";
import { QuickStartSummary } from "@/features/article-quality/QuickStartSummary";
import { EditorSidebar } from "@/components/article/EditorSidebar";
import { SeoSidePanelContainer } from "@/features/article-editor/SeoSidePanelContainer";
import { useFactCheck } from "@/features/article-editor/useFactCheck";
import { TransferDialog } from "@/features/article-transfer/TransferDialog";
import { HeaderModeSwitcher } from "@/features/article-editor/HeaderModeSwitcher";
import { GenerationForm } from "@/features/article-editor/GenerationForm";
import { ArticleEditorProvider } from "@/features/article-editor/ArticleEditorContext";
import { useFixIssue } from "@/features/article-quality/useFixIssue";
import { useBenchmarkOptimize } from "@/features/article-quality/useBenchmarkOptimize";
import { DeviationFixDialog } from "@/features/article-quality/DeviationFixDialog";
import { RewriteAllDialog } from "@/features/article-quality/RewriteAllDialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  countWords,
  fleschScore,
  readabilityLabel,
  markdownToPreviewHtml,
  highlightHtml,
  highlightDeviationsInHtml,
  markdownToCleanHtml,
  markdownToFullHtml,
} from "@/pages/articles/utils";

export default function ArticlesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { limits } = usePlanLimits();
  const { role, user } = useAuth();
  const isAdmin = role === "admin";
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [aiwriterMode, setAiwriterModeState] = useState<"quick" | "expert">(() => {
    if (typeof window === "undefined") return "expert";
    const v = localStorage.getItem("aiwriter_mode");
    return v === "quick" ? "quick" : "expert";
  });
  const setAiwriterMode = (m: "quick" | "expert") => {
    setAiwriterModeState(m);
    try {
      localStorage.setItem("aiwriter_mode", m);
      window.dispatchEvent(new CustomEvent("aiwriter-mode-changed", { detail: m }));
    } catch { /* ignore */ }
  };
  const isQuickMode = aiwriterMode === "quick" && mode === "single";
  const [sectionedOpen, setSectionedOpen] = useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferArticleId, setTransferArticleId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    () => localStorage.getItem("active_project_id") || "none"
  );

  // Projects
  const { data: projects = [] } = useQuery({
    queryKey: ["projects-for-writer"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Articles for interlinking (from selected project)
  const { data: projectArticlesForLinks = [], refetch: refetchProjectArticles } = useQuery({
    queryKey: ["project-articles-for-links", selectedProjectId],
    queryFn: async () => {
      if (!selectedProjectId || selectedProjectId === "none") return [];
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, published_url, status")
        .eq("project_id", selectedProjectId)
        .in("status", ["completed", "published"])
        .not("title", "is", null)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedProjectId && selectedProjectId !== "none",
  });
  const [showInterlinkingArticles, setShowInterlinkingArticles] = useState(false);

  const { data: keywords = [] } = useQuery({
    queryKey: ["keywords-for-writer"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("keywords")
        .select("*")
        .not("intent", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: authorProfiles = [] } = useQuery({
    queryKey: ["author-profiles-for-writer"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("author_profiles")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: savedArticles = [] } = useQuery({
    queryKey: ["articles-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, status, created_at, keyword_id")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // State
  const [selectedKeywordId, setSelectedKeywordId] = useState("");
  const [selectedAuthorId, setSelectedAuthorId] = useState("");
  const [outline, setOutline] = useState<{ text: string; level: string }[]>([]);
  const sanitizeContent = useCallback((text: string) => text.replace(/[—–]/g, '-').replace(/\*\*([^*]+)\*\*/g, '$1'), []);
  const [content, setContentRaw] = useState("");
  const setContent = useCallback((val: string | ((prev: string) => string)) => {
    setContentRaw(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      return sanitizeContent(next);
    });
  }, [sanitizeContent]);

  // Auto-select single author profile
  useEffect(() => {
    if (authorProfiles.length === 1 && !selectedAuthorId) {
      setSelectedAuthorId(authorProfiles[0].id);
    }
  }, [authorProfiles]);

  // Load article for editing from ?edit= query param
  useEffect(() => {
    const editId = searchParams.get("edit");
    if (!editId) return;

    const loadArticle = async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("*")
        .eq("id", editId)
        .single();
      if (error || !data) return;

      setContent(data.content || "");
      setTitle(data.title || "");
      setMetaDescription(data.meta_description || "");
      setCurrentArticleId(data.id);
      if (data.keyword_id) setSelectedKeywordId(data.keyword_id);
      if (data.author_profile_id) setSelectedAuthorId(data.author_profile_id);
      setTelegraphPath((data as any).telegraph_path || "");
      setTelegraphUrl((data as any).telegraph_url || "");
      setPublishedUrl((data as any).published_url || "");
      try { setAnchorLinks(JSON.parse((data as any).anchor_target_url || "[]")); } catch { setAnchorLinks([{ url: "", anchor: "" }]); }
      // Clear the param so it doesn't reload on re-render
      setSearchParams({}, { replace: true });
      toast.info(t("articles.articleLoaded"));
    };
    loadArticle();
  }, [searchParams]);
  const [title, setTitle] = useState("");
  const [h1, setH1] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<"thinking" | "writing" | null>(null);
  const [streamElapsed, setStreamElapsed] = useState(0);
  const {
    schemaJson, setSchemaJson,
    schemaCopied, setSchemaCopied,
    faqTextBlock, setFaqTextBlock,
    faqCopied, setFaqCopied,
    schemaGenerating, setSchemaGenerating,
    faqMode, setFaqMode,
  } = useSchemaFaqState();
  const [currentArticleId, setCurrentArticleId] = useState<string | null>(null);
  const [fixingIssue, setFixingIssue] = useState<string | null>(null);
  const [complianceResult, setComplianceResult] = useState<ComplianceResult | null>(null);
  const complianceCheckedLenRef = useRef<number>(0);
  const [activeDeviation, setActiveDeviation] = useState<{ idx: number; quote: string } | null>(null);
  const [deviationFixText, setDeviationFixText] = useState("");
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [editorComments, setEditorComments] = useState<Array<{ id: string; category: string; rule: string; quote: string; note: string; createdAt: number }>>([]);

  // Invalidate compliance result when content changes significantly after a check
  useEffect(() => {
    if (!complianceResult) return;
    const checkedLen = complianceCheckedLenRef.current;
    if (checkedLen === 0) return;
    if (Math.abs(content.length - checkedLen) > 200) {
      setComplianceResult(null);
      complianceCheckedLenRef.current = 0;
    }
  }, [content, complianceResult]);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [textCopied, setTextCopied] = useState(false);
  const {
    publishingTo, setPublishingTo,
    miralinksLinks, setMiralinksLinks,
    miralinksFollowRules, setMiralinksFollowRules,
    gogetlinksLinks, setGogetlinksLinks,
    gogetlinksFollowRules, setGogetlinksFollowRules,
    telegraphPath, setTelegraphPath,
    telegraphUrl, setTelegraphUrl,
    publishedUrl, setPublishedUrl,
    anchorLinks, setAnchorLinks,
  } = usePublishingState();
  const [includeExpertQuote, setIncludeExpertQuote] = useState(true);
  const [includeComparisonTable, setIncludeComparisonTable] = useState(true);
  const [seoKeywords, setSeoKeywords] = useState("");
  const [enableGeo, setEnableGeo] = useState(false);
  const [geoLocation, setGeoLocation] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [finishReason, setFinishReason] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const benchmarkCacheRef = useRef<Map<string, { data: any; context: string; instructions: string }>>(new Map());
  const { snapshot: snapshotVersion } = useArticleVersions();

  useEffect(() => {
    if (!isStreaming) { setStreamElapsed(0); return; }
    const start = Date.now();
    const interval = setInterval(() => setStreamElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [isStreaming]);

  const selectedKeyword = keywords.find((k: any) => k.id === selectedKeywordId);
  const lsiKeywords: string[] = (selectedKeyword?.lsi_keywords as string[]) || [];

  // Auto-generate SEO Title via AI
  const generateSeoTitle = useCallback(async (articleContent: string) => {
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      const token = s?.access_token;
      if (!token) return;

      const keyword = selectedKeyword?.seed_keyword || "";
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-title`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ keyword, content: articleContent }),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.title) setTitle(data.title);
      if (data.h1) setH1(data.h1);
    } catch {
      // Title generation is best-effort; fallback to H1
    }
  }, [selectedKeyword]);

  // Auto-generate and insert images into article content
  const autoInsertImages = useCallback(async (articleContent: string) => {
    try {
      // Check if image generation is enabled
      if (localStorage.getItem("pro_image_enabled") !== "true") return;

      const { data: { session: s } } = await supabase.auth.getSession();
      const token = s?.access_token;
      if (!token) return;

      // Check if user is Pro
      const { data: profile } = await supabase.from("profiles").select("plan").eq("id", s.user?.id).single();
      if (profile?.plan !== "pro") return;

      // Check if article has H2 headings
      const h2Count = (articleContent.match(/^##\s+/gm) || []).length;
      if (h2Count === 0) return;

      toast.info(t("articles.generatingImages"));

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-pro-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          title: selectedKeyword?.seed_keyword || "",
          content: articleContent,
          style: "photorealistic",
          keyword: selectedKeyword?.seed_keyword || "",
          mode: "multi",
          max_images: 3,
        }),
      });

      if (!resp.ok) return;

      const data = await resp.json();
      const images = data.images;

      if (images?.length > 0) {
        setContent(prev => {
          let result = prev;
          for (let i = images.length - 1; i >= 0; i--) {
            const img = images[i];
            const headingPattern = new RegExp(
              `(^##\\s+${img.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$)`,
              'm'
            );
            const match = result.match(headingPattern);
            if (match && match.index !== undefined) {
              const insertPos = match.index + match[0].length;
              result = result.slice(0, insertPos) + `\n\n![${img.alt}](${img.url})\n` + result.slice(insertPos);
            }
          }
          return result;
        });
        toast.success(`${t("articles.imagesInserted")}: ${images.length}`);
      }
    } catch {
      // Best-effort, don't block the flow
    }
  }, [selectedKeyword]);

  // LSI keyword check
  const lsiStatus = useMemo(() => {
    const lower = content.toLowerCase();
    return lsiKeywords.map((kw) => ({
      keyword: kw,
      found: lower.includes(kw.toLowerCase()),
    }));
  }, [content, lsiKeywords]);

  const lsiFoundCount = lsiStatus.filter((s) => s.found).length;

  // SEO metrics
  const wordCount = useMemo(() => countWords(content), [content]);
  const readability = useMemo(() => fleschScore(content), [content]);
  const readInfo = readabilityLabel(readability, t);

  // Debounced fact-check (extracted hook). setter exposed for handleGenerate / runFixIssue.
  const { factCheckStatus, setFactCheckStatus } = useFactCheck(content, isStreaming);

  // Stream article generation
  const handleGenerate = useCallback(async () => {
    if (!selectedKeywordId) {
      toast.error(t("articles.selectKeyword"));
      return;
    }

    // Validate Miralinks links if Miralinks profile is selected
    const isMiralinks = selectedAuthorId && authorProfiles.find((a: any) => a.id === selectedAuthorId)?.is_miralinks_profile;
    if (isMiralinks) {
      if (!limits.hasMiralinks) {
        toast.error(t("articles.miralinksProOnly"));
        return;
      }
      const filledLinks = miralinksLinks.filter(l => l.url.trim() && l.anchor.trim());
      if (filledLinks.length === 0) {
        toast.error(t("articles.miralinksMinLink"));
        return;
      }
    }

    // Validate GoGetLinks links if GoGetLinks profile is selected
    const isGoGetLinks = selectedAuthorId && authorProfiles.find((a: any) => a.id === selectedAuthorId)?.is_gogetlinks_profile;
    if (isGoGetLinks) {
      if (!limits.hasGoGetLinks) {
        toast.error(t("articles.gogetlinksProOnly"));
        return;
      }
      const filledLinks = gogetlinksLinks.filter(l => l.url.trim() && l.anchor.trim());
      if (filledLinks.length === 0) {
        toast.error(t("articles.gogetlinksMinLink"));
        return;
      }
    }

    setCurrentArticleId(null); // Reset so auto-save creates a NEW article & deducts credit
    setIsStreaming(true);
    setStreamPhase("thinking");
    setContent("");
    setSchemaJson("");
    setFinishReason(null);
    setFactCheckStatus(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Refresh session to ensure fresh token
      const { data: { session: freshSession }, error: refreshError } = await supabase.auth.refreshSession();
      const token = freshSession?.access_token;
      if (refreshError || !token) throw new Error("Not authenticated");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-article`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          keyword_id: selectedKeywordId,
          author_profile_id: (selectedAuthorId && selectedAuthorId !== "none") ? selectedAuthorId : null,
          outline,
          lsi_keywords: lsiKeywords,
          language: (selectedKeyword as any)?.language || null,
          competitor_tables: (() => {
            const isTelegraphAuthor = !!(selectedAuthorId && selectedAuthorId !== "none" &&
              authorProfiles.find((a: any) => a.id === selectedAuthorId && a.name === "Телеграф"));
            return isTelegraphAuthor ? [] : ((selectedKeyword as any)?.competitor_tables || []);
          })(),
          competitor_lists: (selectedKeyword as any)?.competitor_lists || [],
          miralinks_links: miralinksLinks.filter(l => l.url.trim() && l.anchor.trim()),
          gogetlinks_links: gogetlinksLinks.filter(l => l.url.trim() && l.anchor.trim()),
          expert_insights: (() => { try { return JSON.parse(localStorage.getItem(`expert_insights_${selectedKeywordId}`) || "[]"); } catch { return []; } })(),
          include_expert_quote: includeExpertQuote,
          include_comparison_table: (() => {
            const isTelegraphAuthor = !!(selectedAuthorId && selectedAuthorId !== "none" &&
              authorProfiles.find((a: any) => a.id === selectedAuthorId && a.name === "Телеграф"));
            return isTelegraphAuthor ? false : includeComparisonTable;
          })(),
          anchor_links: anchorLinks.filter(l => l.url.trim() && l.anchor.trim()),
          seo_keywords: seoKeywords.trim() || null,
          geo_location: enableGeo && geoLocation.trim() ? geoLocation.trim() : null,
          custom_instructions: customInstructions.trim() || null,
          project_id: (selectedProjectId && selectedProjectId !== "none") ? selectedProjectId : null,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
        if (resp.status === 402) {
          setShowCreditsModal(true);
          setIsStreaming(false);
          setStreamPhase(null);
          return;
        }
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      if (!resp.body) throw new Error("No stream body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let lastFinishReason: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            const fr = parsed.choices?.[0]?.finish_reason;
            if (fr) lastFinishReason = fr;
            if (delta) {
              if (!fullContent) setStreamPhase("writing");
              fullContent += delta;
              setContent(fullContent);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      setFinishReason(lastFinishReason);

      // Auto-fill title and meta from generated content

      // Sanitize: strip all HTML tags and inline styles from generated markdown
      fullContent = fullContent
        .replace(/<[^>]*style="[^"]*"[^>]*>/gi, "") // remove tags with style attr
        .replace(/<\/?(span|div|p|br|ul|ol|li|strong|em|a|h[1-6]|img|figure|figcaption|blockquote|code|pre|table|thead|tbody|tr|td|th|hr|sup|sub|del|ins|mark|small|b|i|u|s|abbr|cite|dfn|kbd|q|ruby|rt|rp|samp|var|wbr|details|summary|time|data|output|progress|meter|section|article|aside|header|footer|nav|main|dialog|template|slot)\b[^>]*>/gi, "")
        .replace(/<!\-\-[^]*?\-\->/g, (m) => m.includes("FAQ Schema") ? m : "") // keep FAQ comment only
        .replace(/style="[^"]*"/gi, "");

      // Auto-generate meta description from first paragraph
      const paragraphs = fullContent
        .replace(/^#.+$/gm, "")
        .split(/\n\n+/)
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 30);
      if (paragraphs.length > 0) {
        setMetaDescription(paragraphs[0].replace(/[*_#`]/g, "").slice(0, 160));
      }

      // Auto-generate SEO Title via AI (async, best-effort)
      generateSeoTitle(fullContent);

      toast.success(t("articles.articleGenerated"));

      // EN Stealth post-processing: contractions, banned phrases, sentence shortening
      fullContent = applyEnStealthPostProcessing(fullContent);

      // Fact-check analysis: detect suspicious hallucination patterns
      // Post-generation validator: detect & auto-fix fake experts/stats
      const validation = validateContent(fullContent);
      if (validation.issues.length > 0) {
        fullContent = validation.fixedContent;
        setContent(fullContent);
        setFactCheckStatus("warning");

        const fakeExperts = validation.issues.filter(i => i.type === "fake_expert").length;
        const pseudoStats = validation.issues.filter(i => i.type === "pseudo_stat").length;
        const fakeOrgs = validation.issues.filter(i => i.type === "fake_company").length;
        const parts: string[] = [];
        if (fakeExperts) parts.push(`${fakeExperts} фейк. экспертов`);
        if (pseudoStats) parts.push(`${pseudoStats} псевдостатистик`);
        if (fakeOrgs) parts.push(`${fakeOrgs} фейк. организаций`);

        toast.warning(`Валидатор исправил: ${parts.join(", ")}`, {
          description: "Текст автоматически очищен от подозрительных элементов. Проверьте результат.",
          duration: 8000,
        });

        // After auto-fix, re-check
        const recheck = validateContent(fullContent);
        setFactCheckStatus(recheck.issues.length === 0 ? "verified" : "warning");
      } else {
        setFactCheckStatus("verified");
      }

      // Auto-generate FAQ & JSON-LD schema (async, best-effort)
      autoGenerateSchema(fullContent, title);

      // Auto-generate and insert images
      // For Miralinks/GoGetLinks profiles: force image generation regardless of setting
      const isMiralinksProfile = selectedAuthorId && authorProfiles.find((a: any) => a.id === selectedAuthorId)?.is_miralinks_profile;
      const isGoGetLinksProfile = selectedAuthorId && authorProfiles.find((a: any) => a.id === selectedAuthorId)?.is_gogetlinks_profile;
      if (isMiralinksProfile || isGoGetLinksProfile) {
        localStorage.setItem("pro_image_enabled", "true");
      }
      autoInsertImages(fullContent);

      // Auto-save after generation completes
      setTimeout(() => {
        saveArticle.mutate();
      }, 500);
    } catch (e: any) {
      if (e.name === "AbortError") {
        toast.info(t("articles.genStopped"));
      } else {
        toast.error(e.message);
      }
    } finally {
      setIsStreaming(false);
      setStreamPhase(null);
      abortRef.current = null;
    }
  }, [selectedKeywordId, selectedAuthorId, outline, lsiKeywords, miralinksLinks, authorProfiles]);

  const handleStop = () => abortRef.current?.abort();

  // Shared: runs a Human/Fix instruction through generate-article (also used by Auto-Improve)
  const runFixIssue = useFixIssue({
    selectedKeywordId,
    selectedAuthorId,
    outline,
    lsiKeywords,
    selectedKeyword,
    content,
    setContent,
    title,
    lang,
    t,
    setStreamPhase,
    setFixingIssue,
    abortRef,
    snapshotVersion,
    currentArticleId,
    setIsStreaming,
    setFactCheckStatus,
  });

  const benchmarkOptimize = useBenchmarkOptimize({
    selectedKeywordId,
    selectedAuthorId,
    outline,
    lsiKeywords,
    selectedKeyword,
    content,
    setContent,
    title,
    setStreamPhase,
    abortRef,
    snapshotVersion,
    currentArticleId,
    isStreaming,
    setIsStreaming,
    benchmarkCacheRef,
  });

  // Save article
  const saveArticle = useMutation({
    mutationFn: async () => {
      const session = await supabase.auth.getSession();
      const userId = session.data.session?.user?.id;
      if (!userId) throw new Error("Not authenticated");

      const payload = {
        user_id: userId,
        keyword_id: selectedKeywordId || null,
        author_profile_id: selectedAuthorId || null,
        title: title || null,
        content,
        meta_description: metaDescription || null,
        anchor_target_url: JSON.stringify(anchorLinks.filter(l => l.url.trim())),
        published_url: publishedUrl.trim() || null,
        project_id: (selectedProjectId && selectedProjectId !== "none") ? selectedProjectId : null,
        seo_score: {
          readability,
          wordCount,
          lsiCoverage: lsiKeywords.length > 0 ? Math.round((lsiFoundCount / lsiKeywords.length) * 100) : 0,
        },
        status: "published",
      } as any;

      if (currentArticleId) {
        const { error } = await supabase
          .from("articles")
          .update(payload)
          .eq("id", currentArticleId);
        if (error) throw error;
        return { id: currentArticleId, isNew: false };
      } else {
        // Deduct credit for new article (skip for admins)
        if (!isAdmin) {
          const { data: deducted } = await supabase.rpc("deduct_credit", { p_user_id: userId });
          if (!deducted) {
            throw new Error(lang === "ru" ? "Недостаточно кредитов для сохранения" : "Not enough credits to save");
          }
        }
        const { data, error } = await supabase
          .from("articles")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        return { id: data.id, isNew: true };
      }
    },
    onSuccess: (result) => {
      setCurrentArticleId(result.id);
      queryClient.invalidateQueries({ queryKey: ["articles-list"] });
      if (result.isNew) {
        queryClient.invalidateQueries({ queryKey: ["profile"] });
        toast.success(
          lang === "ru"
            ? "✅ Статья сохранена, 1 кредит списан"
            : "✅ Article saved, 1 credit deducted",
          {
            description: lang === "ru"
              ? "Статья автоматически сохранена после генерации. Баланс обновлён."
              : "Article was auto-saved after generation. Balance updated.",
            duration: 6000,
          }
        );
      } else {
        toast.success(t("articles.articleSaved"));
      }
      // Auto quality check (background, no credits)
      if (content && content.length > 200) {
        setTimeout(() => {
          supabase.functions.invoke("quality-check", {
            body: { article_id: result.id, content, mode: "auto" },
          }).catch(() => { /* silent */ });
        }, 500);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Auto-save: debounced 8s after last edit, only if article already saved ──
  const autoSaveTimerRef = useRef<number | null>(null);
  const lastSavedContentRef = useRef<string>("");
  useEffect(() => {
    if (!currentArticleId) return;
    if (isStreaming) return;
    if (!content || content.length < 50) return;
    if (content === lastSavedContentRef.current) return;
    if (saveArticle.isPending) return;
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(async () => {
      try {
        const { error } = await supabase
          .from("articles")
          .update({
            content,
            title: title || null,
            meta_description: metaDescription || null,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", currentArticleId);
        if (!error) {
          lastSavedContentRef.current = content;
        }
      } catch { /* silent */ }
    }, 8000);
    return () => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    };
  }, [content, title, metaDescription, currentArticleId, isStreaming, saveArticle.isPending]);

  // Generate schema
  const generateSchema = useMutation({
    mutationFn: async () => {
      const isTelegraph = !!(selectedAuthorId && selectedAuthorId !== "none" &&
        authorProfiles.find((a: any) => a.id === selectedAuthorId && a.name === "Телеграф"));
      const { data, error } = await supabase.functions.invoke("generate-schema", {
        body: {
          title,
          content,
          keyword: selectedKeyword?.seed_keyword,
          questions: selectedKeyword?.questions || [],
          lsi_keywords: lsiKeywords,
          mode: faqMode,
          skip_schema: isTelegraph,
        },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      const schemas = [];
      if (data.article_schema) schemas.push(data.article_schema);
      if (data.faq_schema) schemas.push(data.faq_schema);
      setSchemaJson(schemas.length ? JSON.stringify(schemas, null, 2) : "");
      if (data.faq_text_block) setFaqTextBlock(data.faq_text_block);
      toast.success(t("articles.faqGenerated"));
    },
    onError: (e) => toast.error(e.message),
  });

  const copyToClipboard = (text: string, type: "schema" | "faq") => {
    const copyText = type === "schema" ? `<script type="application/ld+json">\n${text}\n</script>` : text;
    navigator.clipboard.writeText(copyText);
    if (type === "schema") {
      setSchemaCopied(true);
      setTimeout(() => setSchemaCopied(false), 2000);
    } else {
      setFaqCopied(true);
      setTimeout(() => setFaqCopied(false), 2000);
    }
  };

  // Auto-generate FAQ & schema after article generation
  const autoGenerateSchema = useCallback(async (articleContent: string, articleTitle: string) => {
    if (!articleContent || !limits.hasJsonLdSchema) return;
    try {
      setSchemaGenerating(true);
      const isTelegraph = !!(selectedAuthorId && selectedAuthorId !== "none" &&
        authorProfiles.find((a: any) => a.id === selectedAuthorId && a.name === "Телеграф"));
      const { data, error } = await supabase.functions.invoke("generate-schema", {
        body: {
          title: articleTitle,
          content: articleContent,
          keyword: selectedKeyword?.seed_keyword,
          questions: selectedKeyword?.questions || [],
          lsi_keywords: lsiKeywords,
          mode: faqMode,
          skip_schema: isTelegraph,
        },
      });
      if (error || data?.error) return;
      const schemas = [];
      if (data.article_schema) schemas.push(data.article_schema);
      if (data.faq_schema) schemas.push(data.faq_schema);
      setSchemaJson(schemas.length ? JSON.stringify(schemas, null, 2) : "");
      if (data.faq_text_block) setFaqTextBlock(data.faq_text_block);
    } catch {
      // best-effort
    } finally {
      setSchemaGenerating(false);
    }
  }, [selectedKeyword, limits.hasJsonLdSchema, faqMode, lsiKeywords, selectedAuthorId, authorProfiles]);

  // Auto-fill fields when keyword changes
  useEffect(() => {
    if (!selectedKeywordId) {
      setOutline([]);
      setTitle("");
      setMetaDescription("");
      return;
    }
    const kw = keywords.find((k: any) => k.id === selectedKeywordId);
    if (!kw) return;

    // Auto-fill title from seed keyword
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    setTitle(capitalize(kw.seed_keyword));

    // Auto-fill meta description
    const intent = kw.intent || "informational";
    setMetaDescription(
      `${capitalize(kw.seed_keyword)} — ${intent === "informational" ? "полное руководство" : intent === "transactional" ? "лучшие предложения" : intent === "commercial" ? "сравнение и обзор" : "всё что нужно знать"}. ${(kw.lsi_keywords as string[] || []).slice(0, 3).join(", ")}.`.slice(0, 160)
    );

    // Auto-fill outline from questions
    if (kw.questions) {
      const items = (kw.questions as string[]).map((q: string) => ({ text: q, level: "h2" }));
      setOutline(items);
    }
  }, [selectedKeywordId]);

  return (
    <ArticleEditorProvider
      currentArticleId={currentArticleId}
      isStreaming={isStreaming}
      setIsStreaming={setIsStreaming}
      factCheckStatus={factCheckStatus}
      setFactCheckStatus={setFactCheckStatus}
      lsiStatus={lsiStatus}
      benchmarkCache={benchmarkCacheRef}
    >
    <div className="space-y-6 overflow-x-hidden">
      <HeaderModeSwitcher
        mode={mode}
        onModeChange={setMode}
        hasBulkMode={limits.hasBulkMode}
      />

      {keywords.length === 0 && (
        <OnboardingHint
          message={t("onboarding.hintWriter")}
          actionLabel={t("onboarding.startWithResearch")}
          actionPath="/keywords"
        />
      )}

      {mode === "bulk" ? (
        <BulkGenerationMode />
      ) : (
      <>
      {/* Configuration */}
      <GenerationForm
        projects={projects}
        projectArticlesForLinks={projectArticlesForLinks}
        keywords={keywords}
        authorProfiles={authorProfiles}
        selectedProjectId={selectedProjectId}
        onProjectChange={setSelectedProjectId}
        showInterlinkingArticles={showInterlinkingArticles}
        onToggleInterlinking={() => setShowInterlinkingArticles(!showInterlinkingArticles)}
        selectedKeywordId={selectedKeywordId}
        onKeywordChange={setSelectedKeywordId}
        selectedAuthorId={selectedAuthorId}
        onAuthorChange={setSelectedAuthorId}
        includeExpertQuote={includeExpertQuote}
        onExpertQuoteChange={setIncludeExpertQuote}
        includeComparisonTable={includeComparisonTable}
        onComparisonTableChange={setIncludeComparisonTable}
        seoKeywords={seoKeywords}
        onSeoKeywordsChange={setSeoKeywords}
        enableGeo={enableGeo}
        onGeoChange={setEnableGeo}
        geoLocation={geoLocation}
        onGeoLocationChange={setGeoLocation}
        customInstructions={customInstructions}
        onCustomInstructionsChange={setCustomInstructions}
        isStreaming={isStreaming}
        onGenerate={handleGenerate}
        onStop={handleStop}
        onOpenSectioned={() => setSectionedOpen(true)}
      />

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px] lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Left: Editor */}
        <div className="space-y-4">
          {/* Pro Image Cover Generator */}
          <ProImageGenerator
            title={title}
            content={content}
            keyword={selectedKeyword?.seed_keyword}
            onImageGenerated={(url, alt, markdown) => {
              // Prepend cover image to content
              setContent(prev => `![${alt}](${url})\n\n${prev}`);
            }}
            onMultiImagesGenerated={(images) => {
              // Insert images after their corresponding H2 headings
              setContent(prev => {
                let result = prev;
                // Process in reverse order to preserve line positions
                for (let i = images.length - 1; i >= 0; i--) {
                  const img = images[i];
                  const headingPattern = new RegExp(
                    `(^##\\s+${img.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$)`,
                    'm'
                  );
                  const match = result.match(headingPattern);
                  if (match && match.index !== undefined) {
                    const insertPos = match.index + match[0].length;
                    const markdown = `\n\n![${img.alt}](${img.url})\n`;
                    result = result.slice(0, insertPos) + markdown + result.slice(insertPos);
                  }
                }
                return result;
              });
            }}
          />

          {/* Title & Meta — compact */}
          <Card className="bg-card border-border">
            <CardContent className="pt-3 pb-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <Label className="text-[10px] text-muted-foreground">Title (SEO)</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t("articles.titlePlaceholder")}
                    maxLength={70}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px] text-muted-foreground">{t("articles.h1Title")}</Label>
                  <Input
                    value={h1}
                    onChange={(e) => setH1(e.target.value)}
                    placeholder={t("articles.h1Title")}
                    className="h-8 text-sm font-semibold"
                  />
                </div>
              </div>
              <div className="space-y-0.5">
                <Label className="text-[10px] text-muted-foreground">
                  Meta Description <span className="text-muted-foreground/60">({metaDescription.length}/160)</span>
                </Label>
                <Input
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  placeholder={t("articles.metaPlaceholder")}
                  maxLength={160}
                  className="h-8 text-sm"
                />
              </div>
              {/* Published URL for interlinking */}
              <div className="space-y-0.5">
                <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Link2 className="h-3 w-3" />
                  {lang === "ru" ? "URL статьи на сайте (для перелинковки)" : "Published URL (for interlinking)"}
                </Label>
                <Input
                  value={publishedUrl}
                  onChange={(e) => setPublishedUrl(e.target.value)}
                  placeholder="https://example.com/my-article"
                  className="h-8 text-sm"
                />
              </div>

              {/* Anchor Links for Telegra.ph — only for "Телеграф" preset + PRO */}
              {limits.hasProImageGen && selectedAuthorId && authorProfiles.find((a: any) => a.id === selectedAuthorId && a.name === "Телеграф") && (
              <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Link2 className="h-3 w-3" />
                    {lang === "ru" ? "Анкорные ссылки (1-3)" : "Anchor Links (1-3)"}
                  </Label>
                  {anchorLinks.length < 3 && (
                    <button
                      type="button"
                      className="text-[10px] text-primary hover:underline"
                      onClick={() => setAnchorLinks(prev => [...prev, { url: "", anchor: "" }])}
                    >
                      + {lang === "ru" ? "Добавить" : "Add"}
                    </button>
                  )}
                </div>
                {anchorLinks.map((link, idx) => (
                  <div key={idx} className="flex gap-1.5 items-start">
                    <div className="flex-1 space-y-1">
                      <Input
                        value={link.url}
                        onChange={(e) => {
                          const updated = [...anchorLinks];
                          updated[idx] = { ...updated[idx], url: e.target.value };
                          setAnchorLinks(updated);
                        }}
                        placeholder={lang === "ru" ? "https://сайт.com/страница" : "https://site.com/page"}
                        className="h-7 text-[11px] font-mono"
                      />
                      <Input
                        value={link.anchor}
                        onChange={(e) => {
                          const updated = [...anchorLinks];
                          updated[idx] = { ...updated[idx], anchor: e.target.value };
                          setAnchorLinks(updated);
                        }}
                        placeholder={lang === "ru" ? "Текст анкора" : "Anchor text"}
                        className="h-7 text-[11px]"
                      />
                    </div>
                    {anchorLinks.length > 1 && (
                      <button
                        type="button"
                        className="mt-1 text-muted-foreground hover:text-destructive transition-colors"
                        onClick={() => setAnchorLinks(prev => prev.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {telegraphUrl && (
                <div className="flex items-center gap-2 text-[10px]">
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  <a href={telegraphUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">
                    {telegraphUrl}
                  </a>
                </div>
              )}
              </>
              )}
            </CardContent>
          </Card>

          {/* Content Editor / Preview */}
          <Card className="bg-card border-border">
            <Tabs defaultValue="edit">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  <div className="flex items-center gap-3">
                  <TabsList className="h-8 shrink-0">
                    <TabsTrigger value="edit" className="text-xs gap-1 px-2.5">
                      <Pencil className="h-3 w-3" />
                      {t("articles.editor")}
                    </TabsTrigger>
                    <TabsTrigger value="preview" className="text-xs gap-1 px-2.5">
                      <Eye className="h-3 w-3" />
                      {t("articles.preview")}
                    </TabsTrigger>
                    <TabsTrigger value="html" className="text-xs gap-1 px-2.5">
                      <Code2 className="h-3 w-3" />
                      HTML
                    </TabsTrigger>
                    <TabsTrigger value="schema" className="text-xs gap-1 px-2.5">
                      <Code2 className="h-3 w-3" />
                      FAQ & Schema
                    </TabsTrigger>
                  </TabsList>
                  <Separator orientation="vertical" className="h-5" />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!content}
                      onClick={async () => {
                        const html = markdownToCleanHtml(content);
                        try {
                          await navigator.clipboard.write([
                            new ClipboardItem({
                              "text/html": new Blob([html], { type: "text/html" }),
                              "text/plain": new Blob([content], { type: "text/plain" }),
                            }),
                          ]);
                        } catch {
                          await navigator.clipboard.writeText(content);
                        }
                        setTextCopied(true);
                        toast.success(t("common.copied"));
                        setTimeout(() => setTextCopied(false), 2000);
                      }}
                    >
                      {textCopied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                      {textCopied ? t("common.copied") : t("common.copy")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!content}
                      onClick={() => {
                        const html = markdownToFullHtml(content, title, metaDescription);
                        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${(title || "article").replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]/g, "_")}.html`;
                        a.click();
                        URL.revokeObjectURL(url);
                        toast.success(t("articles.htmlDownloaded"));
                      }}
                    >
                      <Download className="h-3 w-3 mr-1" />
                      HTML
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!content}
                      onClick={() => {
                        const html = markdownToCleanHtml(content);
                        const fullHtml = `<html><head><meta charset="utf-8"><title>${title || "Article"}</title></head><body>${html}</body></html>`;
                        const blob = new Blob(['\ufeff', fullHtml], { type: "application/msword;charset=utf-8" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${(title || "article").replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]/g, "_")}.doc`;
                        a.click();
                        URL.revokeObjectURL(url);
                        toast.success(t("articles.docDownloaded"));
                      }}
                    >
                      <FileText className="h-3 w-3 mr-1" />
                      Google Docs
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => saveArticle.mutate()}
                      disabled={!content || saveArticle.isPending}
                    >
                      <Save className="h-3 w-3 mr-1" />
                      {saveArticle.isPending ? "..." : t("common.save")}
                    </Button>

                    {/* Blog platform publish buttons — PRO only, Telegra.ph author only */}
                    {currentArticleId && content && limits.hasProImageGen && !!authorProfiles.find((a: any) => a.id === selectedAuthorId && (a.name === "Телеграф" || a.is_telegraph_author)) && (
                      <>
                        <Separator orientation="vertical" className="h-5" />
                        <Button
                          variant={telegraphPath ? "default" : "outline"}
                          size="sm"
                          disabled={publishingTo !== null}
                          onClick={async () => {
                            setPublishingTo("telegraph");
                            try {
                              const { data, error } = await supabase.functions.invoke("publish-telegraph", {
                                body: {
                                  article_id: currentArticleId,
                                  author_name: authorProfiles.find((a: any) => a.id === selectedAuthorId)?.name || "Author",
                                  anchor_links: anchorLinks.filter(l => l.url.trim() && l.anchor.trim()),
                                  lang,
                                },
                              });
                              if (error || !data?.success) throw new Error(data?.error || (lang === "ru" ? "Ошибка публикации" : "Publish error"));
                              setTelegraphPath(data.url ? "exists" : "");
                              setTelegraphUrl(data.url);
                              const msg = data.is_update
                                ? (lang === "ru" ? "Пост в Telegra.ph успешно обновлен" : "Telegra.ph post successfully updated")
                                : (lang === "ru" ? "Опубликовано в Telegra.ph!" : "Published to Telegra.ph!");
                              toast.success(msg, { description: data.url, action: { label: lang === "ru" ? "Открыть" : "Open", onClick: () => window.open(data.url, "_blank") } });
                            } catch (e: any) {
                              toast.error(e.message || "Ошибка Telegra.ph");
                            } finally {
                              setPublishingTo(null);
                            }
                          }}
                        >
                          {publishingTo === "telegraph" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
                          {telegraphPath
                            ? (lang === "ru" ? "Обновить Telegra.ph" : "Update Telegra.ph")
                            : (lang === "ru" ? "Опубликовать Telegra.ph" : "Publish Telegra.ph")}
                        </Button>
                      </>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isStreaming && (
                  <div className="flex items-center gap-2 mb-3 text-sm text-primary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>
                      {streamPhase === "thinking"
                        ? `${t("articles.generating")} ${streamElapsed}s`
                        : `${t("articles.generating")} ${streamElapsed}s`}
                    </span>
                  </div>
                )}
                {isStreaming && (
                  <SeoTipTicker language={lang === "ru" ? "ru" : "en"} />
                )}
                {/* Live passive analyzer (free SEO + AI checks, debounced 3s) */}
                {currentArticleId && content && !isStreaming && (
                  <div className="flex justify-end items-center gap-2 mb-2">
                    <VersionsBlock
                      articleId={currentArticleId}
                      currentContent={content}
                      currentTitle={title}
                      onRestoreVersion={(c) => setContent(c)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={async () => {
                        if (!currentArticleId) { toast.error("Сначала сохраните статью"); return; }
                        try {
                          const { data: row } = await supabase
                            .from("articles")
                            .select("share_token, is_public")
                            .eq("id", currentArticleId)
                            .maybeSingle();
                          let token = row?.share_token as string | null;
                          if (!token || !row?.is_public) {
                            const upd: any = { is_public: true };
                            if (!token) {
                              token = (typeof crypto !== "undefined" && (crypto as any).randomUUID)
                                ? (crypto as any).randomUUID()
                                : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
                              upd.share_token = token;
                            }
                            const { error } = await supabase.from("articles").update(upd).eq("id", currentArticleId);
                            if (error) throw error;
                          }
                          const url = `${window.location.origin}/share/${token}`;
                          await navigator.clipboard.writeText(url);
                          toast.success("Ссылка скопирована: " + url, { duration: 6000 });
                        } catch (e: any) {
                          toast.error(e?.message || "Не удалось создать ссылку");
                        }
                      }}
                    >
                      <Send className="w-3 h-3" />
                      Поделиться
                    </Button>
                    {currentArticleId && (
                      <QualityBadge
                        articleId={currentArticleId}
                        onOpenVersions={() => window.dispatchEvent(new CustomEvent("open-article-versions", { detail: { articleId: currentArticleId } }))}
                      />
                    )}
                  </div>
                )}
                <TabsContent value="edit" className="mt-0">
                  <Textarea
                    ref={editorTextareaRef}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={t("articles.editorPlaceholder")}
                    className="min-h-[500px] font-mono text-sm leading-relaxed resize-y"
                  />
                  <InlineAIToolbar
                    textareaRef={editorTextareaRef}
                    content={content}
                    language={(lang === "en" ? "en" : "ru") as "ru" | "en"}
                    onReplace={(start, end, replacement) => {
                      setContent(prev => prev.slice(0, start) + replacement + prev.slice(end));
                    }}
                  />
                </TabsContent>
                <TabsContent value="preview" className="mt-0">
                  {content ? (
                    <div className="space-y-0">
                      {/* Author block */}
                      {selectedAuthorId && selectedAuthorId !== "none" && (() => {
                        const author = authorProfiles.find((a: any) => a.id === selectedAuthorId);
                        if (!author) return null;
                        return (
                          <div className="flex items-center gap-3 p-4 mb-6 rounded-lg bg-muted/50 border border-border">
                            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/10 text-primary">
                              <User className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold">{author.name}</p>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                {author.description && <span>{author.description}</span>}
                                {!author.description && author.niche && <span>{author.niche}</span>}
                                {!author.description && author.voice_tone && (
                                  <>
                                    <span>•</span>
                                    <span>{author.voice_tone}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                      <div
                        className="article-preview prose prose-sm max-w-none"
                        onClick={(e) => {
                          const target = (e.target as HTMLElement).closest("[data-dev-idx]") as HTMLElement | null;
                          if (!target) return;
                          const idx = parseInt(target.getAttribute("data-dev-idx") || "-1", 10);
                          const dev = complianceResult?.deviations?.[idx];
                          if (!dev) return;
                          const quoteText = target.textContent || dev.quote;
                          setActiveDeviation({ idx, quote: quoteText });
                          setDeviationFixText(dev.suggestion || quoteText);
                        }}
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(
                            highlightDeviationsInHtml(
                              markdownToPreviewHtml(content),
                              complianceResult?.deviations || [],
                            ),
                            { ADD_ATTR: ["title", "data-cat", "data-dev-idx"] },
                          ),
                        }}
                      />
                      {complianceResult && complianceResult.deviations.length > 0 && (
                        <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground border-t border-border pt-3">
                          <span className="font-medium text-foreground">Подсветка отклонений:</span>
                          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-destructive/30 border border-destructive/60" /> high</span>
                          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-warning/30 border border-warning/60" /> medium</span>
                          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-muted border border-border" /> low</span>
                          <span className="opacity-70">Кликните на фрагмент, чтобы исправить или прокомментировать</span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[11px] ml-auto"
                            onClick={() => setRewriteOpen(true)}
                          >
                            <Wand2 className="h-3 w-3 mr-1" />
                            Переписать с правками
                          </Button>
                        </div>
                      )}
                      {editorComments.length > 0 && (
                        <div className="mt-4 border-t border-border pt-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-foreground flex items-center gap-1">
                              <MessageSquarePlus className="h-3 w-3" />
                              Заметки редактора ({editorComments.length})
                            </span>
                            <span className="text-[10px] text-muted-foreground">не попадают в публикацию</span>
                          </div>
                          {editorComments.map((c) => (
                            <div key={c.id} className="rounded-md border border-warning/30 bg-warning/5 p-2 text-[11px] space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-foreground">{c.category}: {c.rule}</span>
                                <button
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() => setEditorComments(prev => prev.filter(x => x.id !== c.id))}
                                  title="Удалить заметку"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                              <div className="italic text-muted-foreground border-l-2 border-warning/40 pl-2">«{c.quote}»</div>
                              <div className="text-foreground">{c.note}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm py-12 text-center">
                      {t("articles.noContent")}
                    </p>
                  )}
                </TabsContent>
                <TabsContent value="html" className="mt-0">
                  {content ? (
                    <div className="relative">
                      <div className="flex items-center gap-2 absolute top-2 right-2 z-10">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(markdownToCleanHtml(content));
                            toast.success(t("common.copied"));
                          }}
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          {t("common.copy")} HTML
                        </Button>
                      </div>
                      <pre className="min-h-[500px] max-h-[700px] overflow-auto p-4 rounded-md bg-muted text-xs font-mono whitespace-pre-wrap break-all text-foreground">
                        <code dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(highlightHtml(markdownToCleanHtml(content))) }} />
                      </pre>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm py-12 text-center">
                      {t("articles.noContent")}
                    </p>
                  )}
                </TabsContent>
                <TabsContent value="schema" className="mt-0">
                  <div className="space-y-4">
                    {/* Mode Toggle */}
                    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex rounded-lg border border-border bg-background p-0.5">
                          <button
                            onClick={() => setFaqMode("standard")}
                            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                              faqMode === "standard"
                                ? "bg-primary text-primary-foreground font-medium"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Standard FAQ
                          </button>
                          <button
                            onClick={() => setFaqMode("serp-dominance")}
                            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                              faqMode === "serp-dominance"
                                ? "bg-primary text-primary-foreground font-medium"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            🚀 SERP-Dominance
                          </button>
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {faqMode === "serp-dominance"
                            ? "Information Gain + SGE-Ready + Entity Injection"
                            : "Стандартные FAQ вопросы и ответы"}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => generateSchema.mutate()}
                        disabled={!content || generateSchema.isPending || schemaGenerating}
                        className="gap-1.5"
                      >
                        {(generateSchema.isPending || schemaGenerating) ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Wand2 className="h-3 w-3" />
                        )}
                        {(generateSchema.isPending || schemaGenerating) ? t("common.loading") : "Generate FAQ"}
                      </Button>
                    </div>

                    {/* FAQ Text Block */}
                    {faqTextBlock && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold flex items-center gap-2">
                            <BookOpen className="h-4 w-4 text-primary" />
                            FAQ — Визуальный блок
                            {faqMode === "serp-dominance" && (
                              <Badge variant="secondary" className="text-[10px]">Information Gain</Badge>
                            )}
                          </h4>
                          <div className="flex gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(faqTextBlock, "faq")}
                            >
                              {faqCopied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                              {faqCopied ? t("common.copied") : t("common.copy")}
                            </Button>
                          </div>
                        </div>
                        <div
                          className="rounded-lg border border-border bg-background p-4 prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(markdownToPreviewHtml(faqTextBlock)) }}
                        />
                      </div>
                    )}

                    {/* JSON-LD Schema Code */}
                    {schemaJson && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold flex items-center gap-2">
                            <Code2 className="h-4 w-4 text-primary" />
                            JSON-LD Schema 3.0
                            <Badge variant="outline" className="text-[10px]">Schema.org</Badge>
                          </h4>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(schemaJson, "schema")}
                          >
                            {schemaCopied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                            {schemaCopied ? t("common.copied") : `${t("common.copy")} <script>`}
                          </Button>
                        </div>
                        <pre className="rounded-lg border border-border bg-muted p-4 text-xs font-mono whitespace-pre-wrap break-all max-h-[400px] overflow-auto text-foreground">
                          <code dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(highlightHtml(`<script type="application/ld+json">\n${schemaJson}\n</script>`)) }} />
                        </pre>
                      </div>
                    )}

                    {/* Empty state */}
                    {!faqTextBlock && !schemaJson && !generateSchema.isPending && !schemaGenerating && (
                      <div className="py-12 text-center">
                        <Code2 className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
                        <p className="text-sm text-muted-foreground">
                          Click "Generate FAQ" to create a Q&A block with JSON-LD schema markup
                        </p>
                        {faqMode === "serp-dominance" && (
                          <p className="text-xs text-muted-foreground/70 mt-2">
                            Режим SERP-Dominance: Information Gain + Dynamic Entity Injection + SGE-Ready formatting
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>

          {/* Continue Generation Button - shown when text was truncated */}
          {finishReason === "length" && content && !isStreaming && (
            <Card className="bg-card border-border border-warning/50">
              <CardContent className="py-3">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                  <p className="text-xs text-muted-foreground flex-1">
                    {t("articles.truncatedWarning")}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1.5 border-warning/50 text-warning hover:bg-warning/10"
                    onClick={async () => {
                      setIsStreaming(true);
                      setStreamPhase("writing");
                      setFinishReason(null);
                      const prevContent = content;
                      const controller = new AbortController();
                      abortRef.current = controller;
                      try {
                        const { data: { session: freshSession } } = await supabase.auth.refreshSession();
                        const token = freshSession?.access_token;
                        if (!token) throw new Error("Not authenticated");

                        const lastParagraph = prevContent.split("\n\n").filter(p => p.trim()).slice(-2).join("\n\n");
                        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-article`;
                        const resp = await fetch(url, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                          },
                          body: JSON.stringify({
                            keyword_id: selectedKeywordId,
                            author_profile_id: (selectedAuthorId && selectedAuthorId !== "none") ? selectedAuthorId : null,
                            outline,
                            lsi_keywords: lsiKeywords,
                            language: (selectedKeyword as any)?.language || null,
                            optimize_instructions: `ЗАДАЧА: Продолжи писать статью с того места, где она оборвалась. НЕ повторяй то, что уже написано. Допиши оставшиеся разделы и ОБЯЗАТЕЛЬНО добавь заключение.\n\nПОСЛЕДНИЙ КОНТЕКСТ (продолжай отсюда):\n${lastParagraph}`,
                            existing_content: prevContent,
                          }),
                          signal: controller.signal,
                        });

                        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                        if (!resp.body) throw new Error("No stream body");

                        const reader = resp.body.getReader();
                        const decoder = new TextDecoder();
                        let buffer = "";
                        let fullContent = prevContent;

                        while (true) {
                          const { done, value } = await reader.read();
                          if (done) break;
                          buffer += decoder.decode(value, { stream: true });
                          let ni: number;
                          while ((ni = buffer.indexOf("\n")) !== -1) {
                            let line = buffer.slice(0, ni);
                            buffer = buffer.slice(ni + 1);
                            if (line.endsWith("\r")) line = line.slice(0, -1);
                            if (line.startsWith(":") || line.trim() === "") continue;
                            if (!line.startsWith("data: ")) continue;
                            const jsonStr = line.slice(6).trim();
                            if (jsonStr === "[DONE]") break;
                            try {
                              const parsed = JSON.parse(jsonStr);
                              const delta = parsed.choices?.[0]?.delta?.content;
                              const fr = parsed.choices?.[0]?.finish_reason;
                              if (fr) setFinishReason(fr);
                              if (delta) { fullContent += delta; setContent(fullContent); }
                            } catch { buffer = line + "\n" + buffer; break; }
                          }
                        }
                        toast.success(lang === "ru" ? "Статья дописана" : "Article completed");
                      } catch (e: any) {
                        if (e.name !== "AbortError") toast.error(e.message);
                      } finally {
                        setIsStreaming(false);
                        setStreamPhase(null);
                        abortRef.current = null;
                      }
                    }}
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    {t("articles.continueGeneration")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

        </div>

        {/* Right: SEO Dashboard */}
        <div className="space-y-4 md:sticky md:top-4 md:self-start md:max-h-[calc(100vh-2rem)] md:overflow-y-auto overflow-x-hidden scrollbar-hide min-w-0">
          <SeoSidePanelContainer
            content={content}
            selectedKeyword={selectedKeyword}
            selectedKeywordId={selectedKeywordId}
            onContentImproved={(c) => setContent(c)}
          />
          <EditorSidebar
            content={content}
            title={title}
            metaDescription={metaDescription}
            domain={publishedUrl ? (() => { try { return new URL(publishedUrl).host; } catch { return null; } })() : null}
            slug={publishedUrl ? (() => { try { return new URL(publishedUrl).pathname.replace(/^\//, "").replace(/\/$/, ""); } catch { return ""; } })() : ""}
            onJump={(idx, text) => {
              const ta = editorTextareaRef.current;
              if (!ta) return;
              ta.focus();
              ta.setSelectionRange(idx, idx + text.length);
              // approximate scroll: lines before idx
              const before = content.slice(0, idx);
              const lineNum = before.split("\n").length;
              const lineHeight = parseFloat(getComputedStyle(ta).lineHeight || "20") || 20;
              ta.scrollTop = Math.max(0, (lineNum - 3) * lineHeight);
            }}
          />
          <Tabs defaultValue="dashboard">
            <TabsList className="w-full h-8 grid grid-cols-3 gap-0.5">
              <TabsTrigger value="dashboard" className="text-[10px] gap-1 px-1 min-w-0">
                <BarChart3 className="h-3 w-3 shrink-0" />
                <span className="truncate">Dashboard</span>
              </TabsTrigger>
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TabsTrigger value="human" className="text-[10px] gap-1 px-1 min-w-0">
                      <Shield className="h-3 w-3 shrink-0" />
                      <span className="truncate">Human</span>
                    </TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[220px] text-center">
                    <p>{lang === "ru" ? "Проверка текста на AI-детекторы. Используйте после генерации статьи" : "AI detector check. Use after generating an article"}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {!!(selectedAuthorId && authorProfiles.find((a: any) => a.id === selectedAuthorId)?.is_miralinks_profile) ? (
                <TabsTrigger value="miralinks" className="text-[10px] gap-1 px-1 min-w-0">
                  <Link2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">Miralinks</span>
                </TabsTrigger>
              ) : !!(selectedAuthorId && authorProfiles.find((a: any) => a.id === selectedAuthorId)?.is_gogetlinks_profile) ? (
                <TabsTrigger value="gogetlinks" className="text-[10px] gap-1 px-1 min-w-0">
                  <Link2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">GoGetLinks</span>
                </TabsTrigger>
              ) : (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TabsTrigger value="benchmark" className="text-[10px] gap-1 px-1 min-w-0">
                        <Target className="h-3 w-3 shrink-0" />
                        <span className="truncate">Benchmark</span>
                      </TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[240px] text-center">
                      <p>{lang === "ru" ? "Сравнение вашей статьи с ТОП-10 конкурентами. Требует данных из Smart Research" : "Compare your article with TOP-10 competitors. Requires Smart Research data"}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </TabsList>

            <TabsContent value="dashboard" className="mt-3 space-y-4" id="quality-check-panel">
              {/* Quality check: SEO-Module Score, Uniqueness, AI-detector */}
              <QualityCheckPanel
                articleId={currentArticleId}
                content={content}
                onHumanize={async () => {
                  const personaStyle = (() => {
                    if (!selectedAuthorId || selectedAuthorId === "none") return undefined;
                    const author = authorProfiles.find((a: any) => a.id === selectedAuthorId);
                    if (!author) return undefined;
                    return `${author.name}${author.voice_tone ? ': ' + author.voice_tone : ''}${author.description ? ' — ' + author.description : ''}`;
                  })();
                  const lng = detectContentLanguage(content);
                  const instr = getFixInstructions(lng, personaStyle)["humanize-all"];
                  await runFixIssue("humanize-all", instr);
                }}
                benchmarkReady={!!selectedKeywordId}
                onBenchmarkOptimize={selectedKeywordId ? benchmarkOptimize : undefined}
              />

              {/* Author prompt compliance check */}
              {selectedAuthorId && selectedAuthorId !== "none" && (() => {
                const a: any = authorProfiles.find((x: any) => x.id === selectedAuthorId);
                const hasInstr = !!(a?.system_instruction && String(a.system_instruction).trim());
                return (
                  <AuthorComplianceCard
                    content={content}
                    authorProfileId={selectedAuthorId}
                    authorHasInstruction={hasInstr}
                    onResult={(r) => {
                      setComplianceResult(r);
                      complianceCheckedLenRef.current = r ? content.length : 0;
                    }}
                  />
                );
              })()}

              {/* Word count & readability */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    SEO Dashboard
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{t("articles.wordsLabel")}</span>
                      <span className="font-mono">{wordCount.toLocaleString()}</span>
                    </div>
                    <Progress
                      value={Math.min(100, (wordCount / 2000) * 100)}
                      className="h-2"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">{t("articles.recommended")}</p>
                  </div>

                  <Separator />

                  {/* Fact-Check Status Badge */}
                  {factCheckStatus && content && (
                    <div>
                      <div className="flex justify-between items-center text-xs text-muted-foreground mb-1">
                        <span>{t("articles.factCheckLabel")}</span>
                        <Badge
                          variant={factCheckStatus === "verified" ? "default" : "destructive"}
                          className={`text-[10px] ${factCheckStatus === "verified" ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"}`}
                        >
                          {factCheckStatus === "verified" ? (
                            <><CheckCircle2 className="h-3 w-3 mr-1" />{t("articles.factCheckVerified")}</>
                          ) : (
                            <><AlertTriangle className="h-3 w-3 mr-1" />{t("articles.factCheckWarning")}</>
                          )}
                        </Badge>
                      </div>
                      {factCheckStatus === "warning" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full mt-1.5 text-xs h-7"
                          onClick={() => {
                            const result = validateContent(content);
                            if (result.issues.length > 0) {
                              setContent(result.fixedContent);
                              const parts: string[] = [];
                              const fe = result.issues.filter(i => i.type === "fake_expert").length;
                              const ps = result.issues.filter(i => i.type === "pseudo_stat").length;
                              const fo = result.issues.filter(i => i.type === "fake_company").length;
                              if (fe) parts.push(`${fe} фейк. экспертов`);
                              if (ps) parts.push(`${ps} псевдостатистик`);
                              if (fo) parts.push(`${fo} фейк. организаций`);
                              toast.success(`Исправлено: ${parts.join(", ")}`);
                            } else {
                              toast.info("Подозрительных элементов не найдено");
                            }
                            setFactCheckStatus("verified");
                          }}
                        >
                          <Shield className="h-3 w-3 mr-1" /> Исправить автоматически
                        </Button>
                      )}
                    </div>
                  )}

                  <Separator />

                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{t("articles.readability")}</span>
                      <span className={`font-semibold ${readInfo.color}`}>
                        {readability} — {readInfo.label}
                      </span>
                    </div>
                    <Progress value={readability} className="h-2" />
                    <p className="text-[10px] text-muted-foreground mt-1">Flesch Reading Ease</p>
                  </div>

                  <Separator />

                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{t("articles.lsiCoverage")}</span>
                      <span className="font-mono">
                        {lsiFoundCount}/{lsiKeywords.length}
                      </span>
                    </div>
                    <Progress
                      value={lsiKeywords.length > 0 ? (lsiFoundCount / lsiKeywords.length) * 100 : 0}
                      className="h-2"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* LSI Keywords */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Hash className="h-4 w-4 text-primary" />
                    {t("articles.lsiKeywords")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {lsiStatus.length > 0 ? (
                    <div className="space-y-1.5 max-h-[300px] overflow-y-auto overflow-x-hidden scrollbar-hide">
                      {lsiStatus.map((item, i) => (
                        <div
                          key={i}
                          className={`flex items-center gap-2 text-xs rounded-md px-2 py-1.5 transition-colors ${
                            item.found
                              ? "bg-success/10 text-success"
                              : "bg-muted/50 text-muted-foreground"
                          }`}
                        >
                          {item.found ? (
                            <CheckCircle2 className="h-3 w-3 shrink-0" />
                          ) : (
                            <Circle className="h-3 w-3 shrink-0" />
                          )}
                          <span className="font-mono break-all truncate">{item.keyword}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-4">
                       {t("articles.selectForLsi")}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Saved Articles */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    {t("articles.savedArticles")}
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {savedArticles.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {savedArticles.length > 0 ? (
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto overflow-x-hidden scrollbar-hide">
                      {savedArticles.slice(0, 10).map((a: any) => (
                        <div
                          key={a.id}
                          className="flex items-center gap-1 group"
                        >
                        <button
                          className="flex-1 text-left text-xs rounded-md px-2 py-1.5 bg-muted/50 hover:bg-muted/80 transition-colors truncate"
                          onClick={async () => {
                            const { data } = await supabase
                              .from("articles")
                              .select("*")
                              .eq("id", a.id)
                              .single();
                            if (data) {
                              setCurrentArticleId(data.id);
                              setTitle(data.title || "");
                              setContent(data.content || "");
                              setMetaDescription(data.meta_description || "");
                              if (data.keyword_id) setSelectedKeywordId(data.keyword_id);
                              if (data.author_profile_id) setSelectedAuthorId(data.author_profile_id);
                              setTelegraphPath((data as any).telegraph_path || "");
                              setTelegraphUrl((data as any).telegraph_url || "");
                              setPublishedUrl((data as any).published_url || "");
                              try { setAnchorLinks(JSON.parse((data as any).anchor_target_url || "[]")); } catch { setAnchorLinks([{ url: "", anchor: "" }]); }
                            }
                          }}
                        >
                          <span className="font-medium">{a.title || t("common.noTitle")}</span>
                          <span className="text-muted-foreground ml-1">({a.status})</span>
                        </button>
                        <button
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0"
                          title="Удалить статью"
                          onClick={async (e) => {
                            e.stopPropagation();
                             const { error } = await supabase.functions.invoke("delete-content", { body: { type: "article", id: a.id } });
                             if (error) { console.error("Delete error:", error); toast.error(error.message); return; }
                            queryClient.invalidateQueries({ queryKey: ["articles-list"] });
                            if (currentArticleId === a.id) {
                              setCurrentArticleId(null);
                              setTitle("");
                              setContent("");
                              setMetaDescription("");
                            }
                            toast.success(t("common.delete"));
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                        {isAdmin && (
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary shrink-0"
                            title="Передать пользователю"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTransferArticleId(a.id);
                              setTransferDialogOpen(true);
                            }}
                          >
                            <UserPlus className="h-3 w-3" />
                          </button>
                        )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-2">
                       {t("articles.noSaved")}
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="human" className="mt-3">
              <HumanScorePanel
                content={content}
                lsiKeywords={lsiKeywords}
                isFixing={fixingIssue}
                personaStyle={(() => {
                  if (!selectedAuthorId || selectedAuthorId === "none") return undefined;
                  const author = authorProfiles.find((a: any) => a.id === selectedAuthorId);
                  if (!author) return undefined;
                  return `${author.name}${author.voice_tone ? ': ' + author.voice_tone : ''}${author.description ? ' — ' + author.description : ''}`;
                })()}
                onFixIssue={async (issueKey, instruction) => {
                  try { await runFixIssue(issueKey, instruction); } catch {}
                }}
              />
            </TabsContent>

            <TabsContent value="benchmark" className="mt-3">
              {selectedKeywordId ? (
                <SeoBenchmark
                  keywordId={selectedKeywordId}
                  content={content}
                  title={title}
                  metaDescription={metaDescription}
                  onOptimize={async ({ instructions, benchmarkContext }) => {
                    if (isStreaming) return;
                    setIsStreaming(true);
                    setStreamPhase("thinking");
                    const prevContent = content;
                    snapshotVersion({
                      articleId: currentArticleId,
                      content: prevContent,
                      title: title || undefined,
                      reason: "optimize",
                    });
                    setContent("");
                    const controller = new AbortController();
                    abortRef.current = controller;
                    try {
                      const { data: { session: freshSession }, error: refreshError } = await supabase.auth.refreshSession();
                      const token = freshSession?.access_token;
                      if (refreshError || !token) throw new Error("Not authenticated");

                      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-article`;
                      const resp = await fetch(url, {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${token}`,
                          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                        },
                      body: JSON.stringify({
                        keyword_id: selectedKeywordId,
                        author_profile_id: (selectedAuthorId && selectedAuthorId !== "none") ? selectedAuthorId : null,
                          outline,
                          lsi_keywords: lsiKeywords,
                          language: (selectedKeyword as any)?.language || null,
                          optimize_instructions: instructions,
                          deep_analysis_context: benchmarkContext,
                          existing_content: prevContent,
                        }),
                        signal: controller.signal,
                      });

                      if (!resp.ok) {
                        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
                        throw new Error(err.error || `HTTP ${resp.status}`);
                      }
                      if (!resp.body) throw new Error("No stream body");

                      const reader = resp.body.getReader();
                      const decoder = new TextDecoder();
                      let buffer = "";
                      let fullContent = "";

                      while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        let ni: number;
                        while ((ni = buffer.indexOf("\n")) !== -1) {
                          let line = buffer.slice(0, ni);
                          buffer = buffer.slice(ni + 1);
                          if (line.endsWith("\r")) line = line.slice(0, -1);
                          if (line.startsWith(":") || line.trim() === "") continue;
                          if (!line.startsWith("data: ")) continue;
                          const jsonStr = line.slice(6).trim();
                          if (jsonStr === "[DONE]") break;
                          try {
                            const parsed = JSON.parse(jsonStr);
                            const delta = parsed.choices?.[0]?.delta?.content;
                            if (delta) { if (!fullContent) setStreamPhase("writing"); fullContent += delta; setContent(fullContent); }
                          } catch { buffer = line + "\n" + buffer; break; }
                        }
                      }

                      // Auto-generate SEO Title via AI
                      generateSeoTitle(fullContent);
                      toast.success("Статья оптимизирована по ТОП-10 бенчмарку");
                    } catch (e: any) {
                      if (e.name === "AbortError") { toast.info(t("articles.genStopped")); }
                      else { toast.error(e.message); setContent(prevContent); }
                    } finally {
                      setIsStreaming(false);
                      setStreamPhase(null);
                      abortRef.current = null;
                    }
                  }}
                />
              ) : (
                <Card className="bg-card border-border">
                  <CardContent className="py-8 text-center">
                     <p className="text-sm text-muted-foreground">
                       {t("articles.selectKeyword")}
                     </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="miralinks" className="mt-3">
              <PlanGate allowed={limits.hasMiralinks} featureName="Miralinks Integration" requiredPlan="PRO">
                <MiralinksWidget
                  content={content}
                  title={title}
                  metaDescription={metaDescription}
                  isMiralinksProfile={!!(selectedAuthorId && authorProfiles.find((a: any) => a.id === selectedAuthorId)?.is_miralinks_profile)}
                  links={miralinksLinks}
                  onLinksChange={setMiralinksLinks}
                  followRules={miralinksFollowRules}
                  onFollowRulesChange={setMiralinksFollowRules}
                />
              </PlanGate>
            </TabsContent>

            <TabsContent value="gogetlinks" className="mt-3">
              <PlanGate allowed={limits.hasGoGetLinks} featureName="GoGetLinks Integration" requiredPlan="PRO">
                <GoGetLinksWidget
                  content={content}
                  title={title}
                  metaDescription={metaDescription}
                  isGoGetLinksProfile={!!(selectedAuthorId && authorProfiles.find((a: any) => a.id === selectedAuthorId)?.is_gogetlinks_profile)}
                  links={gogetlinksLinks}
                  onLinksChange={setGogetlinksLinks}
                  followRules={gogetlinksFollowRules}
                  onFollowRulesChange={setGogetlinksFollowRules}
                />
              </PlanGate>
            </TabsContent>
          </Tabs>
        </div>
      </div>
      </>
      )}

      {/* Credits Modal */}
      <Dialog open={showCreditsModal} onOpenChange={setShowCreditsModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <div>
                 <DialogTitle>{t("articles.noCreditsTitle") || "Not enough credits"}</DialogTitle>
                 <DialogDescription className="mt-1">
                   {t("articles.noCreditsDesc") || "You have run out of article generation credits"}
                 </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="rounded-lg bg-muted/50 p-4 text-center">
              <p className="text-3xl font-bold text-destructive">0</p>
              <p className="text-xs text-muted-foreground mt-1">{t("pricing.credits")}</p>
            </div>
             <p className="text-sm text-muted-foreground">
               {t("pricing.creditNote")}
             </p>
            <div className="flex gap-2">
               <Button variant="outline" className="flex-1" onClick={() => setShowCreditsModal(false)}>
                 {t("common.close")}
              </Button>
              <Button className="flex-1" onClick={() => { setShowCreditsModal(false); navigate("/pricing"); }}>
                <CreditCard className="h-4 w-4 mr-1.5" />
                {t("nav.pricing")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Admin: Transfer Article Dialog */}
      <TransferDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        articleId={transferArticleId}
      />

      {/* Compliance: edit single deviation */}
      <DeviationFixDialog
        activeDeviation={activeDeviation}
        onClose={() => setActiveDeviation(null)}
        complianceResult={complianceResult}
        content={content}
        setContent={setContent}
        selectedAuthorId={selectedAuthorId}
      />

      {/* Compliance: rewrite whole article with all fixes */}
      <RewriteAllDialog
        open={rewriteOpen}
        onOpenChange={setRewriteOpen}
        complianceResult={complianceResult}
        setComplianceResult={setComplianceResult}
        complianceCheckedLenRef={complianceCheckedLenRef}
        isStreaming={isStreaming}
        setIsStreaming={setIsStreaming}
        setStreamPhase={setStreamPhase}
        abortRef={abortRef}
        content={content}
        setContent={setContent}
        selectedKeywordId={selectedKeywordId}
        selectedAuthorId={selectedAuthorId}
        outline={outline}
        lsiKeywords={lsiKeywords}
        currentArticleId={currentArticleId}
        title={title}
        snapshotVersion={snapshotVersion}
      />

      {/* Sectioned (streamed) generator */}
      <Sheet open={sectionedOpen} onOpenChange={setSectionedOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Генерация по разделам</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <SectionedGeneratorMount
              selectedKeyword={selectedKeyword}
              currentArticleId={currentArticleId}
              authorProfiles={authorProfiles}
              selectedAuthorId={selectedAuthorId}
              outline={outline}
              onArticleCreated={(id) => setCurrentArticleId(id)}
              onComplete={(md, h1Text) => {
                setContentRaw(md);
                if (h1Text) { setTitle(h1Text); setH1(h1Text); }
                toast.success("Статья собрана из разделов");
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
    </ArticleEditorProvider>
  );
}

