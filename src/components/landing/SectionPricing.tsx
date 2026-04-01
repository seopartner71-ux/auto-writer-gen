import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Check, X, Star, Zap, Crown, Sparkles, Rocket } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function SectionPricing() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const isEn = lang === "en";

  const plans = [
    {
      name: isEn ? "Single Shot" : "Single Shot",
      icon: Sparkles,
      price: "$19.99",
      period: isEn ? "one-time" : "разовый",
      popular: false,
      features: [
        { text: isEn ? "1 Expert Credit" : "1 экспертный кредит", included: true },
        { text: isEn ? "Full SERP Research" : "Полный SERP-анализ", included: true },
        { text: isEn ? "1,500+ Words Article" : "Статья от 1500 слов", included: true },
        { text: isEn ? "Stealth Mode" : "Stealth Mode", included: true },
        { text: isEn ? "GEO Radar" : "GEO Radar", included: false },
        { text: isEn ? "Content Factory" : "Content Factory", included: false },
      ],
      cta: isEn ? "Buy Credit" : "Купить кредит",
    },
    {
      name: "Starter",
      icon: Zap,
      price: "$49",
      period: `/ ${isEn ? "mo" : "мес"}`,
      popular: false,
      features: [
        { text: isEn ? "5 Expert Articles / mo" : "5 экспертных статей / мес", included: true },
        { text: isEn ? "Project Management" : "Управление проектами", included: true },
        { text: isEn ? "WordPress Integration" : "WordPress интеграция", included: true },
        { text: isEn ? "Persona Engine" : "Persona Engine", included: true },
        { text: isEn ? "GEO Radar" : "GEO Radar", included: false },
        { text: isEn ? "Content Factory" : "Content Factory", included: false },
      ],
      cta: isEn ? "Start Free" : "Начать бесплатно",
    },
    {
      name: "Agency",
      icon: Rocket,
      price: "$149",
      period: `/ ${isEn ? "mo" : "мес"}`,
      popular: true,
      features: [
        { text: isEn ? "25 Expert Articles / mo" : "25 экспертных статей / мес", included: true },
        { text: isEn ? "GEO Radar Access" : "Доступ к GEO Radar", included: true },
        { text: isEn ? "Content Factory (Bulk)" : "Content Factory (массовая)", included: true },
        { text: isEn ? "Smart Linker Engine" : "Smart Linker Engine", included: true },
        { text: isEn ? "All Starter features" : "Все функции Starter", included: true },
        { text: isEn ? "Priority support" : "Приоритетная поддержка", included: true },
      ],
      cta: isEn ? "Upgrade to Agency" : "Подключить Agency",
    },
    {
      name: "Enterprise",
      icon: Crown,
      price: isEn ? "Custom" : "По запросу",
      period: "",
      popular: false,
      features: [
        { text: isEn ? "Unlimited Credits" : "Безлимитные кредиты", included: true },
        { text: isEn ? "API Access" : "API доступ", included: true },
        { text: isEn ? "White-label Reports" : "White-label отчёты", included: true },
        { text: isEn ? "Dedicated Account Manager" : "Персональный менеджер", included: true },
        { text: isEn ? "All Agency features" : "Все функции Agency", included: true },
        { text: isEn ? "Custom AI Models" : "Кастомные AI модели", included: true },
      ],
      cta: isEn ? "Contact Us" : "Связаться",
    },
  ];

  return (
    <section className="relative py-32 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] rounded-full bg-primary/[0.06] blur-[200px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-7xl">
        <motion.div initial={{ opacity: 0, y: 50 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="text-center mb-14">
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-extrabold leading-[0.95]" style={{ letterSpacing: "-0.06em", textShadow: "0 0 80px rgba(139,92,246,0.08)" }}>
            {t("awg.pricingTitle")}
          </h2>
          <p className="mt-4 text-muted-foreground text-[15px] leading-[1.6]">{t("awg.pricingSub")}</p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {plans.map((plan, i) => {
            const Icon = plan.icon;
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className={`relative rounded-3xl border-t border-l border-r border-b p-6 backdrop-blur-2xl transition-all hover:scale-[1.02] duration-300 ${
                  plan.popular
                    ? "border-t-[#06b6d4]/40 border-l-[#06b6d4]/20 border-r-[#06b6d4]/10 border-b-[#06b6d4]/[0.05] bg-[#06b6d4]/[0.04]"
                    : "border-t-white/15 border-l-white/8 border-r-white/4 border-b-white/[0.02] bg-white/[0.02]"
                }`}
                style={{
                  boxShadow: plan.popular
                    ? "0 20px 50px rgba(0,0,0,0.5), 0 0 40px rgba(6,182,212,0.15)"
                    : "0 20px 50px rgba(0,0,0,0.4)",
                }}
              >
                {plan.popular && (
                  <>
                    <div className="absolute -inset-px rounded-3xl opacity-30 animate-pulse" style={{
                      background: "linear-gradient(135deg, transparent 30%, rgba(6,182,212,0.3) 50%, transparent 70%)",
                    }} />
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 bg-gradient-to-r from-[#06b6d4] to-[#8b5cf6] text-white text-[10px] font-tech font-bold px-4 py-1 rounded-full uppercase tracking-wider">
                      <Star className="h-3 w-3" /> Popular
                    </div>
                  </>
                )}

                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${plan.popular ? "bg-[#06b6d4]/10" : "bg-white/[0.04]"}`}>
                      <Icon className={`h-5 w-5 ${plan.popular ? "text-[#06b6d4]" : "text-muted-foreground"}`} />
                    </div>
                    <h3 className="text-lg font-bold" style={{ letterSpacing: "-0.04em" }}>{plan.name}</h3>
                  </div>

                  <div className="flex items-baseline gap-1 mb-5">
                    <span className="text-3xl font-black" style={{ letterSpacing: "-0.06em" }}>{plan.price}</span>
                    {plan.period && <span className="text-muted-foreground text-sm font-tech">{plan.period}</span>}
                  </div>

                  <ul className="space-y-2 mb-7">
                    {plan.features.map((f, fi) => (
                      <li key={fi} className="flex items-start gap-2 text-[12px]">
                        {f.included ? <Check className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" /> : <X className="h-3.5 w-3.5 text-muted-foreground/30 mt-0.5 shrink-0" />}
                        <span className={f.included ? "text-foreground/80" : "text-muted-foreground/40"}>{f.text}</span>
                      </li>
                    ))}
                  </ul>

                  <button onClick={() => navigate("/register")}
                    className={`w-full py-3 rounded-xl text-sm font-tech font-semibold transition-all ${
                      plan.popular
                        ? "bg-gradient-to-r from-[#06b6d4] to-[#8b5cf6] text-white hover:shadow-[0_0_30px_rgba(6,182,212,0.4)]"
                        : "border border-white/10 bg-white/[0.03] text-foreground hover:bg-white/[0.06]"
                    }`}>
                    {plan.cta}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
