import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const lsiTags = [
  "semantic search", "keyword clustering", "entity extraction",
  "SERP features", "content gap", "search intent", "NLP analysis",
  "topic modeling", "TF-IDF", "co-occurrence", "LSI keywords",
  "knowledge graph", "E-E-A-T", "featured snippet",
];

const serpRows = [
  { pos: 1, url: "competitor-a.com", words: "2,847", lsi: "34", entities: "18" },
  { pos: 2, url: "blog-leader.io", words: "3,102", lsi: "28", entities: "22" },
  { pos: 3, url: "niche-expert.com", words: "1,956", lsi: "41", entities: "15" },
  { pos: 4, url: "top-guide.org", words: "2,534", lsi: "31", entities: "20" },
];

export function SectionResearch() {
  const { t } = useI18n();
  const [visibleTags, setVisibleTags] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleTags(prev => prev.map(i => (i + 1) % lsiTags.length));
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative min-h-screen flex items-center justify-center snap-start overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-[30%] -translate-y-1/2 w-[700px] h-[500px] rounded-full bg-primary/[0.06] blur-[220px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-5xl">
        <motion.div initial={{ opacity: 0, y: 50 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
          className="text-center mb-14">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 mb-6">
            <Search className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-tech font-medium text-primary uppercase tracking-wider">Smart Research</span>
          </div>
          <h2 className="text-5xl sm:text-6xl md:text-7xl font-black leading-[0.95]" style={{ letterSpacing: "-0.06em", textShadow: "0 0 80px rgba(139,92,246,0.08)" }}>
            {t("lp.researchTitle")}
          </h2>
          <p className="mt-5 text-muted-foreground text-[15px] max-w-2xl mx-auto leading-[1.7]">{t("lp.researchSub")}</p>
        </motion.div>

        {/* Elevated card */}
        <motion.div initial={{ opacity: 0, y: 50 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.15 }}
          whileHover={{ rotateX: -1, rotateY: 2, scale: 1.01 }} style={{ perspective: 800 }}
          className="rounded-3xl border-t border-l border-r border-b border-t-white/20 border-l-white/10 border-r-white/5 border-b-white/[0.02] bg-white/[0.02] backdrop-blur-2xl p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.5),0_0_20px_rgba(139,92,246,0.1)]">
          <div className="rounded-2xl bg-[#06060b]/90 p-6 sm:p-8">
            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              {[
                { value: "47", label: t("lp.researchLsiFound"), color: "text-primary" },
                { value: "22", label: t("lp.researchEntities"), color: "text-[#3b82f6]" },
                { value: "8", label: t("lp.researchGaps"), color: "text-[#f59e0b]" },
                { value: "10", label: t("lp.researchExtracted"), color: "text-emerald-400" },
              ].map((s, i) => (
                <div key={i} className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4 text-center">
                  <p className={`text-3xl font-black ${s.color}`} style={{ letterSpacing: "-0.06em" }}>{s.value}</p>
                  <p className="text-[10px] font-tech text-muted-foreground/60 uppercase tracking-wider mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            {/* LSI tags */}
            <div className="flex flex-wrap gap-1.5 mb-6 min-h-[32px] justify-center">
              <AnimatePresence mode="popLayout">
                {visibleTags.map(idx => (
                  <motion.span key={`${idx}-${lsiTags[idx]}`} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.4 }}
                    className="text-[10px] px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary font-medium">
                    {lsiTags[idx]}
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>

            {/* Mini SERP table */}
            <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] overflow-hidden">
              <div className="grid grid-cols-5 gap-px text-[10px] font-medium text-muted-foreground/60 px-4 py-2.5 border-b border-white/[0.04]">
                <span>#</span><span>URL</span><span>Words</span><span>LSI</span><span>Entities</span>
              </div>
              {serpRows.map((r, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 + i * 0.08 }}
                  className="grid grid-cols-5 gap-px text-[11px] px-4 py-2 border-b border-white/[0.02] last:border-0">
                  <span className="text-primary font-bold">{r.pos}</span>
                  <span className="text-muted-foreground truncate">{r.url}</span>
                  <span>{r.words}</span>
                  <span className="text-emerald-400">{r.lsi}</span>
                  <span className="text-[#3b82f6]">{r.entities}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Metric */}
        <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.5 }}
          className="text-center mt-8 text-sm font-tech text-primary/80 tracking-wide">
          {t("lp.researchMetric")}
        </motion.p>
      </div>
    </section>
  );
}
