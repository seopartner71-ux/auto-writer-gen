import { Settings, Sun, Moon, ImageIcon, Save, Lock, User, Palette, Languages, LifeBuoy, Send } from "lucide-react";
import { useAuth } from "@/shared/hooks/useAuth";
import { useTheme } from "@/shared/hooks/useTheme";
import { useI18n } from "@/shared/hooks/useI18n";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";
import { useQuery } from "@tanstack/react-query";
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
import { useState } from "react";

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
      toast.success("Профиль обновлён");
    } catch (e: any) {
      toast.error(e.message || "Ошибка при сохранении");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      toast.error("Пароль должен быть не менее 6 символов");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Пароли не совпадают");
      return;
    }
    setIsChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Пароль изменён");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e: any) {
      toast.error(e.message || "Ошибка при смене пароля");
    } finally {
      setIsChangingPassword(false);
    }
  };

  const plan = profile?.plan ?? "basic";

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Settings className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
            <p className="text-sm text-muted-foreground">Управление аккаунтом и настройками</p>
          </div>
        </div>
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* Profile */}
          <Card className="bg-card border-border overflow-hidden">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  {t("settings.profile")}
                </CardTitle>
                <Badge
                  variant="outline"
                  className="uppercase text-[10px] font-semibold tracking-wider border-primary/30 text-primary"
                >
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
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ваше имя"
                  className="text-sm"
                />
              </div>
              <Button
                onClick={handleSaveProfile}
                disabled={isSavingProfile}
                size="sm"
                className="w-full mt-2"
              >
                <Save className="h-4 w-4 mr-2" />
                {isSavingProfile ? "Сохранение..." : "Сохранить"}
              </Button>
            </CardContent>
          </Card>

          {/* Password */}
          <Card className="bg-card border-border overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary" />
                Безопасность
              </CardTitle>
              <CardDescription className="text-xs">Смена пароля аккаунта</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Новый пароль</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Минимум 6 символов"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Подтвердите пароль</Label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Повторите пароль"
                  className="text-sm"
                />
              </div>
              <Button
                onClick={handleChangePassword}
                disabled={isChangingPassword || !newPassword}
                size="sm"
                variant="outline"
                className="w-full"
              >
                <Lock className="h-4 w-4 mr-2" />
                {isChangingPassword ? "Смена..." : "Сменить пароль"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Appearance */}
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
                  <button
                    onClick={() => setTheme("dark")}
                    className={`flex flex-col items-center gap-2 rounded-lg border p-4 transition-all ${
                      theme === "dark"
                        ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                        : "border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    <Moon className={`h-5 w-5 ${theme === "dark" ? "text-primary" : "text-muted-foreground"}`} />
                    <span className={`text-xs font-medium ${theme === "dark" ? "text-primary" : "text-muted-foreground"}`}>
                      {t("settings.darkTheme")}
                    </span>
                  </button>
                  <button
                    onClick={() => setTheme("light")}
                    className={`flex flex-col items-center gap-2 rounded-lg border p-4 transition-all ${
                      theme === "light"
                        ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                        : "border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    <Sun className={`h-5 w-5 ${theme === "light" ? "text-primary" : "text-muted-foreground"}`} />
                    <span className={`text-xs font-medium ${theme === "light" ? "text-primary" : "text-muted-foreground"}`}>
                      {t("settings.lightTheme")}
                    </span>
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
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ru">🇷🇺 Русский</SelectItem>
                    <SelectItem value="en">🇬🇧 English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Pro usage */}
          {isPro && (
            <Card className="bg-card border-primary/15 overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-primary/60 via-primary to-primary/60" />
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-primary" />
                  Pro Visual Synthesis
                </CardTitle>
                <CardDescription className="text-xs">Лимит генерации изображений</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl font-bold text-foreground">{proImageCount}</p>
                    <p className="text-xs text-muted-foreground">из {proImageMax} генераций</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Осталось {Math.max(0, proImageMax - proImageCount)}
                  </span>
                </div>
                <Progress value={proImagePercent} className="h-2" />
              </CardContent>
            </Card>
          )}

          {/* Account info */}
          <Card className="bg-card border-border overflow-hidden">
            <CardContent className="pt-5 pb-4">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Аккаунт создан</span>
                  <span className="text-foreground">
                    {profile?.created_at
                      ? new Date(profile.created_at).toLocaleDateString("ru-RU", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })
                      : "—"}
                  </span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Лимит генераций</span>
                  <span className="text-foreground font-medium">{limits.maxGenerations} / мес</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
