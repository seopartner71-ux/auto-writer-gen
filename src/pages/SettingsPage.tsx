import { Settings, Sun, Moon, Languages } from "lucide-react";
import { useAuth } from "@/shared/hooks/useAuth";
import { useTheme } from "@/shared/hooks/useTheme";
import { useI18n } from "@/shared/hooks/useI18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function SettingsPage() {
  const { user, profile } = useAuth();
  const { theme, setTheme } = useTheme();
  const { lang, setLang, t } = useI18n();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
      </div>

      <div className="grid gap-6 max-w-lg">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.profile")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("settings.email")}</span>
              <span>{user?.email}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("settings.name")}</span>
              <span>{profile?.full_name ?? "—"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("settings.plan")}</span>
              <span className="text-primary uppercase font-medium">{profile?.plan ?? "basic"}</span>
            </div>
          </CardContent>
        </Card>

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
