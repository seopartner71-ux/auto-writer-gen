import { motion } from "framer-motion";
import { Map, BarChart2, Shield, Zap, Bot, Sparkles } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.7 },
};

export function SectionWhatsNew() {
  const { lang } = useI18n();
  const isEn = lang === "en";

  const features = [
    {
      icon: Map,
      color: "#8b5cf6",
      title: isEn ? "Topical Map" : "Карта тем",
      desc: isEn
        ? "Analyzes search results and groups queries by meaning. Plan your content strategy with real frequency data from Yandex."
        : "Анализирует поисковую выдачу и группирует запросы по смыслу. Планируйте контент-стратегию с реальными данными частотности из Яндекса.",
    },
    {
      icon: BarChart2,
      color: "#3b82f6",
      title: isEn ? "Live SEO Score" : "Живой SEO Score",
      desc: isEn
        ? "Score updates in real time as you write. NLP terms, keyword density, structure - like Surfer but in Russian and cheaper."
        : "Score обновляется в реальном времени пока вы пишете. NLP термины, плотность ключа, структура - как в Surfer но на русском и дешевле.",
    },
    {
      icon: Shield,
      color: "#10b981",
      title: isEn ? "Yandex filter protection" : "Защита от фильтра Яндекса",
      desc: isEn
        ? "Turgenev integration by Ashmanov checks Baden-Baden risk. Automatically fixes overspam and clerical language before publishing."
        : "Интеграция с Тургеневым от Ашманова проверяет риск Баден-Бадена. Автоматически исправляет переспам и канцелярит перед публикацией.",
    },
    {
      icon: Zap,
      color: "#f59e0b",
      title: isEn ? "Quick Start and Expert" : "Быстрый старт и Эксперт",
      desc: isEn
        ? "Newcomer presses one button. Expert configures everything - author style, GEO, LSI, custom instructions."
        : "Новичок нажимает одну кнопку. Эксперт настраивает все - авторский стиль, GEO, LSI, кастомные инструкции.",
    },
    {
      icon: Bot,
      color: "#06b6d4",
      title: isEn ? "Texts like a human" : "Тексты как у человека",
      desc: isEn
        ? "Stealth Engine + Claude and Gemini check after each generation. Turgenev confirms Yandex safety."
        : "Stealth Engine + проверка Claude и Gemini после каждой генерации. Тургенев подтверждает безопасность для Яндекса.",
    },
  ];

  return (
    <section className="relative py-28 overflow-hidden">
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 w-[700px] h-[500px] rounded-full bg-primary/[0.04] blur-[180px]" />

      <div className="container mx-auto px-4 max-w-6xl">
        <motion.div className="text-center mb-16" {...fadeUp}>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 mb-6">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] font-tech font-medium text-primary uppercase tracking-widest">
              {isEn ? "What's new" : "Что нового"}
            </span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-[1.05]" style={{ letterSpacing: "-0.05em" }}>
            {isEn ? "Five new pillars" : "Пять новых опор"}
          </h2>
          <p className="mt-5 text-[#9ca3af] max-w-xl mx-auto text-[15px] leading-[1.6]">
            {isEn
              ? "What makes us different from any tool on the RU market"
              : "Что отличает нас от любого инструмента на РУ-рынке"}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.07, duration: 0.6 }}
                className="group relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md p-6 hover:scale-[1.01] transition-all duration-500"
                style={{ ["--hover-color" as string]: f.color }}
              >
                <div
                  className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                  style={{ background: `radial-gradient(300px circle at 50% 50%, ${f.color}10, transparent 70%)` }}
                />
                <div className="relative z-10">
                  <div
                    className="inline-flex items-center justify-center w-10 h-10 rounded-xl mb-4"
                    style={{ background: `${f.color}1a` }}
                  >
                    <Icon className="h-5 w-5" style={{ color: f.color }} />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}