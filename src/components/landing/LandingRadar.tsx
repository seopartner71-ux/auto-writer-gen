import { motion } from "framer-motion";
import { Radar, Eye, TrendingUp, Globe } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function LandingRadar() {
  const { t } = useI18n();

  const models = [
    { name: "ChatGPT", pct: 72, color: "#10b981" },
    { name: "Perplexity", pct: 58, color: "#8b5cf6" },
    { name: "Gemini", pct: 45, color: "#3b82f6" },
    { name: "Claude", pct: 33, color: "#f59e0b" },
  ];

  return (
    <section className="relative py-24 overflow-hidden">
      <div className="pointer-events-none absolute top-1/3 right-0 w-[500px] h-[500px] rounded-full bg-[#8b5cf6]/6 blur-[160px]" />

      <div className="container mx-auto px-4 max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-[#8b5cf6]/30 bg-[#8b5cf6]/5 px-4 py-1.5 mb-6">
              <Radar className="h-3.5 w-3.5 text-[#8b5cf6]" />
              <span className="text-xs font-medium text-[#8b5cf6]">GEO</span>
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4">
              {t("lp.radarTitle")}
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-8">
              {t("lp.radarDesc")}
            </p>

            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: Eye, label: t("lp.radarF1") },
                { icon: TrendingUp, label: t("lp.radarF2") },
                { icon: Globe, label: t("lp.radarF3") },
                { icon: Radar, label: t("lp.radarF4") },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                  <item.icon className="h-4 w-4 text-[#8b5cf6] shrink-0" />
                  <span className="text-sm">{item.label}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* SoM chart mock */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm p-6 sm:p-8"
          >
            <h3 className="text-sm font-medium text-muted-foreground mb-6">Share of Model (SoM)</h3>
            <div className="space-y-5">
              {models.map((m, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span>{m.name}</span>
                    <span className="font-semibold" style={{ color: m.color }}>{m.pct}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-white/5 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${m.pct}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, delay: 0.3 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: m.color }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-muted-foreground">{t("lp.radarLive")}</span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
