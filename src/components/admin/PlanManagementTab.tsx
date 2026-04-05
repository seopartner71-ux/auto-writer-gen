import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, DollarSign, Plus, Trash2, GripVertical } from "lucide-react";
import { toast } from "sonner";

interface Feature {
  text_ru: string;
  text_en: string;
  included: boolean;
}

interface Plan {
  id: string;
  name: string;
  price_rub: number | null;
  price_usd: number | null;
  monthly_article_limit: number;
  description_ru: string | null;
  description_en: string | null;
  features: Feature[] | null;
}

export function PlanManagementTab() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Plan>>>({});
  const [featureEdits, setFeatureEdits] = useState<Record<string, Feature[]>>({});

  const { data: plans, isLoading } = useQuery({
    queryKey: ["admin-subscription-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .order("monthly_article_limit");
      if (error) throw error;
      return data as unknown as Plan[];
    },
  });

  const getVal = (plan: Plan, field: keyof Plan) => {
    return edits[plan.id]?.[field] ?? plan[field];
  };

  const setField = (planId: string, field: keyof Plan, value: unknown) => {
    setEdits((prev) => ({
      ...prev,
      [planId]: { ...prev[planId], [field]: value },
    }));
  };

  const getFeatures = (plan: Plan): Feature[] => {
    return featureEdits[plan.id] ?? (plan.features as Feature[]) ?? [];
  };

  const setFeatures = (planId: string, features: Feature[]) => {
    setFeatureEdits((prev) => ({ ...prev, [planId]: features }));
  };

  const updateFeature = (planId: string, index: number, field: keyof Feature, value: string | boolean) => {
    const features = [...getFeatures(plans!.find((p) => p.id === planId)!)];
    features[index] = { ...features[index], [field]: value };
    setFeatures(planId, features);
  };

  const addFeature = (planId: string) => {
    const plan = plans!.find((p) => p.id === planId)!;
    const features = [...getFeatures(plan), { text_ru: "", text_en: "", included: true }];
    setFeatures(planId, features);
  };

  const removeFeature = (planId: string, index: number) => {
    const plan = plans!.find((p) => p.id === planId)!;
    const features = getFeatures(plan).filter((_, i) => i !== index);
    setFeatures(planId, features);
  };

  const hasChanges = (planId: string) => {
    const fieldChanges = edits[planId] && Object.keys(edits[planId]).length > 0;
    const featChanges = !!featureEdits[planId];
    return fieldChanges || featChanges;
  };

  const handleSave = async (plan: Plan) => {
    if (!hasChanges(plan.id)) return;

    setSaving(plan.id);
    try {
      const changes: Record<string, unknown> = { ...(edits[plan.id] ?? {}) };
      if (featureEdits[plan.id]) {
        changes.features = featureEdits[plan.id];
      }

      const { error } = await supabase
        .from("subscription_plans")
        .update(changes)
        .eq("id", plan.id);
      if (error) throw error;

      toast.success(`Тариф «${plan.name}» обновлён`);
      setEdits((prev) => { const n = { ...prev }; delete n[plan.id]; return n; });
      setFeatureEdits((prev) => { const n = { ...prev }; delete n[plan.id]; return n; });
      queryClient.invalidateQueries({ queryKey: ["admin-subscription-plans"] });
      queryClient.invalidateQueries({ queryKey: ["subscription-plans"] });
      queryClient.invalidateQueries({ queryKey: ["subscription-plans-landing"] });
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
        Редактируйте цены, описания, лимиты и фичи тарифных планов. Изменения сразу отобразятся на странице Pricing.
      </p>

      <div className="space-y-8">
        {plans?.map((plan) => {
          const features = getFeatures(plan);
          const isSaving = saving === plan.id;
          const changed = hasChanges(plan.id);

          return (
            <Card key={plan.id} className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <DollarSign className="h-5 w-5 text-primary" />
                  {(getVal(plan, "name") as string) || plan.name} ({plan.id})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Name */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Название тарифа</Label>
                  <Input value={(getVal(plan, "name") as string) ?? ""}
                    onChange={(e) => setField(plan.id, "name", e.target.value)}
                    placeholder="NANO / PRO / FACTORY" />
                </div>

                {/* Prices & limit */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Цена USD</Label>
                    <Input type="number" value={String(getVal(plan, "price_usd") ?? 0)}
                      onChange={(e) => setField(plan.id, "price_usd", Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Цена RUB</Label>
                    <Input type="number" value={String(getVal(plan, "price_rub") ?? 0)}
                      onChange={(e) => setField(plan.id, "price_rub", Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Лимит статей</Label>
                    <Input type="number" value={String(getVal(plan, "monthly_article_limit") ?? 0)}
                      onChange={(e) => setField(plan.id, "monthly_article_limit", Number(e.target.value))} />
                  </div>
                </div>

                {/* Descriptions */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Описание (RU)</Label>
                    <Textarea rows={2} value={(getVal(plan, "description_ru") as string) ?? ""}
                      onChange={(e) => setField(plan.id, "description_ru", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Описание (EN)</Label>
                    <Textarea rows={2} value={(getVal(plan, "description_en") as string) ?? ""}
                      onChange={(e) => setField(plan.id, "description_en", e.target.value)} />
                  </div>
                </div>

                {/* Features */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Фичи тарифа</Label>
                  <div className="space-y-2">
                    {features.map((feat, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
                        <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                        <Input
                          placeholder="Текст RU"
                          className="text-xs h-8"
                          value={feat.text_ru}
                          onChange={(e) => updateFeature(plan.id, i, "text_ru", e.target.value)}
                        />
                        <Input
                          placeholder="Text EN"
                          className="text-xs h-8"
                          value={feat.text_en}
                          onChange={(e) => updateFeature(plan.id, i, "text_en", e.target.value)}
                        />
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Switch
                            checked={feat.included}
                            onCheckedChange={(v) => updateFeature(plan.id, i, "included", v)}
                          />
                          <span className="text-[10px] text-muted-foreground w-6">
                            {feat.included ? "Да" : "Нет"}
                          </span>
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                          onClick={() => removeFeature(plan.id, i)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => addFeature(plan.id)}>
                    <Plus className="h-4 w-4 mr-1" /> Добавить фичу
                  </Button>
                </div>

                <Button className="w-full" disabled={!changed || isSaving} onClick={() => handleSave(plan)}>
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
