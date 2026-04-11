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
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";
import { PlanGate } from "@/shared/components/PlanGate";

export default function IntegrationsPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { limits } = usePlanLimits();

  const [ghostUrl, setGhostUrl] = useState("");
  const [ghostApiKey, setGhostApiKey] = useState("");
  
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
