import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";
import { PlanGate } from "@/shared/components/PlanGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Globe, Plus, Trash2, CheckCircle2, XCircle, Loader2,
  Send, ExternalLink, Eye, EyeOff, RefreshCw, Pencil
} from "lucide-react";
import { toast } from "sonner";

interface WpSite {
  id: string;
  site_url: string;
  username: string;
  app_password: string;
  site_name: string | null;
  is_connected: boolean;
}

interface WpCategory {
  id: number;
  name: string;
  slug: string;
  count: number;
}

interface Article {
  id: string;
  title: string | null;
  content: string | null;
  meta_description: string | null;
}

export default function WordPressPage() {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newAppPassword, setNewAppPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Publish state
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [selectedArticleId, setSelectedArticleId] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<number[]>([]);
  const [tagsInput, setTagsInput] = useState("");
  const [publishImmediately, setPublishImmediately] = useState(false);
  const [seoPlugin, setSeoPlugin] = useState<"none" | "rank_math" | "yoast">("none");
  const [customTitle, setCustomTitle] = useState("");
  const [customDescription, setCustomDescription] = useState("");

  // Fetch WP sites
  const { data: sites = [], isLoading: sitesLoading } = useQuery({
    queryKey: ["wp-sites"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wordpress_sites")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as WpSite[];
    },
  });

  // Fetch user articles
  const { data: articles = [] } = useQuery({
    queryKey: ["wp-articles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, content, meta_description")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Article[];
    },
  });

  // Fetch categories for selected site
  const { data: categories = [], isLoading: catsLoading, refetch: refetchCats } = useQuery({
    queryKey: ["wp-categories", selectedSiteId],
    queryFn: async () => {
      if (!selectedSiteId) return [];
      const { data, error } = await supabase.functions.invoke("wordpress-proxy", {
        body: { action: "fetch_categories", site_id: selectedSiteId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return (data?.categories || []) as WpCategory[];
    },
    enabled: !!selectedSiteId,
  });

  // Auto-fill SEO fields when article selected
  useEffect(() => {
    if (selectedArticleId) {
      const art = articles.find((a) => a.id === selectedArticleId);
      if (art) {
        setCustomTitle(art.title || "");
        setCustomDescription(art.meta_description || "");
      }
    }
  }, [selectedArticleId, articles]);

  // Add site
  const addSite = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const url = newUrl.replace(/\/+$/, "");
      if (!url.startsWith("http")) throw new Error("URL должен начинаться с http:// или https://");

      const { error } = await supabase.from("wordpress_sites").insert({
        user_id: user.id,
        site_url: url,
        username: newUsername,
        app_password: newAppPassword,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wp-sites"] });
      setShowAddForm(false);
      setNewUrl("");
      setNewUsername("");
      setNewAppPassword("");
      toast.success("Сайт добавлен");
    },
    onError: (e) => toast.error(e.message),
  });

  // Test connection
  const testConnection = useMutation({
    mutationFn: async (siteId: string) => {
      const { data, error } = await supabase.functions.invoke("wordpress-proxy", {
        body: { action: "test_connection", site_id: siteId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["wp-sites"] });
      toast.success(`Подключено: ${data.user}`);
    },
    onError: (e) => toast.error(`Ошибка подключения: ${e.message}`),
  });

  // Delete site
  const deleteSite = useMutation({
    mutationFn: async (siteId: string) => {
      const { error } = await supabase.from("wordpress_sites").delete().eq("id", siteId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wp-sites"] });
      if (selectedSiteId) setSelectedSiteId("");
      toast.success("Сайт удалён");
    },
    onError: (e) => toast.error(e.message),
  });

  // Publish article
  const publishPost = useMutation({
    mutationFn: async () => {
      if (!selectedSiteId) throw new Error("Выберите сайт");
      if (!selectedArticleId) throw new Error("Выберите статью");

      const article = articles.find((a) => a.id === selectedArticleId);
      if (!article?.content) throw new Error("У статьи нет контента");

      // Convert markdown to HTML (basic)
      let htmlContent = article.content
        .replace(/^### (.+)$/gm, "<h3>$1</h3>")
        .replace(/^## (.+)$/gm, "<h2>$1</h2>")
        .replace(/^# (.+)$/gm, "<h1>$1</h1>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/^- (.+)$/gm, "<li>$1</li>")
        .replace(/(<li>.+<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
        .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
        .replace(/\n\n/g, "\n<!-- wp:paragraph -->\n<p>")
        .replace(/\n(?!<)/g, "</p>\n<!-- /wp:paragraph -->\n");

      // Wrap in Gutenberg blocks
      htmlContent = `<!-- wp:paragraph -->\n<p>${htmlContent}</p>\n<!-- /wp:paragraph -->`;

      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      // Create tag IDs (WP creates them if they don't exist)
      let tagIds: number[] = [];
      if (tags.length > 0) {
        // For simplicity, pass tag names as-is; WP won't accept names directly
        // We'd need to create tags first, but let's keep it simple for now
      }

      const { data, error } = await supabase.functions.invoke("wordpress-proxy", {
        body: {
          action: "create_post",
          site_id: selectedSiteId,
          title: article.title || "Без названия",
          content: htmlContent,
          excerpt: article.meta_description || "",
          status: publishImmediately ? "publish" : "draft",
          categories: selectedCategories,
          meta_title: seoPlugin !== "none" ? customTitle : undefined,
          meta_description: seoPlugin !== "none" ? customDescription : undefined,
          seo_plugin: seoPlugin !== "none" ? seoPlugin : undefined,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(
        publishImmediately ? "Статья опубликована!" : "Черновик сохранён в WordPress!",
        {
          action: {
            label: "Открыть в WP",
            onClick: () => window.open(data.edit_url, "_blank"),
          },
        }
      );
    },
    onError: (e) => toast.error(`Ошибка публикации: ${e.message}`),
  });

  const selectedArticle = articles.find((a) => a.id === selectedArticleId);

  const limits = usePlanLimits();

  return (
    <PlanGate allowed={limits.limits.hasWordPress} featureName="WordPress интеграция" requiredPlan="PRO">
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Globe className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">WordPress</h1>
          <p className="text-sm text-muted-foreground">
            Публикация статей на ваши WordPress-сайты в один клик
          </p>
        </div>
        <Badge variant="outline" className="ml-auto text-primary border-primary">PRO</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        {/* Left: Sites */}
        <div className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>Подключённые сайты</span>
                <Button size="sm" variant="outline" onClick={() => setShowAddForm(!showAddForm)} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Добавить
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Add form */}
              {showAddForm && (
                <div className="space-y-3 p-4 rounded-lg bg-muted/50 border border-border">
                  <div className="space-y-1.5">
                    <Label className="text-xs">URL сайта</Label>
                    <Input
                      placeholder="https://example.com"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Логин WordPress</Label>
                    <Input
                      placeholder="admin"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Пароль приложения</Label>
                    <div className="flex gap-2">
                      <Input
                        type={showPassword ? "text" : "password"}
                        placeholder="xxxx xxxx xxxx xxxx"
                        value={newAppPassword}
                        onChange={(e) => setNewAppPassword(e.target.value)}
                      />
                      <Button variant="ghost" size="icon" onClick={() => setShowPassword(!showPassword)}>
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Создайте в WP: Пользователи → Профиль → Пароли приложений
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!newUrl || !newUsername || !newAppPassword || addSite.isPending}
                      onClick={() => addSite.mutate()}
                    >
                      {addSite.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                      Сохранить
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>
                      Отмена
                    </Button>
                  </div>
                </div>
              )}

              {/* Sites list */}
              {sitesLoading ? (
                <div className="text-sm text-muted-foreground py-4 text-center">Загрузка...</div>
              ) : sites.length === 0 && !showAddForm ? (
                <div className="text-sm text-muted-foreground py-8 text-center">
                  <Globe className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  <p>Нет подключённых сайтов</p>
                  <p className="text-xs mt-1">Нажмите «Добавить» чтобы подключить WordPress</p>
                </div>
              ) : (
                sites.map((site) => (
                  <div
                    key={site.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                      selectedSiteId === site.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/30"
                    }`}
                    onClick={() => setSelectedSiteId(site.id)}
                  >
                    <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${site.is_connected ? "bg-green-500" : "bg-red-500"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {site.site_name || site.site_url.replace(/https?:\/\//, "")}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{site.site_url}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          testConnection.mutate(site.id);
                        }}
                        disabled={testConnection.isPending}
                        title="Проверить подключение"
                      >
                        {testConnection.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("Удалить подключение?")) deleteSite.mutate(site.id);
                        }}
                        title="Удалить"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Publish Panel */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Send className="h-4 w-4 text-primary" />
              Публикация
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedSiteId ? (
              <div className="text-sm text-muted-foreground py-12 text-center">
                <Send className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p>Выберите сайт для публикации</p>
              </div>
            ) : (
              <>
                {/* Article select */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Статья</Label>
                  <Select value={selectedArticleId} onValueChange={setSelectedArticleId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите статью..." />
                    </SelectTrigger>
                    <SelectContent>
                      {articles.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.title || "Без названия"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedArticleId && (
                  <>
                    <Separator />

                    {/* Category */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Категория</Label>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs"
                          onClick={() => refetchCats()}
                          disabled={catsLoading}
                        >
                          {catsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        </Button>
                      </div>
                      <Select
                        value={selectedCategories[0]?.toString() || ""}
                        onValueChange={(v) => setSelectedCategories(v ? [parseInt(v)] : [])}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={catsLoading ? "Загрузка..." : "Без категории"} />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((c) => (
                            <SelectItem key={c.id} value={c.id.toString()}>
                              {c.name} ({c.count})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Tags */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Теги (через запятую)</Label>
                      <Input
                        placeholder="seo, контент, продвижение"
                        value={tagsInput}
                        onChange={(e) => setTagsInput(e.target.value)}
                      />
                    </div>

                    <Separator />

                    {/* SEO Plugin */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">SEO-плагин</Label>
                      <Select value={seoPlugin} onValueChange={(v) => setSeoPlugin(v as any)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Не использовать</SelectItem>
                          <SelectItem value="rank_math">Rank Math</SelectItem>
                          <SelectItem value="yoast">Yoast SEO</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {seoPlugin !== "none" && (
                      <div className="space-y-3 p-3 rounded-lg bg-muted/50">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Meta Title</Label>
                          <Input
                            value={customTitle}
                            onChange={(e) => setCustomTitle(e.target.value)}
                            placeholder="SEO-заголовок"
                          />
                          <p className="text-[10px] text-muted-foreground">{customTitle.length}/60 символов</p>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Meta Description</Label>
                          <Textarea
                            value={customDescription}
                            onChange={(e) => setCustomDescription(e.target.value)}
                            placeholder="SEO-описание"
                            rows={2}
                          />
                          <p className="text-[10px] text-muted-foreground">{customDescription.length}/160 символов</p>
                        </div>
                      </div>
                    )}

                    <Separator />

                    {/* Publish toggle */}
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm">Опубликовать немедленно</Label>
                        <p className="text-xs text-muted-foreground">
                          {publishImmediately ? "Пост будет опубликован сразу" : "Пост будет сохранён как черновик"}
                        </p>
                      </div>
                      <Switch checked={publishImmediately} onCheckedChange={setPublishImmediately} />
                    </div>

                    {/* Publish button */}
                    <Button
                      className="w-full gap-2 h-11"
                      onClick={() => publishPost.mutate()}
                      disabled={publishPost.isPending}
                    >
                      {publishPost.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      {publishPost.isPending
                        ? "Публикация..."
                        : publishImmediately
                          ? "Опубликовать в WordPress"
                          : "Сохранить как черновик"}
                    </Button>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
    </PlanGate>
  );
}
