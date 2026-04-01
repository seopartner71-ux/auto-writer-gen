import { motion } from "framer-motion";
import { TrendingUp, Clock, ShieldCheck, FileText } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const metrics = [
  { icon: TrendingUp, value: "+340%", labelKey: "results.metric1" as const, color: "text-emerald-400" },
  { icon: Clock, value: "8 min", labelKey: "results.metric2" as const, color: "text-primary" },
  { icon: ShieldCheck, value: "94%", labelKey: "results.metric3" as const, color: "text-[#3b82f6]" },
  { icon: FileText, value: "1 200+", labelKey: "results.metric4" as const, color: "text-primary" },
];

export function SectionResults() {
  const { t } = useI18n();

  return (
    <section className="relative py-32 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.015] to-transparent" />

      <div className="relative z-10 container mx-auto px-4 max-w-6xl">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl md:text-5xl font-extrabold tracking-[-0.03em] text-center text-white mb-20"
        >
          {t("results.title")}
        </motion.h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {metrics.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
              className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-8 text-center hover:border-white/[0.1] transition-colors duration-300"
            >
              <m.icon className={`h-6 w-6 mx-auto mb-5 ${m.color} opacity-80`} />
              <p className={`text-4xl font-extrabold tracking-tight ${m.color}`} style={{ letterSpacing: "-0.04em" }}>
                {m.value}
              </p>
              <p className="mt-3 text-[13px] text-muted-foreground/50 leading-snug">
                {t(m.labelKey)}
              </p>
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
          className="mt-14 text-center text-[12px] font-mono text-muted-foreground/30 tracking-wider"
        >
          {t("results.trust")}
        </motion.p>
      </div>
    </section>
  );
}
