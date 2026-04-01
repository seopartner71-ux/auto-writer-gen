import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Play, ShieldCheck, Sparkles, FileText, Hash, Heading2 } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

/* ---------- animated article preview (right side) ---------- */
const articleLines = [
  { type: "h1", text: "How to Choose the Best Pool Service in 2025" },
  { type: "p", text: "Finding a reliable pool maintenance provider requires evaluating several critical factors including" },
  { type: "lsi", text: "pool cleaning frequency • chemical balance • equipment inspection" },
  { type: "p", text: "certification standards and transparent pricing models that align with industry benchmarks." },
  { type: "h2", text: "Key Factors for Hiring a Pool Maintenance Company" },
  { type: "p", text: "According to recent market analysis, homeowners who invest in professional pool services report" },
  { type: "lsi", text: "water quality testing • filter maintenance • seasonal preparation" },
  { type: "p", text: "a 40% reduction in long-term repair costs compared to DIY maintenance approaches." },
  { type: "h2", text: "Cost Breakdown: What to Expect" },
  { type: "p", text: "The average monthly cost ranges from $80 to $150 depending on pool size and service tier." },
];

function ArticlePreview() {
  const [visibleLines, setVisibleLines] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleLines((prev) => {
        if (prev >= articleLines.length) {
          setTimeout(() => setVisibleLines(0), 3000);
          return prev;
        }
        return prev + 1;
      });
    }, 700);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines]);

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-2xl p-1 shadow-[0_30px_80px_rgba(0,0,0,0.5),0_0_40px_rgba(139,92,246,0.08)]">
      <div className="rounded-xl bg-[#08080e]/90 overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.04]">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
          </div>
          <span className="ml-2 text-[10px] font-mono text-muted-foreground/50">serpblueprint — article_output.md</span>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[9px] font-mono text-emerald-400/70 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              GENERATING
            </span>
          </div>
        </div>

        {/* Content */}
        <div ref={containerRef} className="p-5 h-[340px] overflow-hidden space-y-2.5">
          <AnimatePresence>
            {articleLines.slice(0, visibleLines).map((line, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                {line.type === "h1" && (
                  <div className="flex items-start gap-2">
                    <Heading2 className="h-3.5 w-3.5 text-primary/60 mt-1 shrink-0" />
                    <p className="text-sm font-bold text-white/90 leading-snug">{line.text}</p>
                  </div>
                )}
                {line.type === "h2" && (
                  <div className="flex items-start gap-2 mt-3">
                    <Heading2 className="h-3 w-3 text-[#3b82f6]/60 mt-1 shrink-0" />
                    <p className="text-[13px] font-semibold text-white/80 leading-snug">{line.text}</p>
                  </div>
                )}
                {line.type === "p" && (
                  <p className="text-[11px] text-muted-foreground/60 leading-relaxed pl-5">{line.text}</p>
                )}
                {line.type === "lsi" && (
                  <div className="flex flex-wrap gap-1.5 pl-5 mt-1">
                    {line.text.split(" • ").map((kw, j) => (
                      <span key={j} className="text-[9px] font-mono px-2 py-0.5 rounded-full border border-primary/20 bg-primary/[0.06] text-primary/80">
                        <Hash className="inline h-2.5 w-2.5 mr-0.5" />{kw}
                      </span>
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {visibleLines < articleLines.length && (
            <motion.div
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ repeat: Infinity, duration: 1.2 }}
              className="pl-5 flex items-center gap-2"
            >
              <div className="w-3 h-4 bg-primary/40 rounded-sm" />
              <span className="text-[10px] font-mono text-muted-foreground/40">writing...</span>
            </motion.div>
          )}
        </div>

        {/* Bottom bar */}
        <div className="px-4 py-2 border-t border-white/[0.04] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[9px] font-mono text-muted-foreground/40">
              <FileText className="inline h-3 w-3 mr-1" />
              {visibleLines > 0 ? Math.min(visibleLines * 245, 2450) : 0} words
            </span>
            <span className="text-[9px] font-mono text-emerald-400/60">
              <ShieldCheck className="inline h-3 w-3 mr-1" />
              Human Score: 97%
            </span>
          </div>
          <span className="text-[9px] font-mono text-primary/50">SEO Score: 94/100</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- main hero ---------- */
export function SectionHero() {
  const navigate = useNavigate();
  const { t } = useI18n();

  const trustItems = [
    { icon: ShieldCheck, text: t("hero.trust1") },
    { icon: ShieldCheck, text: t("hero.trust2") },
    { icon: Sparkles, text: t("hero.trust3") },
  ];

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      {/* Grid */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.025]" style={{
        backgroundImage: "linear-gradient(hsl(var(--primary) / 0.4) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary) / 0.4) 1px, transparent 1px)",
        backgroundSize: "80px 80px",
      }} />
      {/* Glows */}
      <div className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] rounded-full bg-primary/[0.07] blur-[280px]" />
      <div className="pointer-events-none absolute bottom-[5%] right-[5%] w-[500px] h-[400px] rounded-full bg-[#3b82f6]/[0.05] blur-[220px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Left — Copy */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.06] px-4 py-1.5 mb-8"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] font-tech font-semibold text-primary uppercase tracking-widest">Auto-Writer-Gen</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="text-4xl sm:text-5xl md:text-6xl lg:text-[4.5rem] font-extrabold leading-[0.95]"
              style={{ letterSpacing: "-0.06em" }}
            >
              {t("hero.line1")}{" "}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary via-[#3b82f6] to-primary">
                {t("hero.line2")}
              </span>{" "}
              {t("hero.line3")}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.25 }}
              className="mt-7 max-w-xl text-[15px] text-muted-foreground/70 leading-[1.75]"
            >
              {t("hero.sub")}
            </motion.p>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.35 }}
              className="mt-10 flex flex-wrap gap-4"
            >
              <button
                onClick={() => navigate("/register")}
                className="group relative inline-flex items-center gap-2.5 rounded-full bg-gradient-to-r from-primary to-[#3b82f6] px-9 py-4.5 text-[15px] font-tech font-bold text-white shadow-[0_20px_60px_rgba(139,92,246,0.3)] transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_25px_80px_rgba(139,92,246,0.45)] active:scale-[0.98]"
              >
                <span className="absolute inset-0 rounded-full bg-gradient-to-r from-primary to-[#3b82f6] animate-pulse opacity-15 blur-2xl" />
                <span className="relative flex items-center gap-2">
                  {t("hero.cta")}
                  <ArrowRight className="h-4.5 w-4.5 transition-transform group-hover:translate-x-1" />
                </span>
              </button>

              <button
                onClick={() => {
                  document.getElementById("section-deep-dive")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur-sm px-7 py-4.5 text-[15px] font-tech font-medium text-white/80 transition-all duration-300 hover:bg-white/[0.06] hover:border-white/20"
              >
                <Play className="h-4 w-4 text-primary" />
                {t("hero.demo")}
              </button>
            </motion.div>

            {/* Trust bar */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.8 }}
              className="mt-12 space-y-3"
            >
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {trustItems.map((item, i) => (
                  <span key={i} className="flex items-center gap-1.5 text-[12px] font-tech text-emerald-400/80 tracking-wide">
                    <item.icon className="h-3.5 w-3.5" />
                    {item.text}
                  </span>
                ))}
              </div>
              <p className="text-[11px] font-mono text-muted-foreground/40 tracking-wider">
                {t("hero.bypasses")}
              </p>
              <p className="text-[11px] font-mono text-muted-foreground/35 tracking-wider">
                {t("hero.usedBy")}
              </p>
            </motion.div>
          </div>

          {/* Right — Article Preview */}
          <motion.div
            initial={{ opacity: 0, x: 50, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ duration: 0.9, delay: 0.3 }}
            className="hidden lg:block"
          >
            <ArticlePreview />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
