import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, HelpCircle } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const faqData = {
  ru: [
    { q: "Как работает обход AI-детекторов?", a: "Наша технология Stealth Prompt увеличивает вариативность (Burstiness) и сложность (Perplexity) текста, делая его неотличимым от человеческого для таких сервисов, как Originality.ai и GPTZero." },
    { q: "Что включено в Smart Research?", a: "Это полный анализ ТОП-10 выдачи: извлечение LSI-ключей, вопросов PAA (People Also Ask), структуры заголовков конкурентов и выявление пробелов в контенте (Content Gap)." },
    { q: "Есть ли прямая публикация в WordPress?", a: "Да. Вы можете подключить свой сайт через App Password и публиковать статьи с готовыми SEO-метатегами (Yoast/RankMath) одним кликом или по расписанию." },
    { q: "Могу ли я обучить AI своему стилю?", a: "Да, модуль Persona Engine анализирует ваши образцы текста, выявляет синтаксические паттерны и лексику, чтобы имитировать ваш уникальный авторский голос во всех статьях." },
    { q: "Что такое Factory (Фабрика)?", a: "Это инструмент для массовой генерации. Загрузите список из 100 ключевых слов через CSV, и система сама проведет исследование и напишет статьи для каждой темы в фоновом режиме." },
    { q: "Сколько статей я получу за 1 кредит?", a: "1 кредит = 1 полноценная экспертная статья с анализом конкурентов, LSI-ключами и оптимизацией. Мы не считаем токены или слова, только готовый результат." },
  ],
  en: [
    { q: "How does the AI detector bypass work?", a: "Our Stealth Prompt technology increases text burstiness and perplexity, making it indistinguishable from human writing for services like Originality.ai and GPTZero." },
    { q: "What is included in Smart Research?", a: "It's a complete Top-10 SERP analysis: LSI keyword extraction, PAA (People Also Ask) questions, competitor heading structures, and content gap identification." },
    { q: "Is there direct WordPress publishing?", a: "Yes. You can connect your site via App Password and publish articles with ready-made SEO meta-tags (Yoast/RankMath) in one click or on a schedule." },
    { q: "Can I train the AI on my style?", a: "Yes, the Persona Engine module analyzes your text samples, identifying syntactic patterns and vocabulary to mimic your unique authorial voice in all articles." },
    { q: "What is the Factory module?", a: "It's a bulk generation tool. Upload a list of 100 keywords via CSV, and the system will perform research and write articles for each topic in the background." },
    { q: "How many articles do I get for 1 credit?", a: "1 credit = 1 full expert article with competitor analysis, LSI keywords, and optimization. We don't count tokens or words, only the final result." },
  ],
};

function FaqItem({ question, answer, index }: { question: string; answer: string; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.07 }}
      className="border-b border-white/[0.06] last:border-b-0"
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-5 px-1 text-left group cursor-pointer"
      >
        <span className="text-[15px] font-semibold text-white pr-4 group-hover:text-primary transition-colors duration-200">
          {question}
        </span>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.25 }}
          className="shrink-0"
        >
          <ChevronDown className="h-4 w-4 text-muted-foreground/50" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <p className="text-sm text-[#D1D5DB] leading-[1.8] pb-5 px-1">
              {answer}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function SectionFaq() {
  const { lang } = useI18n();
  const items = lang === "ru" ? faqData.ru : faqData.en;

  return (
    <section id="faq" className="relative py-32 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[400px] rounded-full bg-primary/[0.03] blur-[250px]" />

      <div className="relative z-10 container mx-auto px-6 max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 mb-6">
            <HelpCircle className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-mono font-medium text-primary uppercase tracking-wider">FAQ</span>
          </div>
          <h2
            className="text-4xl sm:text-5xl font-black leading-[0.95]"
            style={{ letterSpacing: "-0.06em", textShadow: "0 0 80px rgba(139,92,246,0.08)" }}
          >
            {lang === "ru" ? "Частые вопросы" : "Frequently asked questions"}
          </h2>
        </motion.div>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] backdrop-blur-2xl p-6 sm:p-8 shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
          {items.map((item, i) => (
            <FaqItem key={i} question={item.q} answer={item.a} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
