import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Check, X, Star, Zap, Crown, Sparkles, Radar } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function SectionPricing() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const isEn = lang === "en";
  const [yearly, setYearly] = useState(false);

  const { data: dbPlans } = useQuery({
    queryKey: ["subscription-plans-landing"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subscription_plans").select("*").order("monthly_article_limit");
      if (error) throw error;
      return data as unknown as Array<{
        id: string; name: string; price_rub: number | null; price_usd: number | null;
        monthly_article_limit: number; description_ru: string | null; description_en: string | null;
        features: Array<{ text_ru: string; text_en: string; included: boolean }> | null;
      }>;
    },
  });

  const getDbPlan = (id: string) => dbPlans?.find((p) => p.id === id);
  const fmtPrice = (id: string, fallbackUsd: number, fallbackRub: string) => {
    const db = getDbPlan(id);
    const base = isEn ? (db?.price_usd ?? fallbackUsd) : (db?.price_rub ?? parseInt(fallbackRub.replace(/\D/g, "")));
    const val = yearly ? Math.round(base * 0.8) : base;
    return isEn ? `$${val}` : `${val.toLocaleString("ru-RU")} ₽`;
  };
  const fmtCredits = (id: string, fallback: number) => getDbPlan(id)?.monthly_article_limit ?? fallback;
  const getFeatures = (id: string, fallback: Array<{ text: string; included: boolean }>) => {
    const db = getDbPlan(id);
    const dbF = db?.features as Array<{ text_ru: string; text_en: string; included: boolean }> | null;
    if (dbF?.length) return dbF.map(f => ({ text: isEn ? f.text_en : f.text_ru, included: f.included }));
    return fallback;
  };

  const plans = [
    {
      id: "free", name: "Starter", icon: Sparkles,
      price: isEn ? "$0" : "0 ₽", period: t("lp.priceFree"),
      credits: fmtCredits("free", 5), popular: false,
      features: getFeatures("free", [
        { text: t("pricing.f.gens5") || (isEn ? "5 credits / month" : "5 кредитов / месяц"), included: true },
        { text: t("lp.priceF1b"), included: true },
        { text: t("lp.priceF1c"), included: true },
        { text: t("lp.priceF1d"), included: true },
        { text: "Factory", included: false },
        { text: "AI Radar & GEO", included: false },
      ]),
      cta: t("lp.priceStart"),
    },
    {
      id: "basic", name: "PRO", icon: Zap,
      price: fmtPrice("basic", 59, "4900"), period: `/ ${t("lp.priceMonth")}`,
      credits: fmtCredits("basic", 30), popular: true, exclusive: "AI Radar & GEO",
      features: getFeatures("basic", [
        { text: t("lp.priceF2a"), included: true },
        { text: t("lp.priceF2b"), included: true },
        { text: t("lp.priceF2c"), included: true },
        { text: t("lp.priceF2d"), included: true },
        { text: t("lp.priceF2e"), included: true },
        { text: t("lp.priceF2f"), included: true },
      ]),
      cta: t("lp.priceUpgrade"),
    },
    {
      id: "pro", name: "Enterprise", icon: Crown,
      price: fmtPrice("pro", 169, "12400"), period: `/ ${t("lp.priceMonth")}`,
      credits: fmtCredits("pro", 100), popular: false,
      features: getFeatures("pro", [
        { text: t("lp.priceF3a"), included: true },
        { text: t("lp.priceF3b"), included: true },
        { text: t("lp.priceF3c"), included: true },
        { text: t("lp.priceF3d"), included: true },
        { text: t("lp.priceF3e"), included: true },
        { text: isEn ? "Bulk generation" : "Массовая генерация", included: true },
      ]),
      cta: t("lp.priceContact"),
    },
  ];

  return (
    <section className="relative min-h-screen flex items-center justify-center snap-start overflow-hidden py-20">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] rounded-full bg-primary/[0.06] blur-[200px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-6xl">
        <motion.div initial={{ opacity: 0, y: 50 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
          className="text-center mb-12">
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-black leading-[0.95]" style={{ letterSpacing: "-0.06em" }}>
            {t("lp.pricingTitle")}
          </h2>
          <p className="mt-4 text-muted-foreground text-[15px] leading-[1.6]">{t("lp.pricingSub")}</p>
        </motion.div>

        {/* Toggle */}
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
          className="flex items-center justify-center gap-3 mb-14">
          <span className={`text-sm font-tech ${!yearly ? "text-foreground" : "text-muted-foreground"}`}>{t("lp.priceMonthly")}</span>
          <button onClick={() => setYearly(!yearly)}
            className={`relative w-12 h-6 rounded-full transition-colors ${yearly ? "bg-primary" : "bg-white/10"}`}>
            <motion.div className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white"
              animate={{ x: yearly ? 24 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
          </button>
          <span className={`text-sm font-tech ${yearly ? "text-foreground" : "text-muted-foreground"}`}>{t("lp.priceYearly")}</span>
          {yearly && (
            <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
              className="text-[10px] font-tech font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              -20%
            </motion.span>
          )}
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {plans.map((plan, i) => {
            const Icon = plan.icon;
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className={`relative rounded-3xl border-t border-l border-r border-b p-7 backdrop-blur-2xl transition-all hover:scale-[1.02] duration-300 ${
                  plan.popular
                    ? "border-t-primary/40 border-l-primary/20 border-r-primary/10 border-b-primary/[0.05] bg-primary/[0.04]"
                    : "border-t-white/15 border-l-white/8 border-r-white/4 border-b-white/[0.02] bg-white/[0.02]"
                }`}
                style={{
                  boxShadow: plan.popular
                    ? "0 20px 50px rgba(0,0,0,0.5), 0 0 40px rgba(139,92,246,0.15), inset 0 1px 0 rgba(139,92,246,0.1)"
                    : "0 20px 50px rgba(0,0,0,0.4)",
                }}
              >
                {/* PRO neon glow animation */}
                {plan.popular && (
                  <>
                    <div className="absolute -inset-px rounded-3xl opacity-30 animate-pulse" style={{
                      background: "linear-gradient(135deg, transparent 30%, hsl(270 60% 60% / 0.3) 50%, transparent 70%)",
                    }} />
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 bg-gradient-to-r from-primary to-[#3b82f6] text-white text-[10px] font-tech font-bold px-4 py-1 rounded-full uppercase tracking-wider">
                      <Star className="h-3 w-3" /> Popular
                    </div>
                  </>
                )}

                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${plan.popular ? "bg-primary/10" : "bg-white/[0.04]"}`}>
                      <Icon className={`h-5 w-5 ${plan.popular ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <h3 className="text-xl font-bold" style={{ letterSpacing: "-0.04em" }}>{plan.name}</h3>
                  </div>

                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="text-4xl font-black" style={{ letterSpacing: "-0.06em" }}>{plan.price}</span>
                    <span className="text-muted-foreground text-sm font-tech">{plan.period}</span>
                  </div>
                  <div className="mb-6">
                    <span className="text-xs font-tech text-primary bg-primary/10 px-2.5 py-1 rounded-full">
                      {plan.credits} {t("pricing.articlesPerMonth") || (isEn ? "articles / mo" : "статей / мес")}
                    </span>
                  </div>

                  <ul className="space-y-2.5 mb-8">
                    {plan.features.map((f, fi) => (
                      <li key={fi} className="flex items-start gap-2.5 text-[13px]">
                        {f.included ? <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" /> : <X className="h-4 w-4 text-muted-foreground/30 mt-0.5 shrink-0" />}
                        <span className={f.included ? "text-foreground/80" : "text-muted-foreground/40"}>{f.text}</span>
                      </li>
                    ))}
                    {plan.exclusive && (
                      <li className="flex items-start gap-2.5 text-[13px]">
                        <Radar className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <span className="text-primary font-semibold">{plan.exclusive}</span>
                        <span className="text-[9px] font-tech bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">{t("lp.priceExcl")}</span>
                      </li>
                    )}
                  </ul>

                  <button onClick={() => navigate("/register")}
                    className={`w-full py-3.5 rounded-xl text-sm font-tech font-semibold transition-all ${
                      plan.popular
                        ? "bg-gradient-to-r from-primary to-[#3b82f6] text-white hover:shadow-[0_0_30px_rgba(139,92,246,0.4)]"
                        : "border border-white/10 bg-white/[0.03] text-foreground hover:bg-white/[0.06]"
                    }`}>
                    {plan.cta}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>

        <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.4 }}
          className="text-center mt-10 text-sm text-muted-foreground">
          {t("lp.priceSocial")}
        </motion.p>
      </div>
    </section>
  );
}
