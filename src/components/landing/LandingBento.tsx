import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Radar, ShieldCheck, Factory, Zap } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useI18n } from "@/shared/hooks/useI18n";

const somData = [
  { name: "ChatGPT", value: 72, color: "#10b981" },
  { name: "Perplexity", value: 58, color: "#8b5cf6" },
  { name: "Gemini", value: 45, color: "#3b82f6" },
  { name: "Claude", value: 33, color: "#f59e0b" },
];

const gaugeValue = 94;

const lsiTags = [
  "semantic search", "keyword clustering", "entity extraction",
  "SERP features", "content gap", "search intent", "NLP analysis",
  "topic modeling", "TF-IDF", "co-occurrence", "LSI keywords",
  "knowledge graph", "E-E-A-T", "featured snippet",
];

const outlineItems = [
  { level: "H2", width: "75%", label: "What is SEO Content?" },
  { level: "H3", width: "60%", label: "Key Components", indent: true },
  { level: "H3", width: "55%", label: "Common Mistakes", indent: true },
  { level: "H2", width: "70%", label: "Research Methods" },
  { level: "H3", width: "50%", label: "Competitor Analysis", indent: true },
  { level: "H2", width: "65%", label: "Writing Strategy" },
];

const personaTexts = [
  { font: "serif", text: "The empirical evidence suggests a paradigm shift in how search engines evaluate content quality..." },
  { font: "sans", text: "Let's break it down: your content needs to hit three key metrics to rank. Here's what works →" },
  { font: "serif", text: "В мире SEO-контента происходит тихая революция. Алгоритмы эволюционируют, и нам пора адаптироваться..." },
  { font: "sans", text: "Короче говоря: если ваш текст не проходит AI-детектор, вы уже проигрываете. Вот как это исправить ↓" },
];

export function LandingBento() {
  const { t } = useI18n();
  const [visibleTags, setVisibleTags] = useState<number[]>([0, 1, 2, 3, 4]);
  const [personaIdx, setPersonaIdx] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleTags(prev => {
        const next = prev.map(i => (i + 1) % lsiTags.length);
        return next;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setPersonaIdx(prev => (prev + 1) % personaTexts.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative py-32 overflow-hidden">
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 w-[700px] h-[500px] rounded-full bg-primary/5 blur-[180px]" />

      <div className="container mx-auto px-4 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black" style={{ letterSpacing: "-0.05em" }}>
            {t("lp.bentoTitle")}
          </h2>
          <p className="mt-5 text-[#9ca3af] max-w-xl mx-auto text-[15px] leading-[1.6]">
            {t("lp.bentoSub")}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          {/* Card 1: Smart Research - spans 4 */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="group md:col-span-4 relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md p-6 sm:p-8 hover:border-primary/20 hover:scale-[1.01] transition-all duration-500"
          >
            <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: "radial-gradient(500px circle at 50% 50%, hsl(270 60% 60% / 0.06), transparent 70%)" }} />
            <div className="relative z-10">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 mb-4">
                <Search className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{t("lp.feat1Title")}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">{t("lp.bento1Desc")}</p>

              {/* Animated LSI tags */}
              <div className="flex flex-wrap gap-1.5 mb-5 min-h-[28px]">
                <AnimatePresence mode="popLayout">
                  {visibleTags.map(idx => (
                    <motion.span
                      key={`${idx}-${lsiTags[idx]}`}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.4 }}
                      className="text-[10px] px-2.5 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary font-medium"
                    >
                      {lsiTags[idx]}
                    </motion.span>
                  ))}
                </AnimatePresence>
              </div>

              {/* Mini SERP table */}
              <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] overflow-hidden">
                <div className="grid grid-cols-4 gap-px text-[10px] font-medium text-muted-foreground px-3 py-2 border-b border-white/[0.04]">
                  <span>#</span><span>URL</span><span>{t("lp.tableWords")}</span><span>LSI</span>
                </div>
                {[
                  { pos: 1, url: "competitor-a.com", words: "2,847", lsi: "34" },
                  { pos: 2, url: "blog-leader.io", words: "3,102", lsi: "28" },
                  { pos: 3, url: "niche-expert.com", words: "1,956", lsi: "41" },
                ].map((r, i) => (
                  <div key={i} className="grid grid-cols-4 gap-px text-[10px] px-3 py-1.5 border-b border-white/[0.02] last:border-0">
                    <span className="text-primary font-bold">{r.pos}</span>
                    <span className="text-muted-foreground truncate">{r.url}</span>
                    <span>{r.words}</span>
                    <span className="text-emerald-400">{r.lsi}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Card 2: AI Radar - spans 2, killer feature */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="group md:col-span-2 relative rounded-2xl border border-primary/20 bg-primary/[0.03] backdrop-blur-md p-6 hover:border-primary/40 hover:scale-[1.01] transition-all duration-500 shadow-[0_0_30px_hsl(270_60%_60%/0.08)]"
          >
            {/* Glow behind chart */}
            <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: "radial-gradient(200px circle at 50% 60%, hsl(270 60% 60% / 0.1), transparent 70%)" }} />
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-3">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
                  <Radar className="h-4 w-4 text-primary" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary">{t("lp.bentoKiller")}</span>
              </div>
              <h3 className="text-lg font-semibold mb-1">AI Radar</h3>
              <p className="text-xs text-muted-foreground mb-4">{t("lp.bento2Desc")}</p>

              {/* Pie chart with tooltips */}
              <div className="h-[140px] -mx-2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={somData}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={55}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                    >
                      {somData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "#111",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: "8px",
                        fontSize: "11px",
                        padding: "6px 10px",
                      }}
                      formatter={(value: number, name: string) => [`${value}%`, name]}
                      labelStyle={{ display: "none" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {somData.map((d, i) => (
                  <span key={i} className="text-[9px] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: d.color }} />
                    {d.name} <span className="text-muted-foreground">{d.value}%</span>
                  </span>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Card 3: Human Score - spans 2 */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.15 }}
            className="group md:col-span-2 relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md p-6 hover:border-emerald-500/20 hover:scale-[1.01] transition-all duration-500"
          >
            <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: "radial-gradient(300px circle at 50% 50%, rgba(16,185,129,0.06), transparent 70%)" }} />
            <div className="relative z-10">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10 mb-4">
                <ShieldCheck className="h-5 w-5 text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Human Score</h3>
              <p className="text-xs text-muted-foreground mb-4">{t("lp.bento3Desc")}</p>

              {/* Gauge */}
              <div className="relative flex items-center justify-center">
                <svg viewBox="0 0 120 70" className="w-full max-w-[180px]">
                  <path d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" strokeLinecap="round" />
                  <motion.path
                    d="M 10 65 A 50 50 0 0 1 110 65"
                    fill="none"
                    stroke="url(#gaugeGrad)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    whileInView={{ pathLength: gaugeValue / 100 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.5, delay: 0.5, ease: [0.22, 1, 0.36, 1] as const }}
                  />
                  <defs>
                    <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#ef4444" />
                      <stop offset="40%" stopColor="#f59e0b" />
                      <stop offset="100%" stopColor="#10b981" />
                    </linearGradient>
                  </defs>
                  <text x="60" y="58" textAnchor="middle" fill="#10b981" fontSize="18" fontWeight="800">{gaugeValue}</text>
                  <text x="60" y="68" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="6">/100</text>
                </svg>
              </div>
            </div>
          </motion.div>

          {/* Card 5: Outline Builder - spans 2 */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="group md:col-span-2 relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md p-6 hover:border-[#3b82f6]/20 hover:scale-[1.01] transition-all duration-500"
          >
            <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: "radial-gradient(300px circle at 50% 50%, rgba(59,130,246,0.06), transparent 70%)" }} />
            <div className="relative z-10">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#3b82f6]/10 mb-4">
                <svg className="h-5 w-5 text-[#3b82f6]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="18" x2="12" y2="18"/></svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Outline Builder</h3>
              <p className="text-xs text-muted-foreground mb-4">{t("lp.bentoOutlineDesc")}</p>

              {/* H2/H3 hierarchy visual */}
              <div className="space-y-1.5">
                {outlineItems.map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.4 + i * 0.08 }}
                    className={`flex items-center gap-2 ${item.indent ? "ml-4" : ""}`}
                  >
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${
                      item.level === "H2" 
                        ? "bg-[#3b82f6]/20 text-[#3b82f6]" 
                        : "bg-white/[0.06] text-muted-foreground"
                    }`}>
                      {item.level}
                    </span>
                    <div className="h-[3px] rounded-full bg-white/[0.06]" style={{ width: item.width }} />
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Card 6: Persona Engine - spans 2 */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.25 }}
            className="group md:col-span-2 relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md p-6 hover:border-[#ec4899]/20 hover:scale-[1.01] transition-all duration-500"
          >
            <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: "radial-gradient(300px circle at 50% 50%, rgba(236,72,153,0.06), transparent 70%)" }} />
            <div className="relative z-10">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#ec4899]/10 mb-4">
                <svg className="h-5 w-5 text-[#ec4899]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Persona Engine</h3>
              <p className="text-xs text-muted-foreground mb-4">{t("lp.bentoPersonaDesc")}</p>

              {/* Font-switching persona demo */}
              <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] p-3 min-h-[60px] relative overflow-hidden">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={personaIdx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.4 }}
                    className="text-[11px] leading-relaxed text-muted-foreground"
                    style={{ fontFamily: personaTexts[personaIdx].font === "serif" ? "Georgia, 'Times New Roman', serif" : "Inter, system-ui, sans-serif" }}
                  >
                    <span className={`inline-block mb-1 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      personaTexts[personaIdx].font === "serif" ? "bg-[#ec4899]/10 text-[#ec4899]" : "bg-[#3b82f6]/10 text-[#3b82f6]"
                    }`}>
                      {personaTexts[personaIdx].font === "serif" ? "Academic" : "Casual"}
                    </span>
                    <br />
                    {personaTexts[personaIdx].text}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>
          </motion.div>

          {/* Card 4: Factory - spans 6 */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="group md:col-span-6 relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md p-6 sm:p-8 hover:border-[#f59e0b]/20 hover:scale-[1.01] transition-all duration-500"
          >
            <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: "radial-gradient(500px circle at 50% 50%, rgba(245,158,11,0.04), transparent 70%)" }} />
            <div className="relative z-10 flex flex-col sm:flex-row gap-6 items-start">
              <div className="flex-1">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#f59e0b]/10 mb-4">
                  <Factory className="h-5 w-5 text-[#f59e0b]" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Factory</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{t("lp.bento4Desc")}</p>
              </div>

              {/* Progress + stacked cards */}
              <div className="flex items-center gap-6 shrink-0">
                {/* Bulk progress indicator */}
                <div className="flex flex-col items-center gap-1.5">
                  <div className="relative w-16 h-16">
                    <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
                      <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="6" />
                      <circle cx="32" cy="32" r="26" fill="none" stroke="#f59e0b" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 26}`} strokeDashoffset={`${2 * Math.PI * 26 * (1 - 0.92)}`} />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-sm font-black text-[#f59e0b]">92%</span>
                    </div>
                  </div>
                  <span className="text-[9px] font-tech text-[#f59e0b] uppercase tracking-wider">{t("lp.bentoBulk")}</span>
                </div>

                <div className="relative w-40 h-28">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 20, rotate: 0 }}
                      whileInView={{ opacity: 1 - i * 0.15, y: -i * 6, rotate: -i * 2 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.5 + i * 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const }}
                      className="absolute inset-0 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
                      style={{ zIndex: 5 - i }}
                    >
                      {i === 0 && (
                        <div className="space-y-1.5">
                          <div className="h-1.5 rounded-full bg-[#f59e0b]/30 w-[60%]" />
                          <div className="h-1 rounded-full bg-white/[0.06] w-full" />
                          <div className="h-1 rounded-full bg-white/[0.06] w-[80%]" />
                          <div className="flex items-center gap-1 mt-2">
                            <Zap className="h-2.5 w-2.5 text-[#f59e0b]" />
                            <span className="text-[8px] text-[#f59e0b]">100+ {t("lp.bentoArticles")}</span>
                          </div>
                        </div>
                      )}
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
