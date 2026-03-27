import { Settings, Sun, Moon, ImageIcon, Save, Lock, User, Palette, Languages, LifeBuoy, Send } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/shared/hooks/useAuth";
import { useTheme } from "@/shared/hooks/useTheme";
import { useI18n } from "@/shared/hooks/useI18n";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useState, useEffect } from "react";

import { RefreshCw } from "lucide-react";

export default function SettingsPage() {
  const { user, profile } = useAuth();
  const { theme, setTheme } = useTheme();
  const { lang, setLang, t } = useI18n();
  const { isPro, limits } = usePlanLimits();

  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [isSubmittingTicket, setIsSubmittingTicket] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? "");
    }
  }, [profile]);

  const handleClearCache = async () => {
    setIsClearingCache(true);
    try {
      await queryClient.invalidateQueries();
      queryClient.clear();
      toast.success(t("settings.cacheCleared"));
    } catch {
      toast.error("Error");
    } finally {
      setTimeout(() => setIsClearingCache(false), 1000);
    }
  };

  const currentPlan = profile?.plan ?? "basic";
  const { data: planLimit } = useQuery({
    queryKey: ["subscription-plan-limit", currentPlan],
    queryFn: async () => {
      const { data } = await supabase
        .from("subscription_plans")
        .select("monthly_article_limit")
        .eq("id", currentPlan)
        .single();
      return data?.monthly_article_limit ?? limits.maxGenerations;
    },
  });

  const { data: proImageCount = 0 } = useQuery({
    queryKey: ["pro-image-count"],
    queryFn: async () => {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const { count } = await supabase
        .from("usage_logs")
        .select("*", { count: "exact", head: true })
        .eq("action", "pro_image_generation")
        .gte("created_at", startOfMonth.toISOString());
      return count || 0;
    },
    enabled: isPro,
  });

  const proImageMax = limits.maxProImages;
  const proImagePercent = proImageMax > 0 ? Math.round((proImageCount / proImageMax) * 100) : 0;

  const handleSaveProfile = async () => {
    if (!user) return;
    setIsSavingProfile(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName.trim() || null })
        .eq("id", user.id);
      if (error) throw error;
      toast.success(t("settings.profileUpdated"));
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      toast.error(t("settings.passwordMin6"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("settings.passwordsNoMatch"));
      return;
    }
    setIsChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success(t("settings.passwordChanged"));
      setNewPassword("");
      setConfirmPassword("");
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleSubmitTicket = async () => {
    if (!user) return;
    if (!ticketSubject.trim() || !ticketMessage.trim()) {
      toast.error(t("settings.fillFields"));
      return;
    }
    setIsSubmittingTicket(true);
    try {
      const { error } = await supabase.from("support_tickets" as any).insert({
        user_id: user.id,
        subject: ticketSubject.trim(),
        message: ticketMessage.trim(),
      } as any);
      if (error) throw error;
      toast.success(t("settings.ticketSent"));
      setTicketSubject("");
      setTicketMessage("");
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setIsSubmittingTicket(false);
    }
  };

  const plan = profile?.plan ?? "basic";

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Settings className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-6">
          <Card className="bg-card border-border overflow-hidden">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  {t("settings.profile")}
                </CardTitle>
                <Badge variant="outline" className="uppercase text-[10px] font-semibold tracking-wider border-primary/30 text-primary">
                  {plan}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("settings.email")}</Label>
                <Input value={user?.email ?? ""} disabled className="bg-muted/50 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("settings.name")}</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t("settings.namePlaceholder")} className="text-sm" />
              </div>
              <Button onClick={handleSaveProfile} disabled={isSavingProfile} size="sm" className="w-full mt-2">
                <Save className="h-4 w-4 mr-2" />
                {isSavingProfile ? t("settings.saving") : t("settings.save")}
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-card border-border overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary" />
                {t("settings.security")}
              </CardTitle>
              <CardDescription className="text-xs">{t("settings.changePassword")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("settings.newPassword")}</Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t("settings.passwordPlaceholder")} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("settings.confirmPassword")}</Label>
                <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={t("settings.repeatPassword")} className="text-sm" />
              </div>
              <Button onClick={handleChangePassword} disabled={isChangingPassword || !newPassword} size="sm" variant="outline" className="w-full">
                <Lock className="h-4 w-4 mr-2" />
                {isChangingPassword ? t("settings.changingPassword") : t("settings.changePasswordBtn")}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-card border-border overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Palette className="h-4 w-4 text-primary" />
                {t("settings.appearance")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2.5">
                <Label className="text-xs text-muted-foreground">{t("settings.theme")}</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setTheme("dark")} className={`flex flex-col items-center gap-2 rounded-lg border p-4 transition-all ${theme === "dark" ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border hover:border-muted-foreground/30"}`}>
                    <Moon className={`h-5 w-5 ${theme === "dark" ? "text-primary" : "text-muted-foreground"}`} />
                    <span className={`text-xs font-medium ${theme === "dark" ? "text-primary" : "text-muted-foreground"}`}>{t("settings.darkTheme")}</span>
                  </button>
                  <button onClick={() => setTheme("light")} className={`flex flex-col items-center gap-2 rounded-lg border p-4 transition-all ${theme === "light" ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border hover:border-muted-foreground/30"}`}>
                    <Sun className={`h-5 w-5 ${theme === "light" ? "text-primary" : "text-muted-foreground"}`} />
                    <span className={`text-xs font-medium ${theme === "light" ? "text-primary" : "text-muted-foreground"}`}>{t("settings.lightTheme")}</span>
                  </button>
                </div>
              </div>
              <Separator />
              <div className="space-y-2.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Languages className="h-3.5 w-3.5" />
                  {t("settings.language")}
                </Label>
                <Select value={lang} onValueChange={(v) => setLang(v as "ru" | "en")}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ru">🇷🇺 Русский</SelectItem>
                    <SelectItem value="en">🇬🇧 English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {isPro && (
            <Card className="bg-card border-primary/15 overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-primary/60 via-primary to-primary/60" />
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-primary" />
                  Pro Visual Synthesis
                </CardTitle>
                <CardDescription className="text-xs">{t("settings.proImageLimit")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Генерация изображений</Label>
                    <p className="text-xs text-muted-foreground">Включить/отключить генерацию Pro-обложек</p>
                  </div>
                  <Switch
                    checked={localStorage.getItem("pro_image_enabled") === "true"}
                    onCheckedChange={(checked) => {
                      localStorage.setItem("pro_image_enabled", String(checked));
                      toast.success(checked ? "Генерация изображений включена" : "Генерация изображений отключена");
                    }}
                  />
                </div>
                <Separator />
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl font-bold text-foreground">{proImageCount}</p>
                    <p className="text-xs text-muted-foreground">{t("bench.ofTotal")} {proImageMax} {t("settings.ofGenerations")}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t("settings.remaining")} {Math.max(0, proImageMax - proImageCount)}
                  </span>
                </div>
                <Progress value={proImagePercent} className="h-2" />
              </CardContent>
            </Card>
          )}

          <Card className="bg-card border-border overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-primary" />
                {t("settings.cache")}
              </CardTitle>
              <CardDescription className="text-xs">{t("settings.cacheDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={handleClearCache} disabled={isClearingCache} size="sm" variant="outline" className="w-full">
                <RefreshCw className={`h-4 w-4 mr-2 ${isClearingCache ? "animate-spin" : ""}`} />
                {isClearingCache ? t("settings.clearing") : t("settings.clearCache")}
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-card border-border overflow-hidden">
            <CardContent className="pt-5 pb-4">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("settings.accountCreated")}</span>
                  <span className="text-foreground">
                    {profile?.created_at
                      ? new Date(profile.created_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "long", year: "numeric" })
                      : "-"}
                  </span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("settings.genLimit")}</span>
                  <span className="text-foreground font-medium">{limits.maxGenerations} {t("settings.perMonth")}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="bg-card border-border overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <LifeBuoy className="h-4 w-4 text-primary" />
            {t("settings.support")}
          </CardTitle>
          <CardDescription className="text-xs">{t("settings.supportDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("settings.subject")}</Label>
            <Input value={ticketSubject} onChange={(e) => setTicketSubject(e.target.value)} placeholder={t("settings.subjectPlaceholder")} className="text-sm" maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("settings.message")}</Label>
            <Textarea value={ticketMessage} onChange={(e) => setTicketMessage(e.target.value)} placeholder={t("settings.messagePlaceholder")} className="text-sm min-h-[120px] resize-y" maxLength={2000} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{ticketMessage.length}/2000</span>
            <Button onClick={handleSubmitTicket} disabled={isSubmittingTicket || !ticketSubject.trim() || !ticketMessage.trim()} size="sm">
              <Send className="h-4 w-4 mr-2" />
              {isSubmittingTicket ? t("settings.sending") : t("settings.sendTicket")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
