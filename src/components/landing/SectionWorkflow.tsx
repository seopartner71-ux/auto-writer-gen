import { motion } from "framer-motion";
import { FolderPlus, Brain, Rocket } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const steps = [
  { icon: FolderPlus, color: "#8b5cf6", titleKey: "awg.step1Title", descKey: "awg.step1Desc" },
  { icon: Brain, color: "#06b6d4", titleKey: "awg.step2Title", descKey: "awg.step2Desc" },
  { icon: Rocket, color: "#10b981", titleKey: "awg.step3Title", descKey: "awg.step3Desc" },
];

export function SectionWorkflow() {
  const { t } = useI18n();

  return (
    <section className="relative py-32 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full bg-[#06b6d4]/[0.04] blur-[220px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-5xl">
        <motion.div initial={{ opacity: 0, y: 50 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-extrabold leading-[0.95]" style={{ letterSpacing: "-0.06em" }}>
            {t("awg.workflowTitle")}
          </h2>
          <p className="mt-4 text-muted-foreground text-[15px] max-w-2xl mx-auto leading-[1.7]">{t("awg.workflowSub")}</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          {/* Connecting lines */}
          <div className="hidden md:block absolute top-14 left-[20%] right-[20%] h-px bg-gradient-to-r from-[#8b5cf6]/20 via-[#06b6d4]/20 to-[#10b981]/20" />

          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ delay: i * 0.15 }}
                className="text-center relative">
                <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-5 border border-white/[0.06]"
                  style={{ background: `${s.color}10`, boxShadow: `0 0 30px ${s.color}10` }}>
                  <Icon className="h-7 w-7" style={{ color: s.color }} />
                </div>
                <span className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-widest mb-2 block">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="text-lg font-bold mb-2" style={{ letterSpacing: "-0.04em" }}>{t(s.titleKey)}</h3>
                <p className="text-sm text-muted-foreground/60 leading-[1.7] max-w-[280px] mx-auto">{t(s.descKey)}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
