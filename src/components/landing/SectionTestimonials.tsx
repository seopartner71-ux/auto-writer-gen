import { useI18n } from "@/shared/hooks/useI18n";
import { motion, AnimatePresence } from "framer-motion";
import { Quote, Flame, Star, Zap, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";

const testimonials = {
  ru: [
    {
      quote: 'Спросите ChatGPT о бассейнах — он даст урок химии. Спросите <span class="text-primary font-bold">SERPblueprint</span> — он расскажет про тарифы на свет в Аризоне, мусор от деревьев <span class="text-amber-400 font-bold">Palo Verde</span> и выживание в жару <span class="text-red-400 font-bold">115°F</span>. В этом разница между райтером и экспертом.',
      author: "Алексей М.",
      role: "SEO-директор, агентство",
      icon: Flame,
    },
    {
      quote: 'За первый месяц мы вывели <span class="text-primary font-bold">47 статей</span> в топ-10. Модуль Factory + Persona Engine дал нам масштаб <span class="text-amber-400 font-bold">без потери качества</span>. Это не генератор текстов — это инженерная система.',
      author: "Мария К.",
      role: "Контент-маркетолог",
      icon: Star,
    },
    {
      quote: 'GEO Radar показал, что <span class="text-primary font-bold">Perplexity</span> уже цитирует наши статьи как первоисточник. Мы буквально <span class="text-emerald-400 font-bold">обучаем нейросети</span> рекомендовать наш бренд. Это следующий уровень SEO.',
      author: "Дмитрий В.",
      role: "Founder, SaaS-стартап",
      icon: Zap,
    },
  ],
  en: [
    {
      quote: 'Ask ChatGPT about pools — you\'ll get a chemistry lesson. Ask <span class="text-primary font-bold">SERPblueprint</span> — it\'ll tell you about electricity rates in Arizona, debris from <span class="text-amber-400 font-bold">Palo Verde</span> trees, and surviving <span class="text-red-400 font-bold">115°F</span> heat. That\'s the difference between a writer and an expert.',
      author: "Alex M.",
      role: "SEO Director, Agency",
      icon: Flame,
    },
    {
      quote: 'In the first month we pushed <span class="text-primary font-bold">47 articles</span> into the top 10. Factory + Persona Engine gave us scale <span class="text-amber-400 font-bold">without losing quality</span>. This isn\'t a text generator — it\'s an engineering system.',
      author: "Maria K.",
      role: "Content Marketer",
      icon: Star,
    },
    {
      quote: 'GEO Radar showed that <span class="text-primary font-bold">Perplexity</span> already cites our articles as a primary source. We\'re literally <span class="text-emerald-400 font-bold">training neural networks</span> to recommend our brand. This is next-level SEO.',
      author: "Dmitry V.",
      role: "Founder, SaaS Startup",
      icon: Zap,
    },
  ],
};

const badgeText = { ru: "Отзывы клиентов", en: "Client Reviews" };
const headingText = {
  ru: "Разница между райтером и экспертом",
  en: "The Difference Between a Writer and an Expert",
};

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 300 : -300, opacity: 0, scale: 0.95 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -300 : 300, opacity: 0, scale: 0.95 }),
};

export function SectionTestimonials() {
  const { lang } = useI18n();
  const items = testimonials[lang] || testimonials.en;
  const [[current, direction], setCurrent] = useState([0, 0]);

  const paginate = useCallback((dir: number) => {
    setCurrent(([prev]) => {
      const next = (prev + dir + items.length) % items.length;
      return [next, dir];
    });
  }, [items.length]);

  useEffect(() => {
    const timer = setInterval(() => paginate(1), 6000);
    return () => clearInterval(timer);
  }, [paginate]);

  const reviewLd = useMemo(() => {
    const plainText = (html: string) => html.replace(/<[^>]+>/g, "");
    return JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "SERPblueprint v2.0",
      "applicationCategory": "SEO Tool",
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": "4.9",
        "reviewCount": String(items.length),
        "bestRating": "5"
      },
      "review": items.map((item) => ({
        "@type": "Review",
        "author": { "@type": "Person", "name": item.author },
        "reviewBody": plainText(item.quote),
        "reviewRating": { "@type": "Rating", "ratingValue": "5", "bestRating": "5" }
      }))
    });
  }, [items]);

  const t = items[current];
  const Icon = t.icon;

  return (
    <section className="relative py-32 px-4 overflow-hidden">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: reviewLd }} />
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-primary/[0.03] blur-[250px]" />

      <div className="relative max-w-4xl mx-auto">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="flex justify-center mb-8"
        >
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-amber-500/20 bg-amber-500/[0.04] text-amber-400/80 text-xs font-mono uppercase tracking-widest">
            <Flame className="w-3.5 h-3.5" />
            {badgeText[lang] || badgeText.en}
          </span>
        </motion.div>

        {/* Heading */}
        <motion.h2
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="text-4xl md:text-5xl font-extrabold tracking-[-0.03em] text-center text-white mb-16"
        >
          {headingText[lang] || headingText.en}
        </motion.h2>

        {/* Slider */}
        <div className="relative">
          <button
            onClick={() => paginate(-1)}
            className="absolute -left-4 md:-left-14 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full border border-white/[0.06] bg-white/[0.015] flex items-center justify-center text-white/40 hover:text-white/70 hover:border-white/[0.12] transition-all"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => paginate(1)}
            className="absolute -right-4 md:-right-14 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full border border-white/[0.06] bg-white/[0.015] flex items-center justify-center text-white/40 hover:text-white/70 hover:border-white/[0.12] transition-all"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          <div className="relative min-h-[260px] md:min-h-[220px]">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={current}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="absolute inset-0"
              >
                <div className="relative rounded-2xl border border-white/[0.05] bg-white/[0.015] p-8 md:p-10 h-full overflow-hidden">
                  <Quote className="w-7 h-7 text-amber-500/40 mb-5" />

                  <p
                    className="text-base md:text-lg text-white/60 leading-relaxed mb-6"
                    dangerouslySetInnerHTML={{ __html: t.quote }}
                  />

                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                      <Icon className="w-4 h-4 text-primary/70" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white/80">{t.author}</div>
                      <div className="text-xs text-muted-foreground/40 font-mono">{t.role}</div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Dots */}
          <div className="flex justify-center gap-2 mt-8">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent([i, i > current ? 1 : -1])}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === current
                    ? "w-8 bg-primary/70"
                    : "w-1.5 bg-white/15 hover:bg-white/30"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
