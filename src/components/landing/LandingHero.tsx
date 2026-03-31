import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles, ShieldAlert, ShieldCheck } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function LandingHero() {
  const navigate = useNavigate();
  const { t } = useI18n();

  const stats = [
    { value: "47.2%", label: t("lp.statRanking") },
    { value: "3,841", label: t("lp.statArticles") },
    { value: "12 min", label: t("lp.statTime") },
  ];

  return (
    <section className="relative min-h-[95vh] flex items-center pt-20 pb-16 overflow-hidden">
      {/* Grid pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(270 60% 60% / 0.5) 1px, transparent 1px), linear-gradient(90deg, hsl(270 60% 60% / 0.5) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />
      <div className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] rounded-full bg-[#8b5cf6]/8 blur-[200px]" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-[#3b82f6]/6 blur-[150px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left: Text */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] as const }}
              className="inline-flex items-center gap-2 rounded-full border border-[#8b5cf6]/30 bg-[#8b5cf6]/5 px-4 py-1.5 mb-6"
            >
              <Sparkles className="h-3.5 w-3.5 text-[#8b5cf6]" />
              <span className="text-xs font-medium text-[#8b5cf6]">{t("lp.badge")}</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] as const }}
              className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.08]"
            >
              {t("lp.heroLine1")}{" "}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#8b5cf6] via-[#3b82f6] to-[#10b981]">
                {t("lp.heroLine2")}
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2, ease: [0.22, 1, 0.36, 1] as const }}
              className="mt-5 max-w-lg text-base text-muted-foreground leading-relaxed"
            >
              {t("lp.heroSub")}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] as const }}
              className="mt-8 flex flex-wrap gap-4"
            >
              <button
                onClick={() => navigate("/register")}
                className="group relative inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_0_30px_rgba(139,92,246,0.4)] transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_0_50px_rgba(139,92,246,0.6)] active:scale-[0.98]"
              >
                <span className="absolute inset-0 rounded-full bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] animate-pulse opacity-20 blur-xl" />
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
              className="mt-12 flex flex-wrap gap-8"
            >
              {stats.map((s, i) => (
                <div key={i}>
                  <p className="text-2xl sm:text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6]">
                    {s.value}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </motion.div>
          </div>

          {/* Right: Stealth Bypass Widget */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.22, 1, 0.36, 1] as const }}
            className="relative"
          >
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md p-1">
              <div className="rounded-xl bg-[#0a0a0f] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                  <span className="ml-2 text-[10px] text-muted-foreground font-mono">stealth_bypass.exe</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Before */}
                  <div className="rounded-xl border border-red-500/20 bg-red-500/[0.03] p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-red-400" />
                      <span className="text-xs font-semibold text-red-400">Standard AI</span>
                    </div>
                    <div className="space-y-1.5">
                      <div className="h-2 rounded-full bg-white/[0.06] w-full" />
                      <div className="h-2 rounded-full bg-white/[0.06] w-[90%]" />
                      <div className="h-2 rounded-full bg-white/[0.06] w-[95%]" />
                      <div className="h-2 rounded-full bg-white/[0.06] w-[88%]" />
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-red-500/10">
                      <span className="text-[10px] text-muted-foreground">AI Detected</span>
                      <span className="text-sm font-bold text-red-400">98%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: "98%" }}
                        transition={{ duration: 1.5, delay: 0.8, ease: [0.22, 1, 0.36, 1] as const }}
                        className="h-full rounded-full bg-gradient-to-r from-red-600 to-red-400"
                      />
                    </div>
                  </div>

                  {/* After */}
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-400" />
                      <span className="text-xs font-semibold text-emerald-400">Humanize Fix</span>
                    </div>
                    <div className="space-y-1.5">
                      <div className="h-2 rounded-full bg-white/[0.06] w-full" />
                      <div className="h-2 rounded-full bg-white/[0.06] w-[72%]" />
                      <div className="h-2 rounded-full bg-white/[0.06] w-[96%]" />
                      <div className="h-2 rounded-full bg-white/[0.06] w-[60%]" />
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-emerald-500/10">
                      <span className="text-[10px] text-muted-foreground">AI Detected</span>
                      <span className="text-sm font-bold text-emerald-400">2%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: "2%" }}
                        transition={{ duration: 1.5, delay: 1.2, ease: [0.22, 1, 0.36, 1] as const }}
                        className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400"
                      />
                    </div>
                  </div>
                </div>

                {/* Arrow */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                  <motion.div
                    animate={{ x: [0, 4, 0] }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                    className="w-8 h-8 rounded-full bg-[#8b5cf6] flex items-center justify-center shadow-[0_0_20px_rgba(139,92,246,0.5)]"
                  >
                    <ArrowRight className="h-4 w-4 text-white" />
                  </motion.div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
