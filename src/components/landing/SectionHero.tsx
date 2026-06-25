import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles, Shield, PlayCircle } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function SectionHero() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
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
  // Premium minimalism: keep risk colors muted, success uses brand primary (no neon)
  const color = aiPercent > 50 ? "#dc2626" : aiPercent > 15 ? "#d97706" : "#6E56CF";
  const label = aiPercent > 15 ? "AI Detected" : "Human Score";
  const displayVal = aiPercent > 15 ? `${aiPercent}%` : `${100 - aiPercent}%`;

  return (
    <section className="relative flex items-center justify-center overflow-hidden pt-24 pb-16 md:pt-28 md:pb-20">
      {/* Grid */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.025]" style={{
        backgroundImage: "linear-gradient(hsl(270 60% 60% / 0.5) 1px, transparent 1px), linear-gradient(90deg, hsl(270 60% 60% / 0.5) 1px, transparent 1px)",
        backgroundSize: "80px 80px",
      }} />
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] rounded-full bg-primary/[0.08] blur-[250px]" />
      <div className="pointer-events-none absolute bottom-[10%] right-[10%] w-[500px] h-[400px] rounded-full bg-[#3b82f6]/[0.06] blur-[200px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-6xl">
        <div className="flex flex-col lg:flex-row items-center gap-16 lg:gap-20">
          {/* Left */}
          <div className="flex-1 text-center lg:text-left">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
              className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 mb-8">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-tech font-medium text-primary uppercase tracking-wider">{t("lp.badge")}</span>
            </motion.div>

            <motion.h1 initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.1 }}
              className="text-5xl sm:text-6xl md:text-7xl lg:text-[5.5rem] font-extrabold leading-[0.95] text-foreground" style={{ letterSpacing: "-0.06em" }}>
              {t("lp.heroLine1")}
            </motion.h1>

            <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.18 }}
              className="mt-5 text-xl sm:text-2xl md:text-3xl font-medium text-foreground/85 leading-[1.2] tracking-tight max-w-2xl mx-auto lg:mx-0">
              {t("lp.heroLine2")}
            </motion.p>

            <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.25 }}
              className="mt-6 max-w-lg text-[15px] text-muted-foreground/80 leading-[1.7] mx-auto lg:mx-0">
              {t("lp.heroSub")}
            </motion.p>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.35 }}
              className="mt-10 flex flex-wrap gap-4 justify-center lg:justify-start">
              <button onClick={() => navigate("/register")}
                className="group inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-4 text-sm font-tech font-semibold text-primary-foreground transition-colors duration-200 hover:bg-primary/90">
                <span className="flex items-center gap-2">
                  {t("lp.cta")}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
              <button
                onClick={() => {
                  const el = document.getElementById("video-demo");
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="group inline-flex items-center gap-2 rounded-lg border border-border bg-transparent px-7 py-4 text-sm font-tech font-medium text-foreground transition-colors duration-200 hover:bg-accent/40"
              >
                <PlayCircle className="h-4 w-4 text-muted-foreground" />
                {lang === "ru" ? "Смотреть демо · 90 сек" : "Watch demo · 90 sec"}
              </button>
            </motion.div>

            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.7 }}
              className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 justify-center lg:justify-start text-[12px] text-muted-foreground/70 font-tech">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-emerald-400" />
                {lang === "ru" ? "Без привязки карты" : "No credit card"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-emerald-400" />
                {lang === "ru" ? "2 кредита сразу" : "2 credits on signup"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-emerald-400" />
                {lang === "ru" ? "Отмена в 1 клик" : "Cancel in 1 click"}
              </span>
            </motion.div>

            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.8 }}
              className="mt-8 text-sm font-tech text-emerald-400/80 tracking-widest">
              {t("lp.heroMetric")}
            </motion.p>

            {/* Реальные показатели качества — на основе блока «Доказательства качества» ниже */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, duration: 0.7 }}
              className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-xl mx-auto lg:mx-0">
              {[
                { v: "1.90%", l: lang === "ru" ? "AI на text.ru" : "AI on text.ru", c: "text-emerald-400" },
                { v: "0", l: lang === "ru" ? "риск Тургенева" : "Turgenev risk", c: "text-emerald-400" },
                { v: "9.4", l: lang === "ru" ? "Главред / 10" : "Glvrd / 10", c: "text-sky-400" },
                { v: "≤ 1 мин", l: lang === "ru" ? "до 1-й статьи" : "to 1st article", c: "text-primary" },
              ].map((s, i) => (
                <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md px-3 py-2 text-center lg:text-left">
                  <div className={`text-lg font-bold ${s.c}`} style={{ letterSpacing: "-0.03em" }}>{s.v}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-tech">{s.l}</div>
                </div>
              ))}
            </motion.div>
          </div>

          {/* Right — Stealth Guard */}
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.9, delay: 0.3 }}
            className="relative shrink-0">
            <div className="rounded-2xl border border-border bg-card p-2">
              <div className="rounded-xl bg-[#06060b] p-8 min-w-[280px] border border-border">
                {/* Title bar */}
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-white/10" />
                  <div className="w-2 h-2 rounded-full bg-white/10" />
                  <div className="w-2 h-2 rounded-full bg-white/10" />
                  <span className="ml-2 text-[10px] font-mono text-muted-foreground/60">stealth_guard.run</span>
                </div>
                <p className="text-center text-[10px] font-tech uppercase tracking-widest text-muted-foreground/40 mb-5">Stealth Guard™</p>

                <div className="flex flex-col items-center">
                  <div className="relative w-[160px] h-[160px] mb-4">
                    <svg viewBox="0 0 130 130" className="w-full h-full -rotate-90">
                      <circle cx="65" cy="65" r={radius} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="10" />
                      <circle cx="65" cy="65" r={radius} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
                        strokeDasharray={circ} strokeDashoffset={circ - progress}
                        style={{ transition: "stroke-dashoffset 0.06s linear, stroke 0.3s" }} />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-4xl font-black" style={{ color, letterSpacing: "-0.06em" }}>{displayVal}</span>
                      <span className="text-[9px] text-muted-foreground/60 font-tech uppercase tracking-widest mt-1">{label}</span>
                    </div>
                  </div>

                  {phase === "done" ? (
                    <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/[0.06] px-4 py-1.5">
                      <Shield className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-tech font-bold text-primary">{t("lp.stealthActive")}</span>
                    </motion.div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/[0.06] px-4 py-1.5">
                      <div className="w-2 h-2 rounded-full bg-primary" />
                      <span className="text-xs font-tech text-primary">{t("lp.stealthProcessing")}</span>
                    </div>
                  )}

                  {phase === "done" && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                      className="mt-4 flex flex-wrap gap-1.5 justify-center">
                      {["Originality.ai", "GPTZero", "Copyleaks"].map((d, i) => (
                        <span key={i} className="text-[8px] font-tech px-2 py-0.5 rounded-full border border-border bg-muted/40 text-muted-foreground">
                          <span className="text-emerald-500">✓</span> {d}
                        </span>
                      ))}
                    </motion.div>
                  )}

                  {/* Compatibility notice */}
                  <p className="mt-4 text-[8px] font-tech text-muted-foreground/40 tracking-wider text-center">
                    {lang === "ru" ? "Тексты проходят проверку Originality, GPTZero, Copyleaks" : "Texts pass Originality, GPTZero and Copyleaks checks"}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
