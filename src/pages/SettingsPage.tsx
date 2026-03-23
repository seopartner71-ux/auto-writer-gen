import { Settings, Sun, Moon, ImageIcon, Save, Lock, User } from "lucide-react";
import { useAuth } from "@/shared/hooks/useAuth";
import { useTheme } from "@/shared/hooks/useTheme";
import { useI18n } from "@/shared/hooks/useI18n";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useState } from "react";

export default function SettingsPage() {
  const { user, profile } = useAuth();
  const { theme, setTheme } = useTheme();
  const { lang, setLang, t } = useI18n();
  const { isPro, limits } = usePlanLimits();

  // Profile editing state
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Password change state
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
      </div>

      <div className="grid gap-6 max-w-lg">
        {/* Profile card with editing */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="h-5 w-5" />
              {t("settings.profile")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("settings.email")}</Label>
              <Input value={user?.email ?? ""} disabled className="bg-muted" />
              <p className="text-xs text-muted-foreground">Email нельзя изменить</p>
            </div>
            <div className="space-y-2">
              <Label>{t("settings.name")}</Label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ваше имя"
              />
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">{t("settings.plan")}</span>
              <span className="text-primary uppercase font-medium">{profile?.plan ?? "basic"}</span>
            </div>
            <Button
              onClick={handleSaveProfile}
              disabled={isSavingProfile}
              size="sm"
              className="w-full"
            >
              <Save className="h-4 w-4 mr-2" />
              {isSavingProfile ? "Сохранение..." : "Сохранить профиль"}
            </Button>
          </CardContent>
        </Card>

        {/* Password change card */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Смена пароля
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Новый пароль</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Минимум 6 символов"
              />
            </div>
            <div className="space-y-2">
              <Label>Подтвердите пароль</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Повторите пароль"
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

        {isPro && (
          <Card className="bg-card border-purple-500/20">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ImageIcon className="h-5 w-5 text-purple-400" />
                Pro Visual Synthesis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Генерации в этом месяце</span>
                <span className="font-medium text-purple-400">
                  {proImageCount} / {proImageMax}
                </span>
              </div>
              <Progress value={proImagePercent} className="h-2" />
              <p className="text-xs text-muted-foreground">
                Осталось {Math.max(0, proImageMax - proImageCount)} Pro-генераций
              </p>
            </CardContent>
          </Card>
        )}

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.appearance")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("settings.theme")}</Label>
              <div className="flex gap-2">
                <Button
                  variant={theme === "dark" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTheme("dark")}
                  className="flex-1"
                >
                  <Moon className="h-4 w-4 mr-2" />
                  {t("settings.darkTheme")}
                </Button>
                <Button
                  variant={theme === "light" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTheme("light")}
                  className="flex-1"
                >
                  <Sun className="h-4 w-4 mr-2" />
                  {t("settings.lightTheme")}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("settings.language")}</Label>
              <Select value={lang} onValueChange={(v) => setLang(v as "ru" | "en")}>
                <SelectTrigger>
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
      </div>
    </div>
  );
}
