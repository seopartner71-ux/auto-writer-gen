import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Lightbulb } from "lucide-react";

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
      // shuffle
      const shuffled = [...data].sort(() => Math.random() - 0.5);
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
    <div className="mt-2 overflow-hidden rounded-lg border border-border/40 bg-gradient-to-r from-primary/5 via-fuchsia-500/5 to-blue-500/5 px-3 py-2 backdrop-blur-sm">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Lightbulb className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">
              {language === "ru" ? "СЕО-совет" : "SEO tip"}
            </span>
            <span className="text-[10px] text-muted-foreground/70">- {current.category}</span>
          </div>
          <div
            className={`mt-0.5 text-xs leading-snug text-foreground/90 transition-opacity duration-300 ${fade ? "opacity-100" : "opacity-0"}`}
          >
            {current.tip}
          </div>
        </div>
      </div>
    </div>
  );
}