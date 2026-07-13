import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { CreditCostBadge } from "@/components/CreditCostBadge";
import { Sparkles, Lock } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

interface AiModel {
  id: string;
  model_key: string;
  display_name: string | null;
  description: string | null;
  credit_cost: number;
  min_plan: string;
  tier: string | null;
  is_active: boolean | null;
}

interface Props {
  value: string;
  onChange: (modelKey: string) => void;
  userPlan?: string; // 'nano' | 'basic' | 'pro'
  articleLength?: number;
  stealth?: boolean;
  label?: string;
  /** Article target language. When "en", RU-only models (e.g. Mistral) are hidden. */
  articleLang?: "ru" | "en";
}

const PLAN_RANK: Record<string, number> = { free: 0, basic: 1, pro: 2 };

// Models known to code-switch or degrade quality on English output.
// Kept in sync with server-side EN override in generate-article/bulk-generate.
const RU_ONLY_MODEL_PATTERNS: RegExp[] = [/mistral/i, /saiga/i, /yandex/i];
function isRuOnlyModel(modelKey: string, displayName?: string | null): boolean {
  const hay = `${modelKey} ${displayName || ""}`;
  return RU_ONLY_MODEL_PATTERNS.some((r) => r.test(hay));
}

const CYR = /[А-Яа-яЁё]/;

/**
 * AI Model picker with live credit cost badge.
 * Locks models that require a higher plan than the user's.
 */
export function ModelSelector({
  value,
  onChange,
  userPlan = "nano",
  articleLength = 3000,
  stealth = false,
  label,
  articleLang,
}: Props) {
  const { t, lang } = useI18n();
  const { data: models = [] } = useQuery({
    queryKey: ["ai-models-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_models")
        .select("*")
        .eq("is_active", true)
        .order("credit_cost");
      if (error) throw error;
      return (data || []) as AiModel[];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Filter RU-only models when writing in English
  const visibleModels = articleLang === "en"
    ? models.filter((m) => !isRuOnlyModel(m.model_key, m.display_name))
    : models;

  // Auto-select first available if current value is missing or filtered out
  useEffect(() => {
    if (visibleModels.length === 0) return;
    const currentVisible = visibleModels.find((m) => m.model_key === value);
    if (!value || !currentVisible) {
      const firstAvailable = visibleModels.find(
        (m) => (PLAN_RANK[m.min_plan] ?? 0) <= (PLAN_RANK[userPlan] ?? 0),
      );
      if (firstAvailable) onChange(firstAvailable.model_key);
    }
  }, [visibleModels, userPlan, articleLang]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = visibleModels.find((m) => m.model_key === value);
  // Hide Cyrillic descriptions when UI is EN or article target is EN.
  const hideDescription = !!current?.description && CYR.test(current.description) && (lang === "en" || articleLang === "en");

  return (
    <div className="space-y-1.5">
      {label && (
        <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3 w-3" /> {label}
        </Label>
      )}
      <div className="flex items-center gap-2">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder={t("model.selectPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {visibleModels.map((m) => {
              const locked = (PLAN_RANK[m.min_plan] ?? 0) > (PLAN_RANK[userPlan] ?? 0);
              return (
                <SelectItem key={m.id} value={m.model_key} disabled={locked}>
                  <div className="flex items-center justify-between gap-3 w-full">
                    <span className="flex items-center gap-2">
                      {locked && <Lock className="h-3 w-3 text-muted-foreground" />}
                      <span className="font-medium">{m.display_name || m.model_key}</span>
                      {m.tier && (
                        <span className="text-[10px] uppercase text-muted-foreground">
                          {m.tier}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-primary font-tech">
                      {m.credit_cost} {t("model.creditsShort")}
                      {locked && ` · ${m.min_plan.toUpperCase()}+`}
                    </span>
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {current && (
          <CreditCostBadge
            modelKey={current.model_key}
            length={articleLength}
            stealth={stealth}
          />
        )}
      </div>
      {current?.description && !hideDescription && (
        <p className="text-[11px] text-muted-foreground leading-tight">{current.description}</p>
      )}
      {articleLang === "en" && (
        <p className="text-[10px] text-muted-foreground/70 leading-tight">{t("model.ruOnlyHint")}</p>
      )}
    </div>
  );
}