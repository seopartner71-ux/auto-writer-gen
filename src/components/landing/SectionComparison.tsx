import { useI18n } from "@/shared/hooks/useI18n";
import { motion } from "framer-motion";
import { AlertTriangle, Sparkles, Check } from "lucide-react";

const content = {
  ru: {
    heading: "Разница — в деталях",
    sub: "Стандартный AI-текст vs контент SERPblueprint с высоким Perplexity и без клише",
    leftTitle: "Стандартный AI-текст",
    leftBadge: "AI: 0%",
    leftLines: [
      { text: "В современном мире цифровых технологий SEO играет ключевую роль в продвижении бизнеса.", tag: "CLICHÉ" },
      { text: "Важно отметить, что качественный контент является неотъемлемой частью успешной стратегии.", tag: "CLICHÉ" },
      { text: "Оптимизация ключевых слов помогает улучшить видимость сайта.", tag: null },
      { text: "В заключение хочется сказать, что SEO — это непрерывный процесс совершенствования.", tag: "CLICHÉ" },
    ],
    leftPatterns: ["⚠ Pattern #1", "⚠ Pattern #2", "⚠ Pattern #3", "⚠ Pattern #4"],
    rightTitle: "SERPblueprint Output",
    rightBadge: "AI: 0%",
    rightLines: [
      "Мы протестировали 340 лонгридов в нишах B2B SaaS и e-commerce. Результат: статьи с Perplexity > 75 получают на 62% больше органического трафика.",
      "Конкретный пример: клиент из ниши кибербезопасности вышел в ТОП-3 за 14 дней по запросу с KD 47.",
      "Секрет — не в «уникальности» текста, а в архитектуре сущностей и синтаксической непредсказуемости.",
      "Наша система воспроизводит паттерн «рваного» экспертного письма, который детекторы не распознают.",
    ],
    rightMetrics: ["Perplexity: 82.4", "Burstiness: 71.2", "E-E-A-T: ✓"],
    footerLeft: "✓ Humanization complete",
    footerRight: "Human Score: 99%",
  },
  en: {
    heading: "The Difference — in Details",
    sub: "Standard AI text vs SERPblueprint content with high Perplexity and no clichés",
    leftTitle: "Standard AI Text",
    leftBadge: "AI: 0%",
    leftLines: [
      { text: "In today's digital landscape, SEO plays a crucial role in business growth.", tag: "CLICHÉ" },
      { text: "It's important to note that quality content is an integral part of any strategy.", tag: "CLICHÉ" },
      { text: "Keyword optimization helps improve website visibility.", tag: null },
      { text: "In conclusion, SEO is a continuous process of improvement.", tag: "CLICHÉ" },
    ],
    leftPatterns: ["⚠ Pattern #1", "⚠ Pattern #2", "⚠ Pattern #3", "⚠ Pattern #4"],
    rightTitle: "SERPblueprint Output",
    rightBadge: "AI: 0%",
    rightLines: [
      "We tested 340 long-reads in B2B SaaS and e-commerce niches. Result: articles with Perplexity > 75 receive 62% more organic traffic.",
      "Specific example: a cybersecurity client hit TOP-3 in 14 days for a keyword with KD 47.",
      "The secret isn't in text 'uniqueness' — it's in entity architecture and syntactic unpredictability.",
      "Our system replicates the 'rough' expert writing pattern that detectors can't recognize.",
    ],
    rightMetrics: ["Perplexity: 82.4", "Burstiness: 71.2", "E-E-A-T: ✓"],
    footerLeft: "✓ Humanization complete",
    footerRight: "Human Score: 99%",
  },
};

export function SectionComparison() {
  const { lang } = useI18n();
  const c = content[lang] || content.en;

  return (
    <section className="relative py-32 px-4 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] rounded-full bg-primary/[0.03] blur-[250px]" />

      <div className="relative max-w-5xl mx-auto">
        {/* Heading */}
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-[-0.05em] text-center text-white italic mb-4"
          style={{ textShadow: "0 0 60px hsl(var(--primary) / 0.15)" }}
        >
          {c.heading}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="text-center text-slate-500 text-sm md:text-base font-mono mb-14 max-w-2xl mx-auto"
        >
          {c.sub}
        </motion.p>

        {/* Comparison container */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15 }}
          className="rounded-2xl border border-white/[0.06] bg-white/[0.015] backdrop-blur-xl overflow-hidden"
        >
          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.06]">
            {/* Left — AI text */}
            <div className="p-6 md:p-8">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="text-red-400 font-mono text-sm font-semibold">{c.leftTitle}</span>
                </div>
                <span className="px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono">
                  {c.leftBadge}
                </span>
              </div>

              <div className="space-y-4 mb-6">
                {c.leftLines.map((line, i) => (
                  <p key={i} className="text-sm text-slate-400 leading-relaxed">
                    {line.text}
                    {line.tag && (
                      <span className="ml-2 text-[10px] font-mono text-red-400/70 uppercase align-super">
                        {line.tag}
                      </span>
                    )}
                  </p>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                {c.leftPatterns.map((p, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 rounded-full border border-red-500/20 bg-red-500/5 text-red-400/70 text-[11px] font-mono"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>

            {/* Right — SERPblueprint */}
            <div className="p-6 md:p-8">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400 font-mono text-sm font-semibold">{c.rightTitle}</span>
                </div>
                <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {c.rightBadge}
                </span>
              </div>

              <div className="space-y-4 mb-6">
                {c.rightLines.map((line, i) => (
                  <p key={i} className="text-sm text-slate-300 leading-relaxed">
                    {line}
                  </p>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                {c.rightMetrics.map((m, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/5 text-emerald-400/80 text-[11px] font-mono flex items-center gap-1.5"
                  >
                    {i < 2 ? <Sparkles className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                    {m}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Footer bar */}
          <div className="border-t border-white/[0.06] px-6 md:px-8 py-4 flex items-center justify-center gap-6 bg-white/[0.01]">
            <span className="text-slate-500 text-sm font-mono">{c.footerLeft}</span>
            <span className="text-emerald-400 font-bold font-mono text-sm">{c.footerRight}</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
