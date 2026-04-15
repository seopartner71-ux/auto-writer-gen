import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Factory, Globe, FileText, Upload, Eye, ExternalLink, Loader2, Rocket } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import DOMPurify from "dompurify";

interface ProjectRow {
  id: string;
  name: string;
  domain: string;
  github_repo: string | null;
  github_token: string | null;
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

  // Stats
  const [totalSites, setTotalSites] = useState(0);
  const [totalArticles, setTotalArticles] = useState(0);
  const [todayPublished, setTodayPublished] = useState(0);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  const isGitHubConfigured = !!(selectedProject?.github_token && selectedProject?.github_repo);

  // Load projects
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name, domain, github_repo, github_token")
        .eq("user_id", user.id);
      if (data) setProjects(data as ProjectRow[]);
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
      const projLang = selectedProj?.domain?.endsWith(".ru") ? "ru" : "en";

      for (const kw of kws) {
        // 1. Create keyword record
        const { data: kwRecord, error: kwErr } = await supabase
          .from("keywords")
          .insert({
            user_id: user.id,
            seed_keyword: kw,
            language: projLang,
            geo: projLang === "ru" ? "ru" : "US",
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
            language: projLang,
            geo: projLang === "ru" ? "RU" : "US",
            keywords: [kw],
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
                  language: projLang,
                }),
              }
            );

            if (!res.ok) {
              const errText = await res.text();
              console.error("generate-article error:", errText);
              await supabase.from("articles").update({ status: "draft" }).eq("id", artRecord.id);
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
            await supabase.from("articles").update({ status: "draft" }).eq("id", artRecord.id);
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
    const html = content
      .replace(/^### (.*$)/gim, "<h3>$1</h3>")
      .replace(/^## (.*$)/gim, "<h2>$1</h2>")
      .replace(/^# (.*$)/gim, "<h1>$1</h1>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
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
                      {p.name} {p.domain ? `(${p.domain})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedProjectId && !isGitHubConfigured && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {lang === "ru"
                  ? "⚠️ Для этого проекта не настроен GitHub Token и Repo. Публикация недоступна. Обратитесь к администратору."
                  : "⚠️ GitHub Token and Repo are not configured for this project. Publishing is unavailable. Contact your admin."}
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
                            <a href={article.published_url} target="_blank" rel="noopener noreferrer">
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

      {/* Preview Dialog */}
      <Dialog open={!!previewArticle} onOpenChange={() => setPreviewArticle(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewArticle?.title || "Preview"}</DialogTitle>
          </DialogHeader>
          {previewArticle?.meta_description && (
            <p className="text-sm text-muted-foreground italic">{previewArticle.meta_description}</p>
          )}
          {previewArticle?.content && (
            <div
              className="prose prose-invert max-w-none mt-4"
              dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(previewArticle.content) }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
