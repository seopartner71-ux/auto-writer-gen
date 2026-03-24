import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Save, ExternalLink, Globe, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function IntegrationsPage() {
  const { user } = useAuth();
  const { t } = useI18n();

  const [ghostUrl, setGhostUrl] = useState("");
  const [ghostApiKey, setGhostApiKey] = useState("");
  const [mediumToken, setMediumToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("ghost_url, ghost_api_key, medium_token")
        .eq("id", user.id)
        .single();
      if (data) {
        setGhostUrl((data as any).ghost_url || "");
        setGhostApiKey((data as any).ghost_api_key || "");
        setMediumToken((data as any).medium_token || "");
      }
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
          medium_token: mediumToken.trim() || null,
        } as any)
        .eq("id", user.id);
      if (error) throw error;
      toast.success("Интеграции сохранены");
    } catch (e: any) {
      toast.error(e.message || "Ошибка сохранения");
    } finally {
      setIsSaving(false);
    }
  };

  const platforms = [
    {
      name: "Telegra.ph",
      badge: "success" as const,
      status: "Готово",
      description: "Моментальная публикация без авторизации. Статья публикуется в один клик прямо из редактора.",
      configured: true,
      docUrl: "https://telegra.ph",
      docLabel: "telegra.ph",
    },
    {
      name: "Ghost",
      badge: ghostUrl && ghostApiKey ? "success" as const : "outline" as const,
      status: ghostUrl && ghostApiKey ? "Настроено" : "Требует настройки",
      description: "Популярная SEO-платформа для блогов. Статьи публикуются как черновики через Admin API.",
      configured: !!(ghostUrl && ghostApiKey),
      docUrl: "https://ghost.org/docs/admin-api/",
      docLabel: "Документация Ghost",
    },
    {
      name: "Medium",
      badge: mediumToken ? "success" as const : "outline" as const,
      status: mediumToken ? "Настроено" : "Требует настройки",
      description: "Крупнейшая блог-платформа. Статьи публикуются как черновики через Integration Token.",
      configured: !!mediumToken,
      docUrl: "https://medium.com/me/settings/security",
      docLabel: "Получить токен",
    },
  ];

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Globe className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Интеграции</h1>
            <p className="text-sm text-muted-foreground">Подключите блог-платформы для публикации статей в один клик</p>
          </div>
        </div>
      </div>

      {/* Status overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

      {/* Ghost settings */}
      <Card className="bg-card border-border overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Настройка Ghost</CardTitle>
          <CardDescription className="text-xs">
            Введите URL вашего Ghost-блога и Admin API Key. Ключ можно создать в Ghost Admin → Settings → Integrations → Custom.
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

      {/* Medium settings */}
      <Card className="bg-card border-border overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Настройка Medium</CardTitle>
          <CardDescription className="text-xs">
            Перейдите в Settings → Security and apps → Integration tokens, создайте токен и вставьте его сюда.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Integration Token</Label>
            <Input
              value={mediumToken}
              onChange={(e) => setMediumToken(e.target.value)}
              placeholder="Вставьте токен из настроек Medium"
              className="text-sm font-mono"
              type="password"
            />
          </div>
        </CardContent>
      </Card>

      {/* Telegra.ph info */}
      <Card className="bg-card border-primary/15 overflow-hidden">
        <div className="h-0.5 bg-primary/60" />
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Telegra.ph</CardTitle>
          <CardDescription className="text-xs">
            Не требует настройки. Нажмите кнопку «Telegra.ph» в редакторе статьи — публикация произойдёт мгновенно.
          </CardDescription>
        </CardHeader>
      </Card>

      <Button onClick={handleSave} disabled={isSaving} className="w-full">
        <Save className="h-4 w-4 mr-2" />
        {isSaving ? "Сохранение..." : "Сохранить интеграции"}
      </Button>
    </div>
  );
}
