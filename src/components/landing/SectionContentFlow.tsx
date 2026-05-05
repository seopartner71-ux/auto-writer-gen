import { motion } from "framer-motion";
import { Map, Search, Sparkles, BarChart2, Shield, Send, TrendingUp } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.7 },
};

export function SectionContentFlow() {
  const { lang } = useI18n();
  const isEn = lang === "en";

  const steps = [
    {
      icon: Map,
      title: isEn ? "Topical Map" : "Карта тем",
      desc: isEn
        ? "Analyze SERPs, cluster queries, show real frequency"
        : "Анализируем поисковую выдачу, кластеризуем запросы, показываем реальную частотность",
      color: "#8b5cf6",
    },
    {
      icon: Search,
      title: isEn ? "Smart Research" : "Smart Research",
      desc: isEn
        ? "Parse top-10, extract LSI, analyze competitor structure"
        : "Парсим топ-10, извлекаем LSI, анализируем структуру конкурентов",
      color: "#3b82f6",
    },
    {
      icon: Sparkles,
      title: isEn ? "AI Generation" : "AI Генерация",
      desc: isEn
        ? "15+ author styles, Stealth Engine, AI-detector bypass"
        : "15+ авторских стилей, Stealth Engine, обход AI-детекторов",
      color: "#a855f7",
    },
    {
      icon: BarChart2,
      title: isEn ? "SEO + Quality" : "SEO + Качество",
      desc: isEn
        ? "Realtime SEO Score, AI-detector Claude+Gemini, burstiness analysis"
        : "Realtime SEO Score, AI-детектор Claude+Gemini, burstiness анализ",
      color: "#10b981",
    },
    {
      icon: Shield,
      title: isEn ? "Turgenev" : "Тургенев",
      desc: isEn
        ? "Baden-Baden risk check, automatic over-spam fix"
        : "Проверка риска Баден-Бадена, автоисправление переспама",
      color: "#f59e0b",
    },
    {
      icon: Send,
      title: isEn ? "Publish" : "Публикация",
      desc: isEn
        ? "WordPress auto-publish, Telegra.ph, Google Docs"
        : "WordPress автопубликация, Telegra.ph, Google Docs",
      color: "#ef4444",
    },
    {
      icon: TrendingUp,
      title: isEn ? "Rankings" : "Позиции",
      desc: isEn
        ? "Yandex and Google indexing, position tracking"
        : "Индексация Яндекс и Google, отслеживание роста позиций",
      color: "#06b6d4",
    },
  ];

  const stats = [
    { value: "7", label: isEn ? "steps" : "шагов" },
    { value: "100%", label: isEn ? "auto" : "авто" },
    { value: "9.2", label: isEn ? "score" : "оценка" },
    { value: isEn ? "RU #1" : "РУ #1", label: isEn ? "market" : "рынок" },
  ];

  return (
    <section className="relative py-28 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[500px] rounded-full bg-primary/[0.04] blur-[200px]" />

      <div className="container mx-auto px-4 max-w-6xl">
        <div className="grid lg:grid-cols-[2fr_3fr] gap-12 lg:gap-16 items-start">
          {/* Left column — heading + stats */}
          <motion.div className="lg:sticky lg:top-28" {...fadeUp}>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 mb-6">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] font-tech font-medium text-primary uppercase tracking-widest">
                {isEn ? "Full cycle" : "Полный цикл"}
              </span>
            </div>
            <h2
              className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[0.95]"
              style={{ letterSpacing: "-0.05em" }}
            >
              {isEn ? (
                <>From idea<br />to top</>
              ) : (
                <>От идеи<br />до топа</>
              )}
            </h2>
            <p className="mt-5 text-[#9ca3af] text-[15px] leading-[1.6] max-w-md">
              {isEn
                ? "Full automated cycle of SEO content creation"
                : "Полный автоматизированный цикл создания SEO-контента"}
            </p>

            <div className="mt-8 grid grid-cols-2 gap-3 max-w-sm">
              {stats.map((s, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md px-4 py-4 text-center"
                >
                  <div className="text-2xl font-bold text-foreground" style={{ letterSpacing: "-0.03em" }}>
                    {s.value}
                  </div>
                  <div className="mt-1 text-[11px] font-tech text-muted-foreground uppercase tracking-wider">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Right column — timeline */}
          <div className="relative">
            {steps.map((step, i) => {
              const Icon = step.icon;
              const next = steps[i + 1];
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.6, delay: i * 0.05 }}
                >
                  <div
                    className="group relative overflow-hidden rounded-2xl border bg-white/[0.02] backdrop-blur-md px-5 py-5 sm:px-6 sm:py-6 transition-all duration-300 hover:bg-white/[0.04]"
                    style={{
                      borderColor: `${step.color}22`,
                    }}
                  >
                    {/* Left edge highlight */}
                    <div
                      className="absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full"
                      style={{ background: `linear-gradient(to bottom, ${step.color}, ${step.color}33)` }}
                    />

                    {/* Big transparent step number */}
                    <div
                      className="pointer-events-none absolute right-4 top-2 text-5xl sm:text-6xl font-bold leading-none"
                      style={{ color: step.color, opacity: 0.1, letterSpacing: "-0.05em" }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </div>

                    <div className="relative flex items-start gap-4">
                      <div
                        className="shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-xl"
                        style={{ background: `${step.color}1f`, border: `1px solid ${step.color}33` }}
                      >
                        <Icon className="h-[22px] w-[22px]" style={{ color: step.color }} />
                      </div>
                      <div className="flex-1 min-w-0 pr-12">
                        <h3 className="text-[18px] font-bold text-foreground leading-tight">
                          {step.title}
                        </h3>
                        <p className="mt-1.5 text-[14px] text-[#9ca3af] leading-[1.55]">
                          {step.desc}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Gradient connector line */}
                  {next && (
                    <div className="flex justify-start pl-[34px] py-1">
                      <div
                        className="w-[2px] h-10 rounded-full"
                        style={{
                          background: `linear-gradient(to bottom, ${step.color}, ${next.color})`,
                          opacity: 0.6,
                        }}
                      />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
