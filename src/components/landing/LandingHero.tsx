import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";
import { StealthProofWidget } from "./StealthProofWidget";

export function LandingHero() {
  const navigate = useNavigate();
  const { t } = useI18n();

  const stats = [
    { value: "47.2%", label: t("lp.statRanking") },
    { value: "3,841", label: t("lp.statArticles") },
    { value: "12 min", label: t("lp.statTime") },
  ];

  return (
    <section className="relative min-h-[95vh] flex items-center pt-24 pb-20 overflow-hidden">
      {/* Grid pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--primary) / 0.5) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary) / 0.5) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />
      {/* Glow blobs */}
      <div className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[700px] rounded-full bg-primary/[0.07] blur-[220px]" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full bg-[#3b82f6]/[0.05] blur-[180px]" />
      {/* Additional glow blobs for depth */}
      <div className="pointer-events-none absolute top-2/3 left-[15%] w-[600px] h-[400px] rounded-full bg-primary/[0.05] blur-[200px]" />
      <div className="pointer-events-none absolute top-[10%] right-[10%] w-[400px] h-[350px] rounded-full bg-[#3b82f6]/[0.06] blur-[180px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left: Text */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] as const }}
              className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 mb-8"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-tech font-medium text-primary uppercase tracking-wider">{t("lp.badge")}</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] as const }}
              className="text-4xl sm:text-5xl md:text-6xl lg:text-[4.25rem] font-black leading-[1.05]"
              style={{ letterSpacing: "-0.05em" }}
            >
              {t("lp.heroLine1")}{" "}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary via-[#3b82f6] to-[#10b981]">
                {t("lp.heroLine2")}
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2, ease: [0.22, 1, 0.36, 1] as const }}
              className="mt-6 max-w-lg text-[15px] text-[#9ca3af] leading-[1.6]"
            >
              {t("lp.heroSub")}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] as const }}
              className="mt-10 flex flex-wrap gap-4"
            >
              <button
                onClick={() => navigate("/register")}
                className="group relative inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary to-[#3b82f6] px-8 py-4 text-sm font-tech font-semibold text-white shadow-[0_0_40px_hsl(var(--primary)/0.35)] transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_0_60px_hsl(var(--primary)/0.5)] active:scale-[0.98]"
              >
                <span className="absolute inset-0 rounded-full bg-gradient-to-r from-primary to-[#3b82f6] animate-pulse opacity-20 blur-xl" />
                <span className="relative flex items-center gap-2">
                  {t("lp.cta")}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
            </motion.div>

            {/* Stats */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.8 }}
              className="mt-14 flex flex-wrap gap-10"
            >
              {stats.map((s, i) => (
                <div key={i}>
                  <p className="text-3xl sm:text-4xl font-black bg-clip-text text-transparent bg-gradient-to-r from-primary to-[#3b82f6]" style={{ letterSpacing: "-0.05em" }}>
                    {s.value}
                  </p>
                  <p className="mt-1 text-xs text-[#9ca3af] font-tech uppercase tracking-wider">{s.label}</p>
                </div>
              ))}
            </motion.div>
          </div>

          {/* Right: Stealth Proof Widget */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.22, 1, 0.36, 1] as const }}
            className="relative"
          >
            <StealthProofWidget />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
