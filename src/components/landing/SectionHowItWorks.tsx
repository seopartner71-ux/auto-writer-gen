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
    <section id="how-it-works" className="relative py-28 overflow-hidden">
      <div className="relative z-10 container mx-auto px-4 max-w-5xl">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl md:text-5xl font-black tracking-[-0.04em] text-center text-white mb-20"
        >
          {t("hiw.title")}
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative">
          {/* Connector line */}
          <div className="hidden md:block absolute top-10 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-primary/30 via-[#3b82f6]/30 to-emerald-400/30" />

          {steps.map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.12 }}
              className="text-center relative"
            >
              <div className="w-20 h-20 mx-auto rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl flex items-center justify-center mb-5 relative z-10">
                <s.icon className={`h-8 w-8 ${s.color}`} />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground/40 tracking-widest uppercase mb-2 block">
                {t("hiw.stepLabel")} {i + 1}
              </span>
              <h3 className="text-lg font-bold text-white mb-2">{t(s.labelKey)}</h3>
              <p className="text-[13px] text-muted-foreground/60 leading-relaxed">{t(s.descKey)}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
