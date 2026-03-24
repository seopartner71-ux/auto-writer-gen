import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, DollarSign } from "lucide-react";
import { toast } from "sonner";

interface Plan {
  id: string;
  name: string;
  price_rub: number | null;
  price_usd: number | null;
  monthly_article_limit: number;
  description_ru: string | null;
  description_en: string | null;
  can_export_html: boolean | null;
  can_use_clusters: boolean | null;
  can_use_paa: boolean | null;
}

export function PlanManagementTab() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);

  const { data: plans, isLoading } = useQuery({
    queryKey: ["admin-subscription-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .order("monthly_article_limit");
      if (error) throw error;
      return data as Plan[];
    },
  });

  const [edits, setEdits] = useState<Record<string, Partial<Plan>>>({});

  const getVal = (plan: Plan, field: keyof Plan) => {
    return edits[plan.id]?.[field] ?? plan[field];
  };

  const setField = (planId: string, field: keyof Plan, value: unknown) => {
    setEdits((prev) => ({
      ...prev,
      [planId]: { ...prev[planId], [field]: value },
    }));
  };

  const handleSave = async (plan: Plan) => {
    const changes = edits[plan.id];
    if (!changes) return;

    setSaving(plan.id);
    try {
      const { error } = await supabase
        .from("subscription_plans")
        .update(changes as Record<string, unknown>)
        .eq("id", plan.id);
      if (error) throw error;

      toast.success(`Тариф «${plan.name}» обновлён`);
      setEdits((prev) => {
        const next = { ...prev };
        delete next[plan.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["admin-subscription-plans"] });
      queryClient.invalidateQueries({ queryKey: ["subscription-plans"] });
    } catch (err) {
      console.error(err);
      toast.error("Не удалось сохранить изменения");
    } finally {
      setSaving(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Редактируйте цены, описания и лимиты тарифных планов. Изменения сразу отобразятся на странице Pricing.
      </p>

      <div className="grid gap-6 lg:grid-cols-3">
        {plans?.map((plan) => {
          const hasChanges = !!edits[plan.id] && Object.keys(edits[plan.id]).length > 0;
          const isSaving = saving === plan.id;

          return (
            <Card key={plan.id} className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <DollarSign className="h-5 w-5 text-primary" />
                  {plan.name} ({plan.id})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Цена USD</Label>
                    <Input
                      type="number"
                      value={getVal(plan, "price_usd") ?? 0}
                      onChange={(e) => setField(plan.id, "price_usd", Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Цена RUB</Label>
                    <Input
                      type="number"
                      value={getVal(plan, "price_rub") ?? 0}
                      onChange={(e) => setField(plan.id, "price_rub", Number(e.target.value))}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Лимит статей / мес.</Label>
                  <Input
                    type="number"
                    value={getVal(plan, "monthly_article_limit") ?? 0}
                    onChange={(e) => setField(plan.id, "monthly_article_limit", Number(e.target.value))}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Описание (RU)</Label>
                  <Textarea
                    rows={2}
                    value={(getVal(plan, "description_ru") as string) ?? ""}
                    onChange={(e) => setField(plan.id, "description_ru", e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Описание (EN)</Label>
                  <Textarea
                    rows={2}
                    value={(getVal(plan, "description_en") as string) ?? ""}
                    onChange={(e) => setField(plan.id, "description_en", e.target.value)}
                  />
                </div>

                <Button
                  className="w-full"
                  disabled={!hasChanges || isSaving}
                  onClick={() => handleSave(plan)}
                >
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Сохранить
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
