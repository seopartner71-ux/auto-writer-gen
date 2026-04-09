import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save, Loader2, CreditCard, ShieldCheck, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface AppSetting {
  id: string;
  key: string;
  value: string;
  description: string | null;
}

const ALL_KEYS = [
  "polar_basic_product_id",
  "polar_pro_product_id",
  "prodamus_shop_id",
  "prodamus_api_key",
  "prodamus_basic_link",
  "prodamus_pro_link",
];

export function PolarSettingsTab() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const { data: settings, isLoading } = useQuery({
    queryKey: ["app-settings", "payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("*")
        .in("key", ALL_KEYS);
      if (error) throw error;
      const result = (data ?? []) as AppSetting[];
      const initial: Record<string, string> = {};
      result.forEach((s) => (initial[s.key] = s.value));
      setValues(initial);
      return result;
    },
  });

  const handleSave = async (section: "polar" | "prodamus") => {
    setSaving(section);
    const keys = section === "polar"
      ? ["polar_basic_product_id", "polar_pro_product_id"]
      : ["prodamus_shop_id", "prodamus_api_key", "prodamus_basic_link", "prodamus_pro_link"];

    try {
      for (const key of keys) {
        const value = values[key] ?? "";
        const { error } = await supabase
          .from("app_settings")
          .update({ value, updated_at: new Date().toISOString() })
          .eq("key", key);

        if (error) {
          const { error: insertError } = await supabase
            .from("app_settings")
            .insert({ key, value });
          if (insertError) throw insertError;
        }
      }
      toast.success(section === "polar" ? "Настройки Polar сохранены" : "Настройки Prodamus сохранены");
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    } catch (err) {
      console.error(err);
      toast.error("Ошибка сохранения настроек");
    } finally {
      setSaving(null);
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
      {/* Prodamus */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              Prodamus — Приём платежей в РФ
            </CardTitle>
            <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">RUB</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Настройте интеграцию с{" "}
            <a href="https://prodamus.ru" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
              Prodamus <ExternalLink className="h-3 w-3" />
            </a>
            {" "}для приёма платежей в рублях.
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="prodamus_basic_link">Ссылка оплаты Basic (₽)</Label>
              <Input
                id="prodamus_basic_link"
                placeholder="https://example.prodamus.link/basic-plan"
                value={values["prodamus_basic_link"] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, prodamus_basic_link: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Ссылка на форму оплаты тарифа Basic</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="prodamus_pro_link">Ссылка оплаты Pro (₽)</Label>
              <Input
                id="prodamus_pro_link"
                placeholder="https://example.prodamus.link/pro-plan"
                value={values["prodamus_pro_link"] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, prodamus_pro_link: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Ссылка на форму оплаты тарифа Pro</p>
            </div>
          </div>

          <Button onClick={() => handleSave("prodamus")} disabled={saving === "prodamus"} className="w-full sm:w-auto">
            {saving === "prodamus" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Сохранить Prodamus
          </Button>
        </CardContent>
      </Card>

      {/* Polar */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <CreditCard className="h-5 w-5 text-primary" />
              Polar.sh — International Payments
            </CardTitle>
            <Badge variant="outline" className="text-primary border-primary/30">USD</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Укажите Product ID из{" "}
            <a href="https://polar.sh" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
              Polar Dashboard <ExternalLink className="h-3 w-3" />
            </a>
            {" "}→ Products.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="polar_basic">Basic Product ID</Label>
              <Input
                id="polar_basic"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={values["polar_basic_product_id"] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, polar_basic_product_id: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Тариф Basic — $65/мес</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="polar_pro">Pro Product ID</Label>
              <Input
                id="polar_pro"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={values["polar_pro_product_id"] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, polar_pro_product_id: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Тариф Pro — $220/мес</p>
            </div>
          </div>

          <Button onClick={() => handleSave("polar")} disabled={saving === "polar"} className="w-full sm:w-auto">
            {saving === "polar" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Сохранить Polar
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
