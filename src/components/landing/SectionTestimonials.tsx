import { useI18n } from "@/shared/hooks/useI18n";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Flame, Quote } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

const testimonials = {
  ru: [
    { quote: "Спросите ChatGPT о бассейнах — он даст урок химии. Спросите СЕО-Модуль — он расскажет про тарифы на свет в Аризоне. В этом разница.", author: "Алексей М.", role: "SEO-директор, агентство", img: "https://i.pravatar.cc/150?img=11" },
    { quote: "За первый месяц мы вывели 47 статей в топ-10. Factory + Persona Engine дал масштаб без потери качества.", author: "Мария К.", role: "Контент-маркетолог", img: "https://i.pravatar.cc/150?img=5" },
    { quote: "GEO Radar показал, что Perplexity цитирует наши статьи как первоисточник. Мы обучаем нейросети рекомендовать наш бренд.", author: "Дмитрий В.", role: "Founder, SaaS-стартап", img: "https://i.pravatar.cc/150?img=12" },
    { quote: "Stealth Engine — это магия. 1.57% AI detection на выходе. Ни один детектор не может отличить от человеческого текста.", author: "Ирина С.", role: "Копирайтер, фриланс", img: "https://i.pravatar.cc/150?img=9" },
    { quote: "Раньше одна статья занимала 4 часа. Сейчас — 15 минут. И качество выше, чем у штатных авторов.", author: "Олег Н.", role: "Руководитель контент-отдела", img: "https://i.pravatar.cc/150?img=14" },
    { quote: "Smart Research — это как иметь аналитика, который за минуту разбирает весь ТОП-10 и выдаёт стратегию.", author: "Анна Т.", role: "SEO-специалист", img: "https://i.pravatar.cc/150?img=16" },
    { quote: "Мы подключили WordPress Auto-Publish и забыли о рутине. Контент выходит по расписанию без нашего участия.", author: "Павел Д.", role: "Владелец интернет-магазина", img: "https://i.pravatar.cc/150?img=53" },
    { quote: "Persona Engine идеально скопировал мой стиль. Клиенты не отличают мои тексты от сгенерированных.", author: "Елена Р.", role: "Блогер, автор", img: "https://i.pravatar.cc/150?img=23" },
    { quote: "100 статей за неделю через Factory. Раньше это заняло бы 3 месяца у команды из 5 человек.", author: "Сергей Л.", role: "CEO, контент-агентство", img: "https://i.pravatar.cc/150?img=33" },
    { quote: "Лучший инструмент для GEO-оптимизации. Мы первые в AI-ответах по нашей нише.", author: "Наталья Ф.", role: "Digital-маркетолог", img: "https://i.pravatar.cc/150?img=44" },
    { quote: "1 кредит = 1 статья экспертного уровня. Никаких скрытых лимитов на токены. Честная модель.", author: "Виктор К.", role: "Предприниматель", img: "https://i.pravatar.cc/150?img=51" },
    { quote: "Поддержка отвечает моментально. Ощущение, что работаешь с командой, а не с сервисом.", author: "Юлия Б.", role: "Менеджер проектов", img: "https://i.pravatar.cc/150?img=32" },
  ],
  en: [
    { quote: "Ask ChatGPT about pools — you get a chemistry lesson. Ask СЕО-Модуль — it tells you about electricity rates in Arizona. That's the difference.", author: "Alex M.", role: "SEO Director, Agency", img: "https://i.pravatar.cc/150?img=11" },
    { quote: "In the first month we pushed 47 articles into the top 10. Factory + Persona Engine gave us scale without losing quality.", author: "Maria K.", role: "Content Marketer", img: "https://i.pravatar.cc/150?img=5" },
    { quote: "GEO Radar showed that Perplexity already cites our articles as a primary source. We're training neural networks to recommend our brand.", author: "Dmitry V.", role: "Founder, SaaS Startup", img: "https://i.pravatar.cc/150?img=12" },
    { quote: "Stealth Engine is magic. 1.57% AI detection on output. No detector can tell it apart from human text.", author: "Irina S.", role: "Freelance Copywriter", img: "https://i.pravatar.cc/150?img=9" },
    { quote: "One article used to take 4 hours. Now — 15 minutes. And the quality is higher than our in-house writers.", author: "Oleg N.", role: "Content Team Lead", img: "https://i.pravatar.cc/150?img=14" },
    { quote: "Smart Research is like having an analyst who breaks down the entire Top 10 in a minute and delivers a strategy.", author: "Anna T.", role: "SEO Specialist", img: "https://i.pravatar.cc/150?img=16" },
    { quote: "We connected WordPress Auto-Publish and forgot about routine. Content goes live on schedule without us.", author: "Pavel D.", role: "E-commerce Owner", img: "https://i.pravatar.cc/150?img=53" },
    { quote: "Persona Engine perfectly copied my style. Clients can't tell my texts from generated ones.", author: "Elena R.", role: "Blogger, Author", img: "https://i.pravatar.cc/150?img=23" },
    { quote: "100 articles in a week via Factory. Previously that would've taken 3 months with a team of 5.", author: "Sergey L.", role: "CEO, Content Agency", img: "https://i.pravatar.cc/150?img=33" },
    { quote: "Best tool for GEO optimization. We're first in AI answers for our niche.", author: "Natalia F.", role: "Digital Marketer", img: "https://i.pravatar.cc/150?img=44" },
    { quote: "1 credit = 1 expert-level article. No hidden token limits. Honest pricing model.", author: "Victor K.", role: "Entrepreneur", img: "https://i.pravatar.cc/150?img=51" },
    { quote: "Support responds instantly. Feels like working with a team, not a service.", author: "Julia B.", role: "Project Manager", img: "https://i.pravatar.cc/150?img=32" },
  ],
};

const badgeText = { ru: "ОТЗЫВЫ КЛИЕНТОВ", en: "CLIENT REVIEWS" };
const headingText = {
  ru: "Разница между райтером и экспертом",
  en: "The Difference Between a Writer and an Expert",
};

interface CardProps {
  position: number;
  item: { quote: string; author: string; role: string; img: string };
  handleMove: (steps: number) => void;
  cardSize: number;
}

function TestimonialCard({ position, item, handleMove, cardSize }: CardProps) {
  const isCenter = position === 0;

  return (
    <motion.div
      key={item.quote}
      initial={false}
      animate={{
        x: `calc(-50% + ${(cardSize / 1.5) * position}px)`,
        y: `calc(-50% + ${isCenter ? -50 : position % 2 ? 15 : -15}px)`,
        rotate: isCenter ? 0 : position % 2 ? 2.5 : -2.5,
        scale: isCenter ? 1 : 0.92,
        opacity: Math.abs(position) > 3 ? 0 : 1,
      }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => handleMove(position)}
      className={cn(
        "absolute left-1/2 top-1/2 cursor-pointer p-6 sm:p-8 transition-colors duration-500 rounded-2xl border backdrop-blur-xl",
        isCenter
          ? "z-10 bg-white/[0.04] border-primary/40 shadow-[0_0_40px_rgba(139,92,246,0.12)]"
          : "z-0 bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]"
      )}
      style={{
        width: cardSize,
        height: cardSize,
      }}
    >
      <Quote className={cn(
        "w-8 h-8 mb-4 shrink-0",
        isCenter ? "text-primary/70" : "text-white/10"
      )} />

      <p className={cn(
        "text-sm sm:text-[15px] leading-relaxed mb-6 line-clamp-5",
        isCenter ? "text-white/90" : "text-white/40"
      )}>
        "{item.quote}"
      </p>

      <div className="absolute bottom-6 left-6 sm:left-8 right-6 sm:right-8">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center border shrink-0",
            isCenter
              ? "bg-primary/20 border-primary/30"
              : "bg-white/[0.03] border-white/[0.06]"
          )}>
            <Flame className={cn("w-4 h-4", isCenter ? "text-primary" : "text-white/20")} />
          </div>
          <div className="min-w-0">
            <div className={cn(
              "text-sm font-semibold truncate",
              isCenter ? "text-white" : "text-white/30"
            )}>{item.author}</div>
            <div className={cn(
              "text-[11px] font-mono truncate",
              isCenter ? "text-white/50" : "text-white/15"
            )}>{item.role}</div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function SectionTestimonials() {
  const { lang } = useI18n();
  const allItems = testimonials[lang] || testimonials.en;
  const [list, setList] = useState(allItems);
  const [cardSize, setCardSize] = useState(340);

  useEffect(() => {
    setList(testimonials[lang] || testimonials.en);
  }, [lang]);

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      setCardSize(w < 640 ? 260 : w < 1024 ? 300 : 340);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const handleMove = (steps: number) => {
    if (steps === 0) return;
    setList(prev => {
      const arr = [...prev];
      if (steps > 0) {
        for (let i = 0; i < steps; i++) {
          const item = arr.shift();
          if (item) arr.push(item);
        }
      } else {
        for (let i = 0; i < Math.abs(steps); i++) {
          const item = arr.pop();
          if (item) arr.unshift(item);
        }
      }
      return arr;
    });
  };

  return (
    <section className="relative py-32 px-4 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full bg-primary/[0.04] blur-[200px]" />

      <div className="relative max-w-5xl mx-auto">
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
          className="text-4xl md:text-5xl lg:text-6xl font-black tracking-[-0.06em] text-center text-white mb-20"
          style={{ textShadow: "0 0 60px hsl(var(--primary) / 0.15)" }}
        >
          {headingText[lang] || headingText.en}
        </motion.h2>

        {/* Stagger Cards */}
        <div className="relative h-[400px] sm:h-[420px] flex items-center justify-center">
          {list.map((item, index) => {
            const center = Math.floor(list.length / 2);
            const position = index - center;
            return (
              <TestimonialCard
                key={item.author + item.role}
                position={position}
                item={item}
                handleMove={handleMove}
                cardSize={cardSize}
              />
            );
          })}
        </div>

        {/* Navigation */}
        <div className="flex justify-center gap-3 mt-8">
          <button
            onClick={() => handleMove(-1)}
            className="w-12 h-12 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur-sm flex items-center justify-center text-white/50 hover:text-white hover:border-primary/40 hover:bg-primary/10 transition-all"
            aria-label="Previous"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => handleMove(1)}
            className="w-12 h-12 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur-sm flex items-center justify-center text-white/50 hover:text-white hover:border-primary/40 hover:bg-primary/10 transition-all"
            aria-label="Next"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </section>
  );
}
