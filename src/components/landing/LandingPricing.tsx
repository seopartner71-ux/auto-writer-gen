import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Check, X, Star, Radar, Zap, Crown, Sparkles } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function LandingPricing() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const isEn = lang === "en";
  const [yearly, setYearly] = useState(false);

  // Fetch subscription plans from DB
  const { data: dbPlans } = useQuery({
    queryKey: ["subscription-plans-landing"],
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

  const getDbPlan = (id: string) => dbPlans?.find((p) => p.id === id);

  const fmtPrice = (id: string, fallbackUsd: number, fallbackRub: string) => {
    const db = getDbPlan(id);
    const base = isEn ? (db?.price_usd ?? fallbackUsd) : (db?.price_rub ?? parseInt(fallbackRub.replace(/\D/g, "")));
    const val = yearly ? Math.round(base * 0.8) : base;
    if (isEn) return `$${val}`;
    return `${val.toLocaleString("ru-RU")} ₽`;
  };

  const fmtCredits = (id: string, fallback: number) => getDbPlan(id)?.monthly_article_limit ?? fallback;

  const fmtName = (id: string, fallback: string) => getDbPlan(id)?.name ?? fallback;

  const getFeatures = (id: string, fallback: Array<{ text: string; included: boolean }>) => {
    const db = getDbPlan(id);
    const dbFeatures = db?.features as Array<{ text_ru: string; text_en: string; included: boolean }> | null;
    if (dbFeatures && dbFeatures.length > 0) {
      return dbFeatures.map((f) => ({
        text: isEn ? f.text_en : f.text_ru,
        included: f.included,
      }));
    }
    return fallback;
  };

  const plans = [
    {
      id: "free",
      name: fmtName("free", "NANO"),
      icon: Sparkles,
      price: fmtPrice("free", 15, "990"),
      period: `/ ${t("lp.priceMonth")}`,
      credits: fmtCredits("free", 5),
      popular: false,
      modelLabel: isEn ? "Generation: Claude Sonnet" : "Генерация: Claude Sonnet",
      modelPremium: false,
      features: getFeatures("free", [
        { text: isEn ? "5 articles per month" : "5 статей в месяц", included: true },
        { text: isEn ? "AI + Turgenev quality check" : "AI + Тургенев проверка качества", included: true },
        { text: isEn ? "3 SEO improvements per article" : "3 SEO-улучшения на статью", included: true },
        { text: isEn ? "All author profiles (15+)" : "Все авторские профили (15+)", included: true },
        { text: isEn ? "Quick Start mode" : "Быстрый старт режим", included: true },
        { text: isEn ? "Realtime SEO Score" : "Realtime SEO Score", included: true },
      ]),
      cta: t("lp.priceStart"),
    },
    {
      id: "basic",
      name: fmtName("basic", "PRO"),
      icon: Zap,
      price: fmtPrice("basic", 65, "5900"),
      period: `/ ${t("lp.priceMonth")}`,
      credits: fmtCredits("basic", 40),
      popular: true,
      exclusive: "AI Radar & GEO",
      modelLabel: isEn ? "Generation: Claude Opus 4" : "Генерация: Claude Opus 4",
      modelPremium: true,
      features: getFeatures("basic", [
        { text: isEn ? "40 articles per month" : "40 статей в месяц", included: true },
        { text: isEn ? "Everything in NANO" : "Всё из NANO", included: true },
        { text: isEn ? "Unlimited SEO improvements" : "Безлимит SEO-улучшений", included: true },
        { text: isEn ? "Bulk up to 10 articles" : "Bulk генерация до 10 статей", included: true },
        { text: isEn ? "Priority queue" : "Приоритетная очередь", included: true },
        { text: isEn ? "WordPress auto-publish" : "WordPress автопубликация", included: true },
      ]),
      cta: t("lp.priceUpgrade"),
    },
    {
      id: "pro",
      name: fmtName("pro", "FACTORY"),
      icon: Crown,
      price: fmtPrice("pro", 220, "19900"),
      period: `/ ${t("lp.priceMonth")}`,
      credits: fmtCredits("pro", 150),
      popular: false,
      modelLabel: isEn ? "Generation: Claude Opus 4" : "Генерация: Claude Opus 4",
      modelPremium: true,
      features: getFeatures("pro", [
        { text: isEn ? "150 articles per month" : "150 статей в месяц", included: true },
        { text: isEn ? "Everything in PRO" : "Всё из PRO", included: true },
        { text: isEn ? "Unlimited bulk (100+ articles)" : "Bulk без лимита (100+ статей)", included: true },
        { text: isEn ? "2 users per account" : "2 пользователя в аккаунте", included: true },
        { text: isEn ? "Site Factory / Programmatic SEO" : "Site Factory / Programmatic SEO", included: true },
        { text: isEn ? "API access" : "API доступ", included: true },
        { text: isEn ? "Priority support" : "Приоритетная поддержка", included: true },
      ]),
      cta: t("lp.priceContact"),
    },
  ];

  return (
    <section className="relative py-32 overflow-hidden">
      {/* Glow behind pricing */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] rounded-full bg-primary/[0.06] blur-[200px]" />

      <div className="container mx-auto px-4 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black" style={{ letterSpacing: "-0.05em" }}>{t("lp.pricingTitle")}</h2>
          <p className="mt-4 text-[#9ca3af] text-[15px] leading-[1.6]">{t("lp.pricingSub")}</p>
        </motion.div>

        {/* Monthly / Yearly toggle */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="flex items-center justify-center gap-3 mb-14"
        >
          <span className={`text-sm font-tech transition-colors ${!yearly ? "text-foreground" : "text-[#9ca3af]"}`}>
            {t("lp.priceMonthly")}
          </span>
          <button
            onClick={() => setYearly(!yearly)}
            className={`relative w-12 h-6 rounded-full transition-colors ${yearly ? "bg-primary" : "bg-white/[0.1]"}`}
          >
            <motion.div
              className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white"
              animate={{ x: yearly ? 24 : 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          </button>
          <span className={`text-sm font-tech transition-colors ${yearly ? "text-foreground" : "text-[#9ca3af]"}`}>
            {t("lp.priceYearly")}
          </span>
          {yearly && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-[10px] font-tech font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full"
            >
              -20%
            </motion.span>
          )}
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {plans.map((plan, i) => {
            const Icon = plan.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className={`relative rounded-2xl border p-7 transition-all hover:scale-[1.02] duration-300 backdrop-blur-xl ${
                  plan.popular
                    ? "border-primary/40 bg-primary/[0.04] shadow-[0_0_50px_hsl(var(--primary)/0.12)]"
                    : "border-white/[0.08] bg-white/[0.02]"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 bg-gradient-to-r from-primary to-[#3b82f6] text-white text-[10px] font-tech font-bold px-4 py-1 rounded-full uppercase tracking-wider">
                    <Star className="h-3 w-3" />
                    Popular
                  </div>
                )}

                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    plan.popular ? "bg-primary/10" : "bg-white/[0.04]"
                  }`}>
                    <Icon className={`h-5 w-5 ${plan.popular ? "text-primary" : "text-[#9ca3af]"}`} />
                  </div>
                  <h3 className="text-xl font-bold tracking-display">{plan.name}</h3>
                </div>

                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-4xl font-black tracking-display">{plan.price}</span>
                  <span className="text-[#9ca3af] text-sm font-tech">{plan.period}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-6">
                  <span className="text-[11px] font-tech text-primary bg-primary/10 px-2.5 py-1 rounded-full">
                    {plan.credits} {t("pricing.articlesPerMonth") || (isEn ? "articles / mo" : "статей / мес")}
                  </span>
                  {plan.modelLabel && (
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-tech px-2.5 py-1 rounded-full border ${
                        plan.modelPremium
                          ? "text-primary border-primary/25 bg-primary/[0.08]"
                          : "text-[#9ca3af] border-white/[0.08] bg-white/[0.02]"
                      }`}
                    >
                      {plan.modelPremium && <Sparkles className="h-2.5 w-2.5" />}
                      {plan.modelLabel}
                    </span>
                  )}
                </div>

                <ul className="space-y-2.5 mb-8">
                  {plan.features.map((f, fi) => (
                    <li key={fi} className="flex items-start gap-2.5 text-[13px]">
                      {f.included ? (
                        <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                      ) : (
                        <X className="h-4 w-4 text-[#9ca3af]/30 mt-0.5 shrink-0" />
                      )}
                      <span className={f.included ? "text-foreground/80" : "text-[#9ca3af]/40"}>{f.text}</span>
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

                <button
                  onClick={() => navigate("/register")}
                  className={`w-full py-3.5 rounded-xl text-sm font-tech font-semibold transition-all ${
                    plan.popular
                      ? "bg-gradient-to-r from-primary to-[#3b82f6] text-white hover:shadow-[0_0_30px_hsl(var(--primary)/0.4)]"
                      : "border border-white/[0.1] bg-white/[0.03] text-foreground hover:bg-white/[0.06]"
                  }`}
                >
                  {plan.cta}
                </button>
              </motion.div>
            );
          })}
        </div>

        {/* Social proof */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="text-center mt-12 text-sm text-[#9ca3af]"
        >
          {t("lp.priceSocial")}
        </motion.p>
      </div>
    </section>
  );
}
