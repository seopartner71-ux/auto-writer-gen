import { motion } from "framer-motion";
import { Check, X, Minus, Sparkles } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

type CellValue = "yes" | "no" | "partial" | string;

interface Row {
  feature: { ru: string; en: string };
  chatgpt: { value: CellValue; label?: { ru: string; en: string } };
  rankline: { value: CellValue; label?: { ru: string; en: string } };
  awg: { value: CellValue; label?: { ru: string; en: string } };
}

const rows: Row[] = [
  {
    feature: { ru: "Локальные нишевые данные", en: "Local Niche Data" },
    chatgpt: { value: "partial", label: { ru: "Обобщённые", en: "Generic" } },
    rankline: { value: "partial", label: { ru: "Базовые", en: "Basic" } },
    awg: { value: "yes", label: { ru: "Глубокие экспертные факты", en: "Deep Expert Facts" } },
  },
  {
    feature: { ru: "GEO-мониторинг", en: "GEO Monitoring" },
    chatgpt: { value: "no" },
    rankline: { value: "yes" },
    awg: { value: "yes", label: { ru: "Встроенный радар", en: "Integrated Radar" } },
  },
  {
    feature: { ru: "Контент-фабрика", en: "Content Factory" },
    chatgpt: { value: "no" },
    rankline: { value: "no" },
    awg: { value: "yes", label: { ru: "Bulk WP-публикация", en: "Bulk WP Publishing" } },
  },
  {
    feature: { ru: "AI-детекция", en: "AI Detection" },
    chatgpt: { value: "no", label: { ru: "Не проходит", en: "Fails" } },
    rankline: { value: "partial", label: { ru: "Нестабильно", en: "Mixed" } },
    awg: { value: "yes", label: { ru: "Stealth Mode (100%)", en: "Stealth Mode (100%)" } },
  },
  {
    feature: { ru: "Внутренняя перелинковка", en: "Internal Linking" },
    chatgpt: { value: "no" },
    rankline: { value: "partial", label: { ru: "Ручная", en: "Manual" } },
    awg: { value: "yes", label: { ru: "AI Linker Engine", en: "AI Linker Engine" } },
  },
  {
    feature: { ru: "Persona Engine", en: "Persona Engine" },
    chatgpt: { value: "no" },
    rankline: { value: "no" },
    awg: { value: "yes", label: { ru: "Cliche Killer Tech", en: "Cliche Killer Tech" } },
  },
];

function CellIcon({ value }: { value: CellValue }) {
  if (value === "yes") return <Check className="h-4 w-4 text-emerald-400" />;
  if (value === "no") return <X className="h-4 w-4 text-red-400/60" />;
  return <Minus className="h-4 w-4 text-[#f59e0b]/70" />;
}

export function SectionComparison() {
  const { t, lang } = useI18n();
  const isEn = lang === "en";

  return (
    <section className="relative py-32 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full bg-[#8b5cf6]/[0.04] blur-[220px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-5xl">
        <motion.div initial={{ opacity: 0, y: 50 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="text-center mb-14">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#06b6d4]/20 bg-[#06b6d4]/5 px-4 py-1.5 mb-6">
            <Sparkles className="h-3.5 w-3.5 text-[#06b6d4]" />
            <span className="text-xs font-tech font-medium text-[#06b6d4] uppercase tracking-wider">
              {isEn ? "Why Us" : "Почему мы"}
            </span>
          </div>
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-extrabold leading-[0.95]" style={{ letterSpacing: "-0.06em", textShadow: "0 0 80px rgba(6,182,212,0.08)" }}>
            {t("awg.compTitle")}
          </h2>
          <p className="mt-4 text-muted-foreground text-[15px] max-w-2xl mx-auto leading-[1.7]">{t("awg.compSub")}</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}
          className="rounded-3xl border-t border-l border-r border-b border-t-white/15 border-l-white/8 border-r-white/4 border-b-white/[0.02] bg-white/[0.02] backdrop-blur-2xl p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
          <div className="rounded-2xl bg-[#06060b]/90 overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-4 border-b border-white/[0.06]">
              <div className="px-5 py-4 text-[11px] font-tech uppercase tracking-wider text-muted-foreground/50">
                {isEn ? "Features" : "Функции"}
              </div>
              <div className="px-4 py-4 text-center text-[11px] font-tech uppercase tracking-wider text-muted-foreground/50">ChatGPT</div>
              <div className="px-4 py-4 text-center text-[11px] font-tech uppercase tracking-wider text-muted-foreground/50">Rankline</div>
              <div className="px-4 py-4 text-center relative">
                <span className="text-[11px] font-tech font-bold uppercase tracking-wider text-[#06b6d4]">Auto-Writer-Gen</span>
                <div className="absolute inset-0 bg-[#06b6d4]/[0.03]" />
              </div>
            </div>

            {/* Rows */}
            {rows.map((row, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                transition={{ delay: 0.15 + i * 0.05 }}
                className="grid grid-cols-4 border-b border-white/[0.03] last:border-0 hover:bg-white/[0.01] transition-colors">
                <div className="px-5 py-3.5 text-[13px] text-foreground/80 font-medium">
                  {isEn ? row.feature.en : row.feature.ru}
                </div>
                {[row.chatgpt, row.rankline, row.awg].map((cell, ci) => (
                  <div key={ci} className={`px-4 py-3.5 flex items-center justify-center gap-2 ${ci === 2 ? "bg-[#06b6d4]/[0.02]" : ""}`}>
                    <CellIcon value={cell.value} />
                    {cell.label && (
                      <span className={`text-[10px] font-tech ${cell.value === "yes" ? "text-emerald-400/80" : cell.value === "partial" ? "text-[#f59e0b]/70" : "text-red-400/50"}`}>
                        {isEn ? cell.label.en : cell.label.ru}
                      </span>
                    )}
                  </div>
                ))}
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
