import { motion } from "framer-motion";
import { Search, Brain, ShieldCheck, Layers, Factory, Globe, Radar, UserCheck, FileText, Zap, Settings, Cpu, Microscope, BarChart3, Workflow, Sparkles, Target } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const blocks = [
  {
    titleKey: "bento.block1",
    color: "text-[#3b82f6]",
    borderColor: "border-[#3b82f6]/10",
    bgColor: "bg-[#3b82f6]/[0.02]",
    modules: [
      { icon: Search, nameKey: "bento.smartResearch", descKey: "bento.smartResearchDesc" },
      { icon: BarChart3, nameKey: "bento.lsi", descKey: "bento.lsiDesc" },
      { icon: Brain, nameKey: "bento.paa", descKey: "bento.paaDesc" },
      { icon: Target, nameKey: "bento.contentGap", descKey: "bento.contentGapDesc" },
    ],
  },
  {
    titleKey: "bento.block2",
    color: "text-primary",
    borderColor: "border-primary/10",
    bgColor: "bg-primary/[0.02]",
    modules: [
      { icon: UserCheck, nameKey: "bento.persona", descKey: "bento.personaDesc" },
      { icon: Cpu, nameKey: "bento.stealthPrompt", descKey: "bento.stealthPromptDesc" },
      { icon: Sparkles, nameKey: "bento.clicheKiller", descKey: "bento.clicheKillerDesc" },
      { icon: FileText, nameKey: "bento.aiWriter", descKey: "bento.aiWriterDesc" },
    ],
  },
  {
    titleKey: "bento.block3",
    color: "text-amber-400",
    borderColor: "border-amber-500/10",
    bgColor: "bg-amber-500/[0.02]",
    modules: [
      { icon: Factory, nameKey: "bento.bulkGen", descKey: "bento.bulkGenDesc" },
      { icon: Workflow, nameKey: "bento.wpSync", descKey: "bento.wpSyncDesc" },
      { icon: Settings, nameKey: "bento.scheduler", descKey: "bento.schedulerDesc" },
      { icon: Layers, nameKey: "bento.outline", descKey: "bento.outlineDesc" },
    ],
  },
  {
    titleKey: "bento.block4",
    color: "text-cyan-400",
    borderColor: "border-cyan-500/10",
    bgColor: "bg-cyan-500/[0.02]",
    modules: [
      { icon: Radar, nameKey: "bento.radar", descKey: "bento.radarDesc" },
      { icon: Globe, nameKey: "bento.indexing", descKey: "bento.indexingDesc" },
      { icon: ShieldCheck, nameKey: "bento.stealth", descKey: "bento.stealthDesc" },
      { icon: Zap, nameKey: "bento.humanize", descKey: "bento.humanizeDesc" },
    ],
  },
];

export function SectionBentoFeatures() {
  const { t } = useI18n();

  return (
    <section id="features" className="relative py-32 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.01] to-transparent" />

      <div className="relative z-10 container mx-auto px-4 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <span className="text-[11px] font-mono text-primary/60 uppercase tracking-widest mb-4 block">
            {t("bento.badge")}
          </span>
          <h2 className="text-3xl md:text-5xl font-extrabold tracking-[-0.03em] text-white mb-5">
            {t("bento.title")}
          </h2>
          <p className="text-muted-foreground/50 text-[15px] max-w-xl mx-auto">
            {t("bento.sub")}
          </p>
        </motion.div>

        {/* Bento Grid — 4 blocks */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {blocks.map((block, bi) => (
            <motion.div
              key={bi}
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: bi * 0.1 }}
              className={`rounded-2xl border ${block.borderColor} ${block.bgColor} p-7 transition-all duration-300 hover:scale-[1.01]`}
            >
              <h3 className={`text-sm font-tech font-bold ${block.color} uppercase tracking-wider mb-6`}>
                {t(block.titleKey)}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {block.modules.map((mod, mi) => (
                  <div key={mi} className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4 hover:border-white/[0.08] transition-colors">
                    <mod.icon className={`h-5 w-5 ${block.color} opacity-70 mb-3`} />
                    <h4 className="text-sm font-semibold text-white/85 mb-1.5">{t(mod.nameKey)}</h4>
                    <p className="text-[11px] text-muted-foreground/40 leading-relaxed">{t(mod.descKey)}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
