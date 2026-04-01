import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Play, ShieldCheck, Activity } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

/* ---------- Glowing dashboard mockup ---------- */
function DashboardMockup() {
  const [humanScore, setHumanScore] = useState(0);
  const [stealthActive, setStealthActive] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setStealthActive(true), 1200);
    const interval = setInterval(() => {
      setHumanScore((p) => {
        if (p >= 98) { clearInterval(interval); return 98; }
        return p + 1;
      });
    }, 35);
    return () => { clearTimeout(t); clearInterval(interval); };
  }, []);

  const scoreColor = humanScore >= 90 ? "text-emerald-400" : humanScore >= 50 ? "text-amber-400" : "text-red-400";

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-2xl p-1 shadow-[0_30px_80px_rgba(0,0,0,0.5),0_0_60px_rgba(139,92,246,0.06)]">
      <div className="rounded-xl bg-[#060609]/90 overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.04]">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
          </div>
          <span className="ml-2 text-[10px] font-mono text-muted-foreground/40">serpblueprint — dashboard</span>
        </div>

        {/* Dashboard content */}
        <div className="p-6 space-y-5">
          {/* Human Score */}
          <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono text-muted-foreground/30 uppercase tracking-widest">Human Score</span>
              <Activity className="h-3.5 w-3.5 text-emerald-400/50" />
            </div>
            <div className={`text-5xl font-extrabold tracking-[-0.05em] ${scoreColor} transition-colors`}>
              {humanScore}%
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-white/[0.03] overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                animate={{ width: `${humanScore}%` }}
                transition={{ duration: 0.05 }}
              />
            </div>
          </div>

          {/* Stealth Mode */}
          <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono text-muted-foreground/30 uppercase tracking-widest block mb-1">Stealth Mode</span>
              <span className={`text-sm font-tech font-bold ${stealthActive ? "text-emerald-400" : "text-muted-foreground/30"}`}>
                {stealthActive ? "Active" : "Initializing..."}
              </span>
            </div>
            <div className={`w-3 h-3 rounded-full ${stealthActive ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.5)]" : "bg-muted-foreground/20"} transition-all`} />
          </div>

          {/* Mini metrics */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Perplexity", value: "82.4" },
              { label: "Burstiness", value: "71.2" },
              { label: "SEO Score", value: "94" },
            ].map((m, i) => (
              <div key={i} className="rounded-lg border border-white/[0.03] bg-white/[0.005] p-3 text-center">
                <div className="text-lg font-bold text-white/80 tracking-tight">{m.value}</div>
                <div className="text-[8px] font-mono text-muted-foreground/25 mt-0.5">{m.label}</div>
              </div>
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
      {/* Radial glow */}
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] rounded-full bg-gradient-radial from-indigo-500/[0.04] to-transparent blur-[200px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
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
              {t("hero2.line1")}{" "}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-[#3b82f6]">
                {t("hero2.line2")}
              </span>
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
