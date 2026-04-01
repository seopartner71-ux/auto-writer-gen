import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Check, X, Star, Zap, Crown, Sparkles, CreditCard } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function LandingPricing() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const isEn = lang === "en";

  const plans = [
    {
      id: "single",
      name: isEn ? "1 Credit" : "1 Кредит",
      subtitle: isEn ? "Pay As You Go" : "Разовый запуск",
      icon: Sparkles,
      price: "230 ₽",
      period: isEn ? "/ single credit" : "/ за 1 кредит",
      unitInfo: null,
      popular: false,
      features: [
        { text: isEn ? "Full SERP analysis" : "Полный SERP-анализ", included: true },
        { text: isEn ? "Stealth Engine (Human Score 95+)" : "Stealth Engine (Human Score 95+)", included: true },
        { text: isEn ? "WordPress export" : "Экспорт в WordPress", included: true },
        { text: isEn ? "LSI keywords & optimization" : "LSI-ключи и оптимизация", included: true },
        { text: isEn ? "Bulk Factory" : "Фабрика (Bulk)", included: false },
        { text: isEn ? "Priority support" : "Приоритетная поддержка", included: false },
      ],
      cta: isEn ? "Buy 1 Credit" : "Купить 1 кредит",
    },
    {
      id: "pro",
      name: isEn ? "10 Credits" : "10 Кредитов",
      subtitle: isEn ? "PRO" : "PRO Пакет",
      icon: Zap,
      price: "1 900 ₽",
      period: isEn ? "/ package" : "/ пакет",
      unitInfo: isEn ? "Only 190 ₽ per article" : "Всего 190 ₽ за статью",
      popular: true,
      features: [
        { text: isEn ? "Everything in 1 Credit" : "Всё из пакета 1 Кредит", included: true },
        { text: isEn ? "Bulk Factory access" : "Доступ к Фабрике (Bulk)", included: true },
        { text: isEn ? "Priority support" : "Приоритетная поддержка", included: true },
        { text: isEn ? "Persona Engine" : "Persona Engine", included: true },
        { text: isEn ? "JSON-LD schema" : "JSON-LD разметка", included: true },
        { text: isEn ? "API access" : "Доступ к API", included: false },
      ],
      cta: isEn ? "Buy 10 Credits" : "Купить 10 кредитов",
    },
    {
      id: "agency",
      name: isEn ? "30 Credits" : "30 Кредитов",
      subtitle: isEn ? "Agency" : "Agency Пакет",
      icon: Crown,
      price: "4 900 ₽",
      period: isEn ? "/ package" : "/ пакет",
      unitInfo: isEn ? "Only 163 ₽ per article" : "Всего 163 ₽ за статью",
      popular: false,
      features: [
        { text: isEn ? "Everything in PRO" : "Всё из PRO пакета", included: true },
        { text: isEn ? "API access" : "Доступ к API", included: true },
        { text: isEn ? "Multi-user support" : "Многопользовательский доступ", included: true },
        { text: isEn ? "GEO Radar" : "GEO Radar", included: true },
        { text: isEn ? "White-label reports" : "White-label отчёты", included: true },
        { text: isEn ? "Dedicated account manager" : "Персональный менеджер", included: true },
      ],
      cta: isEn ? "Buy 30 Credits" : "Купить 30 кредитов",
    },
  ];

  return (
    <section id="pricing" className="relative py-32 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] rounded-full bg-primary/[0.06] blur-[200px]" />

      <div className="container mx-auto px-4 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-6"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black" style={{ letterSpacing: "-0.05em" }}>
            {isEn ? "Simple Credit Pricing" : "Простая система кредитов"}
          </h2>
          <p className="mt-4 text-[#9ca3af] text-[15px] leading-[1.6]">
            {isEn ? "No subscriptions. Buy credits, generate articles." : "Без подписок. Покупайте кредиты, генерируйте статьи."}
          </p>
        </motion.div>

        {/* 1 Credit = 1 Article badge */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="flex justify-center mb-14"
        >
          <div className="inline-flex items-center gap-2.5 bg-primary/10 border border-primary/20 rounded-full px-5 py-2.5">
            <CreditCard className="h-4 w-4 text-primary" />
            <span className="text-sm font-tech font-bold text-primary">
              {isEn ? "1 Credit = 1 SEO Article" : "1 Кредит = 1 SEO-статья"}
            </span>
          </div>
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
                    {isEn ? "Most Popular" : "Популярный"}
                  </div>
                )}

                <div className="flex items-center gap-3 mb-1">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    plan.popular ? "bg-primary/10" : "bg-white/[0.04]"
                  }`}>
                    <Icon className={`h-5 w-5 ${plan.popular ? "text-primary" : "text-[#9ca3af]"}`} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold tracking-display">{plan.name}</h3>
                    <p className="text-xs text-[#9ca3af] font-tech">{plan.subtitle}</p>
                  </div>
                </div>

                <div className="flex items-baseline gap-1 mb-1 mt-4">
                  <span className="text-4xl font-black tracking-display">{plan.price}</span>
                  <span className="text-[#9ca3af] text-sm font-tech">{plan.period}</span>
                </div>

                {plan.unitInfo && (
                  <div className="mb-4">
                    <span className="text-xs font-tech text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
                      {plan.unitInfo}
                    </span>
                  </div>
                )}
                {!plan.unitInfo && <div className="mb-4 h-6" />}

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

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="text-center mt-12 text-sm text-[#9ca3af]"
        >
          {isEn
            ? "1 credit = 1 complete expert article. No hidden fees."
            : "1 кредит = 1 полноценная экспертная статья. Без скрытых комиссий."}
        </motion.p>
      </div>
    </section>
  );
}
