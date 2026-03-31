import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles, ShieldCheck, ScanLine, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function LandingHero() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [scanPhase, setScanPhase] = useState(0); // 0=idle, 1=scanning, 2=done

  useEffect(() => {
    const timer1 = setTimeout(() => setScanPhase(1), 1200);
    const timer2 = setTimeout(() => setScanPhase(2), 3500);
    return () => { clearTimeout(timer1); clearTimeout(timer2); };
  }, []);

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
      {/* Large glow behind hero */}
      <div className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[700px] rounded-full bg-primary/[0.07] blur-[220px]" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full bg-[#3b82f6]/[0.05] blur-[180px]" />

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
              className="text-4xl sm:text-5xl md:text-6xl lg:text-[4.25rem] font-black tracking-display leading-[1.05]"
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
                  <p className="text-3xl sm:text-4xl font-black tracking-display bg-clip-text text-transparent bg-gradient-to-r from-primary to-[#3b82f6]">
                    {s.value}
                  </p>
                  <p className="mt-1 text-xs text-[#9ca3af] font-tech uppercase tracking-wider">{s.label}</p>
                </div>
              ))}
            </motion.div>
          </div>

          {/* Right: AI Stealth Engine Widget */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.22, 1, 0.36, 1] as const }}
            className="relative"
          >
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl p-1.5">
              <div className="rounded-xl bg-[#08080d] p-6">
                {/* Window chrome */}
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                  <span className="ml-3 text-[10px] text-[#9ca3af] font-mono tracking-wide">ai_stealth_engine.run</span>
                </div>

                {/* Blurred text block */}
                <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] p-4 mb-4">
                  <p className="text-[10px] font-tech text-[#9ca3af]/60 uppercase tracking-wider mb-2">{t("lp.heroOriginal")}</p>
                  <div className="space-y-1.5">
                    <div className="h-2 rounded-full bg-white/[0.06] w-full" />
                    <div className="h-2 rounded-full bg-white/[0.06] w-[92%]" />
                    <div className="h-2 rounded-full bg-white/[0.06] w-[88%]" />
                    <div className="h-2 rounded-full bg-white/[0.06] w-[95%]" />
                  </div>
                </div>

                {/* Scanning line */}
                <div className="relative h-8 mb-4 flex items-center gap-3">
                  <ScanLine className={`h-4 w-4 shrink-0 transition-colors duration-500 ${scanPhase === 1 ? "text-primary animate-pulse" : scanPhase === 2 ? "text-emerald-400" : "text-[#9ca3af]/40"}`} />
                  {scanPhase === 1 && (
                    <motion.div
                      className="flex-1 h-[2px] rounded-full bg-primary/40 overflow-hidden"
                    >
                      <motion.div
                        className="h-full bg-gradient-to-r from-primary to-[#3b82f6]"
                        initial={{ width: "0%" }}
                        animate={{ width: "100%" }}
                        transition={{ duration: 2, ease: "easeInOut" }}
                      />
                    </motion.div>
                  )}
                  {scanPhase === 1 && (
                    <span className="text-[10px] font-tech text-primary animate-pulse">{t("lp.heroScanning")}</span>
                  )}
                  {scanPhase === 2 && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center gap-2"
                    >
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span className="text-[10px] font-tech text-emerald-400">{t("lp.heroComplete")}</span>
                    </motion.div>
                  )}
                  {scanPhase === 0 && (
                    <span className="text-[10px] font-tech text-[#9ca3af]/40">{t("lp.heroWaiting")}</span>
                  )}
                </div>

                {/* Result panel */}
                <motion.div
                  initial={{ opacity: 0.3 }}
                  animate={{ opacity: scanPhase === 2 ? 1 : 0.3 }}
                  transition={{ duration: 0.6 }}
                  className="grid grid-cols-2 gap-3"
                >
                  {/* Human Score */}
                  <div className={`rounded-lg border p-4 transition-colors duration-500 ${
                    scanPhase === 2 ? "border-emerald-500/30 bg-emerald-500/[0.04]" : "border-white/[0.04] bg-white/[0.01]"
                  }`}>
                    <p className="text-[10px] font-tech text-[#9ca3af] uppercase tracking-wider mb-1">Human Score</p>
                    <motion.p
                      className="text-3xl font-black tracking-display"
                      style={{ color: scanPhase === 2 ? "#10b981" : "#9ca3af" }}
                    >
                      {scanPhase === 2 ? "99%" : "—"}
                    </motion.p>
                  </div>

                  {/* Status */}
                  <div className={`rounded-lg border p-4 transition-colors duration-500 ${
                    scanPhase === 2 ? "border-emerald-500/30 bg-emerald-500/[0.04]" : "border-white/[0.04] bg-white/[0.01]"
                  }`}>
                    <p className="text-[10px] font-tech text-[#9ca3af] uppercase tracking-wider mb-1">{t("lp.heroStatus")}</p>
                    <div className="flex items-center gap-2">
                      {scanPhase === 2 ? (
                        <>
                          <ShieldCheck className="h-5 w-5 text-emerald-400" />
                          <span className="text-sm font-tech font-bold text-emerald-400">{t("lp.heroPassed")}</span>
                        </>
                      ) : (
                        <span className="text-sm font-tech text-[#9ca3af]/40">—</span>
                      )}
                    </div>
                  </div>
                </motion.div>

                {/* Detectors passed */}
                {scanPhase === 2 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="mt-3 flex flex-wrap gap-1.5"
                  >
                    {["Originality.ai", "GPTZero", "Copyleaks"].map((d, i) => (
                      <span key={i} className="text-[9px] font-tech px-2 py-0.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-400">
                        ✓ {d}
                      </span>
                    ))}
                  </motion.div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
