import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Check, X, Star, Zap, Crown, Sparkles, Shield, Atom } from "lucide-react";
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

  const fmtPrice = (id: string, fallbackUsd: number, fallbackRub: number) => {
    const db = getDbPlan(id);
    const base = isEn ? (db?.price_usd ?? fallbackUsd) : (db?.price_rub ?? fallbackRub);
    const val = yearly ? Math.round(base * 0.8) : base;
    return isEn ? `$${val}` : `${val.toLocaleString("ru-RU")} ₽`;
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
      id: "free",
      name: fmtName("free", "NANO"),
      icon: Atom,
      price: fmtPrice("free", 15, 990),
      period: t("pricing.perMonth"),
      credits: fmtCredits("free", 5),
      description: fmtDesc("free", "Для быстрого теста качества", "Quick quality test"),
      popular: false,
      showShield: false,
      features: getFeatures("free", [
        { text: isEn ? "5 articles per month" : "5 статей в месяц", included: true },
        { text: isEn ? "Deep SERP & LSI Analysis" : "Глубокий SERP & LSI Анализ", included: true },
        { text: isEn ? "Stealth Engine (1.57% AI Detection)" : "Stealth Engine (1.57% AI Detection)", included: true },
        { text: isEn ? "Fact-Check Guard" : "Fact-Check Guard (Защита от галлюцинаций)", included: true },
        { text: isEn ? "1 author profile" : "1 профиль автора", included: true },
        { text: isEn ? "HTML export" : "Экспорт в HTML", included: true },
        { text: isEn ? "Bulk generation & WP Auto-Publish" : "Массовая генерация & WP Auto-Publish", included: false },
        { text: isEn ? "Calendar planner" : "Планировщик календаря", included: false },
      ]),
      cta: t("lp.priceStart"),
    },
    {
      id: "basic",
      name: fmtName("basic", "PRO"),
      icon: Zap,
      price: fmtPrice("basic", 65, 5900),
      period: t("pricing.perMonth"),
      credits: fmtCredits("basic", 40),
      description: fmtDesc("basic", "Идеальный баланс для SEO-профи", "Perfect balance for SEO pros"),
      popular: true,
      showShield: true,
      features: getFeatures("basic", [
        { text: isEn ? "40 articles per month" : "40 статей в месяц", included: true },
        { text: isEn ? "Deep SERP & LSI Analysis" : "Глубокий SERP & LSI Анализ", included: true },
        { text: isEn ? "Stealth Engine (1.57% AI Detection)" : "Stealth Engine (1.57% AI Detection)", included: true },
        { text: isEn ? "Fact-Check Guard" : "Fact-Check Guard (Защита от галлюцинаций)", included: true },
        { text: isEn ? "5 author profiles" : "5 профилей авторов", included: true },
        { text: isEn ? "HTML + Markdown export" : "Экспорт в HTML + Markdown", included: true },
        { text: isEn ? "Uniqueness check + Anti-AI" : "Проверка уникальности + Anti-AI", included: true },
        { text: isEn ? "JSON-LD schema markup" : "JSON-LD микроразметка", included: true },
        { text: isEn ? "WordPress integration" : "WordPress интеграция", included: true },
        { text: isEn ? "Calendar planner" : "Планировщик календаря", included: false },
      ]),
      cta: t("lp.priceUpgrade"),
    },
    {
      id: "pro",
      name: fmtName("pro", "FACTORY"),
      icon: Crown,
      price: fmtPrice("pro", 220, 19900),
      period: t("pricing.perMonth"),
      credits: fmtCredits("pro", 150),
      description: fmtDesc("pro", "Контентный завод для агентств", "Content factory for agencies"),
      popular: false,
      showShield: true,
      features: getFeatures("pro", [
        { text: isEn ? "150 articles per month" : "150 статей в месяц", included: true },
        { text: isEn ? "Deep SERP & LSI + competitor analysis" : "Глубокий SERP & LSI + конкурентный анализ", included: true },
        { text: isEn ? "Stealth Engine (1.57% AI Detection)" : "Stealth Engine (1.57% AI Detection)", included: true },
        { text: isEn ? "Fact-Check Guard" : "Fact-Check Guard (Защита от галлюцинаций)", included: true },
        { text: isEn ? "Unlimited author profiles" : "Безлимитные профили авторов", included: true },
        { text: isEn ? "All export formats" : "Все форматы экспорта", included: true },
        { text: isEn ? "Bulk generation & WP Auto-Publish" : "Массовая генерация & WP Auto-Publish", included: true },
        { text: isEn ? "Calendar planner" : "Планировщик календаря", included: true },
        { text: isEn ? "Miralinks + GoGetLinks" : "Miralinks + GoGetLinks", included: true },
        { text: isEn ? "All AI models (Gemini Pro + GPT-5)" : "Все AI модели (Gemini Pro + GPT-5)", included: true },
        { text: isEn ? "Priority support 24/7" : "Приоритетная поддержка 24/7", included: true },
      ]),
      cta: t("lp.priceContact"),
    },
  ];

  return (
    <section id="pricing" className="relative py-32 flex items-center justify-center overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] rounded-full bg-primary/[0.06] blur-[200px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-6xl">
        <motion.div initial={{ opacity: 0, y: 50 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
          className="text-center mb-12">
          <h2 className="text-5xl sm:text-6xl md:text-7xl font-extrabold leading-[0.95]" style={{ letterSpacing: "-0.06em", textShadow: "0 0 80px rgba(139,92,246,0.08)" }}>
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
              <motion.div key={plan.id} initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
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
                    <div>
                      <h3 className="text-xl font-bold" style={{ letterSpacing: "-0.04em" }}>{plan.name}</h3>
                      <p className="text-[11px] text-muted-foreground">{plan.description}</p>
                    </div>
                  </div>

                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="text-4xl font-black" style={{ letterSpacing: "-0.06em" }}>{plan.price}</span>
                    <span className="text-muted-foreground text-sm font-tech">{plan.period}</span>
                  </div>
                  <div className="mb-4">
                    <span className="text-xs font-tech text-primary bg-primary/10 px-2.5 py-1 rounded-full">
                      {pluralArticles(plan.credits)}
                    </span>
                  </div>

                  {plan.showShield && (
                    <div className="mb-5 flex items-center gap-1.5">
                      <Shield className="h-4 w-4 text-emerald-500" />
                      <span className="text-xs font-semibold text-emerald-500">98% Human Score</span>
                    </div>
                  )}

                  <ul className="space-y-2.5 mb-8">
                    {plan.features.map((f, fi) => (
                      <li key={fi} className="flex items-start gap-2.5 text-[13px]">
                        {f.included ? <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" /> : <X className="h-4 w-4 text-muted-foreground/30 mt-0.5 shrink-0" />}
                        <span className={f.included ? "text-foreground/80" : "text-muted-foreground/40"}>{f.text}</span>
                      </li>
                    ))}
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
