import { useState, useEffect } from "react";
import { Check, X, Zap, Crown, Sparkles, CreditCard, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

export default function PricingPage() {
  const { profile, user } = useAuth();
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const isEn = lang === "en";
  const currentCredits = profile?.credits_amount ?? 0;
  const currentPlan = profile?.plan ?? "free";
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: polarSettings } = useQuery({
    queryKey: ["app-settings", "polar"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("key, value")
        .in("key", ["polar_basic_product_id", "polar_pro_product_id", "polar_single_product_id"]);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((s: { key: string; value: string }) => (map[s.key] = s.value));
      return map;
    },
  });

  useEffect(() => {
    const checkoutId = searchParams.get("checkout_id");
    if (!checkoutId || !user) return;
    const verifyCheckout = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("polar-checkout", {
          body: { action: "verify", checkoutId },
        });
        if (error) throw error;
        if (data?.status === "succeeded") {
          toast.success(isEn ? "Payment successful! Credits added." : "Оплата прошла успешно! Кредиты зачислены.");
          queryClient.invalidateQueries({ queryKey: ["profile"] });
        } else if (data?.status === "failed") {
          toast.error(isEn ? "Payment failed. Please try again." : "Оплата не прошла. Попробуйте снова.");
        }
      } catch (err) {
        console.error("Checkout verification error:", err);
      }
      setSearchParams({});
    };
    verifyCheckout();
  }, [searchParams, user]);

  const plans = [
    {
      id: "single",
      name: isEn ? "1 Credit" : "1 Кредит",
      subtitle: isEn ? "Pay As You Go" : "Разовый запуск",
      price: "230 ₽",
      period: isEn ? "/ single credit" : "/ за 1 кредит",
      unitInfo: null,
      icon: Sparkles,
      badge: null,
      polarProductId: polarSettings?.polar_single_product_id ?? null,
      features: [
        { text: isEn ? "Full SERP analysis" : "Полный SERP-анализ", included: true },
        { text: isEn ? "Stealth Engine (Human Score 95+)" : "Stealth Engine (Human Score 95+)", included: true },
        { text: isEn ? "WordPress export" : "Экспорт в WordPress", included: true },
        { text: isEn ? "LSI keywords & optimization" : "LSI-ключи и оптимизация", included: true },
        { text: isEn ? "HTML & Markdown export" : "HTML и Markdown экспорт", included: true },
        { text: isEn ? "Bulk Factory" : "Фабрика (Bulk)", included: false },
        { text: isEn ? "Priority support" : "Приоритетная поддержка", included: false },
        { text: isEn ? "API access" : "Доступ к API", included: false },
      ],
    },
    {
      id: "basic",
      name: isEn ? "10 Credits" : "10 Кредитов",
      subtitle: isEn ? "PRO" : "PRO Пакет",
      price: "1 900 ₽",
      period: isEn ? "/ package" : "/ пакет",
      unitInfo: isEn ? "Only 190 ₽ per article" : "Всего 190 ₽ за статью",
      icon: Zap,
      badge: isEn ? "Most Popular" : "Популярный",
      polarProductId: polarSettings?.polar_basic_product_id ?? null,
      features: [
        { text: isEn ? "Everything in 1 Credit" : "Всё из пакета 1 Кредит", included: true },
        { text: isEn ? "Bulk Factory access" : "Доступ к Фабрике (Bulk)", included: true },
        { text: isEn ? "Priority support" : "Приоритетная поддержка", included: true },
        { text: isEn ? "Persona Engine" : "Persona Engine", included: true },
        { text: isEn ? "JSON-LD schema" : "JSON-LD разметка", included: true },
        { text: isEn ? "Uniqueness check" : "Проверка уникальности", included: true },
        { text: isEn ? "API access" : "Доступ к API", included: false },
        { text: isEn ? "Multi-user support" : "Многопользовательский доступ", included: false },
      ],
    },
    {
      id: "pro",
      name: isEn ? "30 Credits" : "30 Кредитов",
      subtitle: isEn ? "Agency" : "Agency Пакет",
      price: "4 900 ₽",
      period: isEn ? "/ package" : "/ пакет",
      unitInfo: isEn ? "Only 163 ₽ per article" : "Всего 163 ₽ за статью",
      icon: Crown,
      badge: isEn ? "Best Value" : "Лучшая цена",
      polarProductId: polarSettings?.polar_pro_product_id ?? null,
      features: [
        { text: isEn ? "Everything in PRO" : "Всё из PRO пакета", included: true },
        { text: isEn ? "API access" : "Доступ к API", included: true },
        { text: isEn ? "Multi-user support" : "Многопользовательский доступ", included: true },
        { text: isEn ? "GEO Radar" : "GEO Radar", included: true },
        { text: isEn ? "White-label reports" : "White-label отчёты", included: true },
        { text: isEn ? "All AI models" : "Все AI модели", included: true },
        { text: isEn ? "Anti-AI detection" : "Анти-AI детекция", included: true },
        { text: isEn ? "Dedicated manager" : "Персональный менеджер", included: true },
      ],
    },
  ];

  const handleBuy = async (plan: typeof plans[0]) => {
    if (!user) {
      toast.error(isEn ? "Please log in first" : "Сначала войдите в аккаунт");
      return;
    }
    if (!plan.polarProductId) {
      toast.error(isEn ? "Payment not configured yet." : "Оплата ещё не настроена.");
      return;
    }
    setLoadingPlan(plan.id);
    try {
      const { data, error } = await supabase.functions.invoke("polar-checkout", {
        body: { action: "create", productId: plan.polarProductId },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        throw new Error("No checkout URL");
      }
    } catch (err) {
      console.error("Checkout error:", err);
      toast.error(isEn ? "Checkout failed. Try again." : "Ошибка оплаты. Попробуйте снова.");
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">
          {isEn ? "Credit Packages" : "Пакеты кредитов"}
        </h1>
        <p className="text-muted-foreground max-w-lg mx-auto">
          {isEn ? "Buy credits, generate expert SEO articles. No subscriptions." : "Покупайте кредиты, генерируйте экспертные SEO-статьи. Без подписок."}
        </p>
      </div>

      {/* 1 Credit = 1 Article */}
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-2.5 bg-primary/10 border border-primary/20 rounded-full px-5 py-2.5">
          <CreditCard className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold text-primary">
            {isEn ? "1 Credit = 1 SEO Article" : "1 Кредит = 1 SEO-статья"}
          </span>
        </div>
      </div>

      {/* Balance */}
      <div className="max-w-sm mx-auto">
        <Card className="bg-card border-border">
          <CardContent className="flex items-center justify-between py-4 px-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <CreditCard className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{isEn ? "Your balance" : "Ваш баланс"}</p>
                <p className="text-lg font-bold">{currentCredits} {isEn ? "credits" : "кредитов"}</p>
              </div>
            </div>
            <Badge variant="outline" className="uppercase">{currentPlan}</Badge>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3 max-w-5xl mx-auto">
        {plans.map((plan) => {
          const Icon = plan.icon;
          const isPopular = plan.badge === (isEn ? "Most Popular" : "Популярный");
          const isLoading = loadingPlan === plan.id;
          return (
            <Card key={plan.id} className={`relative bg-card border-border flex flex-col ${isPopular ? "border-primary shadow-lg shadow-primary/10 scale-[1.02]" : ""}`}>
              {plan.badge && (
                <Badge className={`absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 ${isPopular ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}>
                  {plan.badge}
                </Badge>
              )}
              <CardHeader className="text-center pb-2 pt-6">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                <p className="text-xs text-muted-foreground">{plan.subtitle}</p>
                <div className="pt-3">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-sm text-muted-foreground ml-1">{plan.period}</span>
                </div>
                {plan.unitInfo && (
                  <div className="pt-2">
                    <Badge variant="secondary" className="text-xs font-semibold px-3 py-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                      {plan.unitInfo}
                    </Badge>
                  </div>
                )}
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <ul className="space-y-2.5 flex-1 mb-6">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      {f.included ? <Check className="h-4 w-4 text-success shrink-0 mt-0.5" /> : <X className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />}
                      <span className={f.included ? "text-foreground" : "text-muted-foreground/50"}>{f.text}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  variant={isPopular ? "default" : "outline"}
                  disabled={isLoading}
                  onClick={() => handleBuy(plan)}
                >
                  {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {isEn ? `Buy ${plan.name}` : `Купить ${plan.name}`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="text-center text-xs text-muted-foreground max-w-lg mx-auto">
        {isEn
          ? "1 credit = 1 complete expert article with SERP analysis, LSI keywords, and full optimization. No hidden fees."
          : "1 кредит = 1 полноценная экспертная статья с анализом SERP, LSI-ключами и полной оптимизацией. Без скрытых комиссий."}
      </div>
    </div>
  );
}
