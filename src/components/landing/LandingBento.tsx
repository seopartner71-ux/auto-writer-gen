import { motion } from "framer-motion";
import { Search, Radar, ShieldCheck, Factory, TrendingUp, Zap } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { useI18n } from "@/shared/hooks/useI18n";

const somData = [
  { name: "ChatGPT", value: 72, color: "#10b981" },
  { name: "Perplexity", value: 58, color: "#8b5cf6" },
  { name: "Gemini", value: 45, color: "#3b82f6" },
  { name: "Claude", value: 33, color: "#f59e0b" },
];

const gaugeValue = 94;

export function LandingBento() {
  const { t } = useI18n();

  return (
    <section className="relative py-24 overflow-hidden">
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 w-[700px] h-[500px] rounded-full bg-[#8b5cf6]/5 blur-[180px]" />

      <div className="container mx-auto px-4 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold">
            {t("lp.bentoTitle")}
          </h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
            {t("lp.bentoSub")}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          {/* Card 1: Smart Research - spans 4 */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="group md:col-span-4 relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md p-6 sm:p-8 hover:border-[#8b5cf6]/20 hover:scale-[1.01] transition-all duration-500"
          >
            <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: "radial-gradient(500px circle at 50% 50%, rgba(139,92,246,0.06), transparent 70%)" }} />
            <div className="relative z-10">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#8b5cf6]/10 mb-4">
                <Search className="h-5 w-5 text-[#8b5cf6]" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{t("lp.feat1Title")}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">{t("lp.bento1Desc")}</p>

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
                    <span className="text-[#8b5cf6] font-bold">{r.pos}</span>
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
            className="group md:col-span-2 relative rounded-2xl border border-[#8b5cf6]/20 bg-[#8b5cf6]/[0.03] backdrop-blur-md p-6 hover:border-[#8b5cf6]/40 hover:scale-[1.01] transition-all duration-500 shadow-[0_0_30px_rgba(139,92,246,0.08)]"
          >
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-3">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#8b5cf6]/10">
                  <Radar className="h-4 w-4 text-[#8b5cf6]" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#8b5cf6]">{t("lp.bentoKiller")}</span>
              </div>
              <h3 className="text-lg font-semibold mb-1">AI Radar</h3>
              <p className="text-xs text-muted-foreground mb-4">{t("lp.bento2Desc")}</p>

              {/* Pie chart */}
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
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {somData.map((d, i) => (
                  <span key={i} className="text-[9px] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: d.color }} />
                    {d.name}
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
            transition={{ delay: 0.2 }}
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

          {/* Card 4: Factory - spans 4 */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="group md:col-span-4 relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md p-6 sm:p-8 hover:border-[#f59e0b]/20 hover:scale-[1.01] transition-all duration-500"
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

              {/* Stacked cards animation */}
              <div className="relative w-40 h-28 shrink-0">
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
          </motion.div>
        </div>
      </div>
    </section>
  );
}
