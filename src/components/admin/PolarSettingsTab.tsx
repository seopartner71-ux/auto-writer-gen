import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save, Loader2, CreditCard } from "lucide-react";

interface AppSetting {
  id: string;
  key: string;
  value: string;
  description: string | null;
}

export function PolarSettingsTab() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  const { data: settings, isLoading } = useQuery({
    queryKey: ["app-settings", "polar"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("*")
        .in("key", ["polar_basic_product_id", "polar_pro_product_id"]);
      if (error) throw error;
      const result = (data ?? []) as AppSetting[];
      const initial: Record<string, string> = {};
      result.forEach((s) => (initial[s.key] = s.value));
      setValues(initial);
      return result;
    },
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [key, value] of Object.entries(values)) {
        const { error } = await supabase
          .from("app_settings")
          .update({ value, updated_at: new Date().toISOString() })
          .eq("key", key);

        if (error) {
          // If row doesn't exist, insert it
          const { error: insertError } = await supabase
            .from("app_settings")
            .insert({ key, value });
          if (insertError) throw insertError;
        }
      }
      toast.success("Настройки Polar сохранены");
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
    <div className="space-y-4">
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CreditCard className="h-5 w-5 text-primary" />
            Polar.sh — Product IDs
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Укажите Product ID из вашего аккаунта Polar для каждого тарифного плана.
            Получить их можно в{" "}
            <a href="https://polar.sh" target="_blank" rel="noopener noreferrer" className="text-primary underline">
              Polar Dashboard
            </a>{" "}
            → Products.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="polar_basic">Basic Product ID</Label>
            <Input
              id="polar_basic"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={values["polar_basic_product_id"] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, polar_basic_product_id: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">Тариф Basic — $59/мес</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="polar_pro">Pro Product ID</Label>
            <Input
              id="polar_pro"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={values["polar_pro_product_id"] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, polar_pro_product_id: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">Тариф Pro — $169/мес</p>
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Сохранить
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
