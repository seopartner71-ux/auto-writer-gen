import { useState, useEffect, useMemo, useCallback } from "react";
import { Factory, Globe, FileText, Upload, Eye, ExternalLink, Loader2, Rocket, CheckCircle, AlertCircle, ImageIcon, ShieldCheck, HelpCircle, Copy, Link2, Shuffle, User, Trash2, Pencil, Plus, FolderInput, PackageCheck, Cloud, Github, Zap } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { normalizeGoogleVerification } from "@/shared/utils/googleVerification";
import DOMPurify from "dompurify";

interface AuthorProfile {
  id: string;
  name: string;
  type: string;
  avatar_icon: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
  domain: string;
  language: string;
  github_repo: string | null;
  github_token: string | null;
  site_name: string | null;
  site_copyright: string | null;
  site_about: string | null;
  site_contacts: string | null;
  site_privacy: string | null;
  custom_domain: string | null;
  author_name: string | null;
  author_bio: string | null;
  author_avatar: string | null;
  primary_color: string | null;
  font_pair: string | null;
  hosting_platform: string | null;
  injection_links: { url: string; anchor: string }[] | null;
  footer_link: { url: string; text: string } | null;
  google_verification: string | null;
}

type DeployStatus = "idle" | "publishing" | "success" | "error";
interface DeployLog {
  status: DeployStatus;
  message: string;
  timestamp: Date;
}

const HOSTING_PLATFORMS = [
  { value: "vercel", label: "Vercel" },
  { value: "cloudflare", label: "Cloudflare Pages" },
  { value: "netlify", label: "Netlify" },
];

const DNS_CONFIGS: Record<string, { a: string; cname: string; cnameValue: string }> = {
  vercel: { a: "76.76.21.21", cname: "www", cnameValue: "cname.vercel-dns.com" },
  cloudflare: { a: "", cname: "@", cnameValue: "your-project.pages.dev" },
  netlify: { a: "75.2.60.5", cname: "www", cnameValue: "your-site.netlify.app" },
};

// Auto-detect hosting platform from domain
const detectPlatformFromDomain = (domain: string | null | undefined): string | null => {
  if (!domain) return null;
  const d = domain.toLowerCase();
  if (d.includes("vercel.app")) return "vercel";
  if (d.includes("pages.dev")) return "cloudflare";
  if (d.includes("netlify.app") || d.includes("netlify.com")) return "netlify";
  return null;
};

const FONT_PAIRS = [
  { label: "Inter + System", value: "inter" },
  { label: "Geist + Sans", value: "geist" },
  { label: "Roboto + Sans", value: "roboto" },
  { label: "Playfair Display + Inter", value: "playfair" },
  { label: "Merriweather + Open Sans", value: "merriweather" },
];

const ACCENT_COLORS = [
  { label: "Indigo", value: "#6366f1" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Emerald", value: "#10b981" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Rose", value: "#f43f5e" },
  { label: "Violet", value: "#8b5cf6" },
  { label: "Teal", value: "#14b8a6" },
  { label: "Graphite", value: "#475569" },
];

function randomAccentColor(): string {
  return ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)].value;
}

function randomFontPair(): string {
  return FONT_PAIRS[Math.floor(Math.random() * FONT_PAIRS.length)].value;
}

const PUBLISH_DESTINATIONS = [
  { label: "GitHub Pages", icon: Github },
  { label: "Cloudflare Pages", icon: Cloud },
  { label: "Vercel", icon: Rocket },
];

interface QueueArticle {
  id: string;
  title: string | null;
  content: string | null;
  meta_description: string | null;
  status: string | null;
  published_url: string | null;
  keywords: string[] | null;
  created_at: string | null;
}

export default function SiteFactoryPage() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [keywords, setKeywords] = useState("");
  const [generating, setGenerating] = useState(false);
  const [articles, setArticles] = useState<QueueArticle[]>([]);
  const [previewArticle, setPreviewArticle] = useState<QueueArticle | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [repoStatus, setRepoStatus] = useState<"idle" | "checking" | "empty" | "initializing" | "ready" | "error">("idle");
  const [aiFillLoading, setAiFillLoading] = useState(false);
  const [repoError, setRepoError] = useState("");
  const [generateImages, setGenerateImages] = useState(true);
  const [siteConfig, setSiteConfig] = useState({ site_name: "", site_copyright: "", site_about: "", site_contacts: "", site_privacy: "", author_name: "", author_bio: "", author_avatar: "", primary_color: "", font_pair: "", footer_link_url: "", footer_link_text: "", google_verification: "" });
  const [verificationDeployed, setVerificationDeployed] = useState(false);
  const [hostingPlatform, setHostingPlatform] = useState("vercel");
  const [deployLogs, setDeployLogs] = useState<DeployLog[]>([]);
  const [imageCount, setImageCount] = useState(3);
  const [authorProfiles, setAuthorProfiles] = useState<AuthorProfile[]>([]);
  const [selectedAuthorId, setSelectedAuthorId] = useState<string>("");
  const [customDomain, setCustomDomain] = useState("");
  const [showDnsHelper, setShowDnsHelper] = useState(false);
  const [savingDomain, setSavingDomain] = useState(false);
  const [editingArticle, setEditingArticle] = useState<QueueArticle | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editMeta, setEditMeta] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [unassignedArticles, setUnassignedArticles] = useState<QueueArticle[]>([]);
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchPublishing, setBatchPublishing] = useState(false);
  const [injectionLinks, setInjectionLinks] = useState<{ url: string; anchor: string }[]>([]);
  const [indexedArticleIds, setIndexedArticleIds] = useState<Set<string>>(new Set());
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkAnchor, setNewLinkAnchor] = useState("");
  const [deployingVerification, setDeployingVerification] = useState(false);
  const [vercelStatus, setVercelStatus] = useState<"idle" | "checking" | "linked" | "not_linked" | "creating" | "error">("idle");
  const [vercelError, setVercelError] = useState<string>("");
  const [vercelHint, setVercelHint] = useState<string>("");
  const [vercelDomain, setVercelDomain] = useState<string>("");

  // Stats
  const [totalSites, setTotalSites] = useState(0);
  const [totalArticles, setTotalArticles] = useState(0);
  const [todayPublished, setTodayPublished] = useState(0);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  const PROJECT_SELECT = "id, name, domain, language, github_repo, github_token, site_name, site_copyright, site_about, site_contacts, site_privacy, custom_domain, author_name, author_bio, author_avatar, primary_color, font_pair, hosting_platform, injection_links, footer_link, google_verification";

  // Sync siteConfig when project changes
  useEffect(() => {
    if (selectedProject) {
      setSiteConfig({
        site_name: selectedProject.site_name || "",
        site_copyright: selectedProject.site_copyright || "",
        site_about: selectedProject.site_about || "",
        site_contacts: selectedProject.site_contacts || "",
        site_privacy: selectedProject.site_privacy || "",
        author_name: selectedProject.author_name || "",
        author_bio: selectedProject.author_bio || "",
        author_avatar: selectedProject.author_avatar || "",
        primary_color: selectedProject.primary_color || "",
        font_pair: selectedProject.font_pair || "",
        footer_link_url: selectedProject.footer_link?.url || "",
        footer_link_text: selectedProject.footer_link?.text || "",
          google_verification: normalizeGoogleVerification(selectedProject.google_verification || ""),
      });
      setCustomDomain(selectedProject.custom_domain || "");
      setVerificationDeployed(false);
      const detected = detectPlatformFromDomain(selectedProject.domain);
      const resolvedPlatform = detected || selectedProject.hosting_platform || "vercel";
      setHostingPlatform(resolvedPlatform);
      // If detected platform differs from saved one — auto-correct in DB
      if (detected && selectedProject.hosting_platform !== detected) {
        supabase.from("projects").update({ hosting_platform: detected }).eq("id", selectedProject.id).then(() => {
          setProjects((prev) => prev.map((p) => p.id === selectedProject.id ? { ...p, hosting_platform: detected } : p));
        });
      }
      setInjectionLinks(selectedProject.injection_links || []);
    }
  }, [selectedProject]);

  const addDeployLog = (status: DeployStatus, message: string) => {
    setDeployLogs((prev) => [{ status, message, timestamp: new Date() }, ...prev].slice(0, 20));
  };

  const isGitHubConfigured = !!(selectedProject?.github_token && selectedProject?.github_repo);
  const isPlatformLocked = false;

  // Check repo status when project changes
  useEffect(() => {
    if (!selectedProjectId || !isGitHubConfigured) {
      setRepoStatus("idle");
      return;
    }
    let cancelled = false;
    (async () => {
      setRepoStatus("checking");
      setRepoError("");
      try {
        const { data, error } = await supabase.functions.invoke("bootstrap-astro", {
          body: { project_id: selectedProjectId, action: "check" },
        });
        if (cancelled) return;
        if (error) throw new Error(error.message);
        if (data?.status === "ready") {
          setRepoStatus("ready");
        } else if (data?.status === "empty") {
          setRepoStatus("empty");
        } else {
          setRepoStatus("error");
          setRepoError(data?.message || "Неизвестная ошибка");
        }
      } catch (err: any) {
        if (!cancelled) {
          setRepoStatus("error");
          setRepoError(err?.message || String(err));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedProjectId, isGitHubConfigured]);

  // Check Vercel link status when GitHub is configured
  useEffect(() => {
    if (!selectedProjectId || !isGitHubConfigured) {
      setVercelStatus("idle");
      setVercelError("");
      setVercelHint("");
      return;
    }
    let cancelled = false;
    (async () => {
      setVercelStatus("checking");
      try {
        const { data, error } = await supabase.functions.invoke("vercel-deploy", {
          body: { project_id: selectedProjectId, action: "check" },
        });
        if (cancelled) return;
        if (error) throw new Error(error.message);
        if (data?.status === "linked") {
          setVercelStatus("linked");
          setVercelDomain(data.domain || "");
        } else {
          setVercelStatus("not_linked");
        }
      } catch (err: any) {
        if (!cancelled) {
          setVercelStatus("error");
          setVercelError(err?.message || String(err));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedProjectId, isGitHubConfigured, repoStatus]);

  const handleVercelDeploy = async (action: "create" | "redeploy") => {
    if (!selectedProjectId) return;
    setVercelStatus("creating");
    setVercelError("");
    setVercelHint("");
    addDeployLog("publishing", lang === "ru" ? "Создание проекта на Vercel..." : "Creating Vercel project...");
    try {
      const { data, error } = await supabase.functions.invoke("vercel-deploy", {
        body: { project_id: selectedProjectId, action },
      });
      if (error) throw new Error(error.message);
      if (data?.error) {
        setVercelStatus("error");
        setVercelError(data.error);
        if (data.hint) setVercelHint(data.hint);
        addDeployLog("error", data.error);
        toast({
          title: lang === "ru" ? "Ошибка деплоя на Vercel" : "Vercel deploy error",
          description: data.error,
          variant: "destructive",
        });
        return;
      }
      setVercelStatus("linked");
      setVercelDomain(data?.domain || "");
      addDeployLog("success", lang === "ru" ? `Сайт задеплоен: https://${data?.domain}` : `Site deployed: https://${data?.domain}`);
      toast({
        title: lang === "ru" ? "Сайт на Vercel!" : "Site on Vercel!",
        description: data?.domain ? `https://${data.domain}` : (lang === "ru" ? "Деплой запущен" : "Deploy triggered"),
      });
      // Reload projects to get updated domain
      const { data: updated } = await supabase.from("projects").select(PROJECT_SELECT).eq("user_id", user!.id);
      if (updated) setProjects(updated as ProjectRow[]);
    } catch (err: any) {
      setVercelStatus("error");
      setVercelError(err?.message || String(err));
      addDeployLog("error", err?.message || String(err));
      toast({ title: lang === "ru" ? "Ошибка" : "Error", description: err?.message, variant: "destructive" });
    }
  };

  const handleInitRepo = async () => {
    if (!selectedProjectId) return;
    setRepoStatus("initializing");
    try {
      // Auto-fill color/font if empty
      const color = siteConfig.primary_color || randomAccentColor();
      const font = siteConfig.font_pair || randomFontPair();

      // Save site config to project first
      await supabase.from("projects").update({
        site_name: siteConfig.site_name || null,
        site_copyright: siteConfig.site_copyright || null,
        site_about: siteConfig.site_about || null,
        site_contacts: siteConfig.site_contacts || null,
        site_privacy: siteConfig.site_privacy || null,
        author_name: siteConfig.author_name || null,
        author_bio: siteConfig.author_bio || null,
        author_avatar: siteConfig.author_avatar || null,
        primary_color: color,
        font_pair: font,
        hosting_platform: hostingPlatform,
        injection_links: injectionLinks.length > 0 ? injectionLinks : [],
        footer_link: siteConfig.footer_link_url ? { url: siteConfig.footer_link_url, text: siteConfig.footer_link_text || siteConfig.footer_link_url } : null,
        google_verification: normalizeGoogleVerification(siteConfig.google_verification) || null,
      }).eq("id", selectedProjectId);

      // Update local state
      setSiteConfig((prev) => ({ ...prev, primary_color: color, font_pair: font }));

      const { data, error } = await supabase.functions.invoke("bootstrap-astro", {
        body: {
          project_id: selectedProjectId,
          action: "initialize",
          site_name: siteConfig.site_name || selectedProject?.name || "Blog",
          site_copyright: siteConfig.site_copyright || "",
          site_about: siteConfig.site_about || "",
          site_contacts: siteConfig.site_contacts || "",
          site_privacy: siteConfig.site_privacy || "",
          language: selectedProject?.language || "en",
          author_name: siteConfig.author_name || "",
          author_bio: siteConfig.author_bio || "",
          author_avatar: siteConfig.author_avatar || "",
          primary_color: color,
          font_pair: font,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.success) {
        setRepoStatus("ready");
        toast({ title: lang === "ru" ? "Сайт инициализирован!" : "Site initialized!", description: lang === "ru" ? "Шаблон Astro загружен. Vercel задеплоит сайт автоматически." : "Astro template uploaded. Vercel will deploy automatically." });
        // Reload projects to get updated config
        const { data: updated } = await supabase.from("projects").select(PROJECT_SELECT).eq("user_id", user!.id);
        if (updated) setProjects(updated as ProjectRow[]);
      } else {
        setRepoStatus("error");
        const failedFiles = data?.results?.filter((r: any) => r.status !== "ok") || [];
        setRepoError(failedFiles.map((f: any) => `${f.file}: ${f.status}`).join("; "));
        toast({ title: lang === "ru" ? "Ошибка инициализации" : "Init error", variant: "destructive" });
      }
    } catch (err: any) {
      setRepoStatus("error");
      setRepoError(err?.message || String(err));
      toast({ title: lang === "ru" ? "Ошибка" : "Error", description: err?.message, variant: "destructive" });
    }
  };

  // Deploy google verification to live site (re-init Layout.astro)
  const handleDeployVerification = async () => {
    const normalizedGoogleVerification = normalizeGoogleVerification(siteConfig.google_verification);
    if (!selectedProjectId || !normalizedGoogleVerification) return;
    setDeployingVerification(true);
    try {
      // Save verification code to DB
      await supabase.from("projects").update({
        google_verification: normalizedGoogleVerification,
      }).eq("id", selectedProjectId);

      setSiteConfig((prev) => ({ ...prev, google_verification: normalizedGoogleVerification }));

      // Re-init to push updated Layout.astro with the meta tag
      const { data, error } = await supabase.functions.invoke("bootstrap-astro", {
        body: {
          project_id: selectedProjectId,
          action: "initialize",
          site_name: siteConfig.site_name || selectedProject?.name || "Blog",
          site_copyright: siteConfig.site_copyright || "",
          site_about: siteConfig.site_about || "",
          site_contacts: siteConfig.site_contacts || "",
          site_privacy: siteConfig.site_privacy || "",
          language: selectedProject?.language || "en",
          author_name: siteConfig.author_name || "",
          author_bio: siteConfig.author_bio || "",
          author_avatar: siteConfig.author_avatar || "",
          primary_color: siteConfig.primary_color || "",
          font_pair: siteConfig.font_pair || "",
        },
      });
      if (error) throw new Error(error.message);
      if (data?.success) {
        setVerificationDeployed(true);
        toast({ title: lang === "ru" ? "Верификация задеплоена!" : "Verification deployed!", description: lang === "ru" ? "Мета-тег и HTML-файл верификации добавлены на сайт" : "Meta tag and verification HTML file pushed to site" });
      } else {
        throw new Error("Deploy failed");
      }
    } catch (err: any) {
      toast({ title: lang === "ru" ? "Ошибка деплоя" : "Deploy error", description: err?.message, variant: "destructive" });
    } finally {
      setDeployingVerification(false);
    }
  };

  const handleDeleteArticle = async (articleId: string) => {
    const { error } = await supabase.from("articles").delete().eq("id", articleId);
    if (error) {
      toast({ title: lang === "ru" ? "Ошибка удаления" : "Delete error", description: error.message, variant: "destructive" });
    } else {
      setArticles((prev) => prev.filter((a) => a.id !== articleId));
      toast({ title: lang === "ru" ? "Статья удалена" : "Article deleted" });
    }
  };

  const handleOpenEdit = (article: QueueArticle) => {
    setEditingArticle(article);
    setEditTitle(article.title || "");
    setEditContent(article.content || "");
    setEditMeta(article.meta_description || "");
  };

  const handleSaveEdit = async () => {
    if (!editingArticle) return;
    setSavingEdit(true);
    const { error } = await supabase
      .from("articles")
      .update({ title: editTitle, content: editContent, meta_description: editMeta })
      .eq("id", editingArticle.id);
    setSavingEdit(false);
    if (error) {
      toast({ title: lang === "ru" ? "Ошибка сохранения" : "Save error", description: error.message, variant: "destructive" });
    } else {
      setArticles((prev) => prev.map((a) => a.id === editingArticle.id ? { ...a, title: editTitle, content: editContent, meta_description: editMeta } : a));
      setEditingArticle(null);
      toast({ title: lang === "ru" ? "Статья обновлена" : "Article updated" });
    }
  };

  // Load unassigned articles for import
  const loadUnassignedArticles = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("articles")
      .select("id, title, content, meta_description, status, published_url, keywords, created_at")
      .eq("user_id", user.id)
      .is("project_id", null)
      .in("status", ["completed", "published"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setUnassignedArticles(data);
  }, [user]);

  const handleImportArticle = async (articleId: string) => {
    if (!selectedProjectId) return;
    setImportingIds(prev => new Set(prev).add(articleId));
    const { error } = await supabase
      .from("articles")
      .update({ project_id: selectedProjectId })
      .eq("id", articleId);
    if (error) {
      toast({ title: lang === "ru" ? "Ошибка привязки" : "Import error", description: error.message, variant: "destructive" });
    } else {
      setUnassignedArticles(prev => prev.filter(a => a.id !== articleId));
      loadArticles();
      toast({ title: lang === "ru" ? "Статья добавлена в проект" : "Article added to project" });
    }
    setImportingIds(prev => { const n = new Set(prev); n.delete(articleId); return n; });
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select(PROJECT_SELECT)
        .eq("user_id", user.id);
      if (data) setProjects(data as ProjectRow[]);
    })();
  }, [user]);

  // Load author profiles (own + presets)
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("author_profiles")
        .select("id, name, type, avatar_icon")
        .or(`user_id.eq.${user.id},type.eq.preset`)
        .order("name");
      if (data) setAuthorProfiles(data);
    })();
  }, [user]);

  // Load articles for selected project
  const loadArticles = useCallback(async () => {
    if (!user || !selectedProjectId) { setArticles([]); return; }
    const { data } = await supabase
      .from("articles")
      .select("id, title, content, meta_description, status, published_url, keywords, created_at")
      .eq("user_id", user.id)
      .eq("project_id", selectedProjectId)
      .in("status", ["completed", "published", "generating"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setArticles(data);
  }, [user, selectedProjectId]);

  useEffect(() => { loadArticles(); }, [loadArticles]);

  // Load indexing status for articles
  useEffect(() => {
    if (!user || articles.length === 0) { setIndexedArticleIds(new Set()); return; }
    const articleIds = articles.map((a) => a.id);
    (async () => {
      const { data } = await supabase
        .from("indexing_logs")
        .select("article_id")
        .eq("user_id", user.id)
        .eq("status", "success")
        .in("article_id", articleIds);
      if (data) {
        setIndexedArticleIds(new Set(data.map((d: any) => d.article_id)));
      }
    })();
  }, [user, articles]);

  // Realtime subscription for article updates
  useEffect(() => {
    if (!user || !selectedProjectId) return;
    const channel = supabase
      .channel(`factory-articles-${selectedProjectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "articles",
          filter: `project_id=eq.${selectedProjectId}`,
        },
        (payload) => {
          const updated = payload.new as QueueArticle & { user_id?: string };
          if (updated?.user_id && updated.user_id !== user.id) return;

          if (payload.eventType === "INSERT") {
            setArticles((prev) => {
              if (prev.find((a) => a.id === updated.id)) return prev;
              return [updated, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            setArticles((prev) =>
              prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a))
            );
            // Remove from generatingIds when completed
            if (updated.status === "completed" || updated.status === "published") {
              setGeneratingIds((prev) => {
                const next = new Set(prev);
                next.delete(updated.id);
                return next;
              });
            }
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id: string };
            setArticles((prev) => prev.filter((a) => a.id !== old.id));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, selectedProjectId]);

  // Load stats
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { count: sites } = await supabase
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      setTotalSites(sites ?? 0);

      const { count: arts } = await supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .in("status", ["completed", "published"]);
      setTotalArticles(arts ?? 0);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { count: pub } = await supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "published")
        .gte("updated_at", today.toISOString());
      setTodayPublished(pub ?? 0);
    })();
  }, [user, articles]);

  // Parse SSE stream and return full content
  const parseSSEStream = async (response: Response): Promise<string> => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) fullContent += delta;
        } catch { /* skip malformed chunks */ }
      }
    }
    return fullContent;
  };

  const handleGenerate = async () => {
    if (!selectedProjectId || !keywords.trim() || !user) return;
    setGenerating(true);
    try {
      const kws = keywords.split("\n").map((k) => k.trim()).filter(Boolean);
      const selectedProj = projects.find((p) => p.id === selectedProjectId);

      // Detect language from keyword text (Cyrillic = ru), not from domain
      const detectLang = (text: string): string => {
        if (/[а-яА-ЯёЁ]/.test(text)) return "ru";
        if (/[äöüßÄÖÜ]/.test(text)) return "de";
        if (/[àâéèêëïîôùûüÿçœæ]/i.test(text)) return "fr";
        if (/[áéíóúñ¿¡]/i.test(text)) return "es";
        if (/[ãõçâêô]/i.test(text)) return "pt";
        return "en";
      };
      const defaultLang = selectedProj?.language || "en";

      for (const kw of kws) {
        // Detect language per keyword
        const kwLang = detectLang(kw) || defaultLang;
        const geoMap: Record<string, string> = { ru: "RU", en: "US", de: "DE", fr: "FR", es: "ES", pt: "BR" };
        const kwGeo = geoMap[kwLang] || "US";

        // 1. Create keyword record
        const { data: kwRecord, error: kwErr } = await supabase
          .from("keywords")
          .insert({
            user_id: user.id,
            seed_keyword: kw,
            language: kwLang,
            geo: kwGeo,
          })
          .select("id")
          .single();
        if (kwErr || !kwRecord) {
          console.error("Failed to create keyword:", kwErr);
          continue;
        }

        // 2. Create article record with status "generating"
        const { data: artRecord, error: artErr } = await supabase
          .from("articles")
          .insert({
            user_id: user.id,
            keyword_id: kwRecord.id,
            project_id: selectedProjectId,
            title: kw,
            status: "generating",
            language: kwLang,
            geo: kwGeo,
            keywords: [kw],
            author_profile_id: selectedAuthorId && selectedAuthorId !== "none" ? selectedAuthorId : null,
          })
          .select("id")
          .single();
        if (artErr || !artRecord) {
          console.error("Failed to create article:", artErr);
          continue;
        }

        setGeneratingIds((prev) => new Set(prev).add(artRecord.id));

        // 3. Call generate-article edge function (in background)
        (async () => {
          try {
            const { data: session } = await supabase.auth.getSession();
            const token = session?.session?.access_token;
            if (!token) return;

            const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
            const res = await fetch(
              `https://${projectId}.supabase.co/functions/v1/generate-article`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  keyword_id: kwRecord.id,
                  project_id: selectedProjectId,
                  language: kwLang,
                }),
              }
            );

            if (!res.ok) {
              const errText = await res.text();
              console.error("generate-article error:", errText);
              
              // Parse error message for user-friendly display
              let errorMsg = lang === "ru" ? "Ошибка генерации статьи" : "Article generation failed";
              try {
                const errJson = JSON.parse(errText);
                if (errJson.error?.includes("credits exhausted") || res.status === 402) {
                  errorMsg = lang === "ru" 
                    ? "Недостаточно кредитов для генерации. Пополните баланс." 
                    : "Not enough credits. Please top up your balance.";
                } else if (errJson.error) {
                  errorMsg = errJson.error;
                }
              } catch { /* use default */ }
              
              toast({ title: errorMsg, variant: "destructive" });
              
              // Delete the empty article record instead of leaving as draft
              await supabase.from("articles").delete().eq("id", artRecord.id);
              setGeneratingIds((prev) => {
                const next = new Set(prev);
                next.delete(artRecord.id);
                return next;
              });
              return;
            }

            // 4. Parse SSE stream
            const content = await parseSSEStream(res);

            // 5. Extract title from first H1
            let title = kw;
            const h1Match = content.match(/^#\s+(.+)$/m);
            if (h1Match) title = h1Match[1].trim();

            // 6. Extract meta description (first paragraph after title)
            let metaDesc = "";
            const paragraphs = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
            if (paragraphs.length > 0) {
              metaDesc = paragraphs[0].replace(/\*\*/g, "").replace(/\*/g, "").substring(0, 160);
            }

            // 7. Update article with content
            await supabase
              .from("articles")
              .update({
                content,
                title,
                meta_description: metaDesc,
                status: "completed",
              })
              .eq("id", artRecord.id);

            // Deduct credit
            await supabase.rpc("deduct_credit", { p_user_id: user.id });

            setGeneratingIds((prev) => {
              const next = new Set(prev);
              next.delete(artRecord.id);
              return next;
            });
          } catch (err) {
            console.error("Background generation error:", err);
            toast({ 
              title: lang === "ru" ? "Ошибка генерации" : "Generation error", 
              description: String(err),
              variant: "destructive" 
            });
            await supabase.from("articles").delete().eq("id", artRecord.id);
            setGeneratingIds((prev) => {
              const next = new Set(prev);
              next.delete(artRecord.id);
              return next;
            });
          }
        })();
      }

      toast({
        title: lang === "ru" ? "Генерация запущена" : "Generation started",
        description: lang === "ru" ? `${kws.length} статей в очереди` : `${kws.length} articles queued`,
      });
      setKeywords("");
    } catch {
      toast({ title: lang === "ru" ? "Ошибка генерации" : "Generation error", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const platformLabel = HOSTING_PLATFORMS.find((p) => p.value === hostingPlatform)?.label || "Vercel";

  const triggerCloudflare = async () => {
    if (hostingPlatform !== "cloudflare" || !selectedProjectId) return;
    addDeployLog("publishing", lang === "ru" ? "Запуск деплоя на Cloudflare Pages..." : "Triggering Cloudflare Pages deploy...");
    try {
      const { data: cfData, error: cfErr } = await supabase.functions.invoke("deploy-cloudflare", {
        body: { project_id: selectedProjectId },
      });
      if (cfErr) throw cfErr;

      // Handle name conflict
      if (cfData?.error === "name_conflict") {
        addDeployLog("error", `Cloudflare: ${cfData.message}`);
        toast({
          title: lang === "ru" ? "Имя занято" : "Name taken",
          description: lang === "ru"
            ? `Проект "${cfData.project_name}" уже существует на Cloudflare. Измените название проекта в настройках.`
            : cfData.message,
          variant: "destructive",
        });
        return;
      }

      if (cfData?.error) {
        addDeployLog("error", `Cloudflare: ${cfData.error}`);
        toast({ title: "Cloudflare Error", description: cfData.error, variant: "destructive" });
        return;
      }

      // Update project domain with correct pages.dev URL (don't touch custom_domain)
      if (cfData?.project_name && selectedProjectId) {
        const pagesDevDomain = `https://${cfData.project_name}.pages.dev/blog`;
        await supabase
          .from("projects")
          .update({ domain: pagesDevDomain })
          .eq("id", selectedProjectId);

        setProjects((prev) =>
          prev.map((p) =>
            p.id === selectedProjectId ? { ...p, domain: pagesDevDomain } : p
          )
        );
      }

      const msg = cfData?.message || (lang === "ru" ? "Деплой запущен" : "Deploy triggered");
      addDeployLog("success", `Cloudflare: ${msg}`);
      toast({ title: "Cloudflare Pages", description: msg });
    } catch (err: any) {
      addDeployLog("error", `Cloudflare: ${err?.message || String(err)}`);
      toast({ title: "Cloudflare Error", description: err?.message || String(err), variant: "destructive" });
    }
  };

  const handlePublish = async (article: QueueArticle) => {
    if (!selectedProjectId || !article.content) return;
    setPublishing(article.id);
    addDeployLog("publishing", lang === "ru" ? `Публикация: ${article.title}...` : `Publishing: ${article.title}...`);
    try {
      const { data, error } = await supabase.functions.invoke("publish-github", {
        body: {
          article_id: article.id,
          project_id: selectedProjectId,
          generate_images: generateImages,
          image_count: imageCount,
          author_profile_id: selectedAuthorId && selectedAuthorId !== "none" ? selectedAuthorId : null,
        },
      });
      if (error) throw error;
      if (data?.error) {
        addDeployLog("error", data.error);
        toast({
          title: lang === "ru" ? "Ошибка GitHub API" : "GitHub API Error",
          description: data.error,
          variant: "destructive",
        });
        return;
      }
      addDeployLog("success", lang === "ru" ? `Сайт на ${platformLabel} обновлен - ${article.title}` : `Site on ${platformLabel} updated - ${article.title}`);
      toast({
        title: lang === "ru" ? "Статья опубликована!" : "Article published!",
        description: lang === "ru" ? `Сборка на ${platformLabel}...` : `Building on ${platformLabel}...`,
      });
      setArticles((prev) =>
        prev.map((a) =>
          a.id === article.id ? { ...a, status: "published", published_url: data?.url ?? a.published_url } : a
        )
      );
      // Trigger Cloudflare deploy if applicable
      await triggerCloudflare();
    } catch (err: any) {
      addDeployLog("error", err?.message || String(err));
      toast({
        title: lang === "ru" ? "Ошибка публикации" : "Publish error",
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setPublishing(null);
    }
  };

  const handleBatchPublish = async () => {
    if (!selectedProjectId || selectedIds.size === 0) return;
    setBatchPublishing(true);
    addDeployLog("publishing", lang === "ru" ? `Пакетная публикация ${selectedIds.size} статей...` : `Batch publishing ${selectedIds.size} articles...`);
    try {
      const ids = Array.from(selectedIds);
      const { data, error } = await supabase.functions.invoke("publish-github", {
        body: {
          article_ids: ids,
          project_id: selectedProjectId,
          generate_images: generateImages,
          image_count: imageCount,
          author_profile_id: selectedAuthorId && selectedAuthorId !== "none" ? selectedAuthorId : null,
        },
      });
      if (error) throw error;
      if (data?.error) {
        addDeployLog("error", data.error);
        toast({ title: lang === "ru" ? "Ошибка пакетной публикации" : "Batch publish error", description: data.error, variant: "destructive" });
        return;
      }
      addDeployLog("success", lang === "ru" ? `Сайт на ${platformLabel} обновлен - ${data?.published || ids.length} статей одним коммитом` : `Site on ${platformLabel} updated - ${data?.published || ids.length} articles in one commit`);
      toast({
        title: lang === "ru" ? `Опубликовано ${data?.published || ids.length} статей одним коммитом` : `Published ${data?.published || ids.length} articles in one commit`,
        description: lang === "ru" ? `${platformLabel} запустит только одну сборку` : `${platformLabel} will trigger only one build`,
      });
      const publishedUrls = new Map((data?.results || []).map((r: any) => [r.articleId, r.url]));
      setArticles((prev) =>
        prev.map((a) =>
          selectedIds.has(a.id)
            ? { ...a, status: "published", published_url: (publishedUrls.get(a.id) as string) ?? a.published_url }
            : a
        )
      );
      setSelectedIds(new Set());
      // Trigger Cloudflare deploy if applicable
      await triggerCloudflare();
    } catch (err: any) {
      addDeployLog("error", err?.message || String(err));
      toast({
        title: lang === "ru" ? "Ошибка пакетной публикации" : "Batch publish error",
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setBatchPublishing(false);
    }
  };

  const toggleSelectArticle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const publishableArticles = articles.filter(
    (a) => (a.status === "completed" || a.status === "published") && a.content && !generatingIds.has(a.id)
  );

  const toggleSelectAll = () => {
    if (selectedIds.size === publishableArticles.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(publishableArticles.map((a) => a.id)));
    }
  };

  const renderMarkdownPreview = (content: string) => {
    let html = content
      // Tables
      .replace(/^\|(.+)\|\s*\n\|[-| :]+\|\s*\n((?:\|.+\|\s*\n?)*)/gm, (_match, header, body) => {
        const headers = header.split('|').map((h: string) => h.trim()).filter(Boolean);
        const rows = body.trim().split('\n').map((r: string) =>
          r.split('|').map((c: string) => c.trim()).filter(Boolean)
        );
        return `<table><thead><tr>${headers.map((h: string) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r: string[], i: number) => `<tr${i % 2 === 1 ? ' style="background:#f9fafb"' : ''}>${r.map((c: string) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      })
      .replace(/^### (.*$)/gim, "<h3>$1</h3>")
      .replace(/^## (.*$)/gim, "<h2>$1</h2>")
      .replace(/^# (.*$)/gim, "<h1>$1</h1>")
      .replace(/^> (.*$)/gim, "<blockquote>$1</blockquote>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/^\d+\.\s(.+)$/gim, "<li>$1</li>")
      .replace(/^- (.+)$/gim, "<li>$1</li>")
      .replace(/\n/g, "<br/>");
    return DOMPurify.sanitize(html);
  };

  const getStatusBadge = (article: QueueArticle) => {
    const isGenerating = generatingIds.has(article.id) || article.status === "generating";
    const isIndexed = indexedArticleIds.has(article.id);
    
    const indexIcon = article.status === "published" ? (
      <Zap className={`h-3 w-3 ml-1 ${isIndexed ? "text-green-400" : "text-muted-foreground/50"}`} />
    ) : null;

    if (isGenerating) {
      return (
        <Badge variant="secondary" className="text-xs animate-pulse bg-primary/20 text-primary">
          {lang === "ru" ? "Генерируется..." : "Generating..."}
        </Badge>
      );
    }
    if (article.status === "published") {
      return (
        <span className="inline-flex items-center gap-0.5">
          <Badge variant="default" className="text-xs">
            {lang === "ru" ? "Опубликовано" : "Published"}
          </Badge>
          {indexIcon}
        </span>
      );
    }
    if (article.status === "completed") {
      return (
        <Badge variant="secondary" className="text-xs bg-green-500/20 text-green-400">
          {lang === "ru" ? "Готово к публикации" : "Ready to publish"}
        </Badge>
      );
    }
    if (article.status === "failed") {
      return (
        <Badge variant="destructive" className="text-xs">
          {lang === "ru" ? "Ошибка" : "Failed"}
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="text-xs">
        {article.status ?? "draft"}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Factory className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">
            {lang === "ru" ? "Фабрика сайтов" : "Site Factory"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {lang === "ru" ? "Массовая генерация и публикация контента" : "Bulk content generation and publishing"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {PUBLISH_DESTINATIONS.map(({ label, icon: Icon }) => (
          <div
            key={label}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground shadow-sm transition-colors hover:bg-accent/40"
          >
            <Icon className="h-4 w-4 text-primary" />
            <span className="font-medium">{label}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <Globe className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{totalSites}</p>
              <p className="text-sm text-muted-foreground">
                {lang === "ru" ? "Сайтов в сети" : "Sites online"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <FileText className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{totalArticles}</p>
              <p className="text-sm text-muted-foreground">
                {lang === "ru" ? "Статей готово" : "Articles ready"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <Upload className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{todayPublished}</p>
              <p className="text-sm text-muted-foreground">
                {lang === "ru" ? "Опубликовано сегодня" : "Published today"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Control */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {lang === "ru" ? "Управление" : "Controls"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                {lang === "ru" ? "Проект" : "Project"}
              </label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder={lang === "ru" ? "Выберите проект..." : "Select project..."} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} {p.domain ? `(${p.domain})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Hosting Platform Selector */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                {lang === "ru" ? "Платформа хостинга" : "Hosting platform"}
              </label>
              <Select
                value={hostingPlatform}
                onValueChange={async (v) => {
                  if (isPlatformLocked) return;
                  setHostingPlatform(v);
                  if (selectedProjectId) {
                    await supabase.from("projects").update({ hosting_platform: v }).eq("id", selectedProjectId);
                    setProjects((prev) => prev.map((project) => project.id === selectedProjectId ? { ...project, hosting_platform: v } : project));
                  }
                }}
                disabled={!selectedProjectId || isPlatformLocked}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOSTING_PLATFORMS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedProjectId && isPlatformLocked && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {lang === "ru"
                    ? "Для этого проекта зафиксирован Cloudflare Pages по умолчанию."
                    : "Cloudflare Pages is locked as the default hosting platform for this project."}
                </p>
              )}
            </div>

            {selectedProjectId && (
              <div className={`rounded-md border p-3 text-sm ${isGitHubConfigured ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
                {isGitHubConfigured
                  ? (lang === "ru" ? "Сайт готов к работе" : "Site ready")
                  : (lang === "ru" ? "Проект не настроен в Админ-панели" : "Project is not configured in Admin")}
              </div>
            )}
            {/* Author Profile Selector */}
            {authorProfiles.length > 0 && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  {lang === "ru" ? "Профиль автора" : "Author profile"}
                </label>
                <Select value={selectedAuthorId} onValueChange={setSelectedAuthorId}>
                  <SelectTrigger>
                    <SelectValue placeholder={lang === "ru" ? "По умолчанию (случайный)" : "Default (random)"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      {lang === "ru" ? "По умолчанию (случайный)" : "Default (random)"}
                    </SelectItem>
                    {authorProfiles.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedProjectId && !isGitHubConfigured && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {lang === "ru"
                  ? "Проект не настроен в Админ-панели"
                  : "Project is not configured in Admin"}
              </div>
            )}

            {selectedProjectId && isGitHubConfigured && (
              <div className={`rounded-md border p-3 text-sm flex items-center justify-between gap-2 ${
                repoStatus === "ready" ? "border-green-500/30 bg-green-500/10 text-green-400" :
                repoStatus === "empty" ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400" :
                repoStatus === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" :
                repoStatus === "checking" || repoStatus === "initializing" ? "border-primary/30 bg-primary/10 text-primary" :
                "border-border"
              }`}>
                <div className="flex items-center gap-2">
                  {repoStatus === "checking" && <Loader2 className="h-4 w-4 animate-spin" />}
                  {repoStatus === "initializing" && <Loader2 className="h-4 w-4 animate-spin" />}
                  {repoStatus === "ready" && <CheckCircle className="h-4 w-4" />}
                  {repoStatus === "empty" && <AlertCircle className="h-4 w-4" />}
                  {repoStatus === "error" && <AlertCircle className="h-4 w-4" />}
                  <span>
                    {repoStatus === "checking" && (lang === "ru" ? "Проверка репозитория..." : "Checking repo...")}
                    {repoStatus === "initializing" && (lang === "ru" ? "Инициализация сайта..." : "Initializing site...")}
                    {repoStatus === "ready" && (lang === "ru" ? "Сайт готов к работе" : "Site ready")}
                    {repoStatus === "empty" && (lang === "ru" ? "Пустой репозиторий - требуется инициализация" : "Empty repo - needs initialization")}
                    {repoStatus === "error" && (repoError || (lang === "ru" ? "Ошибка проверки" : "Check error"))}
                  </span>
                </div>
                {repoStatus === "empty" && (
                  <Button size="sm" variant="outline" onClick={handleInitRepo} className="shrink-0">
                    <Rocket className="h-3 w-3 mr-1" />
                    {lang === "ru" ? "Инициализировать" : "Initialize"}
                  </Button>
                )}
              </div>
            )}

            {/* Vercel one-click deploy - visible when GitHub is set up and repo is ready */}
            {selectedProjectId && isGitHubConfigured && repoStatus === "ready" && (
              <div className={`rounded-md border p-3 text-sm flex flex-col gap-2 ${
                vercelStatus === "linked" ? "border-green-500/30 bg-green-500/10 text-green-400" :
                vercelStatus === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" :
                vercelStatus === "creating" || vercelStatus === "checking" ? "border-primary/30 bg-primary/10 text-primary" :
                "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
              }`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    {(vercelStatus === "checking" || vercelStatus === "creating") && <Loader2 className="h-4 w-4 animate-spin" />}
                    {vercelStatus === "linked" && <CheckCircle className="h-4 w-4" />}
                    {vercelStatus === "not_linked" && <Cloud className="h-4 w-4" />}
                    {vercelStatus === "error" && <AlertCircle className="h-4 w-4" />}
                    <span>
                      {vercelStatus === "checking" && (lang === "ru" ? "Проверка Vercel..." : "Checking Vercel...")}
                      {vercelStatus === "creating" && (lang === "ru" ? "Деплой на Vercel..." : "Deploying to Vercel...")}
                      {vercelStatus === "linked" && (lang === "ru" ? "Сайт на Vercel" : "Live on Vercel")}
                      {vercelStatus === "not_linked" && (lang === "ru" ? "Готов к деплою на Vercel в 1 клик" : "Ready for one-click Vercel deploy")}
                      {vercelStatus === "error" && (vercelError || (lang === "ru" ? "Ошибка Vercel" : "Vercel error"))}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {vercelStatus === "linked" && vercelDomain && (
                      <a
                        href={`https://${vercelDomain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs underline hover:opacity-80"
                      >
                        <ExternalLink className="h-3 w-3" /> {vercelDomain}
                      </a>
                    )}
                    {vercelStatus === "not_linked" && (
                      <Button size="sm" variant="outline" onClick={() => handleVercelDeploy("create")} className="shrink-0">
                        <Rocket className="h-3 w-3 mr-1" />
                        {lang === "ru" ? "Деплой в 1 клик" : "Deploy in 1 click"}
                      </Button>
                    )}
                    {vercelStatus === "linked" && (
                      <Button size="sm" variant="outline" onClick={() => handleVercelDeploy("redeploy")} className="shrink-0">
                        <Zap className="h-3 w-3 mr-1" />
                        {lang === "ru" ? "Обновить" : "Redeploy"}
                      </Button>
                    )}
                    {vercelStatus === "error" && (
                      <Button size="sm" variant="outline" onClick={() => handleVercelDeploy("create")} className="shrink-0">
                        {lang === "ru" ? "Повторить" : "Retry"}
                      </Button>
                    )}
                  </div>
                </div>
                {vercelHint && (
                  <p className="text-xs opacity-90 break-words">
                    {lang === "ru" ? "Подсказка: " : "Hint: "}{vercelHint}
                  </p>
                )}
              </div>
            )}

            {/* Site Config Form - shown when repo needs initialization or is ready */}
            {selectedProjectId && isGitHubConfigured && (repoStatus === "empty" || repoStatus === "ready") && (
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-medium">
                    {lang === "ru" ? "Настройки сайта и служебные страницы" : "Site settings & service pages"}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    disabled={aiFillLoading}
                    onClick={async () => {
                      if (!selectedProject) return;
                      setAiFillLoading(true);
                      try {
                        const { data, error } = await supabase.functions.invoke("generate-site-config", {
                          body: {
                            domain: selectedProject.domain,
                            project_name: selectedProject.name,
                            language: selectedProject.language || lang,
                            topic: selectedProject.name,
                          },
                        });
                        if (error) throw error;
                        const c = data?.config;
                        if (!c) throw new Error("Empty response");
                        setSiteConfig((prev) => ({
                          ...prev,
                          site_name: c.site_name || prev.site_name,
                          site_about: c.site_about || prev.site_about,
                          site_copyright: c.site_copyright || prev.site_copyright,
                          site_contacts: c.site_contacts || prev.site_contacts,
                          site_privacy: c.site_privacy || prev.site_privacy,
                          author_name: c.author_name || prev.author_name,
                          author_bio: c.author_bio || prev.author_bio,
                          author_avatar: c.author_avatar || prev.author_avatar,
                        }));
                        toast({ title: lang === "ru" ? "Поля заполнены AI" : "Filled by AI" });
                      } catch (e) {
                        toast({
                          title: lang === "ru" ? "Ошибка генерации" : "Generation error",
                          description: e instanceof Error ? e.message : String(e),
                          variant: "destructive",
                        });
                      } finally {
                        setAiFillLoading(false);
                      }
                    }}
                  >
                    {aiFillLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Shuffle className="h-3 w-3 mr-1" />}
                    {lang === "ru" ? "Заполнить через AI" : "Fill with AI"}
                  </Button>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    {lang === "ru" ? "Название сайта" : "Site name"}
                  </label>
                  <Input
                    value={siteConfig.site_name}
                    onChange={(e) => setSiteConfig((prev) => ({ ...prev, site_name: e.target.value }))}
                    placeholder={lang === "ru" ? "Мой SEO-блог" : "My SEO Blog"}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    {lang === "ru" ? "Страница «О нас» (контент)" : "About page content"}
                  </label>
                  <Textarea
                    value={siteConfig.site_about}
                    onChange={(e) => setSiteConfig((prev) => ({ ...prev, site_about: e.target.value }))}
                    rows={2}
                    placeholder={lang === "ru" ? "Мы - команда экспертов..." : "We are a team of experts..."}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    {lang === "ru" ? "Копирайт (футер)" : "Copyright (footer)"}
                  </label>
                  <Input
                    value={siteConfig.site_copyright}
                    onChange={(e) => setSiteConfig((prev) => ({ ...prev, site_copyright: e.target.value }))}
                    placeholder={lang === "ru" ? "Мой Бренд" : "My Brand"}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    {lang === "ru" ? "Контакты (контент страницы)" : "Contacts page content"}
                  </label>
                  <Textarea
                    value={siteConfig.site_contacts}
                    onChange={(e) => setSiteConfig((prev) => ({ ...prev, site_contacts: e.target.value }))}
                    rows={2}
                    placeholder={lang === "ru" ? "Email: info@example.com, Телефон: +7..." : "Email: info@example.com, Phone: +1..."}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    {lang === "ru" ? "Политика конфиденциальности" : "Privacy policy content"}
                  </label>
                  <Textarea
                    value={siteConfig.site_privacy}
                    onChange={(e) => setSiteConfig((prev) => ({ ...prev, site_privacy: e.target.value }))}
                    rows={2}
                    placeholder={lang === "ru" ? "Настоящая политика определяет порядок обработки..." : "This policy defines the processing procedures..."}
                  />
                </div>

                {/* Author fields */}
                <div className="border-t border-border pt-3 mt-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                    <User className="h-3 w-3" />
                    {lang === "ru" ? "Автор сайта" : "Site author"}
                  </p>
                  <div className="space-y-2">
                    <Input
                      value={siteConfig.author_name}
                      onChange={(e) => setSiteConfig((prev) => ({ ...prev, author_name: e.target.value }))}
                      placeholder={lang === "ru" ? "Дмитрий Соколов" : "John Smith"}
                    />
                    <Input
                      value={siteConfig.author_bio}
                      onChange={(e) => setSiteConfig((prev) => ({ ...prev, author_bio: e.target.value }))}
                      placeholder={lang === "ru" ? "SEO-эксперт с 10-летним стажем" : "SEO expert with 10 years experience"}
                    />
                    <div className="flex gap-2">
                      <Input
                        value={siteConfig.author_avatar}
                        onChange={(e) => setSiteConfig((prev) => ({ ...prev, author_avatar: e.target.value }))}
                        placeholder={lang === "ru" ? "URL аватара (необязательно)" : "Avatar URL (optional)"}
                        className="flex-1"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        onClick={() => {
                          const randomId = Math.floor(Math.random() * 70) + 1;
                          const gender = Math.random() > 0.5 ? "men" : "women";
                          setSiteConfig((prev) => ({ ...prev, author_avatar: `https://randomuser.me/api/portraits/${gender}/${randomId}.jpg` }));
                        }}
                      >
                        <Shuffle className="h-3 w-3 mr-1" />
                        {lang === "ru" ? "Случайное" : "Random"}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Color & Font */}
                <div className="border-t border-border pt-3 mt-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    {lang === "ru" ? "Дизайн (Anti-Footprint)" : "Design (Anti-Footprint)"}
                  </p>
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        {lang === "ru" ? "Акцентный цвет" : "Accent color"}
                      </label>
                      <div className="flex gap-2 items-center">
                        <div className="flex gap-1 flex-wrap flex-1">
                          {ACCENT_COLORS.map((c) => (
                            <button
                              key={c.value}
                              type="button"
                              onClick={() => setSiteConfig((prev) => ({ ...prev, primary_color: c.value }))}
                              className={`w-7 h-7 rounded-lg border-2 transition-all ${siteConfig.primary_color === c.value ? "border-foreground scale-110" : "border-transparent"}`}
                              style={{ backgroundColor: c.value }}
                              title={c.label}
                            />
                          ))}
                        </div>
                        <Button size="sm" variant="ghost" type="button" onClick={() => setSiteConfig((prev) => ({ ...prev, primary_color: randomAccentColor() }))}>
                          <Shuffle className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        {lang === "ru" ? "Пара шрифтов" : "Font pair"}
                      </label>
                      <Select value={siteConfig.font_pair} onValueChange={(v) => setSiteConfig((prev) => ({ ...prev, font_pair: v }))}>
                        <SelectTrigger>
                          <SelectValue placeholder={lang === "ru" ? "Случайная пара" : "Random pair"} />
                        </SelectTrigger>
                        <SelectContent>
                          {FONT_PAIRS.map((f) => (
                            <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Footer Link */}
                <div className="border-t border-border pt-3 mt-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Link2 className="h-3 w-3" />
                    {lang === "ru" ? "Сквозная ссылка в подвале" : "Footer link (site-wide)"}
                  </p>
                  <div className="space-y-2">
                    <Input
                      value={siteConfig.footer_link_url}
                      onChange={(e) => setSiteConfig((prev) => ({ ...prev, footer_link_url: e.target.value }))}
                      placeholder="https://example.com"
                    />
                    <Input
                      value={siteConfig.footer_link_text}
                      onChange={(e) => setSiteConfig((prev) => ({ ...prev, footer_link_text: e.target.value }))}
                      placeholder={lang === "ru" ? "Текст ссылки" : "Link text"}
                    />
                </div>

                {/* Google Verification */}
                <div className="border-t border-border pt-3 mt-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                    <ShieldCheck className="h-3 w-3" />
                    {lang === "ru" ? "Google Search Console" : "Google Search Console"}
                  </p>
                  <div className="space-y-2">
                    <Input
                      value={siteConfig.google_verification}
                      onChange={(e) => setSiteConfig((prev) => ({ ...prev, google_verification: e.target.value }))}
                      placeholder={lang === "ru" ? "Вставьте код из мета-тега google-site-verification" : "Paste code from google-site-verification meta tag"}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {lang === "ru"
                        ? "Код добавится в <head> и как HTML-файл в корень сайта (google{код}.html)"
                        : "Code will be injected into <head> and as HTML file at site root (google{code}.html)"}
                    </p>
                    <div className="flex items-center gap-2">
                      {siteConfig.google_verification ? (
                        <>
                          {verificationDeployed ? (
                            <Badge className="gap-1 text-[10px] bg-green-600 hover:bg-green-700 text-white">
                              <CheckCircle className="h-3 w-3" />
                              {lang === "ru" ? "Задеплоен на сайт" : "Deployed to site"}
                            </Badge>
                          ) : (
                            <Badge variant="default" className="gap-1 text-[10px]">
                              <CheckCircle className="h-3 w-3" />
                              {lang === "ru" ? "Код указан" : "Code set"}
                            </Badge>
                          )}
                          {repoStatus === "ready" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] gap-1"
                              disabled={deployingVerification}
                              onClick={handleDeployVerification}
                            >
                              {deployingVerification ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                              {lang === "ru" ? "Задеплоить на сайт" : "Deploy to site"}
                            </Button>
                          )}
                        </>
                      ) : (
                        <Badge variant="secondary" className="gap-1 text-[10px]">
                          <AlertCircle className="h-3 w-3" />
                          {lang === "ru" ? "Требуется верификация" : "Verification required"}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                </div>

                {/* Injection Links */}
                <div className="border-t border-border pt-3 mt-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Link2 className="h-3 w-3" />
                    {lang === "ru" ? "Ссылки для вставки в статьи (Link Injection)" : "Links to inject into articles"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mb-2">
                    {lang === "ru"
                      ? "2-3 случайные ссылки из списка будут автоматически вставлены в каждую статью при публикации"
                      : "2-3 random links from this list will be auto-injected into each article on publish"}
                  </p>
                  {injectionLinks.map((link, i) => (
                    <div key={i} className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs truncate flex-1 text-muted-foreground" title={link.url}>
                        <span className="font-medium text-foreground">{link.anchor}</span> → {link.url}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                        onClick={async () => {
                          const updated = injectionLinks.filter((_, idx) => idx !== i);
                          setInjectionLinks(updated);
                          if (selectedProjectId) {
                            await supabase.from("projects").update({ injection_links: updated }).eq("id", selectedProjectId);
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex gap-2 mt-2">
                    <Input
                      value={newLinkUrl}
                      onChange={(e) => setNewLinkUrl(e.target.value)}
                      placeholder="https://..."
                      className="flex-1 text-xs"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newLinkUrl.trim() && newLinkAnchor.trim()) {
                          e.preventDefault();
                          (document.getElementById("inj-add-btn") as HTMLButtonElement | null)?.click();
                        }
                      }}
                    />
                    <Input
                      value={newLinkAnchor}
                      onChange={(e) => setNewLinkAnchor(e.target.value)}
                      placeholder={lang === "ru" ? "Анкор" : "Anchor"}
                      className="w-32 text-xs"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newLinkUrl.trim() && newLinkAnchor.trim()) {
                          e.preventDefault();
                          (document.getElementById("inj-add-btn") as HTMLButtonElement | null)?.click();
                        }
                      }}
                    />
                    <Button
                      id="inj-add-btn"
                      size="sm"
                      variant="outline"
                      disabled={!newLinkUrl.trim() || !newLinkAnchor.trim()}
                      onClick={async () => {
                        const updated = [...injectionLinks, { url: newLinkUrl.trim(), anchor: newLinkAnchor.trim() }];
                        setInjectionLinks(updated);
                        setNewLinkUrl("");
                        setNewLinkAnchor("");
                        if (selectedProjectId) {
                          await supabase.from("projects").update({ injection_links: updated }).eq("id", selectedProjectId);
                          toast({ title: lang === "ru" ? "Ссылка добавлена" : "Link added" });
                        }
                      }}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  {(newLinkUrl.trim() || newLinkAnchor.trim()) && (
                    <p className="text-[10px] text-amber-500 mt-1.5 flex items-center gap-1">
                      ⚠ {lang === "ru" ? "Нажмите «+» или Enter, чтобы сохранить ссылку — иначе она не будет вставлена в статьи" : "Click «+» or press Enter to save the link — otherwise it won't be injected"}
                    </p>
                  )}
                </div>

                {repoStatus === "ready" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => handleInitRepo()}
                  >
                    <Rocket className="h-3 w-3 mr-1" />
                    {lang === "ru" ? "Обновить служебные страницы" : "Update service pages"}
                  </Button>
                )}
              </div>
            )}

            {/* Custom Domain */}
            {selectedProjectId && isGitHubConfigured && repoStatus === "ready" && (
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium">
                    {lang === "ru" ? "Кастомный домен" : "Custom domain"}
                  </p>
                  <button
                    onClick={() => setShowDnsHelper(!showDnsHelper)}
                    className="ml-auto text-muted-foreground hover:text-primary transition-colors"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </div>

                {selectedProject?.custom_domain && (
                  <div className="flex items-center gap-2 text-xs">
                    <ShieldCheck className="h-3.5 w-3.5 text-green-400" />
                    <span className="text-green-400 font-medium">SSL {lang === "ru" ? "защищен" : "secured"}</span>
                    <span className="text-muted-foreground">-</span>
                    <a
                      href={`https://${selectedProject.custom_domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {selectedProject.custom_domain}
                    </a>
                  </div>
                )}

                <div className="flex gap-2">
                  <Input
                    value={customDomain}
                    onChange={(e) => setCustomDomain(e.target.value)}
                    placeholder="example.com"
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={savingDomain || !customDomain.trim()}
                    onClick={async () => {
                      setSavingDomain(true);
                      try {
                        const domain = customDomain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
                        await supabase.from("projects").update({ custom_domain: domain || null }).eq("id", selectedProjectId);
                        setCustomDomain(domain);
                        // Reload projects
                        const { data: updated } = await supabase.from("projects").select(PROJECT_SELECT).eq("user_id", user!.id);
                        if (updated) setProjects(updated as ProjectRow[]);
                        toast({ title: lang === "ru" ? "Домен сохранен" : "Domain saved" });
                        setShowDnsHelper(true);
                      } catch (err: any) {
                        toast({ title: lang === "ru" ? "Ошибка" : "Error", description: err?.message, variant: "destructive" });
                      } finally {
                        setSavingDomain(false);
                      }
                    }}
                  >
                    {savingDomain ? <Loader2 className="h-4 w-4 animate-spin" /> : (lang === "ru" ? "Привязать" : "Bind")}
                  </Button>
                </div>

                {showDnsHelper && (() => {
                  const dns = DNS_CONFIGS[hostingPlatform] || DNS_CONFIGS.vercel;
                  return (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3 text-sm">
                    <p className="font-medium text-primary">
                      {lang === "ru"
                        ? `DNS-записи для ${platformLabel}:`
                        : `DNS records for ${platformLabel}:`}
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-primary/20">
                            <th className="py-2 px-3 text-left text-primary/80 font-semibold">{lang === "ru" ? "Тип" : "Type"}</th>
                            <th className="py-2 px-3 text-left text-primary/80 font-semibold">{lang === "ru" ? "Имя" : "Name"}</th>
                            <th className="py-2 px-3 text-left text-primary/80 font-semibold">{lang === "ru" ? "Значение" : "Value"}</th>
                            <th className="py-2 px-3 text-right"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {dns.a && (
                            <tr className="border-b border-border/50">
                              <td className="py-2 px-3 font-mono text-primary font-bold">A</td>
                              <td className="py-2 px-3 font-mono">@</td>
                              <td className="py-2 px-3 font-mono text-primary">{dns.a}</td>
                              <td className="py-2 px-3 text-right">
                                <button onClick={() => { navigator.clipboard.writeText(dns.a); toast({ title: lang === "ru" ? "Скопировано" : "Copied" }); }} className="text-muted-foreground hover:text-primary transition-colors">
                                  <Copy className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          )}
                          <tr>
                            <td className="py-2 px-3 font-mono text-primary font-bold">CNAME</td>
                            <td className="py-2 px-3 font-mono">{dns.cname}</td>
                            <td className="py-2 px-3 font-mono text-primary">{dns.cnameValue}</td>
                            <td className="py-2 px-3 text-right">
                              <button onClick={() => { navigator.clipboard.writeText(dns.cnameValue); toast({ title: lang === "ru" ? "Скопировано" : "Copied" }); }} className="text-muted-foreground hover:text-primary transition-colors">
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {lang === "ru"
                        ? `После добавления записей ${platformLabel} автоматически выпустит SSL-сертификат (до 24 часов). Также добавьте домен в настройках проекта на ${platformLabel}.`
                        : `After adding records, ${platformLabel} will automatically issue an SSL certificate (up to 24 hours). Also add the domain in your ${platformLabel} project settings.`}
                    </p>
                  </div>
                  );
                })()}
              </div>
            )}

            <div>
              <label className="text-sm font-medium mb-1.5 block">
                {lang === "ru" ? "Ключевые слова (по одному на строку)" : "Keywords (one per line)"}
              </label>
              <Textarea
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                rows={6}
                placeholder={
                  lang === "ru"
                    ? "купить диван недорого\nкак выбрать матрас\nлучшие кровати 2025"
                    : "buy sofa cheap\nhow to choose mattress\nbest beds 2025"
                }
              />
            </div>

            {/* Image Generation Controls */}
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-primary" />
                  <Label htmlFor="gen-images" className="text-sm font-medium">
                    {lang === "ru" ? "Генерировать фото" : "Generate images"}
                  </Label>
                </div>
                <Switch
                  id="gen-images"
                  checked={generateImages}
                  onCheckedChange={setGenerateImages}
                />
              </div>
              {generateImages && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {lang === "ru" ? "Количество фото на статью" : "Images per article"}
                    </span>
                    <span className="text-sm font-semibold text-primary">{imageCount}</span>
                  </div>
                  <Slider
                    value={[imageCount]}
                    onValueChange={([v]) => setImageCount(v)}
                    min={1}
                    max={5}
                    step={1}
                    className="w-full"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {lang === "ru"
                      ? "При первой публикации также генерируется хедер сайта"
                      : "Site header image is also generated on first publish"}
                  </p>
                </div>
              )}
            </div>

            <Button
              onClick={handleGenerate}
              disabled={!selectedProjectId || !keywords.trim() || generating}
              className="w-full"
            >
              {generating ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />{lang === "ru" ? "Создание задач..." : "Creating tasks..."}</>
              ) : (
                <><Rocket className="h-4 w-4 mr-2" />{lang === "ru" ? "Запустить генерацию" : "Start generation"}</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Right: Queue */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-lg">
              {lang === "ru" ? "Очередь публикации" : "Publication queue"}
            </CardTitle>
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <Button
                  size="sm"
                  onClick={handleBatchPublish}
                  disabled={batchPublishing || !isGitHubConfigured}
                >
                  {batchPublishing ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />{lang === "ru" ? "Публикация..." : "Publishing..."}</>
                  ) : (
                    <><PackageCheck className="h-4 w-4 mr-1.5" />{lang === "ru" ? `Опубликовать выбранное (${selectedIds.size})` : `Publish selected (${selectedIds.size})`}</>
                  )}
                </Button>
              )}
              {selectedProjectId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setImportOpen(true); loadUnassignedArticles(); }}
                >
                  <FolderInput className="h-4 w-4 mr-1.5" />
                  {lang === "ru" ? "Импорт" : "Import"}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {articles.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {lang === "ru" ? "Нет статей для этого проекта" : "No articles for this project"}
              </p>
            ) : (
              <>
                {/* Select all */}
                {publishableArticles.length > 1 && (
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                    <Checkbox
                      checked={selectedIds.size === publishableArticles.length && publishableArticles.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                    <span className="text-xs text-muted-foreground">
                      {lang === "ru" ? "Выбрать все" : "Select all"} ({publishableArticles.length})
                    </span>
                  </div>
                )}
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                {articles.map((article) => {
                  const isGen = generatingIds.has(article.id) || article.status === "generating";
                  const stuckGenerating = article.status === "generating" && article.created_at && (Date.now() - new Date(article.created_at).getTime() > 30 * 60 * 1000);
                  const canDelete = !isGen || stuckGenerating || article.status === "failed";
                  const isPublishable = !isGen && article.content && (article.status === "completed" || article.status === "published");
                  return (
                    <div
                      key={article.id}
                      className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                        isGen ? "border-primary/30 bg-primary/5" : selectedIds.has(article.id) ? "border-primary/50 bg-primary/5" : "border-border"
                      }`}
                    >
                      {/* Checkbox */}
                      <div className="shrink-0">
                        <Checkbox
                          checked={selectedIds.has(article.id)}
                          onCheckedChange={() => toggleSelectArticle(article.id)}
                          disabled={!isPublishable}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {article.title || (lang === "ru" ? "Без названия" : "Untitled")}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {getStatusBadge(article)}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {article.published_url && (
                          <Button size="icon" variant="ghost" asChild>
                            <a
                              href={
                                selectedProject?.custom_domain
                                  ? article.published_url.replace(/https?:\/\/[^/]+/, `https://${selectedProject.custom_domain}`)
                                  : article.published_url
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleOpenEdit(article)}
                          disabled={!article.content || isGen}
                          title={lang === "ru" ? "Редактировать" : "Edit"}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setPreviewArticle(article)}
                          disabled={!article.content || isGen}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" disabled={!canDelete} className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{lang === "ru" ? "Удалить статью?" : "Delete article?"}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {lang === "ru" ? "Это действие нельзя отменить. Статья будет удалена из базы данных." : "This action cannot be undone. The article will be permanently deleted."}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{lang === "ru" ? "Отмена" : "Cancel"}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteArticle(article.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                {lang === "ru" ? "Удалить" : "Delete"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <Button
                          size="sm"
                          variant={article.status === "published" ? "outline" : "default"}
                          onClick={() => handlePublish(article)}
                          disabled={
                            !isGitHubConfigured ||
                            !article.content ||
                            isGen ||
                            publishing === article.id
                          }
                        >
                          {publishing === article.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>{article.status === "published" 
                              ? (lang === "ru" ? "Обновить" : "Update")
                              : (lang === "ru" ? "Опубликовать" : "Publish")
                            }</>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Deploy Status Bar */}
      {deployLogs.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              {deployLogs[0]?.status === "publishing" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              {deployLogs[0]?.status === "success" && <CheckCircle className="h-4 w-4 text-green-400" />}
              {deployLogs[0]?.status === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
              {lang === "ru" ? "Статус деплоя" : "Deploy status"}
            </CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-3">
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {deployLogs.map((log, i) => (
                <div key={i} className={`text-xs flex items-center gap-2 ${
                  log.status === "error" ? "text-destructive" : log.status === "success" ? "text-green-400" : "text-muted-foreground"
                }`}>
                  <span className="text-[10px] opacity-60 tabular-nums shrink-0">
                    {log.timestamp.toLocaleTimeString()}
                  </span>
                  <span className="truncate">{log.message}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview Dialog — matches published site design */}
      <Dialog open={!!previewArticle} onOpenChange={() => setPreviewArticle(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto p-0 bg-gray-50 border-0">
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden m-4">
            {/* Gradient Hero */}
            <div className="w-full h-40 flex items-center justify-center p-6" style={{ background: `linear-gradient(135deg, ${selectedProject?.primary_color || "#8b5cf6"}, ${selectedProject?.primary_color ? selectedProject.primary_color + "99" : "#a78bfa"})` }}>
              <h2 className="text-xl sm:text-2xl font-black text-white text-center leading-tight drop-shadow-lg max-w-xl">
                {previewArticle?.title || "Preview"}
              </h2>
            </div>
            <div className="p-6 sm:p-8">
              <DialogHeader className="mb-4">
                <DialogTitle className="text-2xl font-black tracking-tight text-gray-900 leading-tight">
                  {previewArticle?.title || "Preview"}
                </DialogTitle>
              </DialogHeader>
              {previewArticle?.keywords && previewArticle.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {previewArticle.keywords.map((kw) => (
                    <span key={kw} className="inline-block px-2.5 py-0.5 text-xs font-medium rounded-full bg-violet-50 text-violet-600 border border-violet-100">
                      {kw}
                    </span>
                  ))}
                </div>
              )}
              {previewArticle?.meta_description && (
                <p className="text-base text-gray-500 leading-relaxed mb-6">{previewArticle.meta_description}</p>
              )}
              {previewArticle?.content && (
                <div
                  className="prose prose-gray prose-lg max-w-none
                    prose-headings:text-gray-900 prose-headings:font-bold
                    prose-a:text-violet-600
                    prose-strong:text-gray-900
                    prose-blockquote:border-l-violet-400 prose-blockquote:bg-violet-50/50 prose-blockquote:rounded-r-xl prose-blockquote:not-italic prose-blockquote:py-3 prose-blockquote:px-4
                    prose-table:rounded-xl prose-table:overflow-hidden prose-table:shadow-sm
                    prose-th:bg-violet-600 prose-th:text-white prose-th:text-xs prose-th:uppercase prose-th:tracking-wider prose-th:py-3 prose-th:px-4
                    prose-td:py-3 prose-td:px-4 prose-td:border-t prose-td:border-gray-100
                    prose-code:text-violet-700 prose-code:bg-violet-50 prose-code:rounded prose-code:px-1.5 prose-code:py-0.5
                    prose-li:marker:text-violet-400
                  "
                  dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(previewArticle.content) }}
                />
              )}
              <div className="mt-10 pt-6 border-t border-gray-100">
                <div className="bg-gradient-to-br from-gray-50 to-violet-50/30 rounded-2xl p-5 flex items-start gap-4">
                  {selectedProject?.author_avatar ? (
                    <img src={selectedProject.author_avatar} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0 shadow-lg" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-lg" style={{ background: selectedProject?.primary_color || "#8b5cf6" }}>
                      <span className="text-sm font-bold text-white">
                        {(selectedProject?.author_name || "AП").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: selectedProject?.primary_color || "#8b5cf6" }}>
                      {lang === "ru" ? "Об авторе" : "About the author"}
                    </p>
                    <h4 className="text-sm font-bold text-gray-900">{selectedProject?.author_name || (lang === "ru" ? "Автор" : "Author")}</h4>
                    {selectedProject?.author_bio && (
                      <p className="text-xs text-gray-600 mt-0.5">{selectedProject.author_bio}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingArticle} onOpenChange={(open) => !open && setEditingArticle(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{lang === "ru" ? "Редактирование статьи" : "Edit article"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium mb-1.5 block">{lang === "ru" ? "Заголовок" : "Title"}</Label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </div>
            <div>
              <Label className="text-sm font-medium mb-1.5 block">{lang === "ru" ? "Мета-описание" : "Meta description"}</Label>
              <Input value={editMeta} onChange={(e) => setEditMeta(e.target.value)} />
            </div>
            <div>
              <Label className="text-sm font-medium mb-1.5 block">{lang === "ru" ? "Контент (Markdown)" : "Content (Markdown)"}</Label>
              <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={18} className="font-mono text-xs" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingArticle(null)}>{lang === "ru" ? "Отмена" : "Cancel"}</Button>
              <Button onClick={handleSaveEdit} disabled={savingEdit}>
                {savingEdit ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {lang === "ru" ? "Сохранить" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Articles Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{lang === "ru" ? "Импорт статей в проект" : "Import articles to project"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {lang === "ru"
              ? "Статьи без привязки к проекту. Нажмите '+' чтобы добавить в текущий проект."
              : "Articles without a project. Click '+' to add to current project."}
          </p>
          {unassignedArticles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {lang === "ru" ? "Нет доступных статей для импорта" : "No articles available for import"}
            </p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {unassignedArticles.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{a.title || "Untitled"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {a.created_at ? new Date(a.created_at).toLocaleDateString() : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={importingIds.has(a.id)}
                    onClick={() => handleImportArticle(a.id)}
                  >
                    {importingIds.has(a.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
