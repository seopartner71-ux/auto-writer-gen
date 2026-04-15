import { useState, useEffect, useMemo, useCallback } from "react";
import { Factory, Globe, FileText, Upload, Eye, ExternalLink, Loader2, Rocket, CheckCircle, AlertCircle, ImageIcon, ShieldCheck, HelpCircle, Copy, Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
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
  custom_domain: string | null;
}

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
  const [repoError, setRepoError] = useState("");
  const [generateImages, setGenerateImages] = useState(true);
  const [siteConfig, setSiteConfig] = useState({ site_name: "", site_copyright: "", site_about: "" });
  const [imageCount, setImageCount] = useState(3);
  const [authorProfiles, setAuthorProfiles] = useState<AuthorProfile[]>([]);
  const [selectedAuthorId, setSelectedAuthorId] = useState<string>("");
  const [customDomain, setCustomDomain] = useState("");
  const [showDnsHelper, setShowDnsHelper] = useState(false);
  const [savingDomain, setSavingDomain] = useState(false);

  // Stats
  const [totalSites, setTotalSites] = useState(0);
  const [totalArticles, setTotalArticles] = useState(0);
  const [todayPublished, setTodayPublished] = useState(0);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  // Sync siteConfig when project changes
  useEffect(() => {
    if (selectedProject) {
      setSiteConfig({
        site_name: selectedProject.site_name || "",
        site_copyright: selectedProject.site_copyright || "",
        site_about: selectedProject.site_about || "",
      });
      setCustomDomain(selectedProject.custom_domain || "");
    }
  }, [selectedProject]);

  const isGitHubConfigured = !!(selectedProject?.github_token && selectedProject?.github_repo);

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

  const handleInitRepo = async () => {
    if (!selectedProjectId) return;
    setRepoStatus("initializing");
    try {
      // Save site config to project first
      if (siteConfig.site_name || siteConfig.site_copyright || siteConfig.site_about) {
        await supabase.from("projects").update({
          site_name: siteConfig.site_name || null,
          site_copyright: siteConfig.site_copyright || null,
          site_about: siteConfig.site_about || null,
        }).eq("id", selectedProjectId);
      }

      const { data, error } = await supabase.functions.invoke("bootstrap-astro", {
        body: {
          project_id: selectedProjectId,
          action: "initialize",
          site_name: siteConfig.site_name || selectedProject?.name || "Blog",
          site_copyright: siteConfig.site_copyright || "",
          site_about: siteConfig.site_about || "",
          language: selectedProject?.language || "en",
        },
      });
      if (error) throw new Error(error.message);
      if (data?.success) {
        setRepoStatus("ready");
        toast({ title: lang === "ru" ? "Сайт инициализирован!" : "Site initialized!", description: lang === "ru" ? "Шаблон Astro загружен. Vercel задеплоит сайт автоматически." : "Astro template uploaded. Vercel will deploy automatically." });
        // Reload projects to get updated config
        const { data: updated } = await supabase.from("projects").select("id, name, domain, language, github_repo, github_token, site_name, site_copyright, site_about, custom_domain").eq("user_id", user!.id);
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

  // Load projects
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name, domain, language, github_repo, github_token, site_name, site_copyright, site_about, custom_domain")
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

  const handlePublish = async (article: QueueArticle) => {
    if (!selectedProjectId || !article.content) return;
    setPublishing(article.id);
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
        toast({
          title: lang === "ru" ? "Ошибка GitHub API" : "GitHub API Error",
          description: data.error,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: lang === "ru" ? "Статья опубликована! 🎉" : "Article published! 🎉",
        description: lang === "ru"
          ? "Сайт обновится через минуту"
          : "Site will update in a minute",
      });
      setArticles((prev) =>
        prev.map((a) =>
          a.id === article.id ? { ...a, status: "published", published_url: data?.url ?? a.published_url } : a
        )
      );
    } catch (err: any) {
      toast({
        title: lang === "ru" ? "Ошибка публикации" : "Publish error",
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setPublishing(null);
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
    if (isGenerating) {
      return (
        <Badge variant="secondary" className="text-xs animate-pulse bg-primary/20 text-primary">
          {lang === "ru" ? "Генерируется..." : "Generating..."}
        </Badge>
      );
    }
    if (article.status === "published") {
      return (
        <Badge variant="default" className="text-xs">
          {lang === "ru" ? "Опубликовано" : "Published"}
        </Badge>
      );
    }
    if (article.status === "completed") {
      return (
        <Badge variant="secondary" className="text-xs bg-green-500/20 text-green-400">
          {lang === "ru" ? "Готово к публикации" : "Ready to publish"}
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

      {/* Stats */}
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
                      {p.name} {p.custom_domain ? `(${p.custom_domain})` : p.domain ? `(${p.domain})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
                  ? "Для этого проекта не настроен GitHub Token и Repo. Публикация недоступна."
                  : "GitHub Token and Repo are not configured for this project."}
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

            {/* Site Config Form - shown when repo needs initialization or is ready */}
            {selectedProjectId && isGitHubConfigured && (repoStatus === "empty" || repoStatus === "ready") && (
              <div className="rounded-lg border border-border p-4 space-y-3">
                <p className="text-sm font-medium">
                  {lang === "ru" ? "Настройки сайта и служебные страницы" : "Site settings & service pages"}
                </p>
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
                    rows={3}
                    placeholder={lang === "ru" ? "Мы - команда экспертов, которая помогает бизнесу расти через качественный контент и SEO-оптимизацию." : "We are a team of experts helping businesses grow through quality content and SEO."}
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
                {repoStatus === "ready" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={async () => {
                      await supabase.from("projects").update({
                        site_name: siteConfig.site_name || null,
                        site_copyright: siteConfig.site_copyright || null,
                        site_about: siteConfig.site_about || null,
                      }).eq("id", selectedProjectId);
                      // Re-initialize to apply changes
                      handleInitRepo();
                    }}
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
                        const { data: updated } = await supabase.from("projects").select("id, name, domain, language, github_repo, github_token, site_name, site_copyright, site_about, custom_domain").eq("user_id", user!.id);
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

                {showDnsHelper && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3 text-sm">
                    <p className="font-medium text-primary">
                      {lang === "ru"
                        ? "Добавьте следующие DNS-записи у вашего регистратора доменов:"
                        : "Add these DNS records at your domain registrar:"}
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
                          <tr className="border-b border-border/50">
                            <td className="py-2 px-3 font-mono text-primary font-bold">A</td>
                            <td className="py-2 px-3 font-mono">@</td>
                            <td className="py-2 px-3 font-mono text-primary">76.76.21.21</td>
                            <td className="py-2 px-3 text-right">
                              <button
                                onClick={() => { navigator.clipboard.writeText("76.76.21.21"); toast({ title: lang === "ru" ? "Скопировано" : "Copied" }); }}
                                className="text-muted-foreground hover:text-primary transition-colors"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 font-mono text-primary font-bold">CNAME</td>
                            <td className="py-2 px-3 font-mono">www</td>
                            <td className="py-2 px-3 font-mono text-primary">cname.vercel-dns.com</td>
                            <td className="py-2 px-3 text-right">
                              <button
                                onClick={() => { navigator.clipboard.writeText("cname.vercel-dns.com"); toast({ title: lang === "ru" ? "Скопировано" : "Copied" }); }}
                                className="text-muted-foreground hover:text-primary transition-colors"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {lang === "ru"
                        ? "После добавления записей Vercel автоматически выпустит SSL-сертификат (до 24 часов). Также добавьте домен в настройках проекта на Vercel."
                        : "After adding records, Vercel will automatically issue an SSL certificate (up to 24 hours). Also add the domain in your Vercel project settings."}
                    </p>
                  </div>
                )}
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
          <CardHeader>
            <CardTitle className="text-lg">
              {lang === "ru" ? "Очередь публикации" : "Publication queue"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {articles.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {lang === "ru" ? "Нет статей для этого проекта" : "No articles for this project"}
              </p>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                {articles.map((article) => {
                  const isGen = generatingIds.has(article.id) || article.status === "generating";
                  return (
                    <div
                      key={article.id}
                      className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                        isGen ? "border-primary/30 bg-primary/5" : "border-border"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {article.title || (lang === "ru" ? "Без названия" : "Untitled")}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {getStatusBadge(article)}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
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
                          onClick={() => setPreviewArticle(article)}
                          disabled={!article.content || isGen}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handlePublish(article)}
                          disabled={
                            !isGitHubConfigured ||
                            article.status === "published" ||
                            !article.content ||
                            isGen ||
                            publishing === article.id
                          }
                        >
                          {publishing === article.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>{lang === "ru" ? "Опубликовать" : "Publish"}</>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Preview Dialog — matches published site design */}
      <Dialog open={!!previewArticle} onOpenChange={() => setPreviewArticle(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto p-0 bg-gray-50 border-0">
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden m-4">
            {/* Gradient Hero */}
            <div className="w-full h-40 bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center p-6">
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
              {/* Author block */}
              <div className="mt-10 pt-6 border-t border-gray-100">
                <div className="bg-gradient-to-br from-gray-50 to-violet-50/30 rounded-2xl p-5 flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shrink-0 shadow-lg">
                    <span className="text-sm font-bold text-white">АП</span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-violet-600 uppercase tracking-wider mb-0.5">Об авторе</p>
                    <h4 className="text-sm font-bold text-gray-900">Алексей Петров</h4>
                    <p className="text-xs text-gray-600 mt-0.5">SEO-эксперт с 12-летним стажем. Работал с крупнейшими e-commerce проектами Рунета.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
