import { useI18n } from "@/shared/hooks/useI18n";
import { motion, AnimatePresence } from "framer-motion";
import { Quote, Flame, Star, Zap, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";

const testimonials = {
  ru: [
    {
      quote: 'Спросите ChatGPT о бассейнах — он даст урок химии. Спросите <span class="text-primary font-bold">Auto-Writer-Gen</span> — он расскажет про тарифы на свет в Аризоне, мусор от деревьев <span class="text-amber-400 font-bold">Palo Verde</span> и выживание в жару <span class="text-red-400 font-bold">115°F</span>. В этом разница между райтером и экспертом.',
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
      quote: 'Ask ChatGPT about pools — you\'ll get a chemistry lesson. Ask <span class="text-primary font-bold">Auto-Writer-Gen</span> — it\'ll tell you about electricity rates in Arizona, debris from <span class="text-amber-400 font-bold">Palo Verde</span> trees, and surviving <span class="text-red-400 font-bold">115°F</span> heat. That\'s the difference between a writer and an expert.',
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

const badgeText = { ru: "Доказательство экспертности", en: "Proof of Expertise" };
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

  // Auto-advance every 6s
  useEffect(() => {
    const timer = setInterval(() => paginate(1), 6000);
    return () => clearInterval(timer);
  }, [paginate]);

  // JSON-LD Review schema
  const reviewLd = useMemo(() => {
    const plainText = (html: string) => html.replace(/<[^>]+>/g, "");
    return JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "SERPblueprint v2.4",
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
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full bg-primary/[0.04] blur-[200px]" />

      <div className="relative max-w-4xl mx-auto">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="flex justify-center mb-8"
        >
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-mono uppercase tracking-widest">
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
          className="text-4xl md:text-6xl font-black tracking-[-0.04em] text-center text-white mb-16"
          style={{ textShadow: "0 0 40px hsl(var(--primary) / 0.15)" }}
        >
          {headingText[lang] || headingText.en}
        </motion.h2>

        {/* Slider */}
        <div className="relative">
          {/* Arrows */}
          <button
            onClick={() => paginate(-1)}
            className="absolute -left-4 md:-left-14 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur-md flex items-center justify-center text-white/60 hover:text-white hover:border-white/20 transition-all"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => paginate(1)}
            className="absolute -right-4 md:-right-14 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur-md flex items-center justify-center text-white/60 hover:text-white hover:border-white/20 transition-all"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          {/* Card */}
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
                <div className="relative rounded-2xl border border-t-white/[0.08] border-l-white/[0.05] border-r-white/[0.03] border-b-white/[0.01] bg-white/[0.02] backdrop-blur-xl p-8 md:p-10 h-full overflow-hidden group">
                  <div className="pointer-events-none absolute -top-20 -left-20 w-40 h-40 rounded-full bg-primary/[0.06] blur-[80px]" />

                  <Quote className="w-8 h-8 text-amber-500/60 mb-5" />

                  <p
                    className="text-base md:text-lg text-slate-300 leading-relaxed mb-6"
                    dangerouslySetInnerHTML={{ __html: t.quote }}
                  />

                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
                      <Icon className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">{t.author}</div>
                      <div className="text-xs text-slate-500 font-mono">{t.role}</div>
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
                    ? "w-8 bg-primary"
                    : "w-1.5 bg-white/20 hover:bg-white/40"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
