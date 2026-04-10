import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save, Loader2, ShieldCheck, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface AppSetting {
  id: string;
  key: string;
  value: string;
  description: string | null;
}

const ALL_KEYS = [
  "prodamus_shop_id",
  "prodamus_api_key",
  "prodamus_nano_link",
  "prodamus_basic_link",
  "prodamus_pro_link",
];

export function PolarSettingsTab() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  const { data: settings = [], isLoading } = useQuery({
    queryKey: ["app-settings", "payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("*")
        .in("key", ALL_KEYS);
      if (error) throw error;
      return (data ?? []) as AppSetting[];
    },
  });

  useEffect(() => {
    const initial: Record<string, string> = {};
    settings.forEach((setting) => {
      initial[setting.key] = setting.value ?? "";
    });
    setValues(initial);
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const key of ALL_KEYS) {
        const value = values[key] ?? "";
        const { error } = await supabase
          .from("app_settings")
          .upsert(
            { key, value, updated_at: new Date().toISOString() },
            { onConflict: "key" }
          );
        if (error) throw error;
      }
      toast.success("Настройки Prodamus сохранены");
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    } catch (err) {
      console.error(err);
      toast.error("Ошибка сохранения настроек");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-emerald-500" />
            Prodamus — Приём платежей
          </CardTitle>
          <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">RUB</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Настройте интеграцию с{" "}
          <a href="https://prodamus.ru" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
            Prodamus <ExternalLink className="h-3 w-3" />
          </a>
          {" "}для приёма платежей. Конвертация валют происходит на стороне Prodamus.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="prodamus_shop_id">ID магазина (Shop ID)</Label>
            <Input
              id="prodamus_shop_id"
              placeholder="example.prodamus.link"
              value={values["prodamus_shop_id"] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, prodamus_shop_id: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">Домен вашего магазина в Prodamus</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prodamus_api_key">Секретный ключ (API Key)</Label>
            <Input
              id="prodamus_api_key"
              type="password"
              placeholder="••••••••••••••••"
              value={values["prodamus_api_key"] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, prodamus_api_key: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">Ключ для подписи вебхуков. Настройки → Интеграция</p>
          </div>
        </div>

        <Separator />

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="prodamus_nano_link">Ссылка оплаты NANO (₽)</Label>
            <Input
              id="prodamus_nano_link"
              placeholder="https://example.prodamus.link/nano-plan"
              value={values["prodamus_nano_link"] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, prodamus_nano_link: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">Тариф NANO — 990 ₽/мес</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prodamus_basic_link">Ссылка оплаты PRO (₽)</Label>
            <Input
              id="prodamus_basic_link"
              placeholder="https://example.prodamus.link/pro-plan"
              value={values["prodamus_basic_link"] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, prodamus_basic_link: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">Тариф PRO — 5 900 ₽/мес</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prodamus_pro_link">Ссылка оплаты FACTORY (₽)</Label>
            <Input
              id="prodamus_pro_link"
              placeholder="https://example.prodamus.link/factory-plan"
              value={values["prodamus_pro_link"] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, prodamus_pro_link: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">Тариф FACTORY — 19 900 ₽/мес</p>
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Сохранить
        </Button>
      </CardContent>
    </Card>
  );
}
