import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Save, DollarSign, Plus, Trash2, GripVertical, Shield, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { FEATURE_FLAG_LABELS, DEFAULT_PLAN_CONFIG, PlanConfig } from "@/shared/api/types";

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
  feature_flags: Record<string, unknown> | null;
}

const BOOLEAN_FLAGS = [
  "hasCalendar",
  "hasUniquenessCheck",
  "hasJsonLdSchema",
  "hasFullSerp",
  "hasAntiAiCheck",
  "hasBulkMode",
  "hasWordPress",
  "hasProImageGen",
  "hasMiralinks",
  "hasGoGetLinks",
  "hasProjects",
  "hasRadar",
] as const;

const NUMERIC_FLAGS = [
  { key: "maxAuthorProfiles", label: { ru: "Макс. авторских профилей (-1 = безлимит)", en: "Max author profiles (-1 = unlimited)" } },
  { key: "maxProImages", label: { ru: "Макс. PRO изображений (0 = выкл)", en: "Max PRO images (0 = disabled)" } },
] as const;

export function PlanManagementTab() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Plan>>>({});
  const [featureEdits, setFeatureEdits] = useState<Record<string, Feature[]>>({});
  const [flagEdits, setFlagEdits] = useState<Record<string, Record<string, unknown>>>({});
  const [modelsEdits, setModelsEdits] = useState<Record<string, string>>({});

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

  // Feature flags helpers
  const getFlags = (plan: Plan): Record<string, unknown> => {
    const base = plan.feature_flags ?? DEFAULT_PLAN_CONFIG;
    return { ...DEFAULT_PLAN_CONFIG, ...base, ...(flagEdits[plan.id] ?? {}) };
  };

  const setFlag = (planId: string, key: string, value: unknown) => {
    setFlagEdits((prev) => ({
      ...prev,
      [planId]: { ...(prev[planId] ?? {}), [key]: value },
    }));
  };

  const getModelsString = (plan: Plan): string => {
    if (modelsEdits[plan.id] !== undefined) return modelsEdits[plan.id];
    const flags = getFlags(plan);
    return Array.isArray(flags.models) ? (flags.models as string[]).join(", ") : "";
  };

  const hasChanges = (planId: string) => {
    const fieldChanges = edits[planId] && Object.keys(edits[planId]).length > 0;
    const featChanges = !!featureEdits[planId];
    const flagChanges = !!flagEdits[planId];
    const modelChanges = modelsEdits[planId] !== undefined;
    return fieldChanges || featChanges || flagChanges || modelChanges;
  };

  const handleSave = async (plan: Plan) => {
    if (!hasChanges(plan.id)) return;

    setSaving(plan.id);
    try {
      const changes: Record<string, unknown> = { ...(edits[plan.id] ?? {}) };
      if (featureEdits[plan.id]) {
        changes.features = featureEdits[plan.id];
      }

      // Build feature_flags
      if (flagEdits[plan.id] || modelsEdits[plan.id] !== undefined) {
        const currentFlags = { ...DEFAULT_PLAN_CONFIG, ...(plan.feature_flags ?? {}) };
        const merged = { ...currentFlags, ...(flagEdits[plan.id] ?? {}) };
        
        // Parse models from text
        if (modelsEdits[plan.id] !== undefined) {
          merged.models = modelsEdits[plan.id]
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean);
        }
        
        changes.feature_flags = merged;
      }

      const { error } = await supabase
        .from("subscription_plans")
        .update(changes)
        .eq("id", plan.id);
      if (error) throw error;

      toast.success(`Тариф «${plan.name}» обновлён`);
      setEdits((prev) => { const n = { ...prev }; delete n[plan.id]; return n; });
      setFeatureEdits((prev) => { const n = { ...prev }; delete n[plan.id]; return n; });
      setFlagEdits((prev) => { const n = { ...prev }; delete n[plan.id]; return n; });
      setModelsEdits((prev) => { const n = { ...prev }; delete n[plan.id]; return n; });
      queryClient.invalidateQueries({ queryKey: ["admin-subscription-plans"] });
      queryClient.invalidateQueries({ queryKey: ["subscription-plans"] });
      queryClient.invalidateQueries({ queryKey: ["subscription-plans-landing"] });
      queryClient.invalidateQueries({ queryKey: ["plan-feature-flags"] });
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
        Редактируйте цены, описания, лимиты, фичи и <strong>привязку функционала</strong> к тарифным планам. Изменения сразу отобразятся на странице Pricing и в логике доступа.
      </p>

      <div className="space-y-8">
        {plans?.map((plan) => {
          const features = getFeatures(plan);
          const flags = getFlags(plan);
          const isSaving = saving === plan.id;
          const changed = hasChanges(plan.id);

          return (
            <Card key={plan.id} className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <DollarSign className="h-5 w-5 text-primary" />
                  {(getVal(plan, "name") as string) || plan.name}
                  <Badge variant="outline" className="text-xs font-mono">{plan.id}</Badge>
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

                <Separator />

                {/* Feature Flags - the new section */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    <Label className="text-sm font-semibold">Привязка функционала</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Включайте/выключайте доступ к функциям для этого тарифа. Изменения применяются мгновенно после сохранения.
                  </p>

                  {/* Boolean flags grid */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {BOOLEAN_FLAGS.map((flagKey) => {
                      const label = FEATURE_FLAG_LABELS[flagKey];
                      const isEnabled = Boolean(flags[flagKey]);
                      return (
                        <div
                          key={flagKey}
                          className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-2.5"
                        >
                          <span className="text-xs font-medium">{label?.ru ?? flagKey}</span>
                          <Switch
                            checked={isEnabled}
                            onCheckedChange={(v) => setFlag(plan.id, flagKey, v)}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* Numeric flags */}
                  <div className="grid grid-cols-2 gap-3">
                    {NUMERIC_FLAGS.map((nf) => (
                      <div key={nf.key} className="space-y-1.5">
                        <Label className="text-xs">{nf.label.ru}</Label>
                        <Input
                          type="number"
                          value={String(flags[nf.key] ?? 0)}
                          onChange={(e) => setFlag(plan.id, nf.key, Number(e.target.value))}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Models */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <Label className="text-xs font-semibold">Доступные AI модели</Label>
                    </div>
                    <Textarea
                      rows={2}
                      className="text-xs font-mono"
                      placeholder="google/gemini-2.5-flash, openai/gpt-5-nano"
                      value={getModelsString(plan)}
                      onChange={(e) => setModelsEdits((prev) => ({ ...prev, [plan.id]: e.target.value }))}
                    />
                    <p className="text-[10px] text-muted-foreground">Через запятую. Пример: google/gemini-2.5-flash, openai/gpt-5</p>
                  </div>
                </div>

                <Separator />

                {/* Features (pricing page display) */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Фичи тарифа (отображение на Pricing)</Label>
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
