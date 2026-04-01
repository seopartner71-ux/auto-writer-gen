import { useI18n } from "@/shared/hooks/useI18n";
import { motion } from "framer-motion";
import { Quote, Flame, Star, Zap } from "lucide-react";

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

export function SectionTestimonials() {
  const { lang } = useI18n();
  const items = testimonials[lang] || testimonials.en;

  return (
    <section className="relative py-32 px-4 overflow-hidden">
      {/* Glow */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full bg-primary/[0.04] blur-[200px]" />

      <div className="relative max-w-5xl mx-auto">
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
          className="text-4xl md:text-5xl font-extrabold tracking-[-0.05em] text-center text-white italic mb-16"
          style={{ textShadow: "0 0 40px hsl(var(--primary) / 0.15)" }}
        >
          {headingText[lang] || headingText.en}
        </motion.h2>

        {/* Testimonials */}
        <div className="flex flex-col gap-8">
          {items.map((t, i) => {
            const Icon = t.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15 }}
                className="relative group"
              >
                <div className="relative rounded-2xl border border-t-white/[0.08] border-l-white/[0.05] border-r-white/[0.03] border-b-white/[0.01] bg-white/[0.02] backdrop-blur-xl p-8 md:p-10 overflow-hidden transition-all duration-500 hover:bg-white/[0.04] hover:border-t-white/[0.12]">
                  {/* Subtle corner glow */}
                  <div className="pointer-events-none absolute -top-20 -left-20 w-40 h-40 rounded-full bg-primary/[0.06] blur-[80px] opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

                  {/* Quote icon */}
                  <Quote className="w-8 h-8 text-amber-500/60 mb-5" />

                  {/* Quote text */}
                  <p
                    className="text-base md:text-lg text-slate-300 leading-relaxed mb-6"
                    dangerouslySetInnerHTML={{ __html: t.quote }}
                  />

                  {/* Author */}
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
                      <Icon className="w-4.5 h-4.5 text-primary" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">{t.author}</div>
                      <div className="text-xs text-slate-500 font-mono">{t.role}</div>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
