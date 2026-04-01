import { motion } from "framer-motion";
import { Search, UserCheck, ShieldCheck, Layers, Globe, Radar } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const features = [
  { icon: Search, labelKey: "feat.research", descKey: "feat.researchDesc", highlight: false },
  { icon: UserCheck, labelKey: "feat.personas", descKey: "feat.personasDesc", highlight: false },
  { icon: ShieldCheck, labelKey: "feat.stealth", descKey: "feat.stealthDesc", highlight: true },
  { icon: Layers, labelKey: "feat.bulk", descKey: "feat.bulkDesc", highlight: false },
  { icon: Globe, labelKey: "feat.wordpress", descKey: "feat.wordpressDesc", highlight: false },
  { icon: Radar, labelKey: "feat.radar", descKey: "feat.radarDesc", highlight: false },
] as const;

export function SectionFeatures() {
  const { t } = useI18n();

  return (
    <section id="features" className="relative py-28 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.015] to-transparent" />

      <div className="relative z-10 container mx-auto px-4 max-w-6xl">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl md:text-5xl font-black tracking-[-0.04em] text-center text-white mb-5"
        >
          {t("feat.title")}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center text-muted-foreground/60 text-[15px] mb-16 max-w-xl mx-auto"
        >
          {t("feat.sub")}
        </motion.p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className={`rounded-2xl border p-7 backdrop-blur-xl transition-all duration-300 hover:scale-[1.02] ${
                f.highlight
                  ? "border-emerald-500/20 bg-emerald-500/[0.03] hover:border-emerald-500/30"
                  : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"
              }`}
            >
              <f.icon className={`h-7 w-7 mb-4 ${f.highlight ? "text-emerald-400" : "text-primary"}`} />
              <h3 className="text-lg font-bold text-white mb-2">{t(f.labelKey)}</h3>
              <p className="text-[13px] text-muted-foreground/60 leading-relaxed">{t(f.descKey)}</p>
              {f.highlight && (
                <span className="inline-block mt-4 text-[10px] font-mono text-emerald-400/80 border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-1 rounded-full tracking-wider">
                  CORE TECHNOLOGY
                </span>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
