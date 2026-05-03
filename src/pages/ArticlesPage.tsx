import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import DOMPurify from "dompurify";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
  Wand2, Loader2, Hash, FileText, Save, Code2, Trash2,
  CheckCircle2, Circle, BarChart3, BookOpen, Copy, Check, Download, Eye, Pencil, User, Target, Factory, Gem, Shield, ShieldAlert, CreditCard, AlertTriangle, Send, Link2, Quote, Table2, MapPin, Search, MessageSquarePlus, UserPlus, ChevronDown, ChevronUp, ExternalLink
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import MyArticlesPage from "@/pages/MyArticlesPage";
import { toast } from "sonner";
import { useI18n } from "@/shared/hooks/useI18n";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";
import { useAuth } from "@/shared/hooks/useAuth";
import { PlanGate } from "@/shared/components/PlanGate";
import { SeoBenchmark } from "@/features/seo-analysis/SeoBenchmark";
import { BulkGenerationMode } from "@/components/bulk/BulkGenerationMode";
import { ProImageGenerator } from "@/features/pro-image-gen/ProImageGenerator";
import { HumanScorePanel } from "@/components/article/HumanScorePanel";
import { QualityCheckPanel } from "@/components/article/QualityCheckPanel";
import { LiveQualityBadge } from "@/components/article/LiveQualityBadge";
import { AuthorComplianceCard, type ComplianceResult, type ComplianceDeviation } from "@/components/article/AuthorComplianceCard";
import { PersonaSelector } from "@/components/article/PersonaSelector";
import { MiralinksWidget, type MiralinksLink } from "@/components/article/MiralinksWidget";
import { validateContent, applyEnStealthPostProcessing } from "@/shared/utils/contentValidator";
import { GoGetLinksWidget, type GoGetLinksLink } from "@/components/article/GoGetLinksWidget";
import { InlineAIToolbar } from "@/components/article/InlineAIToolbar";
import { SectionedGenerator } from "@/components/article/SectionedGenerator";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";
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
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [sectionedOpen, setSectionedOpen] = useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferArticleId, setTransferArticleId] = useState<string | null>(null);
  const [transferEmail, setTransferEmail] = useState("");
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
  const [schemaJson, setSchemaJson] = useState<string>("");
  const [schemaCopied, setSchemaCopied] = useState(false);
  const [faqTextBlock, setFaqTextBlock] = useState<string>("");
  const [faqCopied, setFaqCopied] = useState(false);
  const [schemaGenerating, setSchemaGenerating] = useState(false);
  const [faqMode, setFaqMode] = useState<"standard" | "serp-dominance">("serp-dominance");
  const [currentArticleId, setCurrentArticleId] = useState<string | null>(null);
  const [fixingIssue, setFixingIssue] = useState<string | null>(null);
  const [complianceResult, setComplianceResult] = useState<ComplianceResult | null>(null);
  const complianceCheckedLenRef = useRef<number>(0);
  const [activeDeviation, setActiveDeviation] = useState<{ idx: number; quote: string } | null>(null);
  const [deviationFixText, setDeviationFixText] = useState("");
  const [isRewritingFragment, setIsRewritingFragment] = useState(false);
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
  const [publishingTo, setPublishingTo] = useState<string | null>(null);
  const [miralinksLinks, setMiralinksLinks] = useState<MiralinksLink[]>([{ url: "", anchor: "" }]);
  const [miralinksFollowRules, setMiralinksFollowRules] = useState(true);
  const [gogetlinksLinks, setGogetlinksLinks] = useState<GoGetLinksLink[]>([{ url: "", anchor: "" }]);
  const [gogetlinksFollowRules, setGogetlinksFollowRules] = useState(true);
  const [includeExpertQuote, setIncludeExpertQuote] = useState(true);
  const [includeComparisonTable, setIncludeComparisonTable] = useState(true);
  const [seoKeywords, setSeoKeywords] = useState("");
  const [enableGeo, setEnableGeo] = useState(false);
  const [geoLocation, setGeoLocation] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [telegraphPath, setTelegraphPath] = useState("");
  const [telegraphUrl, setTelegraphUrl] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [anchorLinks, setAnchorLinks] = useState<{ url: string; anchor: string }[]>([{ url: "", anchor: "" }]);
  const [finishReason, setFinishReason] = useState<string | null>(null);
  const [factCheckStatus, setFactCheckStatus] = useState<"verified" | "warning" | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Admin: transfer article to another user
  const handleTransferArticle = useCallback(async () => {
    if (!transferArticleId || !transferEmail.trim()) return;
    try {
      // Find user by email
      const { data: targetProfile, error: profileErr } = await supabase
        .from("profiles")
        .select("id, email")
        .eq("email", transferEmail.trim())
        .single();
      if (profileErr || !targetProfile) {
        toast.error(lang === "ru" ? "Пользователь не найден" : "User not found");
        return;
      }
      // Update article user_id
      const { error: updateErr } = await supabase
        .from("articles")
        .update({ user_id: targetProfile.id })
        .eq("id", transferArticleId);
      if (updateErr) throw updateErr;
      toast.success(lang === "ru" ? `Статья передана ${targetProfile.email}` : `Article transferred to ${targetProfile.email}`);
      setTransferDialogOpen(false);
      setTransferArticleId(null);
      setTransferEmail("");
      queryClient.invalidateQueries({ queryKey: ["articles-list"] });
    } catch (e: any) {
      toast.error(e.message || "Transfer failed");
    }
  }, [transferArticleId, transferEmail, lang, queryClient]);

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

  // Debounced fact-check to avoid freezing during streaming
  useEffect(() => {
    if (!content || content.length < 100 || isStreaming) {
      return;
    }
    const timer = setTimeout(() => {
      const result = validateContent(content);
      setFactCheckStatus(result.issues.length > 0 ? "warning" : "verified");
    }, 1000);
    return () => clearTimeout(timer);
  }, [content, isStreaming]);

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
          project_id: selectedProjectId || null,
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
    },
    onError: (e) => toast.error(e.message),
  });

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
    <div className="space-y-6 overflow-x-hidden">
      {/* Mode Switcher */}
      <div className="flex items-center gap-3">
        <FileText className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{t("articles.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("articles.subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1">
          <Button
            variant={mode === "single" ? "default" : "ghost"}
            size="sm"
            onClick={() => setMode("single")}
            className="gap-1.5 text-xs"
          >
            <Gem className="h-3.5 w-3.5" />
            Boutique
          </Button>
          <Button
            variant={mode === "bulk" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              if (!limits.hasBulkMode) {
                toast.error(t("articles.bulkProOnly"));
                return;
              }
              setMode("bulk");
            }}
            className="gap-1.5 text-xs"
          >
            <Factory className="h-3.5 w-3.5" />
            Factory
            {!limits.hasBulkMode && <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">PRO</Badge>}
          </Button>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              {t("nav.myArticles")}
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
            <SheetHeader>
              <SheetTitle>{t("nav.myArticles")}</SheetTitle>
            </SheetHeader>
            <div className="mt-4">
              <MyArticlesPage />
            </div>
          </SheetContent>
        </Sheet>
      </div>

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
      <div className="rounded-lg border border-border bg-card p-4">
        {/* Project selector (FACTORY only) */}
        {projects.length > 0 && (
          <div className="mb-3 pb-3 border-b border-border">
            <Label className="text-xs text-muted-foreground">{t("projects.selectProject")}</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder={t("projects.noProject")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("projects.noProject")}</SelectItem>
                {projects.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.domain || "—"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Interlinking articles panel */}
        {selectedProjectId && selectedProjectId !== "none" && projectArticlesForLinks.length > 0 && (
          <div className="mb-3 pb-3 border-b border-border">
            <button
              type="button"
              onClick={() => setShowInterlinkingArticles(!showInterlinkingArticles)}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              <Link2 className="h-3.5 w-3.5" />
              <span>{lang === "ru" ? "Статьи для перелинковки" : "Articles for interlinking"} ({projectArticlesForLinks.length})</span>
              {showInterlinkingArticles ? <ChevronUp className="h-3.5 w-3.5 ml-auto" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
            </button>
            {showInterlinkingArticles && (
              <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                {projectArticlesForLinks.map((article: any) => (
                  <div key={article.id} className="flex items-center gap-2 text-xs p-1.5 rounded bg-muted/50">
                    <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate flex-1 font-medium">{article.title}</span>
                    {article.published_url ? (
                      <a href={article.published_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1 shrink-0">
                        <ExternalLink className="h-3 w-3" />
                        <span className="max-w-[200px] truncate">{article.published_url}</span>
                      </a>
                    ) : (
                      <span className="text-destructive/70 text-[10px] shrink-0">{lang === "ru" ? "URL не указан" : "No URL"}</span>
                    )}
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground mt-1">
                  {lang === "ru"
                    ? "Укажите Published URL у каждой статьи (в редакторе → SEO/Meta) для корректной перелинковки."
                    : "Set Published URL for each article (in editor → SEO/Meta) for proper interlinking."}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("articles.keyword")}</Label>
            <Select value={selectedKeywordId} onValueChange={setSelectedKeywordId}>
              <SelectTrigger>
                <SelectValue placeholder={t("common.select")} />
              </SelectTrigger>
              <SelectContent>
                {keywords.map((k: any) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.seed_keyword} — {k.intent}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">&nbsp;</Label>
            {isStreaming ? (
              <Button variant="destructive" onClick={handleStop} className="w-full">
                {t("articles.stop")}
              </Button>
            ) : (
              <Button
                onClick={handleGenerate}
                disabled={!selectedKeywordId}
                className="w-full gap-2"
              >
                <Wand2 className="h-4 w-4" />
                Generate
              </Button>
            )}
            {!isStreaming && (
              <Button
                variant="outline"
                size="sm"
                disabled={!selectedKeywordId}
                className="w-full mt-1.5 gap-2 text-xs"
                onClick={() => setSectionedOpen(true)}
                title="Генерировать по разделам со стримингом и регенерацией каждого H2"
              >
                <Wand2 className="h-3.5 w-3.5" />
                По разделам (beta)
              </Button>
            )}
          </div>
        </div>

        {/* Persona Selector */}
        <PersonaSelector
          authors={authorProfiles}
          selectedId={selectedAuthorId}
          onSelect={setSelectedAuthorId}
        />

        {/* Content formatting options */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border mt-3">
          {(() => {
            // Telegra.ph не поддерживает HTML-таблицы и микроразметку — принудительно
            // выключаем чип "Таблица сравнения" при выборе автора Телеграф.
            const isTelegraphAuthor = !!(selectedAuthorId && selectedAuthorId !== "none" &&
              authorProfiles.find((a: any) => a.id === selectedAuthorId && a.name === "Телеграф"));
            if (isTelegraphAuthor && includeComparisonTable) {
              // отложенно сбросим, чтобы не дёргать setState во время рендера
              setTimeout(() => setIncludeComparisonTable(false), 0);
            }
            return null;
          })()}
          <button
            type="button"
            onClick={() => setIncludeExpertQuote(!includeExpertQuote)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-200 select-none cursor-pointer ${
              includeExpertQuote
                ? 'border-purple-500/60 text-white bg-purple-500/10 shadow-[0_0_15px_rgba(168,85,247,0.4)]'
                : 'border-slate-800 text-slate-400 bg-white/5 hover:bg-white/10 hover:border-slate-700'
            }`}
          >
            <Quote className={`h-3.5 w-3.5 ${includeExpertQuote ? 'text-purple-400' : 'text-slate-500'}`} />
            {t("articles.expertQuote")}
          </button>
          {(() => {
            const isTelegraphAuthor = !!(selectedAuthorId && selectedAuthorId !== "none" &&
              authorProfiles.find((a: any) => a.id === selectedAuthorId && a.name === "Телеграф"));
            return (
              <button
                type="button"
                disabled={isTelegraphAuthor}
                title={isTelegraphAuthor ? "Telegra.ph не поддерживает таблицы" : undefined}
                onClick={() => !isTelegraphAuthor && setIncludeComparisonTable(!includeComparisonTable)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-200 select-none ${
                  isTelegraphAuthor
                    ? 'border-slate-800 text-slate-600 bg-white/5 opacity-50 cursor-not-allowed'
                    : includeComparisonTable
                      ? 'border-purple-500/60 text-white bg-purple-500/10 shadow-[0_0_15px_rgba(168,85,247,0.4)] cursor-pointer'
                      : 'border-slate-800 text-slate-400 bg-white/5 hover:bg-white/10 hover:border-slate-700 cursor-pointer'
                }`}
              >
                <Table2 className={`h-3.5 w-3.5 ${includeComparisonTable && !isTelegraphAuthor ? 'text-purple-400' : 'text-slate-500'}`} />
                {t("articles.comparisonTable")}
              </button>
            );
          })()}
        </div>

        {/* SEO Keywords, Geo, Custom Instructions */}
        <div className="space-y-3 pt-3 border-t border-border">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Search className="h-3 w-3" />
              {t("articles.seoKeywords")}
            </Label>
            <Input
              value={seoKeywords}
              onChange={(e) => setSeoKeywords(e.target.value)}
              placeholder={t("articles.seoKeywordsPlaceholder")}
              className="h-8 text-sm bg-muted/30"
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="geo-toggle"
              checked={enableGeo}
              onCheckedChange={(v) => setEnableGeo(!!v)}
              className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
            />
            <label htmlFor="geo-toggle" className="text-sm text-foreground cursor-pointer flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              {t("articles.addGeo")}
            </label>
          </div>

          {enableGeo && (
            <div className="space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
              <Label className="text-[11px] text-muted-foreground">{t("articles.targetRegion")}</Label>
              <Input
                value={geoLocation}
                onChange={(e) => setGeoLocation(e.target.value)}
                placeholder={t("articles.targetRegionPlaceholder")}
                className="h-8 text-sm bg-muted/30"
              />
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <MessageSquarePlus className="h-3 w-3" />
              {t("articles.customInstructions")}
            </Label>
            <Textarea
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder={t("articles.customInstructionsPlaceholder")}
              className="min-h-[72px] text-sm bg-muted/30 resize-y"
              rows={3}
            />
          </div>
        </div>
      </div>

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

                    {/* Blog platform publish buttons — PRO only */}
                    {currentArticleId && content && limits.hasProImageGen && (
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
                {/* Live passive analyzer (free SEO + AI checks, debounced 3s) */}
                {currentArticleId && content && !isStreaming && (
                  <div className="flex justify-end mb-2">
                    <LiveQualityBadge
                      articleId={currentArticleId}
                      content={content}
                      enabled={localStorage.getItem("live_quality_disabled") !== "1"}
                      onClick={() => {
                        // Scroll up to make the right-side dashboard visible
                        try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
                      }}
                    />
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

            <TabsContent value="dashboard" className="mt-3 space-y-4">
              {/* Quality check: SEO-Module Score, Uniqueness, AI-detector */}
              <QualityCheckPanel articleId={currentArticleId} content={content} />

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
                              setTransferEmail("");
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
                  if (!selectedKeywordId || !content.trim()) {
                    toast.error("Нет контента для исправления");
                    return;
                  }
                  setFixingIssue(issueKey);
                  setIsStreaming(true);
                  setStreamPhase("thinking");
                  const prevContent = content;
                  setContent("");

                  const isHumanize = issueKey === "humanize-all";
                  if (isHumanize) {
                    toast.info(lang === "ru"
                      ? "Анализируем структуру текста и убираем AI-паттерны..."
                      : "Analyzing text structure and removing AI patterns...",
                      { duration: 8000 }
                    );
                  }

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
                        optimize_instructions: `ЗАДАЧА: Исправь ТОЛЬКО указанную проблему, сохрани весь остальной текст максимально близко к оригиналу.\n\n${instruction}\n\nВАЖНО: НЕ переписывай статью целиком. Измени только те части, которые нарушают указанное правило. Сохрани структуру, заголовки и объём.`,
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

                    if (isHumanize) {
                      toast.success(lang === "ru"
                        ? "Текст успешно гуманизирован! Запах GPT устранён."
                        : "Text humanized successfully! GPT smell eliminated.",
                        { duration: 5000 }
                      );
                    } else {
                      toast.success(lang === "ru" ? "Проблема исправлена — проверьте Human Score" : "Issue fixed — check Human Score");
                    }
                  } catch (e: any) {
                     if (e.name === "AbortError") { toast.info(t("articles.genStopped")); }
                    else {
                      toast.error(isHumanize
                        ? (lang === "ru" ? "Ошибка при обработке текста. Попробуйте ещё раз." : "Error processing text. Please try again.")
                        : e.message
                      );
                      setContent(prevContent);
                    }
                  } finally {
                    setIsStreaming(false);
                    setStreamPhase(null);
                    setFixingIssue(null);
                    abortRef.current = null;
                  }
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
      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              {lang === "ru" ? "Передать статью пользователю" : "Transfer article to user"}
            </DialogTitle>
            <DialogDescription>
              {lang === "ru" ? "Введите email пользователя, которому хотите передать статью" : "Enter the email of the user to transfer the article to"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="user@example.com"
              value={transferEmail}
              onChange={(e) => setTransferEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && transferEmail.trim() && handleTransferArticle()}
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setTransferDialogOpen(false)}>
                {t("common.close")}
              </Button>
              <Button
                className="flex-1"
                disabled={!transferEmail.trim()}
                onClick={handleTransferArticle}
              >
                <UserPlus className="h-4 w-4 mr-1.5" />
                {lang === "ru" ? "Передать" : "Transfer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Compliance: edit single deviation */}
      <Dialog open={!!activeDeviation} onOpenChange={(o) => { if (!o) { setActiveDeviation(null); setIsRewritingFragment(false); } }}>
        <DialogContent className="max-w-lg">
          {activeDeviation && complianceResult?.deviations[activeDeviation.idx] && (() => {
            const dev = complianceResult.deviations[activeDeviation.idx];
            const escRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const findFragmentRange = (scope: "sentence" | "paragraph"): { match: string; before: string; after: string } | null => {
              const orig = activeDeviation.quote.trim();
              if (!orig) return null;
              // find quote position (exact or soft)
              let idx = content.indexOf(orig);
              let matched = orig;
              if (idx === -1) {
                const re = new RegExp(escRegex(orig).replace(/\s+/g, "\\s+"), "i");
                const m = re.exec(content);
                if (!m) return null;
                idx = m.index;
                matched = m[0];
              }
              const end = idx + matched.length;
              if (scope === "paragraph") {
                // find paragraph: bounded by blank line, </p>, <p>, or HTML block tags
                const before = content.slice(0, idx);
                const after = content.slice(end);
                const startMatches = [
                  before.lastIndexOf("\n\n"),
                  before.lastIndexOf("</p>"),
                  before.lastIndexOf("</h1>"),
                  before.lastIndexOf("</h2>"),
                  before.lastIndexOf("</h3>"),
                  before.lastIndexOf("</li>"),
                  before.lastIndexOf("</ul>"),
                  before.lastIndexOf("</ol>"),
                  before.lastIndexOf("<p>"),
                ];
                let startCut = Math.max(...startMatches);
                if (startCut < 0) startCut = 0;
                else {
                  // move past the boundary tag/newlines
                  const slice = before.slice(startCut);
                  startCut += slice.search(/\S/) >= 0 ? slice.indexOf(slice.trim()[0]) : 0;
                }
                const endMatches = [
                  after.indexOf("\n\n"),
                  after.indexOf("</p>"),
                  after.indexOf("<h1"),
                  after.indexOf("<h2"),
                  after.indexOf("<h3"),
                  after.indexOf("<p>"),
                  after.indexOf("<ul"),
                  after.indexOf("<ol"),
                ].filter(n => n >= 0);
                let endCut = endMatches.length ? Math.min(...endMatches) : after.length;
                // include closing </p> if it was the boundary
                const closingP = after.indexOf("</p>");
                if (closingP >= 0 && closingP === endCut) endCut += "</p>".length;
                return {
                  match: content.slice(startCut, end + endCut),
                  before: content.slice(0, startCut),
                  after: content.slice(end + endCut),
                };
              }
              // sentence scope: from previous .!?…\n to next .!?…
              const sentStart = (() => {
                const slice = content.slice(0, idx);
                const m = slice.match(/[.!?…]["»)\s]*\s+(?=\S[^.!?…]*$)/);
                if (!m) return 0;
                return slice.length - (slice.length - (m.index || 0)) + m[0].length;
              })();
              const sentEnd = (() => {
                const slice = content.slice(end);
                const m = slice.match(/[^.!?…]*[.!?…]+["»)]?/);
                return end + (m ? m[0].length : slice.length);
              })();
              return {
                match: content.slice(sentStart, sentEnd),
                before: content.slice(0, sentStart),
                after: content.slice(sentEnd),
              };
            };

            const handleRewrite = async (scope: "sentence" | "paragraph") => {
              const range = findFragmentRange(scope);
              if (!range) {
                toast.error("Не удалось найти фрагмент в тексте");
                return;
              }
              setIsRewritingFragment(true);
              try {
                const { data: { session } } = await supabase.auth.getSession();
                const token = session?.access_token;
                if (!token) throw new Error("Not authenticated");
                const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rewrite-fragment`;
                const resp = await fetch(url, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                  },
                  body: JSON.stringify({
                    fragment: range.match,
                    scope,
                    author_profile_id: selectedAuthorId,
                    violations: (complianceResult?.deviations || []).map(d => ({
                      category: d.category, rule: d.rule, suggestion: d.suggestion,
                    })),
                    context_before: range.before,
                    context_after: range.after,
                  }),
                });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
                const rewritten = (data.rewritten || "").toString().trim();
                if (!rewritten) throw new Error("Пустой ответ");
                setContent(range.before + rewritten + range.after);
                toast.success(scope === "paragraph" ? "Абзац переписан с учётом требований автора" : "Предложение переписано с учётом требований автора");
                setActiveDeviation(null);
              } catch (e: any) {
                toast.error(e.message || "Ошибка переписывания");
              } finally {
                setIsRewritingFragment(false);
              }
            };
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-warning" />
                    Правка отклонения
                  </DialogTitle>
                  <DialogDescription>
                    <span className="font-medium text-foreground">{dev.category}</span> · {dev.rule}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Цитата из статьи</Label>
                    <div className="mt-1 p-2 rounded-md bg-muted/50 border border-border text-xs italic">
                      «{activeDeviation.quote}»
                    </div>
                  </div>
                  {dev.suggestion && (
                    <div className="text-[11px] text-muted-foreground">
                      Подсказка ИИ: <span className="text-foreground">{dev.suggestion}</span>
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground">
                    ИИ перепишет фрагмент строго по инструкции автора, исправив все найденные нарушения. Факты сохранятся.
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="default"
                      className="w-full"
                      disabled={isRewritingFragment || !selectedAuthorId || selectedAuthorId === "none"}
                      onClick={() => handleRewrite("sentence")}
                    >
                      {isRewritingFragment ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}
                      Переписать предложение
                    </Button>
                    <Button
                      variant="secondary"
                      className="w-full"
                      disabled={isRewritingFragment || !selectedAuthorId || selectedAuthorId === "none"}
                      onClick={() => handleRewrite("paragraph")}
                    >
                      {isRewritingFragment ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}
                      Переписать абзац
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    className="w-full text-destructive hover:text-destructive"
                    disabled={isRewritingFragment}
                    onClick={() => {
                      const orig = activeDeviation.quote.trim();
                      if (!orig) return;
                      if (content.includes(orig)) {
                        setContent(content.replace(orig, ""));
                        toast.success("Фрагмент удален из текста");
                        setActiveDeviation(null);
                      } else {
                        const escRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                        const re = new RegExp(escRegex(orig).replace(/\s+/g, "\\s+"), "i");
                        if (re.test(content)) {
                          setContent(content.replace(re, ""));
                          toast.success("Фрагмент удален из текста");
                          setActiveDeviation(null);
                        } else {
                          toast.error("Не удалось найти фрагмент");
                        }
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Удалить фрагмент из текста
                  </Button>
                  <Button variant="ghost" className="w-full" onClick={() => setActiveDeviation(null)}>
                    Отмена
                  </Button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Compliance: rewrite whole article with all fixes */}
      <Dialog open={rewriteOpen} onOpenChange={setRewriteOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-primary" />
              Переписать статью с учётом всех отклонений
            </DialogTitle>
            <DialogDescription>
              ИИ получит список найденных нарушений и перепишет проблемные фрагменты, сохранив структуру и объём.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {complianceResult && (
              <div className="max-h-[200px] overflow-y-auto scrollbar-hide space-y-1 text-[11px]">
                {complianceResult.deviations.map((d, i) => (
                  <div key={i} className="p-1.5 rounded border border-border bg-muted/30">
                    <span className="font-medium">{d.category}:</span> {d.rule}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRewriteOpen(false)} disabled={isStreaming}>
                Отмена
              </Button>
              <Button
                className="flex-1"
                disabled={isStreaming || !complianceResult || complianceResult.deviations.length === 0 || !selectedKeywordId}
                onClick={async () => {
                  if (!complianceResult) return;
                  setRewriteOpen(false);
                  const rules = complianceResult.deviations.map((d, i) =>
                    `${i + 1}. [${d.severity}/${d.category}] ${d.rule}\n   Цитата: «${d.quote}»\n   Что сделать: ${d.suggestion || "переписать в стиле автора"}`
                  ).join("\n\n");
                  const instruction =
                    `Перепиши статью, ИСПРАВИВ следующие отклонения от инструкции автора. Сохрани структуру, заголовки, объём и факты. Меняй ТОЛЬКО проблемные фрагменты.\n\nОТКЛОНЕНИЯ:\n${rules}`;
                  setIsStreaming(true);
                  setStreamPhase("thinking");
                  const prevContent = content;
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
                        optimize_instructions: instruction,
                        existing_content: prevContent,
                      }),
                      signal: controller.signal,
                    });
                    if (!resp.ok) {
                      const err = await resp.json().catch(() => ({ error: "Unknown" }));
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
                    setComplianceResult(null);
                    complianceCheckedLenRef.current = 0;
                    toast.success("Статья переписана. Запустите проверку заново.");
                  } catch (e: any) {
                    if (e.name === "AbortError") toast.info("Переписывание остановлено");
                    else { toast.error(e.message); setContent(prevContent); }
                  } finally {
                    setIsStreaming(false);
                    setStreamPhase(null);
                    abortRef.current = null;
                  }
                }}
              >
                <Wand2 className="h-3 w-3 mr-1" />
                Переписать
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
  );
}

function SectionedGeneratorMount({
  selectedKeyword,
  currentArticleId,
  authorProfiles,
  selectedAuthorId,
  outline,
  onArticleCreated,
  onComplete,
}: {
  selectedKeyword: any;
  currentArticleId: string | null;
  authorProfiles: any[];
  selectedAuthorId: string;
  outline: { text: string; level: string }[];
  onArticleCreated: (id: string) => void;
  onComplete: (md: string, h1: string) => void;
}) {
  const [articleId, setArticleId] = useState<string | null>(currentArticleId);
  const [creating, setCreating] = useState(false);

  useEffect(() => { setArticleId(currentArticleId); }, [currentArticleId]);

  if (!selectedKeyword) {
    return <div className="text-sm text-muted-foreground">Сначала выберите ключевое слово.</div>;
  }

  if (!articleId) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">
          Будет создан черновик статьи для разбиения на разделы.
        </div>
        <Button
          disabled={creating}
          onClick={async () => {
            setCreating(true);
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) throw new Error("Not authenticated");
              const { data, error } = await supabase
                .from("articles")
                .insert({
                  user_id: user.id,
                  keyword_id: selectedKeyword.id,
                  author_profile_id: (selectedAuthorId && selectedAuthorId !== "none") ? selectedAuthorId : null,
                  title: selectedKeyword.seed_keyword,
                  content: "",
                  status: "generating",
                  language: selectedKeyword.language || "ru",
                })
                .select("id")
                .single();
              if (error) throw error;
              setArticleId(data.id);
              onArticleCreated(data.id);
            } catch (e: any) {
              toast.error(`Не удалось создать черновик: ${e?.message || e}`);
            } finally {
              setCreating(false);
            }
          }}
        >
          {creating ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Wand2 className="size-4 mr-1" />}
          Создать черновик и продолжить
        </Button>
      </div>
    );
  }

  const author = authorProfiles?.find((a: any) => a.id === selectedAuthorId);
  const personaPrompt =
    author?.system_prompt_override ||
    author?.system_instruction ||
    (author ? `Имя: ${author.name}. Тон: ${author.voice_tone || "—"}.` : "");

  return (
    <SectionedGenerator
      articleId={articleId}
      keyword={selectedKeyword.seed_keyword}
      language={selectedKeyword.language || "ru"}
      personaPrompt={personaPrompt}
      existingOutline={outline?.length ? outline.map(o => ({ text: o.text })) : undefined}
      onComplete={onComplete}
    />
  );
}
