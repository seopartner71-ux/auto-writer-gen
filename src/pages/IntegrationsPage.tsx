import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, ExternalLink, Globe, CheckCircle2, AlertCircle, Loader2, Unplug, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";
import { PlanGate } from "@/shared/components/PlanGate";

type BloggerBlog = { id: string; name: string; url: string };
type BloggerConnection = {
  google_email: string | null;
  blogs: BloggerBlog[];
  default_blog_id: string | null;
  default_blog_name: string | null;
};

export default function IntegrationsPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { limits } = usePlanLimits();

  const [ghostUrl, setGhostUrl] = useState("");
  const [ghostApiKey, setGhostApiKey] = useState("");

  const [isSaving, setIsSaving] = useState(false);
  const [, setLoaded] = useState(false);

  // Blogger state
  const [blogger, setBlogger] = useState<BloggerConnection | null>(null);
  const [bloggerLoading, setBloggerLoading] = useState(true);
  const [connectingBlogger, setConnectingBlogger] = useState(false);
  const [refreshingBlogs, setRefreshingBlogs] = useState(false);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [{ data: profile }, { data: bConn }] = await Promise.all([
        supabase.from("profiles").select("ghost_url, has_ghost_key, has_medium_token").eq("id", user.id).single(),
        (supabase as any).from("blogger_connections").select("google_email, blogs, default_blog_id, default_blog_name, has_tokens").eq("user_id", user.id).maybeSingle(),
      ]);
      if (profile) {
        setGhostUrl((profile as any).ghost_url || "");
        // Don't expose ghost_api_key value; show placeholder if configured
        setGhostApiKey((profile as any).has_ghost_key ? "••••••••" : "");
      }
      if (bConn) setBlogger(bConn as any);
      setBloggerLoading(false);
      setLoaded(true);
    };
    load();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          ghost_url: ghostUrl.trim() || null,
          ghost_api_key: ghostApiKey.trim() || null,
        } as any)
        .eq("id", user.id);
      if (error) throw error;
      toast.success(t("integrations.saved"));
    } catch (e: any) {
      toast.error(e.message || t("integrations.saveError"));
    } finally {
      setIsSaving(false);
    }
  };

  const connectBlogger = async () => {
    setConnectingBlogger(true);
    try {
      const { data, error } = await supabase.functions.invoke("blogger-oauth-start", {
        body: { return_to: window.location.origin + "/integrations" },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("No authorize URL");
      window.location.href = data.url;
    } catch (e: any) {
      toast.error(e.message || "Ошибка подключения");
      setConnectingBlogger(false);
    }
  };

  const disconnectBlogger = async () => {
    try {
      const { error } = await supabase.functions.invoke("blogger-disconnect", { body: {} });
      if (error) throw error;
      setBlogger(null);
      toast.success(t("integrations.bloggerDisconnected"));
    } catch (e: any) {
      toast.error(e.message || "Ошибка");
    }
  };

  const refreshBlogs = async () => {
    setRefreshingBlogs(true);
    try {
      const { data, error } = await supabase.functions.invoke("blogger-list-blogs", { body: {} });
      if (error) throw error;
      if (data?.blogs && blogger) {
        setBlogger({ ...blogger, blogs: data.blogs });
        toast.success(t("integrations.bloggerRefreshed"));
      }
    } catch (e: any) {
      toast.error(e.message || "Ошибка");
    } finally {
      setRefreshingBlogs(false);
    }
  };

  const setDefaultBlog = async (blogId: string) => {
    try {
      const { error } = await supabase.functions.invoke("blogger-set-default", { body: { blog_id: blogId } });
      if (error) throw error;
      const blog = blogger?.blogs.find(b => b.id === blogId);
      if (blogger && blog) setBlogger({ ...blogger, default_blog_id: blog.id, default_blog_name: blog.name });
      toast.success(t("integrations.bloggerDefaultSet"));
    } catch (e: any) {
      toast.error(e.message || "Ошибка");
    }
  };

  const bloggerConfigured = !!blogger?.default_blog_id;

  const platforms = [
    {
      name: "Telegra.ph",
      badge: "success" as const,
      status: t("integrations.telegraphReady"),
      description: t("integrations.telegraphPlatformDesc"),
      configured: true,
      docUrl: "https://telegra.ph",
      docLabel: "telegra.ph",
    },
    {
      name: "Blogger",
      badge: bloggerConfigured ? "success" as const : "outline" as const,
      status: bloggerConfigured ? t("integrations.bloggerConfigured") : t("integrations.bloggerNotConfigured"),
      description: t("integrations.bloggerPlatformDesc"),
      configured: bloggerConfigured,
      docUrl: "https://www.blogger.com",
      docLabel: "blogger.com",
    },
    {
      name: "Ghost",
      badge: ghostUrl && ghostApiKey ? "success" as const : "outline" as const,
      status: ghostUrl && ghostApiKey ? t("integrations.ghostConfigured") : t("integrations.ghostNotConfigured"),
      description: t("integrations.ghostPlatformDesc"),
      configured: !!(ghostUrl && ghostApiKey),
      docUrl: "https://ghost.org/docs/admin-api/",
      docLabel: t("integrations.ghostDocLabel"),
    },
    {
      name: "Miralinks",
      badge: "success" as const,
      status: t("integrations.builtIn"),
      description: t("integrations.miralinksPlatformDesc"),
      configured: true,
      docUrl: "https://miralinks.ru",
      docLabel: "miralinks.ru",
    },
    {
      name: "GoGetLinks",
      badge: "success" as const,
      status: t("integrations.builtIn"),
      description: t("integrations.gogetlinksPlatformDesc"),
      configured: true,
      docUrl: "https://gogetlinks.net",
      docLabel: "gogetlinks.net",
    },
  ];

  return (
    <PlanGate allowed={limits.hasProImageGen} featureName={t("integrations.title")} requiredPlan="PRO">
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Globe className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{t("integrations.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("integrations.subtitle")}</p>
          </div>
        </div>
      </div>

      {/* Status overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {platforms.map((p) => (
          <Card key={p.name} className={`bg-card border-border overflow-hidden ${p.configured ? "border-primary/20" : ""}`}>
            {p.configured && <div className="h-0.5 bg-primary/60" />}
            <CardContent className="pt-5 pb-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">{p.name}</span>
                <Badge variant={p.badge === "success" ? "default" : "outline"} className="text-[10px]">
                  {p.configured ? (
                    <><CheckCircle2 className="h-3 w-3 mr-1" />{p.status}</>
                  ) : (
                    <><AlertCircle className="h-3 w-3 mr-1" />{p.status}</>
                  )}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{p.description}</p>
              <a
                href={p.docUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                {p.docLabel} <ExternalLink className="h-3 w-3" />
              </a>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Blogger settings */}
      <Card className="bg-card border-border overflow-hidden">
        {blogger && <div className="h-0.5 bg-primary/60" />}
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            Blogger (Google)
            {blogger?.google_email && <Badge variant="outline" className="text-[10px]">{blogger.google_email}</Badge>}
          </CardTitle>
          <CardDescription className="text-xs">
            {t("integrations.bloggerDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {bloggerLoading ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> {t("common.loading")}
            </div>
          ) : !blogger ? (
            <Button onClick={connectBlogger} disabled={connectingBlogger} className="w-full sm:w-auto">
              {connectingBlogger ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Globe className="h-4 w-4 mr-2" />}
              {t("integrations.bloggerConnect")}
            </Button>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t("integrations.bloggerDefaultBlog")}</Label>
                  <Select value={blogger.default_blog_id || ""} onValueChange={setDefaultBlog}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("integrations.bloggerSelectBlog")} />
                    </SelectTrigger>
                    <SelectContent>
                      {blogger.blogs.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("integrations.bloggerNoBlogs")}</div>
                      ) : (
                        blogger.blogs.map(b => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" onClick={refreshBlogs} disabled={refreshingBlogs} size="sm">
                  {refreshingBlogs ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={disconnectBlogger}>
                  <Unplug className="h-3 w-3 mr-1.5" />
                  {t("integrations.bloggerDisconnect")}
                </Button>
                <Button variant="outline" size="sm" onClick={connectBlogger} disabled={connectingBlogger}>
                  {connectingBlogger ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1.5" />}
                  {t("integrations.bloggerReconnect")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Ghost settings */}
      <Card className="bg-card border-border overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">{t("integrations.ghostTitle")}</CardTitle>
          <CardDescription className="text-xs">
            {t("integrations.ghostDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Ghost URL</Label>
              <Input
                value={ghostUrl}
                onChange={(e) => setGhostUrl(e.target.value)}
                placeholder="https://myblog.ghost.io"
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Admin API Key</Label>
              <Input
                value={ghostApiKey}
                onChange={(e) => setGhostApiKey(e.target.value)}
                placeholder="id:secret"
                className="text-sm font-mono"
                type="password"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Telegra.ph info */}
      <Card className="bg-card border-primary/15 overflow-hidden">
        <div className="h-0.5 bg-primary/60" />
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Telegra.ph</CardTitle>
          <CardDescription className="text-xs">
            {t("integrations.telegraphDesc")}
          </CardDescription>
        </CardHeader>
      </Card>

      <Button onClick={handleSave} disabled={isSaving} className="w-full">
        <Save className="h-4 w-4 mr-2" />
        {isSaving ? t("integrations.saving") : t("integrations.save")}
      </Button>
    </div>
    </PlanGate>
  );
}
