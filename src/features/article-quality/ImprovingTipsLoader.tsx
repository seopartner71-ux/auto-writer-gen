import { useEffect, useState } from "react";
import { Sparkles, Lightbulb } from "lucide-react";

const TIPS = [
  "Direct Answer First: дайте ответ в первом абзаце - Google любит это",
  "H2 как вопрос пользователя - выше CTR в SERP и шанс попасть в People Also Ask",
  "Добавьте таблицу сравнения - удерживает читателя на 40% дольше",
  "FAQ-блок в конце статьи = +1 шанс попасть в featured snippet",
  "LSI-слова важнее точного вхождения ключа - Google понимает синонимы",
  "Короткие абзацы (2-3 строки) - 70% читают со смартфона",
  "Цифры и факты в подзаголовках повышают кликабельность",
  "Внутренняя перелинковка на 3-5 статей укрепляет тематический авторитет",
  "Картинка с описательным alt-текстом - +шанс трафика из Google Images",
  "Уникальный личный опыт - главный сигнал E-E-A-T для Google в 2026",
  "Длинный хвост (long-tail) приводит готовых к покупке посетителей",
  "Перплексия и burstiness - то, что отличает живой текст от AI-сгенерированного",
  "Глагол в начале заголовка = +12% CTR (Узнайте, Сделайте, Проверьте)",
  "Цитата эксперта или кейс из практики снижает показатель отказов",
  "Schema.org разметка FAQ и HowTo - быстрый путь к расширенным сниппетам",
  "Списки (ul/ol) сканируются глазами в 3 раза быстрее сплошного текста",
  "Добавьте микро-CTA в середине статьи, а не только в конце",
  "Свежесть контента важна: обновляйте старые статьи раз в 6 месяцев",
  "Заголовок до 60 символов - не обрезается в выдаче",
  "Meta description 140-160 символов с призывом к действию",
  "Релевантные emoji в заголовках в соцсетях - но не в title статьи",
  "Скорость загрузки < 2.5 сек - прямой фактор ранжирования",
  "Видео или GIF удерживают пользователя в 2 раза дольше",
  "Не дублируйте ключ в каждом абзаце - это уже не работает с 2015",
];

export function ImprovingTipsLoader({ label = "Улучшаем текст..." }: { label?: string }) {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [dots, setDots] = useState("");

  useEffect(() => {
    const tipTimer = setInterval(() => {
      setIdx((i) => (i + 1) % TIPS.length);
    }, 4500);
    const dotTimer = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 400);
    return () => {
      clearInterval(tipTimer);
      clearInterval(dotTimer);
    };
  }, []);

  return (
    <div className="rounded-xl border border-primary/30 bg-card/95 backdrop-blur-md shadow-2xl p-5 max-w-md w-full mx-4">
      <div className="flex items-center gap-2.5 pb-3 border-b border-border/60">
        <div className="relative">
          <Sparkles className="h-4 w-4 text-primary animate-pulse" />
          <div className="absolute inset-0 h-4 w-4 rounded-full bg-primary/30 blur-md animate-pulse" />
        </div>
        <span className="text-sm font-semibold text-foreground">
          {label}<span className="text-primary inline-block w-4">{dots}</span>
        </span>
      </div>
      <div className="pt-3 flex gap-2.5">
        <Lightbulb className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1 min-h-[3.5rem]">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
            Пока ждете - SEO совет
          </div>
          <div
            key={idx}
            className="text-[13px] leading-relaxed text-foreground/90 animate-in fade-in slide-in-from-bottom-1 duration-500"
          >
            {TIPS[idx]}
          </div>
        </div>
      </div>
      <div className="mt-3 h-1 rounded-full bg-border/60 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-primary via-purple-500 to-primary bg-[length:200%_100%] animate-[shimmer_2s_linear_infinite]" />
      </div>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
    </div>
  );
}