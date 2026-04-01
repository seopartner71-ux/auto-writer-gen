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
        { text: t("pricing.f.basicResearch"), included: true },
        { text: t("pricing.f.1profile"), included: true },
        { text: t("pricing.f.htmlExport"), included: true },
        { text: t("pricing.f.basicSeo"), included: true },
        { text: t("pricing.f.modelsFlashLite"), included: true },
        { text: t("pricing.f.uniquenessCheck"), included: false },
        { text: t("pricing.f.jsonLd"), included: false },
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
        { text: t("pricing.f.gens30"), included: true },
        { text: t("pricing.f.fullSerp"), included: true },
        { text: t("pricing.f.5profiles"), included: true },
        { text: t("pricing.f.htmlMdExport"), included: true },
        { text: t("pricing.f.advancedSeo"), included: true },
        { text: t("pricing.f.modelsFlashNano"), included: true },
        { text: t("pricing.f.uniquenessCheck"), included: true },
        { text: t("pricing.f.jsonLd"), included: true },
        { text: isEn ? "Bulk Factory & Schedule" : "Factory + Расписание", included: true },
        { text: t("pricing.f.miralinks"), included: false },
      ]),
      cta: t("lp.priceUpgrade"),
    },
    {
      id: "pro", name: "Agency", icon: Crown,
      price: fmtPrice("pro", 169, "12400"), period: `/ ${t("lp.priceMonth")}`,
      credits: fmtCredits("pro", 100), popular: false,
      features: getFeatures("pro", [
        { text: t("pricing.f.gens100"), included: true },
        { text: t("pricing.f.fullSerpComp"), included: true },
        { text: t("pricing.f.unlimitedProfiles"), included: true },
        { text: t("pricing.f.allExports"), included: true },
        { text: t("pricing.f.fullSeo"), included: true },
        { text: t("pricing.f.allModels"), included: true },
        { text: t("pricing.f.bulkGen"), included: true },
        { text: t("pricing.f.uniquenessAntiAi"), included: true },
        { text: t("pricing.f.miralinks"), included: true },
        { text: t("pricing.f.gogetlinks"), included: true },
      ]),
      cta: t("lp.priceContact"),
    },
  ];

  return (
    <section id="pricing" className="relative py-36 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full bg-primary/[0.04] blur-[250px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-6xl">
        <motion.div initial={{ opacity: 0, y: 25 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="text-center mb-14">
          <h2 className="text-3xl md:text-5xl font-extrabold tracking-[-0.03em] text-white">
            {t("lp.pricingTitle")}
          </h2>
          <p className="mt-4 text-muted-foreground/50 text-[15px]">{t("lp.pricingSub")}</p>
        </motion.div>

        {/* Toggle */}
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
          className="flex items-center justify-center gap-3 mb-16">
          <span className={`text-sm font-tech ${!yearly ? "text-foreground/80" : "text-muted-foreground/40"}`}>{t("lp.priceMonthly")}</span>
          <button onClick={() => setYearly(!yearly)}
            className={`relative w-12 h-6 rounded-full transition-colors ${yearly ? "bg-primary/70" : "bg-white/[0.08]"}`}>
            <motion.div className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white"
              animate={{ x: yearly ? 24 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
          </button>
          <span className={`text-sm font-tech ${yearly ? "text-foreground/80" : "text-muted-foreground/40"}`}>{t("lp.priceYearly")}</span>
          {yearly && (
            <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
              className="text-[10px] font-tech font-bold text-emerald-400/80 bg-emerald-500/[0.06] border border-emerald-500/15 px-2 py-0.5 rounded-full">
              -20%
            </motion.span>
          )}
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan, i) => {
            const Icon = plan.icon;
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className={`relative rounded-2xl border p-8 transition-all hover:scale-[1.01] duration-300 ${
                  plan.popular
                    ? "border-primary/25 bg-primary/[0.03] shadow-[0_0_50px_rgba(139,92,246,0.08)]"
                    : "border-white/[0.05] bg-white/[0.015]"
                }`}
              >
                {/* Border beam for PRO */}
                {plan.popular && (
                  <>
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 bg-gradient-to-r from-primary to-[#3b82f6] text-white text-[10px] font-tech font-bold px-4 py-1 rounded-full uppercase tracking-wider">
                      <Star className="h-3 w-3" /> Popular
                    </div>
                    {/* Animated border beam */}
                    <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
                      <div className="absolute inset-[-1px] rounded-2xl"
                        style={{
                          background: "conic-gradient(from var(--border-angle, 0deg), transparent 60%, rgba(139,92,246,0.3) 80%, transparent 100%)",
                          animation: "border-beam 4s linear infinite",
                        }}
                      />
                      <div className="absolute inset-[1px] rounded-[15px] bg-[#060609]/95" />
                    </div>
                  </>
                )}

                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-5">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${plan.popular ? "bg-primary/[0.08]" : "bg-white/[0.02]"}`}>
                      <Icon className={`h-5 w-5 ${plan.popular ? "text-primary/80" : "text-muted-foreground/50"}`} />
                    </div>
                    <h3 className="text-xl font-bold text-white/90" style={{ letterSpacing: "-0.03em" }}>{plan.name}</h3>
                  </div>

                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="text-4xl font-extrabold text-white" style={{ letterSpacing: "-0.04em" }}>{plan.price}</span>
                    <span className="text-muted-foreground/40 text-sm font-tech">{plan.period}</span>
                  </div>
                  <div className="mb-7">
                    <span className="text-xs font-tech text-primary/70 bg-primary/[0.06] px-2.5 py-1 rounded-full">
                      {plan.credits} {t("pricing.articlesPerMonth") || (isEn ? "articles / mo" : "статей / мес")}
                    </span>
                  </div>

                  <ul className="space-y-3 mb-8">
                    {plan.features.map((f, fi) => (
                      <li key={fi} className="flex items-start gap-2.5 text-[13px]">
                        {f.included ? <Check className="h-4 w-4 text-emerald-400/70 mt-0.5 shrink-0" /> : <X className="h-4 w-4 text-muted-foreground/20 mt-0.5 shrink-0" />}
                        <span className={f.included ? "text-foreground/60" : "text-muted-foreground/30"}>{f.text}</span>
                      </li>
                    ))}
                    {plan.exclusive && (
                      <li className="flex items-start gap-2.5 text-[13px]">
                        <Radar className="h-4 w-4 text-primary/70 mt-0.5 shrink-0" />
                        <span className="text-primary/70 font-medium">{plan.exclusive}</span>
                        <span className="text-[9px] font-tech bg-primary/[0.08] text-primary/70 px-1.5 py-0.5 rounded-full">{t("lp.priceExcl")}</span>
                      </li>
                    )}
                  </ul>

                  <button onClick={() => navigate("/register")}
                    className={`w-full py-3.5 rounded-xl text-sm font-tech font-semibold transition-all ${
                      plan.popular
                        ? "bg-gradient-to-r from-primary to-[#3b82f6] text-white hover:shadow-[0_0_30px_rgba(139,92,246,0.35)]"
                        : "border border-white/[0.06] bg-white/[0.02] text-foreground/70 hover:bg-white/[0.04]"
                    }`}>
                    {plan.cta}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>

        <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.4 }}
          className="text-center mt-12 text-sm text-muted-foreground/30">
          {t("lp.priceSocial")}
        </motion.p>
      </div>
    </section>
  );
}
