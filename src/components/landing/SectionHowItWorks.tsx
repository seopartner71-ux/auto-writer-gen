import { motion } from "framer-motion";
import { Search, UserCheck, ShieldCheck, Upload } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const steps = [
  { icon: Search, color: "text-primary", labelKey: "hiw.step1", descKey: "hiw.desc1" },
  { icon: UserCheck, color: "text-[#3b82f6]", labelKey: "hiw.step2", descKey: "hiw.desc2" },
  { icon: ShieldCheck, color: "text-emerald-400", labelKey: "hiw.step3", descKey: "hiw.desc3" },
  { icon: Upload, color: "text-primary", labelKey: "hiw.step4", descKey: "hiw.desc4" },
] as const;

export function SectionHowItWorks() {
  const { t } = useI18n();

  return (
    <section id="how-it-works" className="relative py-32 overflow-hidden">
      <div className="relative z-10 container mx-auto px-4 max-w-5xl">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl md:text-5xl font-extrabold tracking-[-0.03em] text-center text-white mb-20"
        >
          {t("hiw.title")}
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 relative">
          {/* Connector line */}
          <div className="hidden md:block absolute top-10 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-primary/20 via-[#3b82f6]/20 to-emerald-400/20" />

          {steps.map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.12 }}
              className="text-center relative"
            >
              <div className="w-20 h-20 mx-auto rounded-2xl border border-white/[0.05] bg-white/[0.015] flex items-center justify-center mb-6 relative z-10">
                <s.icon className={`h-7 w-7 ${s.color} opacity-80`} />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground/30 tracking-widest uppercase mb-2 block">
                {t("hiw.stepLabel")} {i + 1}
              </span>
              <h3 className="text-lg font-bold text-white/90 mb-2">{t(s.labelKey)}</h3>
              <p className="text-[13px] text-muted-foreground/50 leading-relaxed">{t(s.descKey)}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
