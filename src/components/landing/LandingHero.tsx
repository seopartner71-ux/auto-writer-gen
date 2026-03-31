import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, delay: i * 0.15, ease: [0.22, 1, 0.36, 1] },
  }),
};

export function LandingHero() {
  const navigate = useNavigate();
  const { t } = useI18n();

  const stats = [
    { value: "47.2%", label: t("lp.statRanking") },
    { value: "3,841", label: t("lp.statArticles") },
    { value: "12 min", label: t("lp.statTime") },
  ];

  return (
    <section className="relative min-h-[90vh] flex flex-col items-center justify-center pt-28 pb-20 overflow-hidden">
      {/* Grid pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(270 60% 60% / 0.4) 1px, transparent 1px), linear-gradient(90deg, hsl(270 60% 60% / 0.4) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Glow orbs */}
      <div className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] rounded-full bg-[#8b5cf6]/10 blur-[180px]" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-[#3b82f6]/8 blur-[150px]" />
      <div className="pointer-events-none absolute bottom-1/4 left-1/6 w-[300px] h-[300px] rounded-full bg-[#10b981]/6 blur-[120px]" />

      <div className="relative z-10 container mx-auto px-4 text-center max-w-5xl">
        {/* Badge */}
        <motion.div
          custom={0}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 mb-8"
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium text-primary">{t("lp.badge")}</span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          custom={1}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05]"
        >
          {t("lp.heroLine1")}{" "}
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#8b5cf6] via-[#3b82f6] to-[#10b981]">
            {t("lp.heroLine2")}
          </span>
        </motion.h1>

        {/* Sub-headline */}
        <motion.p
          custom={2}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mx-auto mt-6 max-w-2xl text-base sm:text-lg text-muted-foreground leading-relaxed"
        >
          {t("lp.heroSub")}
        </motion.p>

        {/* CTA */}
        <motion.div custom={3} variants={fadeUp} initial="hidden" animate="show" className="mt-10">
          <button
            onClick={() => navigate("/register")}
            className="group relative inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] px-8 py-4 text-base font-semibold text-white shadow-[0_0_30px_rgba(139,92,246,0.4)] transition-all duration-300 hover:scale-[1.04] hover:shadow-[0_0_50px_rgba(139,92,246,0.6)] active:scale-[0.98]"
          >
            <span className="absolute inset-0 rounded-full bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] animate-pulse opacity-30 blur-xl" />
            <span className="relative flex items-center gap-2">
              {t("lp.cta")}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </button>
        </motion.div>

        {/* Stats bar */}
        <motion.div
          custom={4}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-20 flex flex-wrap items-center justify-center gap-8 sm:gap-16"
        >
          {stats.map((s, i) => (
            <div key={i} className="text-center">
              <p className="text-3xl sm:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6]">
                {s.value}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
