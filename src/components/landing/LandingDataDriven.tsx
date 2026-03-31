import { motion } from "framer-motion";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { TrendingUp } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const chartData = [
  { month: "Jan", generic: 120, synthesized: 130 },
  { month: "Feb", generic: 125, synthesized: 180 },
  { month: "Mar", generic: 118, synthesized: 260 },
  { month: "Apr", generic: 122, synthesized: 390 },
  { month: "May", generic: 115, synthesized: 520 },
  { month: "Jun", generic: 110, synthesized: 710 },
  { month: "Jul", generic: 108, synthesized: 880 },
  { month: "Aug", generic: 105, synthesized: 1100 },
];

export function LandingDataDriven() {
  const { t } = useI18n();

  return (
    <section className="relative py-24 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 right-0 w-[500px] h-[500px] rounded-full bg-[#3b82f6]/5 blur-[180px]" />

      <div className="container mx-auto px-4 max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-[#3b82f6]/30 bg-[#3b82f6]/5 px-4 py-1.5 mb-6">
              <TrendingUp className="h-3.5 w-3.5 text-[#3b82f6]" />
              <span className="text-xs font-medium text-[#3b82f6]">Data-Driven</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              {t("lp.dataTitle")}
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-8">
              {t("lp.dataDesc")}
            </p>

            {/* Cases */}
            <div className="space-y-3">
              {[
                { emoji: "🏊", text: t("lp.case1") },
                { emoji: "🎯", text: t("lp.case2") },
                { emoji: "⚡", text: t("lp.case3") },
              ].map((c, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 + i * 0.1 }}
                  className="flex items-start gap-3 rounded-xl border border-white/[0.04] bg-white/[0.01] p-3"
                >
                  <span className="text-lg shrink-0">{c.emoji}</span>
                  <p className="text-xs text-muted-foreground leading-relaxed">{c.text}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Chart */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-medium text-muted-foreground">{t("lp.chartTitle")}</h3>
              <div className="flex items-center gap-4 text-[10px]">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-white/20" />
                  {t("lp.chartGeneric")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#8b5cf6]" />
                  {t("lp.chartSynth")}
                </span>
              </div>
            </div>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="synthGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip
                    contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", fontSize: "11px" }}
                    labelStyle={{ color: "rgba(255,255,255,0.5)" }}
                  />
                  <Area type="monotone" dataKey="generic" stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} fill="none" dot={false} />
                  <Area type="monotone" dataKey="synthesized" stroke="#8b5cf6" strokeWidth={2} fill="url(#synthGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
