import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Check, Star, Radar, Zap } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function LandingPricing() {
  const navigate = useNavigate();
  const { t } = useI18n();

  const plans = [
    {
      name: "Starter",
      price: "$0",
      period: t("lp.priceFree"),
      features: [
        t("lp.priceF1a"),
        t("lp.priceF1b"),
        t("lp.priceF1c"),
        t("lp.priceF1d"),
      ],
      popular: false,
      cta: t("lp.priceStart"),
    },
    {
      name: "PRO",
      price: "$29",
      period: `/ ${t("lp.priceMonth")}`,
      features: [
        t("lp.priceF2a"),
        t("lp.priceF2b"),
        t("lp.priceF2c"),
        t("lp.priceF2d"),
        t("lp.priceF2e"),
        t("lp.priceF2f"),
      ],
      popular: true,
      cta: t("lp.priceUpgrade"),
      exclusive: "AI Radar & GEO",
    },
    {
      name: "Enterprise",
      price: "$99",
      period: `/ ${t("lp.priceMonth")}`,
      features: [
        t("lp.priceF3a"),
        t("lp.priceF3b"),
        t("lp.priceF3c"),
        t("lp.priceF3d"),
        t("lp.priceF3e"),
      ],
      popular: false,
      cta: t("lp.priceContact"),
    },
  ];

  return (
    <section className="relative py-24 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full bg-[#8b5cf6]/5 blur-[180px]" />

      <div className="container mx-auto px-4 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold">{t("lp.pricingTitle")}</h2>
          <p className="mt-4 text-muted-foreground">{t("lp.pricingSub")}</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className={`relative rounded-2xl border p-6 sm:p-8 transition-all hover:scale-[1.02] duration-300 ${
                plan.popular
                  ? "border-[#8b5cf6]/40 bg-[#8b5cf6]/5 shadow-[0_0_40px_rgba(139,92,246,0.15)]"
                  : "border-white/[0.06] bg-white/[0.02]"
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] text-white text-xs font-semibold px-4 py-1 rounded-full">
                  <Star className="h-3 w-3" />
                  Popular
                </div>
              )}

              <h3 className="text-xl font-bold">{plan.name}</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold">{plan.price}</span>
                <span className="text-muted-foreground text-sm">{plan.period}</span>
              </div>

              <ul className="mt-6 space-y-3">
                {plan.features.map((f, fi) => (
                  <li key={fi} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{f}</span>
                  </li>
                ))}
                {plan.exclusive && (
                  <li className="flex items-start gap-2 text-sm">
                    <Radar className="h-4 w-4 text-[#8b5cf6] mt-0.5 shrink-0" />
                    <span className="text-[#8b5cf6] font-semibold">{plan.exclusive}</span>
                    <span className="text-[9px] bg-[#8b5cf6]/20 text-[#8b5cf6] px-1.5 py-0.5 rounded-full font-medium">{t("lp.priceExcl")}</span>
                  </li>
                )}
              </ul>

              <button
                onClick={() => navigate("/register")}
                className={`mt-8 w-full py-3 rounded-xl text-sm font-semibold transition-all ${
                  plan.popular
                    ? "bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] text-white hover:shadow-[0_0_30px_rgba(139,92,246,0.4)]"
                    : "border border-white/[0.1] bg-white/[0.03] text-foreground hover:bg-white/[0.06]"
                }`}
              >
                {plan.cta}
              </button>
            </motion.div>
          ))}
        </div>

        {/* Social proof */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="text-center mt-10 text-sm text-muted-foreground"
        >
          {t("lp.priceSocial")}
        </motion.p>
      </div>
    </section>
  );
}
