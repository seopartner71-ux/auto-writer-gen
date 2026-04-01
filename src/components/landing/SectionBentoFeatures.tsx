import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Search, Brain, ShieldCheck, Layers, Globe, Radar, UserCheck, FileText, Zap, Settings, Cpu, BarChart3, Workflow, Sparkles, Target, Bell, Hash } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

/* ---------- Micro UI widgets for cards ---------- */
function MiniLSITable() {
  return (
    <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.01] p-2.5 space-y-1.5">
      {[
        { kw: "pool maintenance cost", score: 94 },
        { kw: "chemical testing kit", score: 87 },
        { kw: "filter cleaning freq", score: 82 },
      ].map((r, i) => (
        <div key={i} className="flex items-center justify-between text-[10px] font-mono">
          <span className="text-white/50 flex items-center gap-1"><Hash className="h-2.5 w-2.5" />{r.kw}</span>
          <span className="text-emerald-400/80">{r.score}%</span>
        </div>
      ))}
    </div>
  );
}

function MiniProgressBar() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setProgress((p) => p >= 100 ? 0 : p + 2), 120);
    return () => clearInterval(i);
  }, []);
  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between text-[10px] font-mono">
        <span className="text-amber-400/70">Batch: 150 articles</span>
        <span className="text-white/50">{Math.min(progress, 100)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <motion.div className="h-full rounded-full bg-gradient-to-r from-amber-500/70 to-amber-400/70"
          style={{ width: `${Math.min(progress, 100)}%` }} />
      </div>
    </div>
  );
}

function MiniRadarToast() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 2000);
    return () => clearTimeout(t);
  }, []);
  return show ? (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] p-2.5 flex items-center gap-2"
    >
      <Bell className="h-3.5 w-3.5 text-cyan-400/80" />
      <span className="text-[10px] font-mono text-cyan-400/80">Brand mentioned in GPT-4o</span>
    </motion.div>
  ) : null;
}

function MiniHumanScore() {
  return (
    <div className="mt-4 flex items-center gap-2.5">
      <div className="h-2 flex-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div className="h-full w-[97%] rounded-full bg-gradient-to-r from-emerald-500/70 to-emerald-400/70" />
      </div>
      <span className="text-[10px] font-mono text-emerald-400/80">97%</span>
    </div>
  );
}

/* ---------- Blocks with micro-widgets ---------- */
const blocks = [
  {
    titleKey: "bento.block1",
    color: "text-[#3b82f6]",
    borderColor: "border-[#3b82f6]/15",
    bgColor: "bg-[#3b82f6]/[0.03]",
    glowColor: "group-hover:shadow-[0_0_50px_rgba(59,130,246,0.1)]",
    modules: [
      { icon: Search, nameKey: "bento.smartResearch", descKey: "bento.smartResearchDesc", widget: "lsi" },
      { icon: BarChart3, nameKey: "bento.lsi", descKey: "bento.lsiDesc", widget: null },
      { icon: Brain, nameKey: "bento.paa", descKey: "bento.paaDesc", widget: null },
      { icon: Target, nameKey: "bento.contentGap", descKey: "bento.contentGapDesc", widget: null },
    ],
  },
  {
    titleKey: "bento.block2",
    color: "text-primary",
    borderColor: "border-primary/15",
    bgColor: "bg-primary/[0.03]",
    glowColor: "group-hover:shadow-[0_0_50px_rgba(139,92,246,0.1)]",
    modules: [
      { icon: UserCheck, nameKey: "bento.persona", descKey: "bento.personaDesc", widget: null },
      { icon: Cpu, nameKey: "bento.stealthPrompt", descKey: "bento.stealthPromptDesc", widget: null },
      { icon: Sparkles, nameKey: "bento.clicheKiller", descKey: "bento.clicheKillerDesc", widget: null },
      { icon: FileText, nameKey: "bento.aiWriter", descKey: "bento.aiWriterDesc", widget: "human" },
    ],
  },
  {
    titleKey: "bento.block3",
    color: "text-amber-400",
    borderColor: "border-amber-500/15",
    bgColor: "bg-amber-500/[0.03]",
    glowColor: "group-hover:shadow-[0_0_50px_rgba(245,158,11,0.1)]",
    modules: [
      { icon: Workflow, nameKey: "bento.bulkGen", descKey: "bento.bulkGenDesc", widget: "progress" },
      { icon: Globe, nameKey: "bento.wpSync", descKey: "bento.wpSyncDesc", widget: null },
      { icon: Settings, nameKey: "bento.scheduler", descKey: "bento.schedulerDesc", widget: null },
      { icon: Layers, nameKey: "bento.outline", descKey: "bento.outlineDesc", widget: null },
    ],
  },
  {
    titleKey: "bento.block4",
    color: "text-cyan-400",
    borderColor: "border-cyan-500/15",
    bgColor: "bg-cyan-500/[0.03]",
    glowColor: "group-hover:shadow-[0_0_50px_rgba(34,211,238,0.1)]",
    modules: [
      { icon: Radar, nameKey: "bento.radar", descKey: "bento.radarDesc", widget: "toast" },
      { icon: Globe, nameKey: "bento.indexing", descKey: "bento.indexingDesc", widget: null },
      { icon: ShieldCheck, nameKey: "bento.stealth", descKey: "bento.stealthDesc", widget: null },
      { icon: Zap, nameKey: "bento.humanize", descKey: "bento.humanizeDesc", widget: null },
    ],
  },
];

export function SectionBentoFeatures() {
  const { t } = useI18n();

  const renderWidget = (type: string | null) => {
    if (type === "lsi") return <MiniLSITable />;
    if (type === "progress") return <MiniProgressBar />;
    if (type === "toast") return <MiniRadarToast />;
    if (type === "human") return <MiniHumanScore />;
    return null;
  };

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
          <span className="text-xs font-mono text-primary/70 uppercase tracking-widest mb-4 block">
            {t("bento.badge")}
          </span>
          <h2 className="text-3xl md:text-5xl font-extrabold tracking-[-0.03em] text-white mb-5">
            {t("bento.title")}
          </h2>
          <p className="text-foreground/50 text-base max-w-xl mx-auto leading-relaxed">
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
              className={`group rounded-2xl border ${block.borderColor} ${block.bgColor} p-8 transition-all duration-500 hover:scale-[1.01] ${block.glowColor}`}
            >
              <h3 className={`text-sm font-tech font-bold ${block.color} uppercase tracking-wider mb-7`}>
                {t(block.titleKey)}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {block.modules.map((mod, mi) => (
                  <div key={mi} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 hover:border-white/[0.15] hover:bg-white/[0.04] transition-all duration-300 hover:shadow-[0_0_25px_rgba(139,92,246,0.06)]">
                    <mod.icon className={`h-5 w-5 ${block.color} opacity-80 mb-3`} />
                    <h4 className="text-sm font-semibold text-white/90 mb-2">{t(mod.nameKey)}</h4>
                    <p className="text-sm text-foreground/50 leading-relaxed">{t(mod.descKey)}</p>
                    {renderWidget(mod.widget)}
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
