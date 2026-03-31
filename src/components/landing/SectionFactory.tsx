import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { Factory, Zap } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const articles = [
  { title: "Best CRM Tools 2025", words: 2847 },
  { title: "Как выбрать VPN", words: 3102 },
  { title: "Pool Service Guide", words: 1956 },
  { title: "React vs Vue 2025", words: 2534 },
  { title: "Crypto Tax Guide", words: 2891 },
  { title: "Home Insurance Tips", words: 2103 },
];

export function SectionFactory() {
  const { t } = useI18n();
  const [visibleIdx, setVisibleIdx] = useState(0);
  const [published, setPublished] = useState(0);
  const [bulkProgress, setBulkProgress] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleIdx(prev => (prev + 1) % articles.length);
      setPublished(prev => Math.min(prev + 1, 100));
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  // Animate bulk progress when in view
  useEffect(() => {
    if (!inView) return;
    const interval = setInterval(() => {
      setBulkProgress(prev => {
        if (prev >= 92) { clearInterval(interval); return 92; }
        return prev + 1;
      });
    }, 25);
    return () => clearInterval(interval);
  }, [inView]);

  return (
    <section ref={ref} className="relative min-h-screen flex items-center justify-center snap-start overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 right-[20%] -translate-y-1/2 w-[600px] h-[500px] rounded-full bg-[#f59e0b]/[0.04] blur-[220px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-5xl">
        <motion.div initial={{ opacity: 0, y: 50 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
          className="text-center mb-14">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#f59e0b]/20 bg-[#f59e0b]/5 px-4 py-1.5 mb-6">
            <Factory className="h-3.5 w-3.5 text-[#f59e0b]" />
            <span className="text-xs font-tech font-medium text-[#f59e0b] uppercase tracking-wider">Factory</span>
          </div>
          <h2 className="text-5xl sm:text-6xl md:text-7xl font-black leading-[0.95]" style={{ letterSpacing: "-0.06em" }}>
            {t("lp.factoryTitle")}
          </h2>
          <p className="mt-5 text-muted-foreground text-[15px] max-w-2xl mx-auto leading-[1.7]">{t("lp.factorySub")}</p>
        </motion.div>

        {/* Conveyor belt */}
        <motion.div initial={{ opacity: 0, y: 50 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.15 }}
          className="rounded-3xl border-t border-l border-r border-b border-t-white/20 border-l-white/10 border-r-white/5 border-b-white/[0.02] bg-white/[0.02] backdrop-blur-2xl p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.5),0_0_20px_rgba(245,158,11,0.08)]">
          <div className="rounded-2xl bg-[#06060b]/90 p-6 sm:p-8">
            {/* Stats */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-[#f59e0b] animate-pulse" />
                <span className="text-sm font-tech text-[#f59e0b]">{t("lp.factoryGenerating")}</span>
              </div>
              <div className="flex gap-6 items-center">
                {/* Animated bulk progress */}
                <div className="flex items-center gap-3">
                  <div className="relative w-10 h-10">
                    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                      <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
                      <circle cx="18" cy="18" r="15" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 15}
                        strokeDashoffset={2 * Math.PI * 15 * (1 - bulkProgress / 100)}
                        style={{ transition: "stroke-dashoffset 0.05s linear" }} />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black text-[#f59e0b]">{bulkProgress}%</span>
                  </div>
                  <span className="text-[9px] font-tech text-muted-foreground/60 uppercase">{t("lp.factoryBulk")}</span>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black text-[#f59e0b]" style={{ letterSpacing: "-0.06em" }}>{published}</p>
                  <p className="text-[9px] font-tech text-muted-foreground/60 uppercase">{t("lp.factoryPublished")}</p>
                </div>
              </div>
            </div>

            {/* Conveyor items */}
            <div className="relative h-[180px] overflow-hidden rounded-xl border border-white/[0.04] bg-white/[0.01]">
              <div className="absolute inset-0 flex flex-col justify-between py-4 px-4 opacity-20">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="h-px bg-white/10" />
                ))}
              </div>

              <AnimatePresence mode="popLayout">
                {[0, 1, 2].map(offset => {
                  const idx = (visibleIdx + offset) % articles.length;
                  const art = articles[idx];
                  return (
                    <motion.div
                      key={`${idx}-${visibleIdx}`}
                      initial={{ x: "110%", opacity: 0 }}
                      animate={{ x: `${offset * 35}%`, opacity: offset === 2 ? 0.4 : 1 }}
                      exit={{ x: "-30%", opacity: 0 }}
                      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                      className="absolute top-1/2 -translate-y-1/2 w-[30%] min-w-[200px]"
                      style={{ left: `${2 + offset * 2}%` }}
                    >
                      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm p-4 shadow-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <Zap className="h-3 w-3 text-[#f59e0b]" />
                          <span className="text-[10px] font-tech text-[#f59e0b]">{art.words} words</span>
                        </div>
                        <p className="text-xs font-medium truncate">{art.title}</p>
                        <div className="mt-2 flex gap-1">
                          <div className="h-1 rounded-full bg-emerald-400/40 flex-1" />
                          <div className="h-1 rounded-full bg-emerald-400/20 w-[30%]" />
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              <div className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-[#21759b]/20 flex items-center justify-center">
                <span className="text-lg">⚡</span>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.5 }}
          className="text-center mt-8 text-sm font-tech text-[#f59e0b]/80 tracking-wide">
          {t("lp.factoryMetric")}
        </motion.p>
      </div>
    </section>
  );
}
