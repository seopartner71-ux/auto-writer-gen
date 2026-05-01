import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Check, Loader2, Sparkles, Trophy, Zap, ShieldCheck, Timer } from "lucide-react";

const KEYWORDS = [
  "как выбрать ноутбук",
  "продвижение сайта",
  "SEO оптимизация",
  "контент маркетинг",
];

const ARTICLE_VARIANTS: Record<string, string[]> = {
  "как выбрать ноутбук": [
    "# Как выбрать ноутбук в 2026 году",
    "",
    "Ноутбук подбирают под задачу, а не под бренд. Иначе переплатите 30-50% за функции, которыми не воспользуетесь.",
    "",
    "## Ключевые параметры",
    "",
    "Процессор отвечает за скорость, ОЗУ - за многозадачность, SSD - за отзывчивость. Для офиса хватит 16 ГБ и 512 ГБ.",
  ],
  "продвижение сайта": [
    "# Продвижение сайта в 2026: рабочая стратегия",
    "",
    "SEO в 2026 - это не ссылки и не плотность ключей. Это поведенческие сигналы, E-E-A-T и присутствие в AI Overviews.",
    "",
    "## С чего начать",
    "",
    "Технический аудит, семантическое ядро, контент-план на 3 месяца. Без этих трех шагов любой бюджет уходит в трубу.",
  ],
  "SEO оптимизация": [
    "# SEO оптимизация: что работает в 2026",
    "",
    "Google и Яндекс перешли на оценку пользы для пользователя. Алгоритмы видят, дочитали ли статью и вернулись ли в выдачу.",
    "",
    "## Главные факторы",
    "",
    "Глубина раскрытия темы, скорость загрузки, мобильная адаптация и структурированные данные дают 80% результата.",
  ],
  "контент маркетинг": [
    "# Контент маркетинг: от стратегии к продажам",
    "",
    "Контент без стратегии - это блог ради блога. Каждая статья должна вести читателя к следующему шагу воронки.",
    "",
    "## Принципы рабочего контента",
    "",
    "Один материал - одна задача аудитории. Информационный, коммерческий и удерживающий контент работают вместе.",
  ],
};

const STAGES = [
  { label: "Анализируем конкурентов в Google", duration: 1400 },
  { label: "Извлекаем LSI и семантику", duration: 1200 },
  { label: "Создаем структуру H1-H2-H3", duration: 1300 },
  { label: "Пишем статью с учетом GEO/AI Overviews", duration: 1800 },
  { label: "Гуманизируем текст (Stealth Engine)", duration: 1200 },
];

type Step = "idle" | "typing" | "click" | "stages" | "writing" | "scores" | "cta" | "celebrate";

export function SectionVideoDemo() {
  const [step, setStep] = useState<Step>("idle");
  const [keywordIdx, setKeywordIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [stageIdx, setStageIdx] = useState(-1);
  const [articleText, setArticleText] = useState("");
  const [showScores, setShowScores] = useState(false);
  const [pulseCta, setPulseCta] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [seoCount, setSeoCount] = useState(0);
  const [uniqCount, setUniqCount] = useState(0);
  const [confetti, setConfetti] = useState(false);
  const [keywordFade, setKeywordFade] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const visibleRef = useRef(false);
  const cycleRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const keywordIdxRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          visibleRef.current = e.isIntersecting;
          if (e.isIntersecting && cycleRef.current === null) {
            startCycle();
          }
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (cycleRef.current) window.clearTimeout(cycleRef.current);
      if (timerRef.current) window.clearInterval(timerRef.current);
      cycleRef.current = null;
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetState() {
    setStep("idle");
    setTyped("");
    setStageIdx(-1);
    setArticleText("");
    setShowScores(false);
    setPulseCta(false);
    setSecondsLeft(60);
    setSeoCount(0);
    setUniqCount(0);
    setConfetti(false);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function startCountdown() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
  }

  async function animateNumber(target: number, setter: (n: number) => void, duration = 1400) {
    const start = performance.now();
    return new Promise<void>((resolve) => {
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        setter(Math.round(target * eased));
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  async function runOnce() {
    resetState();
    const kw = KEYWORDS[keywordIdxRef.current % KEYWORDS.length];
    await wait(400);

    setStep("typing");
    startCountdown();
    for (let i = 1; i <= kw.length; i++) {
      if (!visibleRef.current) return;
      setTyped(kw.slice(0, i));
      await wait(80);
    }
    await wait(400);

    setStep("click");
    await wait(700);

    setStep("stages");
    for (let i = 0; i < STAGES.length; i++) {
      if (!visibleRef.current) return;
      setStageIdx(i);
      await wait(STAGES[i].duration);
    }
    setStageIdx(STAGES.length);

    setStep("writing");
    const fullText = (ARTICLE_VARIANTS[kw] ?? ARTICLE_VARIANTS["как выбрать ноутбук"]).join("\n");
    for (let i = 1; i <= fullText.length; i += 2) {
      if (!visibleRef.current) return;
      setArticleText(fullText.slice(0, i));
      await wait(14);
    }
    await wait(400);

    // Final explosion
    setStep("celebrate");
    setConfetti(true);
    setShowScores(true);
    // animate counters in parallel
    animateNumber(87, setSeoCount, 1400);
    animateNumber(94, setUniqCount, 1600);
    await wait(1000);
    setConfetti(false);

    setStep("cta");
    setPulseCta(true);
    await wait(5000); // 5 sec rest then loop

    // fade out keyword and rotate
    setKeywordFade(true);
    await wait(400);
    keywordIdxRef.current = (keywordIdxRef.current + 1) % KEYWORDS.length;
    setKeywordIdx(keywordIdxRef.current);
    setKeywordFade(false);
  }

  function startCycle() {
    const loop = async () => {
      if (!visibleRef.current) {
        cycleRef.current = window.setTimeout(loop, 1500);
        return;
      }
      await runOnce();
      cycleRef.current = window.setTimeout(loop, 300);
    };
    cycleRef.current = window.setTimeout(loop, 200);
  }

  const currentKeyword = KEYWORDS[keywordIdx];

  return (
    <section
      ref={containerRef}
      className="relative py-20 md:py-28 px-4 overflow-hidden"
      aria-labelledby="video-demo-title"
    >
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-[600px] rounded-full bg-primary/10 blur-[120px]" />
      </div>

      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12 md:mb-16">
          <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary mb-4 transition-opacity ${keywordFade ? "opacity-50" : "opacity-100"}`}>
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            Live demo - "{currentKeyword}"
          </div>
          <h2
            id="video-demo-title"
            className="text-3xl md:text-5xl font-bold tracking-tight mb-3"
          >
            Смотрите как это работает
          </h2>
          <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto">
            От ключевого слова до готовой статьи за 60 секунд - без редактирования и доработок
          </p>
        </div>

        <div className="grid lg:grid-cols-[1fr_280px] gap-8 items-start">
          {/* Browser frame */}
          <div className="relative rounded-2xl border border-border/60 bg-[#0a0a0a] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.8)] overflow-hidden">
            {/* Confetti overlay */}
            {confetti && <ConfettiBurst />}

            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-[#101010]">
              <div className="flex gap-1.5">
                <span className="size-3 rounded-full bg-[#ff5f57]" />
                <span className="size-3 rounded-full bg-[#febc2e]" />
                <span className="size-3 rounded-full bg-[#28c840]" />
              </div>
              <div className="flex-1 mx-3 px-3 py-1 rounded-md bg-black/60 text-[11px] text-muted-foreground font-mono truncate">
                seo-modul.pro/quick-start
              </div>
            </div>

            <div className="p-5 md:p-8 min-h-[460px] md:min-h-[540px] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Zap className="size-4 text-primary" />
                  <span className="text-sm font-medium">Quick Start - первая статья</span>
                </div>
              </div>

              {/* Input field */}
              <div className="mb-4">
                <label className="text-xs text-muted-foreground block mb-1.5">
                  Введите ключевое слово
                </label>
                <div className="relative h-11 rounded-lg bg-black/50 border border-border/60 px-3 flex items-center text-sm font-mono">
                  <span className={`text-foreground transition-opacity duration-300 ${keywordFade ? "opacity-0" : "opacity-100"}`}>
                    {typed}
                  </span>
                  {(step === "idle" || step === "typing") && (
                    <span className="ml-0.5 inline-block w-[2px] h-4 bg-primary animate-pulse" />
                  )}
                </div>
              </div>

              {/* CTA button (in-screen) */}
              <div className="mb-5">
                <button
                  type="button"
                  className={`relative w-full h-11 rounded-lg bg-gradient-to-r from-primary to-[#a855f7] text-primary-foreground font-medium text-sm transition-transform overflow-hidden ${
                    step === "click" ? "scale-[0.97]" : ""
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    {(step === "stages" || step === "writing") ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    {step === "stages" || step === "writing" ? "Генерируем..." : "Создать статью"}
                  </span>
                  {step === "click" && (
                    <span className="absolute inset-0 rounded-lg ring-2 ring-primary/60 animate-ping" />
                  )}
                </button>
              </div>

              {/* Stages */}
              {(step === "stages" || step === "writing" || step === "scores" || step === "cta" || step === "celebrate") && (
                <div className="space-y-2 mb-5">
                  {STAGES.map((s, i) => {
                    const done = i < stageIdx || step === "writing" || step === "scores" || step === "cta" || step === "celebrate";
                    const active = i === stageIdx && step === "stages";
                    return (
                      <div
                        key={s.label}
                        className={`flex items-center gap-2 text-xs transition-all duration-300 ${
                          done ? "text-foreground translate-x-0 opacity-100" : active ? "text-foreground opacity-100" : "text-muted-foreground/40 opacity-60"
                        }`}
                        style={{ transitionDelay: `${i * 50}ms` }}
                      >
                        {done ? (
                          <Check className="size-3.5 text-emerald-400 shrink-0" />
                        ) : active ? (
                          <Loader2 className="size-3.5 text-primary animate-spin shrink-0" />
                        ) : (
                          <span className="size-3.5 rounded-full border border-border/60 shrink-0" />
                        )}
                        <span className={active ? "animate-pulse" : ""}>{s.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Article preview */}
              {(step === "writing" || step === "scores" || step === "cta" || step === "celebrate") && (
                <div className="rounded-lg border border-border/40 bg-black/40 p-4 mb-4 flex-1 min-h-[140px] animate-fade-in">
                  <pre className="whitespace-pre-wrap text-[11px] md:text-xs leading-relaxed text-foreground/85 font-sans m-0">
                    {articleText}
                    {step === "writing" && (
                      <span className="inline-block w-[6px] h-3 bg-primary/80 ml-0.5 animate-pulse align-middle" />
                    )}
                  </pre>
                </div>
              )}

              {/* Quality badges */}
              {showScores && (
                <div className="flex flex-wrap gap-2 animate-fade-in">
                  <Badge color="amber" icon={<Trophy className="size-3" />} label={`SEO Score: ${seoCount}/100`} />
                  <Badge color="emerald" icon={<Check className="size-3" />} label={`Уникальность: ${uniqCount}%`} />
                  <Badge color="emerald" icon={<ShieldCheck className="size-3" />} label="AI-детектор: 92% человек" />
                </div>
              )}
            </div>
          </div>

          {/* Side facts */}
          <div className="space-y-4">
            <FactCard
              icon={<Timer className="size-5" />}
              value={`${secondsLeft} сек`}
              label="осталось до готовой статьи"
              accent="primary"
              live
            />
            <FactCard
              icon={<Trophy className="size-5" />}
              value={`${seoCount}/100`}
              label="средний SEO Score"
              accent="amber"
            />
            <FactCard
              icon={<ShieldCheck className="size-5" />}
              value={`${uniqCount}%`}
              label="средняя уникальность текста"
              accent="emerald"
            />
          </div>
        </div>

        {/* Bottom CTA - magnetic */}
        <div className="mt-12 text-center">
          <div className={`inline-block ${pulseCta ? "animate-magnetic" : ""}`}>
            <Button
              asChild
              size="lg"
              className={`h-14 px-8 text-base bg-gradient-to-r from-primary to-[#a855f7] hover:opacity-95 transition-all relative ${
                pulseCta ? "shadow-[0_0_60px_-5px_hsl(var(--primary)/0.7)] animate-glow-pulse" : ""
              }`}
            >
              <Link to="/auth">
                Создать первую статью бесплатно
                <span className="ml-1">-&gt;</span>
              </Link>
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Без карты. 3 статьи в подарок при регистрации.
          </p>
        </div>
      </div>

      {/* Inline keyframes */}
      <style>{`
        @keyframes magnetic {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          25% { transform: translate(-2px, 1px) rotate(-0.5deg); }
          50% { transform: translate(2px, -1px) rotate(0.5deg); }
          75% { transform: translate(-1px, -2px) rotate(-0.3deg); }
        }
        .animate-magnetic { animation: magnetic 2.5s ease-in-out infinite; }
        @keyframes glow-pulse {
          0%, 100% { box-shadow: 0 0 30px -5px hsl(var(--primary) / 0.5); }
          50% { box-shadow: 0 0 60px 0px hsl(var(--primary) / 0.8); }
        }
        .animate-glow-pulse { animation: glow-pulse 2s ease-in-out infinite; }
        @keyframes confetti-fall {
          0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate(var(--tx), var(--ty)) rotate(var(--r)); opacity: 0; }
        }
      `}</style>
    </section>
  );
}

function ConfettiBurst() {
  const pieces = Array.from({ length: 40 });
  const colors = ["#a855f7", "#3b82f6", "#10b981", "#f59e0b", "#ef4444"];
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {pieces.map((_, i) => {
        const tx = (Math.random() - 0.5) * 600;
        const ty = (Math.random() - 0.3) * 500;
        const r = Math.random() * 720;
        const c = colors[i % colors.length];
        const delay = Math.random() * 200;
        return (
          <span
            key={i}
            className="absolute top-1/2 left-1/2 size-2 rounded-sm"
            style={{
              backgroundColor: c,
              ['--tx' as any]: `${tx}px`,
              ['--ty' as any]: `${ty}px`,
              ['--r' as any]: `${r}deg`,
              animation: `confetti-fall 1s ease-out ${delay}ms forwards`,
            }}
          />
        );
      })}
    </div>
  );
}

function Badge({
  color, icon, label,
}: { color: "emerald" | "amber"; icon: React.ReactNode; label: string }) {
  const cls =
    color === "emerald"
      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
      : "bg-amber-500/10 text-amber-300 border-amber-500/30";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium ${cls} animate-fade-in`}>
      {icon}
      {label}
    </span>
  );
}

function FactCard({
  icon, value, label, accent, live,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  accent: "primary" | "amber" | "emerald";
  live?: boolean;
}) {
  const accentCls =
    accent === "primary"
      ? "text-primary bg-primary/10 border-primary/20"
      : accent === "amber"
      ? "text-amber-300 bg-amber-500/10 border-amber-500/20"
      : "text-emerald-300 bg-emerald-500/10 border-emerald-500/20";
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur p-4 transition-transform hover:scale-[1.02]">
      <div className={`inline-flex items-center justify-center size-10 rounded-lg border ${accentCls} mb-3 ${live ? "animate-pulse" : ""}`}>
        {icon}
      </div>
      <div className="text-2xl font-bold tracking-tight tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function wait(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

export default SectionVideoDemo;
