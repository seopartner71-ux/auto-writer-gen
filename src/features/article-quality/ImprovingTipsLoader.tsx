import { useEffect, useState } from "react";
import { Sparkles, Lightbulb } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const TIPS_RU = [
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
const TIPS_EN = [
  "Direct Answer First: put the answer in the opening paragraph - Google loves it",
  "H2 phrased as a user question - higher SERP CTR and a shot at People Also Ask",
  "Add a comparison table - readers stay ~40% longer",
  "A FAQ block at the end = +1 chance to hit a featured snippet",
  "LSI words matter more than exact-match - Google understands synonyms",
  "Short paragraphs (2-3 lines) - 70% read on mobile",
  "Numbers and facts in subheadings lift click-through",
  "Internal links to 3-5 related posts strengthen topical authority",
  "Images with descriptive alt text - extra traffic from Google Images",
  "First-hand experience is the top E-E-A-T signal for Google in 2026",
  "Long-tail queries bring purchase-ready visitors",
  "Perplexity and burstiness are what separate human text from AI",
  "A verb at the start of the title = +12% CTR (Learn, Do, Check)",
  "An expert quote or case study lowers bounce rate",
  "Schema.org FAQ and HowTo markup is a fast track to rich snippets",
  "Lists (ul/ol) scan 3x faster than solid text",
  "Add a micro-CTA in the middle of the article, not only at the end",
  "Freshness matters: refresh older posts every 6 months",
  "Title under 60 characters isn't truncated in the SERP",
  "Meta description 140-160 chars with a clear call to action",
  "Relevant emojis in social headlines - but not in the article title",
  "Page speed < 2.5s is a direct ranking factor",
  "Video or GIF holds a user 2x longer",
  "Don't repeat the keyword in every paragraph - hasn't worked since 2015",
];

export function ImprovingTipsLoader({ label }: { label?: string }) {
  const { t, lang } = useI18n();
  const tips = lang === "en" ? TIPS_EN : TIPS_RU;
  const finalLabel = label ?? t("qic.tips.label");
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * tips.length));
  const [dots, setDots] = useState("");

  useEffect(() => {
    const tipTimer = setInterval(() => {
      setIdx((i) => (i + 1) % tips.length);
    }, 4500);
    const dotTimer = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 400);
    return () => {
      clearInterval(tipTimer);
      clearInterval(dotTimer);
    };
  }, [tips.length]);

  return (
    <div className="rounded-xl border border-primary/30 bg-card/95 backdrop-blur-md shadow-2xl p-5 max-w-md w-full mx-4">
      <div className="flex items-center gap-2.5 pb-3 border-b border-border/60">
        <div className="relative">
          <Sparkles className="h-4 w-4 text-primary animate-pulse" />
          <div className="absolute inset-0 h-4 w-4 rounded-full bg-primary/30 blur-md animate-pulse" />
        </div>
        <span className="text-sm font-semibold text-foreground">
          {finalLabel}<span className="text-primary inline-block w-4">{dots}</span>
        </span>
      </div>
      <div className="pt-3 flex gap-2.5">
        <Lightbulb className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1 min-h-[3.5rem]">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
            {t("qic.tips.heading")}
          </div>
          <div
            key={idx}
            className="text-[13px] leading-relaxed text-foreground/90 animate-in fade-in slide-in-from-bottom-1 duration-500"
          >
            {tips[idx]}
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