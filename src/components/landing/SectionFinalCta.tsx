import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function SectionFinalCta() {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <section className="relative py-36 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-primary/[0.06] blur-[300px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-3xl text-center">
        <motion.h2
          initial={{ opacity: 0, y: 25 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl md:text-5xl lg:text-6xl font-extrabold tracking-[-0.03em] text-white mb-7"
        >
          {t("finalCta.title")}
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15 }}
          className="text-foreground/55 text-base mb-12 max-w-lg mx-auto leading-relaxed"
        >
          {t("finalCta.sub")}
        </motion.p>

        <motion.button
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.25 }}
          onClick={() => navigate("/register")}
          className="group inline-flex items-center gap-2.5 rounded-full bg-gradient-to-r from-primary to-[#3b82f6] px-10 py-5 text-base font-tech font-bold text-white shadow-[0_20px_60px_rgba(139,92,246,0.25)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_25px_80px_rgba(139,92,246,0.4)] active:scale-[0.98]"
        >
          {t("finalCta.button")}
          <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
        </motion.button>
      </div>
    </section>
  );
}
