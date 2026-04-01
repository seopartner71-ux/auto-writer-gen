import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function SectionFinalCta() {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <section className="relative py-32 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full bg-primary/[0.08] blur-[280px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-3xl text-center">
        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl md:text-5xl lg:text-6xl font-black tracking-[-0.04em] text-white mb-6"
        >
          {t("finalCta.title")}
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15 }}
          className="text-muted-foreground/60 text-[15px] mb-10 max-w-lg mx-auto"
        >
          {t("finalCta.sub")}
        </motion.p>

        <motion.button
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.25 }}
          onClick={() => navigate("/register")}
          className="group inline-flex items-center gap-2.5 rounded-full bg-gradient-to-r from-primary to-[#3b82f6] px-10 py-5 text-base font-tech font-bold text-white shadow-[0_20px_60px_rgba(139,92,246,0.3)] transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_25px_80px_rgba(139,92,246,0.45)] active:scale-[0.98]"
        >
          {t("finalCta.button")}
          <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
        </motion.button>
      </div>
    </section>
  );
}
