import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles, Shield, BarChart3 } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function SectionHero() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [aiPercent, setAiPercent] = useState(98);
  const [phase, setPhase] = useState<"dropping" | "done">("dropping");

  useEffect(() => {
    const timer = setTimeout(() => {
      const interval = setInterval(() => {
        setAiPercent((prev) => {
          if (prev <= 0) { clearInterval(interval); setPhase("done"); return 0; }
          return prev - (prev > 40 ? 3 : prev > 10 ? 2 : 1);
        });
      }, 45);
      return () => clearInterval(interval);
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  const radius = 58;
  const circ = 2 * Math.PI * radius;
  const progress = (aiPercent / 100) * circ;
  const color = aiPercent > 50 ? "#ef4444" : aiPercent > 15 ? "#f59e0b" : "#10b981";
  const label = aiPercent > 15 ? "AI Detected" : "Human Score";
  const displayVal = aiPercent > 15 ? `${aiPercent}%` : `${100 - aiPercent}%`;

  // SoM chart data for GEO Radar mockup
  const somBars = [
    { model: "GPT-4o", pct: 78, color: "#10b981" },
    { model: "Claude", pct: 45, color: "#f59e0b" },
    { model: "Perplexity", pct: 92, color: "#06b6d4" },
    { model: "Gemini", pct: 61, color: "#8b5cf6" },
  ];

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-[0.025]" style={{
        backgroundImage: "linear-gradient(hsl(270 60% 60% / 0.5) 1px, transparent 1px), linear-gradient(90deg, hsl(270 60% 60% / 0.5) 1px, transparent 1px)",
        backgroundSize: "80px 80px",
      }} />
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] rounded-full bg-primary/[0.08] blur-[250px]" />
      <div className="pointer-events-none absolute bottom-[10%] right-[10%] w-[500px] h-[400px] rounded-full bg-[#06b6d4]/[0.06] blur-[200px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-6xl">
        <div className="flex flex-col lg:flex-row items-center gap-16 lg:gap-20">
          {/* Left */}
          <div className="flex-1 text-center lg:text-left">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
              className="inline-flex items-center gap-2 rounded-full border border-[#06b6d4]/30 bg-[#06b6d4]/5 px-4 py-1.5 mb-8">
              <Sparkles className="h-3.5 w-3.5 text-[#06b6d4]" />
              <span className="text-xs font-tech font-medium text-[#06b6d4] uppercase tracking-wider">{t("lp.badge")}</span>
            </motion.div>

            <motion.h1 initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.1 }}
              className="text-5xl sm:text-6xl md:text-7xl lg:text-[5.5rem] font-extrabold leading-[0.95]" style={{ letterSpacing: "-0.06em", textShadow: "0 0 80px rgba(6,182,212,0.12)" }}>
              {t("awg.heroLine1")}
              <br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#06b6d4] to-[#8b5cf6]">
                {t("awg.heroLine2")}
              </span>
            </motion.h1>

            <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.25 }}
              className="mt-6 max-w-xl text-[15px] text-muted-foreground/80 leading-[1.7] mx-auto lg:mx-0">
              {t("awg.heroSub")}
            </motion.p>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.35 }}
              className="mt-10 flex flex-wrap gap-4 justify-center lg:justify-start">
              <button onClick={() => navigate("/register")}
                className="group relative inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#06b6d4] to-[#8b5cf6] px-10 py-5 text-base font-tech font-bold text-white shadow-[0_20px_60px_rgba(6,182,212,0.3)] transition-all duration-300 hover:scale-[1.04] hover:shadow-[0_25px_80px_rgba(6,182,212,0.45)] active:scale-[0.98]">
                <span className="absolute inset-0 rounded-full bg-gradient-to-r from-[#06b6d4] to-[#8b5cf6] animate-pulse opacity-15 blur-2xl" />
                <span className="relative flex items-center gap-2">
                  {t("awg.cta")}
                  <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                </span>
              </button>
            </motion.div>

            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.8 }}
              className="mt-8 text-sm font-tech text-emerald-400/80 tracking-widest">
              {t("lp.heroMetric")}
            </motion.p>
          </div>

          {/* Right — 3D-tilted GEO Radar Dashboard Mockup */}
          <motion.div initial={{ opacity: 0, scale: 0.9, rotateY: -10 }} animate={{ opacity: 1, scale: 1, rotateY: 0 }} transition={{ duration: 1, delay: 0.3 }}
            className="relative shrink-0" style={{ perspective: 1200 }}>
            <div className="rounded-3xl border-t border-l border-r border-b border-t-white/20 border-l-white/10 border-r-white/5 border-b-white/[0.02] bg-white/[0.02] backdrop-blur-2xl p-2 shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_30px_rgba(6,182,212,0.1)]"
              style={{ transform: "rotateY(-4deg) rotateX(2deg)" }}>
              <div className="rounded-2xl bg-[#06060b]/90 p-6 min-w-[320px] sm:min-w-[380px]">
                {/* Title bar */}
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-red-500/60" />
                  <div className="w-2 h-2 rounded-full bg-yellow-500/60" />
                  <div className="w-2 h-2 rounded-full bg-green-500/60" />
                  <span className="ml-2 text-[10px] font-mono text-muted-foreground/50">geo_radar.dashboard</span>
                </div>

                {/* SoM Chart Header */}
                <div className="flex items-center justify-between mt-3 mb-4">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-[#06b6d4]" />
                    <span className="text-[11px] font-tech font-semibold text-[#06b6d4] uppercase tracking-wider">Share of Model</span>
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground/40">LIVE</span>
                </div>

                {/* SoM Bars */}
                <div className="space-y-3 mb-5">
                  {somBars.map((bar, i) => (
                    <motion.div key={bar.model} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8 + i * 0.15 }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-mono text-muted-foreground/70">{bar.model}</span>
                        <span className="text-[10px] font-mono font-bold" style={{ color: bar.color }}>{bar.pct}%</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-white/[0.04]">
                        <motion.div className="h-full rounded-full" style={{ background: bar.color }}
                          initial={{ width: 0 }} animate={{ width: `${bar.pct}%` }}
                          transition={{ duration: 1.2, delay: 1 + i * 0.15, ease: "easeOut" }} />
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Stealth Gauge (compact) */}
                <div className="border-t border-white/[0.04] pt-4">
                  <div className="flex items-center gap-4">
                    <div className="relative w-[80px] h-[80px] shrink-0">
                      <svg viewBox="0 0 130 130" className="w-full h-full -rotate-90">
                        <circle cx="65" cy="65" r={radius} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="8" />
                        <circle cx="65" cy="65" r={radius} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
                          strokeDasharray={circ} strokeDashoffset={circ - progress}
                          style={{ transition: "stroke-dashoffset 0.06s linear, stroke 0.3s" }} />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-lg font-black" style={{ color, letterSpacing: "-0.06em" }}>{displayVal}</span>
                        <span className="text-[7px] text-muted-foreground/50 font-tech uppercase">{label}</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {phase === "done" ? (
                        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                          className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-1">
                          <Shield className="h-3 w-3 text-emerald-400" />
                          <span className="text-[10px] font-tech font-bold text-emerald-400">{t("lp.stealthActive")}</span>
                        </motion.div>
                      ) : (
                        <div className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/[0.06] px-3 py-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                          <span className="text-[10px] font-tech text-primary">{t("lp.stealthProcessing")}</span>
                        </div>
                      )}
                      {phase === "done" && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
                          className="flex flex-wrap gap-1">
                          {["Originality.ai", "GPTZero"].map((d, i) => (
                            <span key={i} className="text-[7px] font-tech px-1.5 py-0.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-400">
                              ✓ {d}
                            </span>
                          ))}
                        </motion.div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
