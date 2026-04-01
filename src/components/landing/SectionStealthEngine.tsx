import { useRef, useEffect, useState } from "react";
import { motion, useInView } from "framer-motion";
import { Shield, CheckCircle, Zap } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

/* ── Animated gauge arc ── */
function HumanScoreGauge({ inView }: { inView: boolean }) {
  const [score, setScore] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let frame: number;
    let start: number;
    const duration = 2000;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setScore(Math.round(eased * 97));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView]);

  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * 0.75; // 270 degree arc
  const dashOffset = circumference * (1 - progress);

  return (
    <div className="flex flex-col items-center">
      <svg width="200" height="200" viewBox="0 0 200 200" className="drop-shadow-[0_0_30px_rgba(16,185,129,0.3)]">
        {/* Background arc */}
        <circle
          cx="100" cy="100" r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
          transform="rotate(135 100 100)"
        />
        {/* Progress arc */}
        <motion.circle
          cx="100" cy="100" r={radius}
          fill="none"
          stroke="url(#gaugeGrad)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform="rotate(135 100 100)"
          initial={{ strokeDashoffset: circumference }}
          animate={inView ? { strokeDashoffset: dashOffset } : {}}
          transition={{ duration: 2, ease: "easeOut" }}
        />
        {/* Glow circle at tip */}
        <defs>
          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Center text */}
        <text x="100" y="90" textAnchor="middle" className="fill-emerald-400 text-5xl font-black" style={{ fontSize: "48px", fontWeight: 900 }}>
          {score}%
        </text>
        <text x="100" y="115" textAnchor="middle" className="fill-muted-foreground/60" style={{ fontSize: "12px", fontFamily: "monospace", letterSpacing: "0.1em" }}>
          Human Score
        </text>
      </svg>
    </div>
  );
}

/* ── Metric card ── */
function MetricCard({ value, label, delay, inView }: { value: number; label: string; delay: number; inView: boolean }) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const timeout = setTimeout(() => {
      let frame: number;
      let start: number;
      const tick = (ts: number) => {
        if (!start) start = ts;
        const p = Math.min((ts - start) / 1500, 1);
        setCurrent(+(p * value).toFixed(1));
        if (p < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    }, delay);
    return () => clearTimeout(timeout);
  }, [inView, value, delay]);

  return (
    <div className="flex-1 rounded-xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl p-4 text-center">
      <p className="text-2xl sm:text-3xl font-black text-emerald-400" style={{ letterSpacing: "-0.04em" }}>
        {current.toFixed(1)}
      </p>
      <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}

/* ── Detector badges ── */
const detectors = ["Originality.ai", "GPTZero", "Copyleaks", "Turnitin"];

export function SectionStealthEngine() {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  const bullets = [
    { icon: CheckCircle, text: t("lp.stealthBullet1"), color: "#10b981" },
    { icon: Shield, text: t("lp.stealthBullet2"), color: "#10b981" },
    { icon: Zap, text: t("lp.stealthBullet3"), color: "#f59e0b" },
  ];

  return (
    <section ref={ref} className="relative py-32 overflow-hidden">
      {/* Background glows */}
      <div className="pointer-events-none absolute top-1/2 right-[15%] -translate-y-1/2 w-[600px] h-[500px] rounded-full bg-emerald-500/[0.04] blur-[250px]" />
      <div className="pointer-events-none absolute bottom-[20%] left-[5%] w-[400px] h-[400px] rounded-full bg-primary/[0.03] blur-[200px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left: Text */}
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.7 }}
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-4 py-1.5 mb-6">
              <Shield className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs font-mono font-medium text-emerald-400 uppercase tracking-wider">
                Core Technology
              </span>
            </div>

            <h2
              className="text-4xl sm:text-5xl md:text-6xl font-black leading-[0.95] mb-6"
              style={{ letterSpacing: "-0.06em", textShadow: "0 0 80px rgba(16,185,129,0.08)" }}
            >
              {t("lp.stealthEngineH1")}
              <br />
              <span className="text-emerald-400">{t("lp.stealthEngineH2")}</span>
            </h2>

            <p className="text-muted-foreground/70 text-[15px] leading-[1.8] mb-8 max-w-lg">
              {t("lp.stealthEngineBody")}
            </p>

            <div className="space-y-4">
              {bullets.map((b, i) => {
                const Icon = b.icon;
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    animate={inView ? { opacity: 1, x: 0 } : {}}
                    transition={{ duration: 0.5, delay: 0.4 + i * 0.15 }}
                    className="flex items-start gap-3"
                  >
                    <Icon className="h-5 w-5 mt-0.5 shrink-0" style={{ color: b.color }} />
                    <span className="text-sm text-foreground/80">{b.text}</span>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>

          {/* Right: Visual widget */}
          <motion.div
            initial={{ opacity: 0, x: 40, scale: 0.95 }}
            animate={inView ? { opacity: 1, x: 0, scale: 1 } : {}}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="flex justify-center"
          >
            <div className="w-full max-w-md rounded-2xl border border-white/[0.06] bg-[#08080f]/95 backdrop-blur-2xl shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_40px_rgba(16,185,129,0.06)] overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-center px-6 py-4 border-b border-white/[0.04]">
                <motion.span
                  className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-[0.2em]"
                  animate={{ opacity: [0.4, 0.8, 0.4] }}
                  transition={{ duration: 3, repeat: Infinity }}
                >
                  Stealth Engine™
                </motion.span>
              </div>

              {/* Gauge */}
              <div className="px-6 pt-6 pb-4">
                <HumanScoreGauge inView={inView} />
              </div>

              {/* Metrics */}
              <div className="px-6 pb-4 flex gap-3">
                <MetricCard value={82.0} label="Perplexity" delay={800} inView={inView} />
                <MetricCard value={71.0} label="Burstiness" delay={1000} inView={inView} />
              </div>

              {/* Detector badges */}
              <div className="px-6 pb-6">
                <div className="flex flex-wrap gap-2 justify-center">
                  {detectors.map((d, i) => (
                    <motion.div
                      key={d}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={inView ? { opacity: 1, scale: 1 } : {}}
                      transition={{ duration: 0.4, delay: 1.5 + i * 0.1 }}
                      className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5"
                    >
                      <CheckCircle className="h-3 w-3 text-emerald-400" />
                      <span className="text-[10px] font-mono text-emerald-400/80">{d}</span>
                    </motion.div>
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
