import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles } from "lucide-react";

interface Tip { id: string; tip: string; category: string; }

interface Props {
  language?: "ru" | "en";
  intervalMs?: number;
}

const FALLBACK_RU: Tip[] = [
  { id: "f1", category: "geo", tip: "Direct Answer First: первые 50 слов - прямой ответ на запрос. Это шанс попасть в Featured Snippet." },
  { id: "f2", category: "quality", tip: "Уникальность от 90% - стандарт для ТОП-10. AI-детектор - менее 30%." },
  { id: "f3", category: "best-practices", tip: "Title до 60 символов, ключ в первых 30. Google обрезает длинные заголовки." },
];
const FALLBACK_EN: Tip[] = [
  { id: "f1", category: "geo", tip: "Direct Answer First: opening 50 words must answer the query. Wins Featured Snippets." },
  { id: "f2", category: "quality", tip: "Uniqueness above 90% is the bar for top-10. AI detector below 30%." },
  { id: "f3", category: "best-practices", tip: "Keep titles under 60 chars, keyword in first 30." },
];

export function SeoTipTicker({ language = "ru", intervalMs = 8000 }: Props) {
  const [tips, setTips] = useState<Tip[]>(language === "ru" ? FALLBACK_RU : FALLBACK_EN);
  const [idx, setIdx] = useState(0);
  const [fade, setFade] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const { data } = await supabase
        .from("seo_tips")
        .select("id,tip,category")
        .eq("language", language)
        .eq("is_active", true)
        .limit(200);
      if (!mounted.current || !data || data.length === 0) return;
      // language sanity filter: ru must contain cyrillic, en must NOT
      const cyr = /[А-Яа-я]/;
      const filtered = (data as Tip[]).filter((t) =>
        language === "ru" ? cyr.test(t.tip) : !cyr.test(t.tip)
      );
      const pool = filtered.length > 0 ? filtered : (data as Tip[]);
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      setTips(shuffled);
      setIdx(0);
    })();
    return () => { mounted.current = false; };
  }, [language]);

  useEffect(() => {
    if (tips.length <= 1) return;
    const t = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        if (!mounted.current) return;
        setIdx((i) => (i + 1) % tips.length);
        setFade(true);
      }, 280);
    }, intervalMs);
    return () => clearInterval(t);
  }, [tips, intervalMs]);

  const current = tips[idx];
  if (!current) return null;

  return (
    <div className="group relative mt-3 overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-fuchsia-500/[0.06] to-blue-500/10 p-[1px] shadow-[0_0_24px_-12px_hsl(var(--primary)/0.6)]">
      {/* animated sheen */}
      <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.07] to-transparent group-hover:translate-x-full motion-safe:animate-[shimmer_4s_ease-in-out_infinite]" />
      <div className="relative rounded-[11px] bg-background/80 px-4 py-3 backdrop-blur-md">
        <div className="flex items-start gap-3">
          <div className="relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/30 to-fuchsia-500/30 text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="absolute inset-0 rounded-lg ring-1 ring-primary/30" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="bg-gradient-to-r from-primary via-fuchsia-400 to-blue-400 bg-clip-text text-[10px] font-bold uppercase tracking-[0.14em] text-transparent">
                {language === "ru" ? "СЕО-совет" : "SEO tip"}
              </span>
              <span className="rounded-full border border-border/50 bg-muted/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/80">
                {current.category}
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground/60">
                {language === "ru" ? "пока идет генерация" : "while generating"}
              </span>
            </div>
            <div
              key={current.id}
              className={`mt-1 text-[13px] leading-relaxed text-foreground/90 transition-all duration-300 ${
                fade ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
              }`}
            >
              {current.tip}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}