import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const aiLines = [
  { key: "hum.ai1", cliche: true },
  { key: "hum.ai2", cliche: true },
  { key: "hum.ai3", cliche: false },
  { key: "hum.ai4", cliche: true },
];

const humanLines = [
  { key: "hum.hu1" },
  { key: "hum.hu2" },
  { key: "hum.hu3" },
  { key: "hum.hu4" },
];

export function SectionHumanizer() {
  const { t } = useI18n();

  return (
    <section className="relative py-32 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] rounded-full bg-primary/[0.03] blur-[300px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-5xl font-extrabold tracking-[-0.03em] text-white mb-5">
            {t("hum.title")}
          </h2>
          <p className="text-muted-foreground/50 text-[15px] max-w-xl mx-auto">
            {t("hum.sub")}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left — AI text (bad) */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="rounded-2xl border border-red-500/10 bg-red-500/[0.02] p-6"
          >
            <div className="flex items-center gap-2 mb-5">
              <AlertTriangle className="h-4 w-4 text-red-400/70" />
              <span className="text-sm font-tech font-bold text-red-400/80">{t("hum.labelAi")}</span>
              <span className="ml-auto text-[10px] font-mono text-red-400/50 border border-red-500/15 bg-red-500/[0.04] px-2 py-0.5 rounded-full">AI: 94%</span>
            </div>
            <div className="space-y-3">
              {aiLines.map((line, i) => (
                <p key={i} className={`text-[13px] leading-relaxed ${line.cliche ? "text-red-300/50 line-through decoration-red-400/20" : "text-white/50"}`}>
                  {t(line.key)}
                </p>
              ))}
            </div>
          </motion.div>

          {/* Right — Human text (good) */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.02] p-6"
          >
            <div className="flex items-center gap-2 mb-5">
              <CheckCircle2 className="h-4 w-4 text-emerald-400/70" />
              <span className="text-sm font-tech font-bold text-emerald-400/80">{t("hum.labelHuman")}</span>
              <span className="ml-auto text-[10px] font-mono text-emerald-400/50 border border-emerald-500/15 bg-emerald-500/[0.04] px-2 py-0.5 rounded-full">AI: 0%</span>
            </div>
            <div className="space-y-3">
              {humanLines.map((line, i) => (
                <p key={i} className="text-[13px] leading-relaxed text-white/60">
                  {t(line.key)}
                </p>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-3">
              <div className="flex gap-1.5">
                <span className="text-[9px] font-mono text-emerald-400/50 border border-emerald-500/10 px-2 py-0.5 rounded-full">Perplexity: 82</span>
                <span className="text-[9px] font-mono text-emerald-400/50 border border-emerald-500/10 px-2 py-0.5 rounded-full">Burstiness: 71</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
