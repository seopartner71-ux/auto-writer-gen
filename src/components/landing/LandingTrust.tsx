import { motion } from "framer-motion";
import { Shield, Check } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const detectors = ["Originality.ai", "GPTZero", "Copyleaks", "Sapling", "ZeroGPT", "Turnitin"];
const integrations = [
  { icon: "⚡", label: "WordPress" },
  { icon: "📊", label: "Yoast SEO" },
  { icon: "🏆", label: "RankMath" },
  { icon: "👻", label: "Ghost" },
  { icon: "📡", label: "Telegraph" },
];

export function LandingTrust() {
  const { t } = useI18n();

  return (
    <section className="relative py-20 overflow-hidden">
      <div className="container mx-auto px-4 max-w-5xl space-y-16">
        {/* Detector Wall marquee */}
        <div className="relative overflow-hidden py-6 border-y border-white/[0.04]">
          <p className="text-center text-xs font-tech text-muted-foreground uppercase tracking-widest mb-4">
            {t("lp.detectorWallSub")}
          </p>
          <div className="flex items-center gap-8 animate-marquee whitespace-nowrap">
            {[...detectors, ...detectors, ...detectors].map((d, i) => (
              <span key={i} className="flex items-center gap-2 text-sm text-muted-foreground/60 shrink-0 font-tech">
                <Check className="h-3.5 w-3.5 text-emerald-400/50 shrink-0" />
                {d}
              </span>
            ))}
            <span className="text-xs text-emerald-400/60 font-medium shrink-0 px-4">•</span>
            <span className="text-xs text-muted-foreground/50 shrink-0">{t("lp.marqueeText")}</span>
            <span className="text-xs text-emerald-400/60 font-medium shrink-0 px-4">•</span>
          </div>
        </div>

        {/* AI Detectors */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-4 py-1.5 mb-4">
              <Shield className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs font-medium text-emerald-400">{t("lp.trustBadge")}</span>
            </div>
            <h3 className="text-xl font-bold">{t("lp.trustTitle")}</h3>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            {detectors.map((d, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-2 rounded-full border border-emerald-500/10 bg-emerald-500/[0.03] px-4 py-2"
              >
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-sm font-medium">{d}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Integrations */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
        >
          <div className="text-center mb-8">
            <h3 className="text-xl font-bold">{t("lp.integrTitle")}</h3>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {integrations.map((int, i) => (
              <div key={i} className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm px-5 py-2.5">
                <span className="text-lg">{int.icon}</span>
                <span className="text-sm font-medium">{int.label}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
