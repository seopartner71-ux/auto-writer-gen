import { useI18n } from "@/shared/hooks/useI18n";
import { motion, AnimatePresence } from "framer-motion";
import { Quote, ChevronLeft, ChevronRight, Flame } from "lucide-react";
import { useState, useCallback, useEffect } from "react";

const testimonials = {
  ru: [
    {
      quote: 'Спросите ChatGPT о бассейнах - он даст урок химии. Спросите <span class="text-primary font-bold">SERPblueprint</span> - он расскажет про тарифы на свет в Аризоне, мусор от деревьев <span class="text-amber-400 font-bold">Palo Verde</span> и выживание в жару <span class="text-red-400 font-bold">115°F</span>. В этом разница между райтером и экспертом.',
      author: "Алексей М.",
      role: "SEO-директор, агентство",
    },
    {
      quote: 'За первый месяц мы вывели <span class="text-primary font-bold">47 статей</span> в топ-10. Модуль Factory + Persona Engine дал нам масштаб <span class="text-amber-400 font-bold">без потери качества</span>. Это не генератор текстов - это инженерная система.',
      author: "Мария К.",
      role: "Контент-маркетолог",
    },
    {
      quote: 'GEO Radar показал, что <span class="text-primary font-bold">Perplexity</span> уже цитирует наши статьи как первоисточник. Мы буквально <span class="text-emerald-400 font-bold">обучаем нейросети</span> рекомендовать наш бренд. Это следующий уровень SEO.',
      author: "Дмитрий В.",
      role: "Founder, SaaS-стартап",
    },
  ],
  en: [
    {
      quote: 'Ask ChatGPT about pools - you\'ll get a chemistry lesson. Ask <span class="text-primary font-bold">SERPblueprint</span> - it\'ll tell you about electricity rates in Arizona, debris from <span class="text-amber-400 font-bold">Palo Verde</span> trees, and surviving <span class="text-red-400 font-bold">115°F</span> heat. That\'s the difference between a writer and an expert.',
      author: "Alex M.",
      role: "SEO Director, Agency",
    },
    {
      quote: 'In the first month we pushed <span class="text-primary font-bold">47 articles</span> into the top 10. Factory + Persona Engine gave us scale <span class="text-amber-400 font-bold">without losing quality</span>. This isn\'t a text generator - it\'s an engineering system.',
      author: "Maria K.",
      role: "Content Marketer",
    },
    {
      quote: 'GEO Radar showed that <span class="text-primary font-bold">Perplexity</span> already cites our articles as a primary source. We\'re literally <span class="text-emerald-400 font-bold">training neural networks</span> to recommend our brand. This is next-level SEO.',
      author: "Dmitry V.",
      role: "Founder, SaaS Startup",
    },
  ],
};

const badgeText = { ru: "ОТЗЫВЫ КЛИЕНТОВ", en: "CLIENT REVIEWS" };
const headingText = {
  ru: "Разница между райтером и экспертом",
  en: "The Difference Between a Writer and an Expert",
};

export function SectionTestimonials() {
  const { lang } = useI18n();
  const items = testimonials[lang] || testimonials.en;
  const [current, setCurrent] = useState(0);

  const next = useCallback(() => setCurrent((p) => (p + 1) % items.length), [items.length]);
  const prev = useCallback(() => setCurrent((p) => (p - 1 + items.length) % items.length), [items.length]);

  useEffect(() => {
    const id = setInterval(next, 6000);
    return () => clearInterval(id);
  }, [next]);

  const t = items[current];

  return (
    <section className="relative py-32 px-4 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full bg-primary/[0.04] blur-[200px]" />

      <div className="relative max-w-4xl mx-auto">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="flex justify-center mb-8"
        >
          <span className="inline-flex items-center gap-2 px-5 py-2 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-mono uppercase tracking-[0.2em]">
            <Flame className="w-3.5 h-3.5" />
            {badgeText[lang] || badgeText.en}
          </span>
        </motion.div>

        {/* Heading */}
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="text-4xl md:text-5xl lg:text-6xl font-black tracking-[-0.06em] text-center text-white mb-16"
          style={{ textShadow: "0 0 60px hsl(var(--primary) / 0.15)" }}
        >
          {headingText[lang] || headingText.en}
        </motion.h2>

        {/* Carousel */}
        <div className="relative flex items-center gap-4">
          {/* Prev */}
          <button
            onClick={prev}
            className="shrink-0 w-10 h-10 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur-sm flex items-center justify-center text-white/50 hover:text-white hover:border-white/20 transition-all"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          {/* Card */}
          <div className="flex-1 min-h-[240px] relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={current}
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{ duration: 0.35 }}
                className="relative rounded-2xl border border-t-white/[0.1] border-l-white/[0.06] border-r-white/[0.03] border-b-white/[0.01] bg-white/[0.02] backdrop-blur-xl p-8 md:p-10 overflow-hidden"
              >
                <div className="pointer-events-none absolute -top-20 -left-20 w-40 h-40 rounded-full bg-primary/[0.06] blur-[80px]" />

                <Quote className="w-10 h-10 text-amber-500/70 mb-6" />

                <p
                  className="text-base md:text-lg lg:text-xl text-slate-300 leading-relaxed mb-8"
                  dangerouslySetInnerHTML={{ __html: t.quote }}
                />

                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
                    <Flame className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">{t.author}</div>
                    <div className="text-xs text-slate-500 font-mono">{t.role}</div>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Next */}
          <button
            onClick={next}
            className="shrink-0 w-10 h-10 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur-sm flex items-center justify-center text-white/50 hover:text-white hover:border-white/20 transition-all"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Dots */}
        <div className="flex justify-center gap-2 mt-6">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === current ? "w-8 bg-primary" : "w-3 bg-white/20"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
