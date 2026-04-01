import { motion } from "framer-motion";
import { Search, Brain, Radar, Factory } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const pillars = [
  {
    icon: Search,
    color: "#8b5cf6",
    titleKey: "awg.pillar1Title",
    descKey: "awg.pillar1Desc",
  },
  {
    icon: Brain,
    color: "#ec4899",
    titleKey: "awg.pillar2Title",
    descKey: "awg.pillar2Desc",
  },
  {
    icon: Radar,
    color: "#06b6d4",
    titleKey: "awg.pillar3Title",
    descKey: "awg.pillar3Desc",
  },
  {
    icon: Factory,
    color: "#f59e0b",
    titleKey: "awg.pillar4Title",
    descKey: "awg.pillar4Desc",
  },
];

export function SectionPillars() {
  const { t } = useI18n();

  return (
    <section className="relative py-32 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] rounded-full bg-primary/[0.04] blur-[220px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-6xl">
        <motion.div initial={{ opacity: 0, y: 50 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-extrabold leading-[0.95]" style={{ letterSpacing: "-0.06em", textShadow: "0 0 80px rgba(139,92,246,0.08)" }}>
            {t("awg.pillarsTitle")}
          </h2>
          <p className="mt-4 text-muted-foreground text-[15px] max-w-2xl mx-auto leading-[1.7]">{t("awg.pillarsSub")}</p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {pillars.map((p, i) => {
            const Icon = p.icon;
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                whileHover={{ y: -6, scale: 1.02 }}
                className="group rounded-3xl border-t border-l border-r border-b border-t-white/15 border-l-white/8 border-r-white/4 border-b-white/[0.02] bg-white/[0.02] backdrop-blur-2xl p-7 sm:p-8 transition-all duration-500"
                style={{ boxShadow: `0 20px 50px rgba(0,0,0,0.4), 0 0 20px ${p.color}08` }}>
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5 transition-transform group-hover:scale-110" style={{ background: `${p.color}10` }}>
                  <Icon className="h-6 w-6" style={{ color: p.color }} />
                </div>
                <h3 className="text-xl font-bold mb-3" style={{ letterSpacing: "-0.04em" }}>{t(p.titleKey)}</h3>
                <p className="text-sm text-muted-foreground/70 leading-[1.7]">{t(p.descKey)}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
