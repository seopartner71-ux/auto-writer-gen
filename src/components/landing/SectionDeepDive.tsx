import { motion } from "framer-motion";
import { useI18n } from "@/shared/hooks/useI18n";
import { Brain, Globe, Layers } from "lucide-react";

const fadeUp = { initial: { opacity: 0, y: 50 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-100px" }, transition: { duration: 0.7 } };

/* ── tiny reusable node dot ── */
function Dot({ color, x, y, size = 6 }: { color: string; x: string; y: string; size?: number }) {
  return (
    <motion.div
      className="absolute rounded-full"
      style={{ left: x, top: y, width: size, height: size, background: color, boxShadow: `0 0 12px ${color}80` }}
      animate={{ scale: [1, 1.4, 1], opacity: [0.7, 1, 0.7] }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

export function SectionDeepDive() {
  const { t } = useI18n();

  return (
    <div className="relative py-16">
      {/* ═══════ Block 1: Stealth Technology — text left, visual right ═══════ */}
      <section className="relative py-32 overflow-hidden">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="flex flex-col lg:flex-row items-center gap-16 lg:gap-24">
            {/* Text */}
            <motion.div className="flex-1 space-y-6" {...fadeUp}>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5">
                <Brain className="h-3.5 w-3.5 text-primary" />
                <span className="text-[10px] font-tech font-medium text-primary uppercase tracking-widest">{t("deep.stealthTag")}</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-[1.05]" style={{ letterSpacing: "-0.05em" }}>
                {t("deep.stealthH1")}{" "}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-[#3b82f6]">{t("deep.stealthH2")}</span>
              </h2>
              <p className="text-[15px] text-muted-foreground/80 leading-[1.8] max-w-xl">{t("deep.stealthBody")}</p>
              <p className="text-sm font-tech text-emerald-400/80 tracking-wider">{t("deep.stealthMetric")}</p>
            </motion.div>

            {/* Visual — Neural brain */}
            <motion.div className="flex-1 flex justify-center" {...fadeUp} transition={{ duration: 0.8, delay: 0.15 }}>
              <div className="relative w-[300px] h-[300px] sm:w-[360px] sm:h-[360px]">
                {/* Glow bg */}
                <div className="absolute inset-0 rounded-full bg-primary/[0.04] blur-[80px]" />
                {/* Outer ring */}
                <svg className="absolute inset-0 w-full h-full animate-[spin_30s_linear_infinite]" viewBox="0 0 360 360">
                  <circle cx="180" cy="180" r="170" fill="none" stroke="rgba(139,92,246,0.08)" strokeWidth="1" strokeDasharray="8 12" />
                </svg>
                {/* Inner ring */}
                <svg className="absolute inset-[15%] w-[70%] h-[70%] animate-[spin_20s_linear_infinite_reverse]" viewBox="0 0 200 200">
                  <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(59,130,246,0.08)" strokeWidth="1" strokeDasharray="6 10" />
                </svg>
                {/* Center icon */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-20 h-20 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-xl flex items-center justify-center shadow-[0_10px_40px_rgba(0,0,0,0.4)]">
                    <Brain className="h-9 w-9 text-primary" />
                  </div>
                </div>
                {/* AI (red) -> Human (green) dots */}
                <Dot color="#ef4444" x="15%" y="20%" />
                <Dot color="#ef4444" x="75%" y="12%" />
                <Dot color="#f59e0b" x="10%" y="60%" />
                <Dot color="#10b981" x="80%" y="55%" size={8} />
                <Dot color="#10b981" x="55%" y="82%" size={8} />
                <Dot color="#10b981" x="25%" y="85%" size={7} />
                {/* Labels */}
                <span className="absolute top-[14%] left-[22%] text-[8px] font-tech text-red-400/60 uppercase">AI</span>
                <span className="absolute bottom-[10%] right-[18%] text-[8px] font-tech text-emerald-400/60 uppercase">Human</span>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ═══════ Block 2: GEO Era — visual left, text right ═══════ */}
      <section className="relative py-32 overflow-hidden">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="flex flex-col lg:flex-row-reverse items-center gap-16 lg:gap-24">
            {/* Text */}
            <motion.div className="flex-1 space-y-6" {...fadeUp}>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#06b6d4]/20 bg-[#06b6d4]/5 px-4 py-1.5">
                <Globe className="h-3.5 w-3.5 text-[#06b6d4]" />
                <span className="text-[10px] font-tech font-medium text-[#06b6d4] uppercase tracking-widest">GEO</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-[1.05]" style={{ letterSpacing: "-0.05em" }}>
                {t("deep.geoH1")}{" "}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#06b6d4] to-[#3b82f6]">{t("deep.geoH2")}</span>
              </h2>
              <p className="text-[15px] text-muted-foreground/80 leading-[1.8] max-w-xl">{t("deep.geoBody")}</p>
              <p className="text-sm font-tech text-[#06b6d4]/80 tracking-wider">{t("deep.geoMetric")}</p>
            </motion.div>

            {/* Visual — Perplexity-style card */}
            <motion.div className="flex-1 flex justify-center" {...fadeUp} transition={{ duration: 0.8, delay: 0.15 }}>
              <div className="w-full max-w-[380px] rounded-2xl border-t border-l border-r border-b border-t-white/15 border-l-white/8 border-r-white/4 border-b-white/[0.02] bg-white/[0.02] backdrop-blur-2xl p-1 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                <div className="rounded-xl bg-[#06060b]/90 p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-5 h-5 rounded bg-[#06b6d4]/20 flex items-center justify-center">
                      <Globe className="h-3 w-3 text-[#06b6d4]" />
                    </div>
                    <span className="text-[10px] font-tech text-muted-foreground/50">perplexity.ai</span>
                  </div>
                  <p className="text-xs text-foreground/70 leading-[1.8] mb-3">{t("deep.geoFakeAnswer")}</p>
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#06b6d4]/20 bg-[#06b6d4]/[0.04] w-fit">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#06b6d4]" />
                    <span className="text-[9px] font-tech text-[#06b6d4]">{t("deep.geoSource")}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ═══════ Block 3: Factory — text left, visual right (wide) ═══════ */}
      <section className="relative py-32 overflow-hidden">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="flex flex-col lg:flex-row items-center gap-16 lg:gap-24">
            {/* Text */}
            <motion.div className="flex-1 space-y-6" {...fadeUp}>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#f59e0b]/20 bg-[#f59e0b]/5 px-4 py-1.5">
                <Layers className="h-3.5 w-3.5 text-[#f59e0b]" />
                <span className="text-[10px] font-tech font-medium text-[#f59e0b] uppercase tracking-widest">Factory</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-[1.05]" style={{ letterSpacing: "-0.05em" }}>
                {t("deep.factoryH1")}{" "}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#f59e0b] to-[#ef4444]">{t("deep.factoryH2")}</span>
              </h2>
              <p className="text-[15px] text-muted-foreground/80 leading-[1.8] max-w-xl">{t("deep.factoryBody")}</p>
              <p className="text-sm font-tech text-[#f59e0b]/80 tracking-wider">{t("deep.factoryMetric")}</p>
            </motion.div>

            {/* Visual — Pipeline */}
            <motion.div className="flex-1 flex justify-center" {...fadeUp} transition={{ duration: 0.8, delay: 0.15 }}>
              <div className="w-full max-w-[420px] rounded-2xl border-t border-l border-r border-b border-t-white/15 border-l-white/8 border-r-white/4 border-b-white/[0.02] bg-white/[0.02] backdrop-blur-2xl p-1 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                <div className="rounded-xl bg-[#06060b]/90 p-5">
                  <p className="text-[9px] font-tech text-muted-foreground/40 uppercase tracking-widest mb-4">Pipeline</p>
                  <div className="flex items-center gap-3">
                    {[
                      { label: "Research", color: "#8b5cf6", icon: "🔍" },
                      { label: "Synthesis", color: "#3b82f6", icon: "⚙️" },
                      { label: "Humanize", color: "#10b981", icon: "🧬" },
                      { label: "Publish", color: "#f59e0b", icon: "🚀" },
                    ].map((step, i) => (
                      <div key={i} className="flex items-center gap-3 flex-1">
                        <motion.div
                          className="flex flex-col items-center gap-1.5 flex-1"
                          initial={{ opacity: 0, y: 15 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true }}
                          transition={{ delay: 0.3 + i * 0.12 }}
                        >
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-base" style={{ background: `${step.color}15`, boxShadow: `0 0 20px ${step.color}10` }}>
                            {step.icon}
                          </div>
                          <span className="text-[8px] font-tech uppercase tracking-wider" style={{ color: step.color }}>{step.label}</span>
                        </motion.div>
                        {i < 3 && <div className="w-4 h-px bg-white/10 shrink-0 -mt-4" />}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}
