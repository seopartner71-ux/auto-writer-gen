import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, Globe, BarChart3, Search } from "lucide-react";
import { toast } from "sonner";

export function SeoIntegrationsTab() {
  const [metricaId, setMetricaId] = useState("");
  const [yandexVerification, setYandexVerification] = useState("");
  const [googleVerification, setGoogleVerification] = useState("");
  const [saving, setSaving] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("*")
        .limit(1)
        .single();
      if (data) {
        setSettingsId(data.id);
        setMetricaId(data.metrica_id || "");
        setYandexVerification(data.yandex_verification || "");
        setGoogleVerification(data.google_verification || "");
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    if (!settingsId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("site_settings")
        .update({
          metrica_id: metricaId.trim(),
          yandex_verification: yandexVerification.trim(),
          google_verification: googleVerification.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", settingsId);
      if (error) throw error;
      toast.success("SEO-настройки сохранены");
    } catch (e: any) {
      toast.error(e.message || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Яндекс.Метрика
          </CardTitle>
          <CardDescription className="text-xs">
            Введите числовой ID счётчика. Скрипт будет автоматически встроен на все страницы сайта. На localhost метрика не загружается.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">ID счётчика</Label>
            <Input
              value={metricaId}
              onChange={(e) => setMetricaId(e.target.value.replace(/\D/g, ""))}
              placeholder="987654321"
              className="text-sm font-mono max-w-xs"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Яндекс.Вебмастер
          </CardTitle>
          <CardDescription className="text-xs">
            Код верификации из мета-тега. Найдите его в Яндекс.Вебмастер → Настройки → Права доступа → Мета-тег.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Значение content мета-тега</Label>
            <Input
              value={yandexVerification}
              onChange={(e) => setYandexVerification(e.target.value)}
              placeholder="abc123def456"
              className="text-sm font-mono max-w-md"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            Google Search Console
          </CardTitle>
          <CardDescription className="text-xs">
            Код верификации из мета-тега. Найдите его в GSC → Настройки → Подтверждение права собственности → Тег HTML.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Значение content мета-тега</Label>
            <Input
              value={googleVerification}
              onChange={(e) => setGoogleVerification(e.target.value)}
              placeholder="google-site-verification=..."
              className="text-sm font-mono max-w-md"
            />
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving}>
        <Save className="h-4 w-4 mr-2" />
        {saving ? "Сохранение..." : "Сохранить настройки"}
      </Button>
    </div>
  );
}
