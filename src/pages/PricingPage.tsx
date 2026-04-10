import { useState } from "react";
import { Check, X, Zap, Crown, Sparkles, CreditCard, Loader2, Shield, Atom } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export default function PricingPage() {
  const { profile, user } = useAuth();
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const currentPlan = profile?.plan ?? "free";
  const isEn = lang === "en";
  const currentCredits = profile?.credits_amount ?? 0;

  const { data: paymentSettings } = useQuery({
    queryKey: ["app-settings", "prodamus"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("key, value")
        .in("key", ["prodamus_nano_link", "prodamus_basic_link", "prodamus_pro_link"]);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((s: { key: string; value: string }) => (map[s.key] = s.value));
      return map;
    },
  });

  const { data: dbPlans } = useQuery({
    queryKey: ["subscription-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .order("monthly_article_limit");
      if (error) throw error;
      return data as unknown as Array<{
        id: string; name: string; price_rub: number | null; price_usd: number | null;
        monthly_article_limit: number; description_ru: string | null; description_en: string | null;
        features: Array<{ text_ru: string; text_en: string; included: boolean }> | null;
      }>;
    },
  });

  const prodamusNanoLink = paymentSettings?.prodamus_nano_link ?? null;
  const prodamusBasicLink = paymentSettings?.prodamus_basic_link ?? null;
  const prodamusProLink = paymentSettings?.prodamus_pro_link ?? null;

  const getDbPlan = (id: string) => dbPlans?.find((p) => p.id === id);

  const fmtPrice = (id: string, fallbackRub: number) => {
    const db = getDbPlan(id);
    const rub = db?.price_rub ?? fallbackRub;
    return `${rub.toLocaleString("ru-RU")} ₽`;
  };

  const fmtCredits = (id: string, fallback: number) => getDbPlan(id)?.monthly_article_limit ?? fallback;
  const fmtName = (id: string, fallback: string) => getDbPlan(id)?.name ?? fallback;

  const fmtDesc = (id: string, fallbackRu: string, fallbackEn: string) => {
    const db = getDbPlan(id);
    return (isEn ? db?.description_en : db?.description_ru) || (isEn ? fallbackEn : fallbackRu);
  };

  const getFeatures = (id: string, fallback: Array<{ text: string; included: boolean }>) => {
    const db = getDbPlan(id);
    const dbF = db?.features as Array<{ text_ru: string; text_en: string; included: boolean }> | null;
    if (dbF?.length) return dbF.map(f => ({ text: isEn ? f.text_en : f.text_ru, included: f.included }));
    return fallback;
  };

  const pluralArticles = (n: number) => {
    if (isEn) return `${n} articles / mo`;
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n} статья / мес`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} статьи / мес`;
    return `${n} статей / мес`;
  };

  const plans = [
    {
      id: "free" as const,
      name: fmtName("free", "NANO"),
      price: fmtPrice("free", 990),
      period: t("pricing.perMonth"),
      icon: Atom,
      description: fmtDesc("free", "Для быстрого теста качества", "Quick quality test"),
      badge: null,
      credits: fmtCredits("free", 5),
      prodamusLink: prodamusNanoLink,
      showShield: false,
      features: getFeatures("free", [
        { text: isEn ? "5 articles per month" : "5 статей в месяц", included: true },
        { text: isEn ? "1 author profile" : "1 профиль автора", included: true },
        { text: isEn ? "HTML export" : "Экспорт в HTML", included: true },
      ]),
    },
    {
      id: "basic" as const,
      name: fmtName("basic", "PRO"),
      price: fmtPrice("basic", 5900),
      period: t("pricing.perMonth"),
      icon: Zap,
      description: fmtDesc("basic", "Идеальный баланс для SEO-профи", "Perfect balance for SEO pros"),
      badge: t("pricing.popular"),
      credits: fmtCredits("basic", 40),
      prodamusLink: prodamusBasicLink,
      showShield: true,
      features: getFeatures("basic", [
        { text: isEn ? "40 articles per month" : "40 статей в месяц", included: true },
        { text: isEn ? "5 author profiles" : "5 профилей авторов", included: true },
        { text: isEn ? "Uniqueness check" : "Проверка уникальности", included: true },
      ]),
    },
    {
      id: "pro" as const,
      name: fmtName("pro", "FACTORY"),
      price: fmtPrice("pro", 19900),
      period: t("pricing.perMonth"),
      icon: Crown,
      description: fmtDesc("pro", "Контентный завод для агентств", "Content factory for agencies"),
      badge: t("pricing.maximum"),
      credits: fmtCredits("pro", 150),
      prodamusLink: prodamusProLink,
      showShield: true,
      features: getFeatures("pro", [
        { text: isEn ? "150 articles per month" : "150 статей в месяц", included: true },
        { text: isEn ? "All AI models" : "Все модели AI", included: true },
        { text: isEn ? "Bulk generation" : "Массовая генерация", included: true },
      ]),
    },
  ];

  const handleSelectPlan = async (planId: string) => {
    if (!user) {
      toast.error(t("pricing.loginRequired"));
      return;
    }
    if (planId === currentPlan) return;

    const selectedPlan = plans.find(p => p.id === planId);

    const link = selectedPlan?.prodamusLink;
    if (!link) {
      toast.error(isEn ? "Payment not configured yet. Please contact the administrator." : "Оплата ещё не настроена. Обратитесь к администратору.");
      return;
    }

    const url = new URL(link);
    if (user.email) url.searchParams.set("customer_email", user.email);
    url.searchParams.set("customer_extra", user.id);
    url.searchParams.set("order_id", `plan_${planId}`);
    url.searchParams.set("do", window.location.origin + "/payment-success");
    window.open(url.toString(), "_blank");
  };

  return (
    <div className="space-y-8 overflow-x-hidden scrollbar-hide">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">{t("pricing.title")}</h1>
        <p className="text-muted-foreground max-w-lg mx-auto">{t("pricing.creditDesc")}</p>
      </div>

      {/* Balance card */}
      <div className="max-w-sm mx-auto">
        <Card className="bg-card border-border">
          <CardContent className="flex items-center justify-between py-4 px-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <CreditCard className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("pricing.yourBalance")}</p>
                <p className="text-lg font-bold">{currentCredits} {t("pricing.credits")}</p>
              </div>
            </div>
            <Badge variant="outline" className="uppercase">
              {fmtName(currentPlan, currentPlan.toUpperCase())}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Plans grid */}
      <div className="grid gap-6 lg:grid-cols-3 max-w-5xl mx-auto px-2 pt-4">
        {plans.map((plan) => {
          const isCurrentPlan = currentPlan === plan.id;
          const Icon = plan.icon;
          const isPopular = plan.badge === t("pricing.popular");
          return (
            <Card key={plan.id} className={`relative bg-card border-border flex flex-col overflow-visible ${isPopular ? "border-primary shadow-lg shadow-primary/10 ring-1 ring-primary" : ""}`}>
              {plan.badge && (
                <Badge className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 z-10 ${isPopular ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}>{plan.badge}</Badge>
              )}
              <CardHeader className="text-center pb-2 pt-6">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                <p className="text-xs text-muted-foreground">{plan.description}</p>
                <div className="pt-3">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-sm text-muted-foreground ml-1">{plan.period}</span>
                </div>
                <div className="pt-2">
                  <Badge variant="secondary" className="text-sm font-semibold px-3 py-1">
                    {pluralArticles(plan.credits)}
                  </Badge>
                </div>
                {plan.showShield && (
                  <div className="pt-2 flex items-center justify-center gap-1.5">
                    <Shield className="h-4 w-4 text-emerald-500" />
                    <span className="text-xs font-semibold text-emerald-500">98% Human Score</span>
                  </div>
                )}
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <ul className="space-y-2.5 flex-1 mb-6">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      {feature.included ? <Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> : <X className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />}
                      <span className={feature.included ? "text-foreground" : "text-muted-foreground/50"}>{feature.text}</span>
                    </li>
                  ))}
                </ul>
                {isCurrentPlan ? (
                  <Button className="w-full" variant="secondary" disabled>
                  {t("pricing.currentPlan")}
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    variant={isPopular ? "default" : "outline"}
                    onClick={() => handleSelectPlan(plan.id)}
                    disabled={false}
                  >
                    {isEn ? "Pay" : "Оплатить"}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="text-center text-xs text-muted-foreground max-w-lg mx-auto">{t("pricing.creditNote")}</div>
    </div>
  );
}
