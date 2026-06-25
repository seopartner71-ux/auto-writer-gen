import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Lock, Unlock } from "lucide-react";

export function RegistrationSettingsTab() {
  const queryClient = useQueryClient();

  const { data: enabled, isLoading } = useQuery({
    queryKey: ["app-settings", "registration_enabled"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "registration_enabled")
        .maybeSingle();
      if (error) throw error;
      return (data?.value ?? "true").toLowerCase() === "true";
    },
  });

  const [local, setLocal] = useState<boolean>(true);
  useEffect(() => {
    if (typeof enabled === "boolean") setLocal(enabled);
  }, [enabled]);

  const updateFlag = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert(
          { key: "registration_enabled", value: next ? "true" : "false" },
          { onConflict: "key" }
        );
      if (error) throw error;
    },
    onSuccess: (_d, next) => {
      queryClient.invalidateQueries({ queryKey: ["app-settings", "registration_enabled"] });
      toast.success(next ? "Регистрация открыта" : "Регистрация закрыта");
    },
    onError: (e: any) => {
      toast.error(e.message);
      // Revert
      if (typeof enabled === "boolean") setLocal(enabled);
    },
  });

  return (
    <div className="space-y-4">
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {local ? <Unlock className="h-4 w-4 text-emerald-500" /> : <Lock className="h-4 w-4 text-amber-500" />}
            Регистрация новых пользователей
          </CardTitle>
          <CardDescription>
            Когда тумблер выключен, страница <code>/register</code> показывает сообщение
            «Регистрация временно закрыта» и форма скрыта. Существующие пользователи продолжают входить.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
            <div className="space-y-1">
              <Label className="text-sm font-medium">
                {local ? "Регистрация открыта" : "Регистрация закрыта"}
              </Label>
              <p className="text-xs text-muted-foreground">
                Все новые заявки создаются в статусе <strong>pending</strong> и ждут ручной активации админом.
              </p>
            </div>
            <Switch
              checked={local}
              disabled={isLoading || updateFlag.isPending}
              onCheckedChange={(next) => {
                setLocal(next);
                updateFlag.mutate(next);
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}