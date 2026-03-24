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
  const currentPlan = profile?.plan ?? "free";
  const isEn = lang === "en";
  const currentCredits = profile?.credits_amount ?? 0;
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Fetch Polar product IDs from app_settings
  const { data: polarSettings } = useQuery({
    queryKey: ["app-settings", "polar"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("key, value")
        .in("key", ["polar_basic_product_id", "polar_pro_product_id"]);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((s: { key: string; value: string }) => (map[s.key] = s.value));
      return map;
    },
  });

  // Fetch subscription plans from DB
  const { data: dbPlans } = useQuery({
    queryKey: ["subscription-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .order("monthly_article_limit");
      if (error) throw error;
      return data as Array<{
        id: string; name: string; price_rub: number | null; price_usd: number | null;
        monthly_article_limit: number; description_ru: string | null; description_en: string | null;
      }>;
    },
  });

  const basicProductId = polarSettings?.polar_basic_product_id ?? null;
  const proProductId = polarSettings?.polar_pro_product_id ?? null;

  // Verify checkout on return from Polar
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
          toast.success(isEn ? "Payment successful! Your plan has been upgraded." : "Оплата прошла успешно! Ваш тариф обновлён.");
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
      id: "free" as const, name: "Free", price: isEn ? "$0" : "0 ₽", period: t("pricing.perMonth"), icon: Sparkles,
      description: t("pricing.freeDesc"), badge: null, credits: 5, polarProductId: null as string | null,
      features: [
        { text: t("pricing.f.gens5"), included: true },
        { text: t("pricing.f.basicResearch"), included: true },
        { text: t("pricing.f.1profile"), included: true },
        { text: t("pricing.f.htmlExport"), included: true },
        { text: t("pricing.f.basicSeo"), included: true },
        { text: t("pricing.f.modelsFlashLite"), included: true },
        { text: t("pricing.f.uniquenessCheck"), included: false },
        { text: t("pricing.f.jsonLd"), included: false },
        { text: t("pricing.f.calendarPlanner"), included: false },
        { text: t("pricing.f.prioritySupport"), included: false },
      ],
    },
    {
      id: "basic" as const, name: t("pricing.basicName"), price: isEn ? "$59" : "4 900 ₽", period: t("pricing.perMonth"), icon: Zap,
      description: t("pricing.basicDesc"), badge: t("pricing.popular"), credits: 30, polarProductId: basicProductId,
      features: [
        { text: t("pricing.f.gens30"), included: true },
        { text: t("pricing.f.fullSerp"), included: true },
        { text: t("pricing.f.5profiles"), included: true },
        { text: t("pricing.f.htmlMdExport"), included: true },
        { text: t("pricing.f.advancedSeo"), included: true },
        { text: t("pricing.f.modelsFlashNano"), included: true },
        { text: t("pricing.f.uniquenessCheck"), included: true },
        { text: t("pricing.f.jsonLd"), included: true },
        { text: t("pricing.f.calendarPlanner"), included: false },
        { text: t("pricing.f.prioritySupport"), included: false },
      ],
    },
    {
      id: "pro" as const, name: "Pro", price: isEn ? "$169" : "12 400 ₽", period: t("pricing.perMonth"), icon: Crown,
      description: t("pricing.proDesc"), badge: t("pricing.maximum"), credits: 100, polarProductId: proProductId,
      features: [
        { text: t("pricing.f.gens100"), included: true },
        { text: t("pricing.f.fullSerpComp"), included: true },
        { text: t("pricing.f.unlimitedProfiles"), included: true },
        { text: t("pricing.f.allExports"), included: true },
        { text: t("pricing.f.fullSeo"), included: true },
        { text: t("pricing.f.allModels"), included: true },
        { text: t("pricing.f.bulkGen"), included: true },
        { text: t("pricing.f.uniquenessAntiAi"), included: true },
        { text: t("pricing.f.allSchema"), included: true },
        { text: t("pricing.f.support247"), included: true },
      ],
    },
  ];

  const handleSelectPlan = async (planId: string) => {
    if (!user) {
      toast.error(t("pricing.loginRequired"));
      return;
    }
    if (planId === currentPlan) return;

    const selectedPlan = plans.find(p => p.id === planId);

    // Free plan — just update directly
    if (planId === "free") {
      const { error } = await supabase.from("profiles").update({ plan: planId, credits_amount: 5, monthly_limit: 5 }).eq("id", user.id);
      if (error) {
        toast.error(t("pricing.changeFailed"));
      } else {
        toast.success(`${t("pricing.planChanged")} Free.`);
        queryClient.invalidateQueries({ queryKey: ["profile"] });
      }
      return;
    }

    // Paid plans — redirect to Polar checkout
    if (!selectedPlan?.polarProductId) {
      toast.error(
        isEn
          ? "Payment not configured yet. Please contact the administrator."
          : "Оплата ещё не настроена. Обратитесь к администратору."
      );
      return;
    }

    setLoadingPlan(planId);

    try {
      const { data, error } = await supabase.functions.invoke("polar-checkout", {
        body: {
          action: "create",
          productId: selectedPlan.polarProductId,
        },
      });

      if (error) throw error;

      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err) {
      console.error("Checkout error:", err);
      toast.error(
        isEn
          ? "Failed to create checkout. Please try again."
          : "Не удалось создать сессию оплаты. Попробуйте снова."
      );
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">{t("pricing.title")}</h1>
        <p className="text-muted-foreground max-w-lg mx-auto">{t("pricing.creditDesc")}</p>
      </div>

      <div className="max-w-sm mx-auto">
        <Card className="bg-card border-border">
          <CardContent className="flex items-center justify-between py-4 px-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center"><CreditCard className="h-5 w-5 text-primary" /></div>
              <div>
                <p className="text-xs text-muted-foreground">{t("pricing.yourBalance")}</p>
                <p className="text-lg font-bold">{currentCredits} {t("pricing.credits")}</p>
              </div>
            </div>
            <Badge variant="outline" className="uppercase">{currentPlan}</Badge>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3 max-w-5xl mx-auto">
        {plans.map((plan) => {
          const isCurrentPlan = currentPlan === plan.id;
          const Icon = plan.icon;
          const isPopular = plan.badge === t("pricing.popular");
          const isLoading = loadingPlan === plan.id;
          return (
            <Card key={plan.id} className={`relative bg-card border-border flex flex-col ${isPopular ? "border-primary shadow-lg shadow-primary/10 scale-[1.02]" : ""}`}>
              {plan.badge && (
                <Badge className={`absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 ${isPopular ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}>{plan.badge}</Badge>
              )}
              <CardHeader className="text-center pb-2 pt-6">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10"><Icon className="h-6 w-6 text-primary" /></div>
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                <p className="text-xs text-muted-foreground">{plan.description}</p>
                <div className="pt-3"><span className="text-4xl font-bold">{plan.price}</span><span className="text-sm text-muted-foreground ml-1">{plan.period}</span></div>
                <div className="pt-2"><Badge variant="secondary" className="text-sm font-semibold px-3 py-1">{plan.credits} {t("pricing.articlesPerMonth")}</Badge></div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <ul className="space-y-2.5 flex-1 mb-6">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      {feature.included ? <Check className="h-4 w-4 text-success shrink-0 mt-0.5" /> : <X className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />}
                      <span className={feature.included ? "text-foreground" : "text-muted-foreground/50"}>{feature.text}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  variant={isCurrentPlan ? "secondary" : isPopular ? "default" : "outline"}
                  disabled={isCurrentPlan || isLoading}
                  onClick={() => handleSelectPlan(plan.id)}
                >
                  {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {isCurrentPlan ? t("pricing.currentPlan") : t("pricing.selectPlan")}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="text-center text-xs text-muted-foreground max-w-lg mx-auto">{t("pricing.creditNote")}</div>
    </div>
  );
}
