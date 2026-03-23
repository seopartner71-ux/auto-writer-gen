import { motion } from "framer-motion";
import { useI18n } from "@/shared/hooks/useI18n";

export function LandingStats() {
  const { t } = useI18n();

  const stats = [
    { value: "47.2%", label: t("landing.statRanking") },
    { value: "3,841", label: t("landing.statArticles") },
    { value: "12 min", label: t("landing.statTime") },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="relative z-10 mt-20 flex flex-wrap items-center justify-center gap-12 sm:gap-20"
    >
      {stats.map((s) => (
        <div key={s.label} className="text-center">
          <p className="text-3xl sm:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-400">
            {s.value}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
        </div>
      ))}
    </motion.div>
  );
}
