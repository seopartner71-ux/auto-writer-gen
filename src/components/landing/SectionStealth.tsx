import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Zap, Eye } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function SectionStealth() {
  const { t } = useI18n();
  const [score, setScore] = useState(0);
  const [perplexity, setPerplexity] = useState(0);
  const [burstiness, setBurstiness] = useState(0);
  const [started, setStarted] = useState(false);

  const radius = 62;
  const circ = 2 * Math.PI * radius;

  useEffect(() => {
    if (!started) return;
    const interval = setInterval(() => {
      setScore((p) => { if (p >= 97) { clearInterval(interval); return 97; } return p + 1; });
      setPerplexity((p) => Math.min(p + 0.85, 82));
      setBurstiness((p) => Math.min(p + 0.73, 71));
    }, 30);
    return () => clearInterval(interval);
  }, [started]);

  const progress = (score / 100) * circ;
  const color = score >= 90 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";

  return (
    <section className="relative py-32 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] rounded-full bg-emerald-500/[0.04] blur-[280px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left — Text */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            onViewportEnter={() => setStarted(true)}
          >
            <span className="text-[11px] font-mono text-emerald-400 tracking-widest uppercase mb-4 block">
              {t("stealth.tag")}
            </span>
            <h2 className="text-3xl md:text-5xl font-black tracking-[-0.04em] text-white mb-6">
              {t("stealth.title")}
            </h2>
            <p className="text-[15px] text-muted-foreground/60 leading-[1.75] mb-8 max-w-lg">
              {t("stealth.body")}
            </p>

            <div className="space-y-4">
              {[
                { icon: ShieldCheck, text: t("stealth.point1") },
                { icon: Eye, text: t("stealth.point2") },
                { icon: Zap, text: t("stealth.point3") },
              ].map((p, i) => (
                <div key={i} className="flex items-start gap-3">
                  <p.icon className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
                  <span className="text-[14px] text-white/80">{p.text}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Right — Gauge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="flex justify-center"
          >
            <div className="rounded-3xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-2xl p-2 shadow-[0_30px_80px_rgba(0,0,0,0.5),0_0_30px_rgba(16,185,129,0.08)]">
              <div className="rounded-2xl bg-[#08080e]/90 p-10 min-w-[300px]">
                <p className="text-center text-[10px] font-mono text-muted-foreground/40 uppercase tracking-widest mb-6">
                  Stealth Engine™
                </p>

                {/* Gauge */}
                <div className="flex justify-center mb-8">
                  <div className="relative w-[170px] h-[170px]">
                    <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90">
                      <circle cx="70" cy="70" r={radius} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="10" />
                      <circle cx="70" cy="70" r={radius} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
                        strokeDasharray={circ} strokeDashoffset={circ - progress}
                        style={{ transition: "stroke-dashoffset 0.05s linear, stroke 0.3s" }} />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-5xl font-black" style={{ color, letterSpacing: "-0.06em" }}>{score}%</span>
                      <span className="text-[10px] font-mono text-muted-foreground/50 mt-1">Human Score</span>
                    </div>
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-center">
                    <p className="text-2xl font-bold text-primary" style={{ letterSpacing: "-0.04em" }}>{perplexity.toFixed(1)}</p>
                    <p className="text-[9px] font-mono text-muted-foreground/40 mt-1">Perplexity</p>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-center">
                    <p className="text-2xl font-bold text-[#3b82f6]" style={{ letterSpacing: "-0.04em" }}>{burstiness.toFixed(1)}</p>
                    <p className="text-[9px] font-mono text-muted-foreground/40 mt-1">Burstiness</p>
                  </div>
                </div>

                {/* Detectors */}
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {["Originality.ai", "GPTZero", "Copyleaks", "Turnitin"].map((d, i) => (
                    <span key={i} className={`text-[9px] font-mono px-2.5 py-1 rounded-full border ${
                      score >= 90
                        ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400"
                        : "border-white/[0.06] bg-white/[0.02] text-muted-foreground/40"
                    }`}>
                      {score >= 90 ? "✓" : "○"} {d}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
