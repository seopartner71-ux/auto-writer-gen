import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Play, ShieldCheck, Activity, Hash, Search, FileText } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

/* ---------- LSI keyword stream ---------- */
const lsiKeywords = [
  "pool maintenance cost", "chemical balance testing", "filter replacement schedule",
  "seasonal pool care", "salt vs chlorine systems", "pump efficiency rating",
  "water hardness ppm", "algae prevention protocol", "heat pump sizing",
  "skimmer basket capacity", "pH level optimal range", "backwash frequency",
];

function LSIStream() {
  const [visible, setVisible] = useState<number[]>([]);
  const ref = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => {
      ref.current = (ref.current + 1) % lsiKeywords.length;
      setVisible((prev) => {
        const next = [...prev, ref.current];
        return next.length > 6 ? next.slice(-6) : next;
      });
    }, 800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-wrap gap-1.5 overflow-hidden max-h-[52px]">
      <AnimatePresence mode="popLayout">
        {visible.map((idx) => (
          <motion.span
            key={`${idx}-${visible.indexOf(idx)}`}
            initial={{ opacity: 0, scale: 0.8, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="text-[9px] font-mono px-2 py-0.5 rounded-full border border-primary/20 bg-primary/[0.06] text-primary/80 whitespace-nowrap"
          >
            <Hash className="inline h-2.5 w-2.5 mr-0.5" />{lsiKeywords[idx]}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ---------- Enhanced Dashboard Mockup ---------- */
function DashboardMockup() {
  const [humanScore, setHumanScore] = useState(0);
  const [stealthActive, setStealthActive] = useState(false);
  const [lsiCount, setLsiCount] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setStealthActive(true), 1200);
    const interval = setInterval(() => {
      setHumanScore((p) => { if (p >= 98) { clearInterval(interval); return 98; } return p + 1; });
    }, 35);
    const lsiInterval = setInterval(() => {
      setLsiCount((p) => Math.min(p + 1, 47));
    }, 80);
    return () => { clearTimeout(t); clearInterval(interval); clearInterval(lsiInterval); };
  }, []);

  const scoreColor = humanScore >= 90 ? "text-emerald-400" : humanScore >= 50 ? "text-amber-400" : "text-red-400";
  const radius = 42;
  const circ = 2 * Math.PI * radius;
  const progress = (humanScore / 100) * circ;
  const strokeColor = humanScore >= 90 ? "#34d399" : humanScore >= 50 ? "#fbbf24" : "#f87171";

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-2xl p-1 shadow-[0_30px_80px_rgba(0,0,0,0.5),0_0_80px_rgba(139,92,246,0.08)]">
      <div className="rounded-xl bg-[#060609]/90 overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.04]">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
          </div>
          <span className="ml-2 text-[10px] font-mono text-muted-foreground/40">serpblueprint — analysis</span>
          <div className="ml-auto">
            <span className="text-[9px] font-mono text-emerald-400/60 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Top row — Gauge + Stealth */}
          <div className="grid grid-cols-2 gap-4">
            {/* Gauge */}
            <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4 flex flex-col items-center">
              <span className="text-[9px] font-mono text-muted-foreground/25 uppercase tracking-widest mb-2">Human Score</span>
              <div className="relative w-[100px] h-[100px]">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth="7" />
                  <circle cx="50" cy="50" r={radius} fill="none" stroke={strokeColor} strokeWidth="7" strokeLinecap="round"
                    strokeDasharray={circ} strokeDashoffset={circ - progress}
                    style={{ transition: "stroke-dashoffset 0.05s linear, stroke 0.3s" }} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-3xl font-extrabold tracking-[-0.05em] ${scoreColor}`}>{humanScore}%</span>
                </div>
              </div>
            </div>

            {/* Stealth + Metrics */}
            <div className="space-y-3">
              <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono text-muted-foreground/25 uppercase tracking-widest">Stealth</span>
                  <div className={`w-2.5 h-2.5 rounded-full ${stealthActive ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]" : "bg-muted-foreground/20"} transition-all`} />
                </div>
                <span className={`text-sm font-tech font-bold ${stealthActive ? "text-emerald-400" : "text-muted-foreground/30"}`}>
                  {stealthActive ? "Active" : "..."}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-white/[0.03] bg-white/[0.005] p-2 text-center">
                  <div className="text-sm font-bold text-primary/80">82.4</div>
                  <div className="text-[7px] font-mono text-muted-foreground/20">Perplexity</div>
                </div>
                <div className="rounded-lg border border-white/[0.03] bg-white/[0.005] p-2 text-center">
                  <div className="text-sm font-bold text-[#3b82f6]/80">71.2</div>
                  <div className="text-[7px] font-mono text-muted-foreground/20">Burstiness</div>
                </div>
              </div>
            </div>
          </div>

          {/* LSI extraction live */}
          <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-mono text-muted-foreground/25 uppercase tracking-widest flex items-center gap-1">
                <Search className="h-3 w-3" /> LSI Extraction
              </span>
              <span className="text-[9px] font-mono text-primary/60">{lsiCount} found</span>
            </div>
            <LSIStream />
          </div>

          {/* Detectors passed */}
          <div className="flex flex-wrap gap-1.5">
            {["Originality.ai", "GPTZero", "Copyleaks", "Turnitin"].map((d, i) => (
              <span key={i} className={`text-[8px] font-mono px-2 py-0.5 rounded-full border transition-all ${
                humanScore >= 90
                  ? "border-emerald-500/15 bg-emerald-500/[0.04] text-emerald-400/70"
                  : "border-white/[0.04] bg-white/[0.01] text-muted-foreground/20"
              }`}>
                {humanScore >= 90 ? "✓" : "○"} {d}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Hero ---------- */
export function SectionHero() {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20 pb-16">
      {/* Grid */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.015]" style={{
        backgroundImage: "linear-gradient(hsl(var(--primary) / 0.4) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary) / 0.4) 1px, transparent 1px)",
        backgroundSize: "80px 80px",
      }} />
      {/* Radial glows */}
      <div className="pointer-events-none absolute top-1/4 left-1/3 w-[600px] h-[400px] rounded-full bg-indigo-500/[0.04] blur-[200px]" />
      <div className="pointer-events-none absolute bottom-1/4 right-1/4 w-[500px] h-[350px] rounded-full bg-slate-500/[0.03] blur-[200px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left — Copy */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.04] px-4 py-1.5 mb-10"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] font-tech font-medium text-primary/80 uppercase tracking-widest">SERPblueprint v2.0</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="text-4xl sm:text-5xl md:text-[3.5rem] lg:text-[3.8rem] font-extrabold leading-[1.05]"
              style={{ letterSpacing: "-0.04em" }}
            >
              {t("hero2.line1")}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.25 }}
              className="mt-8 max-w-lg text-base text-muted-foreground/60 leading-[1.8]"
            >
              {t("hero2.sub")}
            </motion.p>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.35 }}
              className="mt-10 flex flex-wrap gap-4"
            >
              <button onClick={() => navigate("/register")}
                className="group relative inline-flex items-center gap-2.5 rounded-full bg-gradient-to-r from-primary to-[#3b82f6] px-8 py-4 text-[15px] font-tech font-bold text-white shadow-[0_20px_60px_rgba(139,92,246,0.25)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_25px_80px_rgba(139,92,246,0.4)] active:scale-[0.98]">
                {t("nav.startFree")}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              <button onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })}
                className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] px-7 py-4 text-[15px] font-tech font-medium text-white/70 transition-all duration-300 hover:bg-white/[0.05] hover:border-white/[0.15]">
                <Play className="h-4 w-4 text-primary/70" />
                {t("hero.demo")}
              </button>
            </motion.div>

            {/* Trust bar */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.8 }}
              className="mt-14 space-y-3"
            >
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {["0% AI Detection", "Stealth Guard™", "Human Score 95+"].map((text, i) => (
                  <span key={i} className="flex items-center gap-1.5 text-[12px] font-tech text-emerald-400/70 tracking-wide">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {text}
                  </span>
                ))}
              </div>
              <p className="text-[11px] font-mono text-muted-foreground/30 tracking-wider">
                {t("hero.bypasses")}
              </p>
            </motion.div>
          </div>

          {/* Right — Dashboard */}
          <motion.div
            initial={{ opacity: 0, x: 40, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ duration: 0.9, delay: 0.3 }}
            className="hidden lg:block"
          >
            <DashboardMockup />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
