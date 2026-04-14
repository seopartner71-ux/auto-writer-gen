import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save, Loader2, ShieldCheck, ExternalLink, Globe, Bitcoin } from "lucide-react";
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
  "polar_nano_product_id",
  "polar_basic_product_id",
  "polar_pro_product_id",
  "cryptomus_merchant_id",
  "cryptomus_api_key",
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
      const existingValues = Object.fromEntries(
        settings.map((setting) => [setting.key, setting.value ?? ""])
      ) as Record<string, string>;

      for (const key of ALL_KEYS) {
        const shouldPreserveExistingSecret =
          (key === "prodamus_api_key" || key === "cryptomus_api_key") && !rawValue.trim();
        const value = shouldPreserveExistingSecret
          ? (existingValues[key] ?? "")
          : rawValue;

        const { error } = await supabase
          .from("app_settings")
          .upsert(
            { key, value, updated_at: new Date().toISOString() },
            { onConflict: "key" }
          );
        if (error) throw error;
      }
      toast.success("Настройки платежей сохранены");
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
    <div className="space-y-6">
      {/* Prodamus (RUB) */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              Prodamus — Приём платежей (RU)
            </CardTitle>
            <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">RUB ₽</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Используется когда язык приложения = RU.{" "}
            <a href="https://prodamus.ru" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
              Prodamus <ExternalLink className="h-3 w-3" />
            </a>
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
              <p className="text-xs text-muted-foreground">Ключ для подписи вебхуков</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="prodamus_nano_link">Ссылка NANO (₽)</Label>
              <Input
                id="prodamus_nano_link"
                placeholder="https://example.prodamus.link/nano"
                value={values["prodamus_nano_link"] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, prodamus_nano_link: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">990 ₽/мес</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="prodamus_basic_link">Ссылка PRO (₽)</Label>
              <Input
                id="prodamus_basic_link"
                placeholder="https://example.prodamus.link/pro"
                value={values["prodamus_basic_link"] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, prodamus_basic_link: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">5 900 ₽/мес</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="prodamus_pro_link">Ссылка FACTORY (₽)</Label>
              <Input
                id="prodamus_pro_link"
                placeholder="https://example.prodamus.link/factory"
                value={values["prodamus_pro_link"] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, prodamus_pro_link: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">19 900 ₽/мес</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Polar (USD) */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Globe className="h-5 w-5 text-blue-500" />
              Polar — International Payments (EN)
            </CardTitle>
            <Badge variant="outline" className="text-blue-500 border-blue-500/30">USD $</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Используется когда язык приложения = EN.{" "}
            <a href="https://polar.sh" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
              Polar <ExternalLink className="h-3 w-3" />
            </a>
            . Product ID берутся из Polar Dashboard → Products.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="polar_nano_product_id">NANO Product ID ($)</Label>
              <Input
                id="polar_nano_product_id"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={values["polar_nano_product_id"] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, polar_nano_product_id: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">$19/mo</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="polar_basic_product_id">PRO Product ID ($)</Label>
              <Input
                id="polar_basic_product_id"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={values["polar_basic_product_id"] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, polar_basic_product_id: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">$79/mo</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="polar_pro_product_id">FACTORY Product ID ($)</Label>
              <Input
                id="polar_pro_product_id"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={values["polar_pro_product_id"] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, polar_pro_product_id: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">$249/mo</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cryptomus (Crypto) */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bitcoin className="h-5 w-5 text-orange-500" />
              Cryptomus — Crypto Payments (EN)
            </CardTitle>
            <Badge variant="outline" className="text-orange-500 border-orange-500/30">USDT / BTC</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Крипто-оплата для EN пользователей.{" "}
            <a href="https://cryptomus.com" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
              Cryptomus <ExternalLink className="h-3 w-3" />
            </a>
            . Merchant UUID и API Key берутся из Cryptomus Dashboard.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cryptomus_merchant_id">Merchant UUID</Label>
              <Input
                id="cryptomus_merchant_id"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={values["cryptomus_merchant_id"] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, cryptomus_merchant_id: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">UUID мерчанта из Cryptomus</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cryptomus_api_key">Payment API Key</Label>
              <Input
                id="cryptomus_api_key"
                type="password"
                placeholder="••••••••••••••••"
                value={values["cryptomus_api_key"] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, cryptomus_api_key: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Ключ для подписи платежей</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
        Сохранить все настройки
      </Button>
    </div>
  );
}
