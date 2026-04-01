import { motion } from "framer-motion";
import { Flame, Quote } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function SectionExpertProof() {
  const { t, lang } = useI18n();
  const isEn = lang === "en";

  return (
    <section className="relative py-32 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-[20%] -translate-y-1/2 w-[600px] h-[500px] rounded-full bg-[#f59e0b]/[0.04] blur-[220px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-4xl">
        <motion.div initial={{ opacity: 0, y: 50 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="text-center mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#f59e0b]/20 bg-[#f59e0b]/5 px-4 py-1.5 mb-6">
            <Flame className="h-3.5 w-3.5 text-[#f59e0b]" />
            <span className="text-xs font-tech font-medium text-[#f59e0b] uppercase tracking-wider">
              {isEn ? "The 115°F Expert Proof" : "Доказательство экспертности"}
            </span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold leading-[1.05]" style={{ letterSpacing: "-0.05em", textShadow: "0 0 60px rgba(245,158,11,0.08)" }}>
            {t("awg.expertTitle")}
          </h2>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.15 }}
          className="rounded-3xl border-t border-l border-r border-b border-t-white/15 border-l-white/8 border-r-white/4 border-b-white/[0.02] bg-white/[0.02] backdrop-blur-2xl p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
          <div className="rounded-2xl bg-[#06060b]/90 p-8 sm:p-10">
            <Quote className="h-8 w-8 text-[#f59e0b]/30 mb-4" />
            <p className="text-[15px] sm:text-base text-foreground/80 leading-[1.9] font-light italic" dangerouslySetInnerHTML={{ __html: t("awg.expertQuote") }} />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
