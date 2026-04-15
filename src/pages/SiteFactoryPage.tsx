import { useState, useEffect, useMemo } from "react";
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
  useEffect(() => {
    if (!user || !selectedProjectId) { setArticles([]); return; }
    (async () => {
      const { data } = await supabase
        .from("articles")
        .select("id, title, content, meta_description, status, published_url, created_at")
        .eq("user_id", user.id)
        .eq("project_id", selectedProjectId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (data) setArticles(data);
    })();
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

  const handleGenerate = async () => {
    if (!selectedProjectId || !keywords.trim()) return;
    setGenerating(true);
    try {
      const kws = keywords.split("\n").map((k) => k.trim()).filter(Boolean);
      for (const kw of kws) {
        await supabase.functions.invoke("generate-article", {
          body: {
            keyword: kw,
            project_id: selectedProjectId,
            language: "ru",
            geo: "RU",
          },
        });
      }
      toast({
        title: lang === "ru" ? "Генерация запущена" : "Generation started",
        description: lang === "ru" ? `${kws.length} статей в очереди` : `${kws.length} articles queued`,
      });
      setKeywords("");
      // Refresh articles
      const { data } = await supabase
        .from("articles")
        .select("id, title, content, meta_description, status, published_url, created_at")
        .eq("user_id", user!.id)
        .eq("project_id", selectedProjectId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (data) setArticles(data);
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
      toast({
        title: lang === "ru" ? "Опубликовано!" : "Published!",
        description: data?.url || "",
      });
      // Update local state
      setArticles((prev) =>
        prev.map((a) =>
          a.id === article.id ? { ...a, status: "published", published_url: data?.url ?? a.published_url } : a
        )
      );
    } catch {
      toast({ title: lang === "ru" ? "Ошибка публикации" : "Publish error", variant: "destructive" });
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
            <FileText className="h-8 w-8 text-emerald-500" />
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
            <Upload className="h-8 w-8 text-blue-500" />
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
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
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
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />{lang === "ru" ? "Генерация..." : "Generating..."}</>
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
                {articles.map((article) => (
                  <div
                    key={article.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {article.title || (lang === "ru" ? "Без названия" : "Untitled")}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge
                          variant={article.status === "published" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {article.status === "published"
                            ? lang === "ru" ? "Опубликовано" : "Published"
                            : article.status === "completed"
                            ? lang === "ru" ? "Готово" : "Ready"
                            : article.status ?? "draft"}
                        </Badge>
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
                        disabled={!article.content}
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
                ))}
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
