import { useEffect, useState, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Factory, Zap, CheckCircle, Globe, FileText, Shield } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

/* ── Pipeline steps ── */
const pipelineSteps = [
  { label: "Research", icon: Globe, color: "#8b5cf6" },
  { label: "Synthesis", icon: Zap, color: "#3b82f6" },
  { label: "Stealth Polish", icon: Shield, color: "#10b981" },
  { label: "WP Sync", icon: FileText, color: "#f59e0b" },
];

const articleKeys = [
  "lp.factArt1", "lp.factArt2", "lp.factArt3", "lp.factArt4",
  "lp.factArt5", "lp.factArt6", "lp.factArt7", "lp.factArt8",
];
const articleWords = [2450, 3102, 2847, 1956, 2534, 2103, 2891, 1820];

/* ── Odometer digit ── */
function OdometerDigit({ digit, delay = 0 }: { digit: number; delay?: number }) {
  return (
    <span className="inline-block overflow-hidden h-[1.1em] relative align-bottom">
      <motion.span
        className="inline-flex flex-col"
        initial={{ y: "0%" }}
        animate={{ y: `-${digit * 10}%` }}
        transition={{ duration: 1.2, delay, ease: [0.22, 1, 0.36, 1] }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
          <span key={n} className="block h-[1.1em] leading-[1.1em]">{n}</span>
        ))}
      </motion.span>
    </span>
  );
}

function OdometerNumber({ value, delay = 0 }: { value: number; delay?: number }) {
  const digits = String(value).split("").map(Number);
  return (
    <span className="inline-flex">
      {digits.map((d, i) => (
        <OdometerDigit key={i} digit={d} delay={delay + i * 0.08} />
      ))}
    </span>
  );
}

/* ── Single article card ── */
function ArticleCard({ title, words }: { title: string; words: number }) {
  return (
    <div className="shrink-0 w-[210px] rounded-xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl p-4 hover:shadow-[0_10px_40px_rgba(139,92,246,0.12)] hover:border-white/[0.12] transition-all duration-300 hover:scale-105 cursor-default">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
          <span className="text-[8px] font-tech text-emerald-400/80 uppercase">Live</span>
        </div>
        <div className="flex items-center gap-1">
          <CheckCircle className="h-2.5 w-2.5 text-[#3b82f6]/60" />
          <span className="text-[7px] font-tech text-[#3b82f6]/60">WordPress</span>
        </div>
      </div>
      <p className="text-[11px] font-semibold leading-tight truncate mb-2">{title}</p>
      <div className="flex items-center gap-1.5">
        <FileText className="h-2.5 w-2.5 text-muted-foreground/40" />
        <span className="text-[9px] font-tech text-muted-foreground/50">{words.toLocaleString()} words</span>
      </div>
    </div>
  );
}

/* ── Marquee row ── */
function MarqueeRow({ titles, direction = 1, speed = 40 }: { titles: string[]; direction?: number; speed?: number }) {
  const [paused, setPaused] = useState(false);
  const doubled = [...titles, ...titles];

  return (
    <div
      className="overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <motion.div
        className="flex gap-4 w-max"
        animate={{ x: direction > 0 ? ["0%", "-50%"] : ["-50%", "0%"] }}
        transition={{
          duration: paused ? speed * 3 : speed,
          repeat: Infinity,
          ease: "linear",
        }}
      >
        {doubled.map((title, i) => (
          <ArticleCard key={i} title={title} words={articleWords[i % articleWords.length]} />
        ))}
      </motion.div>
    </div>
  );
}

/* ── Main Section ── */
export function SectionFactory() {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const [flowOffset, setFlowOffset] = useState(0);

  const localizedTitles = articleKeys.map(k => t(k));

  useEffect(() => {
    const interval = setInterval(() => setFlowOffset(p => (p + 1) % 100), 40);
    return () => clearInterval(interval);
  }, []);

  return (
    <section ref={ref} className="relative min-h-screen flex items-center justify-center snap-start overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 right-[20%] -translate-y-1/2 w-[600px] h-[500px] rounded-full bg-[#f59e0b]/[0.04] blur-[220px]" />
      <div className="pointer-events-none absolute bottom-[20%] left-[10%] w-[400px] h-[400px] rounded-full bg-primary/[0.03] blur-[200px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-6xl">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 50 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
          className="text-center mb-12">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#f59e0b]/20 bg-[#f59e0b]/5 px-4 py-1.5 mb-6">
            <Factory className="h-3.5 w-3.5 text-[#f59e0b]" />
            <span className="text-xs font-tech font-medium text-[#f59e0b] uppercase tracking-wider">Factory</span>
          </div>
          <h2 className="text-5xl sm:text-6xl md:text-7xl font-black leading-[0.95]"
            style={{ letterSpacing: "-0.06em", textShadow: "0 0 80px rgba(245,158,11,0.08)" }}>
            {t("lp.factoryTitle")}
          </h2>
          <p className="mt-5 text-muted-foreground/80 text-[15px] max-w-2xl mx-auto leading-[1.7]">{t("lp.factorySub")}</p>
        </motion.div>

        {/* Pipeline HUD */}
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }} className="mb-10">
          <div className="flex items-center justify-center gap-0">
            {pipelineSteps.map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={i} className="flex items-center">
                  <motion.div initial={{ opacity: 0, scale: 0.8 }} whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.1 }}
                    className="flex flex-col items-center gap-2">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center border border-white/[0.06]"
                      style={{ background: `${step.color}10`, boxShadow: `0 0 20px ${step.color}08` }}>
                      <Icon className="h-5 w-5" style={{ color: step.color }} />
                    </div>
                    <span className="text-[9px] font-tech uppercase tracking-wider text-muted-foreground/60">{step.label}</span>
                  </motion.div>
                  {i < pipelineSteps.length - 1 && (
                    <div className="w-12 sm:w-20 h-px mx-2 sm:mx-4 relative -mt-5 overflow-hidden">
                      <div className="absolute inset-0 bg-white/[0.04]" />
                      <motion.div className="absolute top-0 h-full w-6 rounded-full"
                        style={{ background: `linear-gradient(90deg, transparent, ${step.color}40, transparent)`, left: `${flowOffset}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }} className="flex items-center justify-center gap-8 sm:gap-14 mb-8">
          <div className="text-center">
            <p className="text-4xl sm:text-5xl font-black text-[#f59e0b]" style={{ letterSpacing: "-0.06em" }}>
              {inView ? <OdometerNumber value={14} delay={0.3} /> : "0"}
            </p>
            <p className="text-[10px] font-tech text-muted-foreground/50 uppercase tracking-wider mt-1">{t("lp.factoryPublished")}</p>
          </div>
          <div className="w-px h-10 bg-white/[0.06]" />
          <div className="text-center">
            <p className="text-4xl sm:text-5xl font-black text-primary" style={{ letterSpacing: "-0.06em" }}>
              {inView ? <OdometerNumber value={4} delay={0.5} /> : "0"}
            </p>
            <p className="text-[10px] font-tech text-muted-foreground/50 uppercase tracking-wider mt-1">{t("lp.factoryQueue")}</p>
          </div>
          <div className="w-px h-10 bg-white/[0.06]" />
          <div className="text-center">
            <p className="text-4xl sm:text-5xl font-black text-emerald-400" style={{ letterSpacing: "-0.06em" }}>
              {inView ? <OdometerNumber value={92} delay={0.4} /> : "0"}<span className="text-2xl">%</span>
            </p>
            <p className="text-[10px] font-tech text-muted-foreground/50 uppercase tracking-wider mt-1">{t("lp.factoryBulk")}</p>
          </div>
        </motion.div>

        {/* Conveyor Belt */}
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="rounded-3xl border-t border-l border-r border-b border-t-white/15 border-l-white/8 border-r-white/4 border-b-white/[0.02] bg-white/[0.015] backdrop-blur-2xl p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.5),0_0_20px_rgba(245,158,11,0.06)]">
          <div className="rounded-2xl bg-[#06060b]/90 py-6 px-2 space-y-4 overflow-hidden">
            <MarqueeRow titles={localizedTitles} direction={1} speed={40} />
            <MarqueeRow titles={localizedTitles} direction={-1} speed={45} />
          </div>
        </motion.div>

        {/* Bottom metric */}
        <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.5 }}
          className="text-center mt-8 text-sm font-mono text-primary/90 tracking-wider"
          style={{ textShadow: "0 0 20px rgba(139,92,246,0.3)" }}>
          {t("lp.factoryMetric")}
        </motion.p>
      </div>
    </section>
  );
}
