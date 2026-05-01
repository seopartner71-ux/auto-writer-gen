import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Check, Loader2, Sparkles, Trophy, Zap, ShieldCheck } from "lucide-react";

const TYPED_KEYWORD = "как выбрать ноутбук";

const STAGES = [
  { label: "Анализируем конкурентов в Google", duration: 2200 },
  { label: "Извлекаем LSI и семантику", duration: 1800 },
  { label: "Создаем структуру H1-H2-H3", duration: 2000 },
  { label: "Пишем статью с учетом GEO/AI Overviews", duration: 2400 },
  { label: "Гуманизируем текст (Stealth Engine)", duration: 1600 },
];

const ARTICLE_LINES = [
  "# Как выбрать ноутбук в 2026 году: гид без воды",
  "",
  "Ноутбук подбирают под задачу, а не под бренд. Если перепутать порядок, переплатите 30-50% за функции, которыми не воспользуетесь.",
  "",
  "## Ключевые параметры",
  "",
  "Процессор отвечает за скорость, оперативная память - за многозадачность, SSD - за отзывчивость системы. Для работы с документами хватит 16 ГБ ОЗУ и 512 ГБ SSD.",
];

const TOTAL_CYCLE_MS = 32000;

export function SectionVideoDemo() {
  const [step, setStep] = useState<"idle" | "typing" | "click" | "stages" | "writing" | "scores" | "cta">("idle");
  const [typed, setTyped] = useState("");
  const [stageIdx, setStageIdx] = useState(-1);
  const [articleText, setArticleText] = useState("");
  const [showScores, setShowScores] = useState(false);
  const [pulseCta, setPulseCta] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const visibleRef = useRef(false);
  const cycleRef = useRef<number | null>(null);

  // Run only when in viewport (perf)
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
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (cycleRef.current) {
        window.clearTimeout(cycleRef.current);
        cycleRef.current = null;
      }
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
  }

  async function runOnce() {
    resetState();
    await wait(400);

    // Step 1: typing keyword (0-3s)
    setStep("typing");
    for (let i = 1; i <= TYPED_KEYWORD.length; i++) {
      if (!visibleRef.current) return;
      setTyped(TYPED_KEYWORD.slice(0, i));
      await wait(90);
    }
    await wait(500);

    // Step 2: button click (3-5s)
    setStep("click");
    await wait(900);

    // Step 3: stages (5-15s)
    setStep("stages");
    for (let i = 0; i < STAGES.length; i++) {
      if (!visibleRef.current) return;
      setStageIdx(i);
      await wait(STAGES[i].duration);
    }
    setStageIdx(STAGES.length);

    // Step 4: writing article (typewriter)
    setStep("writing");
    const fullText = ARTICLE_LINES.join("\n");
    for (let i = 1; i <= fullText.length; i += 2) {
      if (!visibleRef.current) return;
      setArticleText(fullText.slice(0, i));
      await wait(18);
    }
    await wait(700);

    // Step 5: scores
    setStep("scores");
    setShowScores(true);
    await wait(2200);

    // Step 6: pulse CTA
    setStep("cta");
    setPulseCta(true);
    await wait(2800);
  }

  function startCycle() {
    const loop = async () => {
      if (!visibleRef.current) {
        cycleRef.current = window.setTimeout(loop, 1500);
        return;
      }
      await runOnce();
      cycleRef.current = window.setTimeout(loop, 600);
    };
    cycleRef.current = window.setTimeout(loop, 200);
  }

  return (
    <section
      ref={containerRef}
      className="relative py-20 md:py-28 px-4 overflow-hidden"
      aria-labelledby="video-demo-title"
    >
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12 md:mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary mb-4">
            <Sparkles className="size-3" />
            Live demo
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
          {/* Browser frame with animation */}
          <div className="relative rounded-2xl border border-border/60 bg-[#0a0a0a] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.8)] overflow-hidden">
            {/* Browser top bar */}
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

            {/* Screen content */}
            <div className="p-5 md:p-8 min-h-[460px] md:min-h-[520px] flex flex-col">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="size-4 text-primary" />
                <span className="text-sm font-medium">Создайте первую статью за 60 секунд</span>
              </div>

              {/* Input field */}
              <div className="mb-4">
                <label className="text-xs text-muted-foreground block mb-1.5">
                  Введите ключевое слово
                </label>
                <div className="relative h-11 rounded-lg bg-black/50 border border-border/60 px-3 flex items-center text-sm font-mono">
                  <span className="text-foreground">{typed}</span>
                  {(step === "idle" || step === "typing") && (
                    <span className="ml-0.5 inline-block w-[2px] h-4 bg-primary animate-pulse" />
                  )}
                </div>
              </div>

              {/* CTA button (in-screen) */}
              <div className="mb-5">
                <button
                  type="button"
                  className={`relative w-full h-11 rounded-lg bg-gradient-to-r from-primary to-[#a855f7] text-primary-foreground font-medium text-sm transition-transform ${
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

              {/* Stages list */}
              {(step === "stages" || step === "writing" || step === "scores" || step === "cta") && (
                <div className="space-y-2 mb-5">
                  {STAGES.map((s, i) => {
                    const done = i < stageIdx || step === "writing" || step === "scores" || step === "cta";
                    const active = i === stageIdx && step === "stages";
                    return (
                      <div
                        key={s.label}
                        className={`flex items-center gap-2 text-xs transition-colors ${
                          done ? "text-foreground" : active ? "text-foreground" : "text-muted-foreground/50"
                        }`}
                      >
                        {done ? (
                          <Check className="size-3.5 text-emerald-400 shrink-0" />
                        ) : active ? (
                          <Loader2 className="size-3.5 text-primary animate-spin shrink-0" />
                        ) : (
                          <span className="size-3.5 rounded-full border border-border/60 shrink-0" />
                        )}
                        <span>{s.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Article preview (typewriter) */}
              {(step === "writing" || step === "scores" || step === "cta") && (
                <div className="rounded-lg border border-border/40 bg-black/40 p-4 mb-4 flex-1 min-h-[140px]">
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
                  <Badge color="emerald" icon={<Check className="size-3" />} label="SEO Score: 87/100" />
                  <Badge color="emerald" icon={<Check className="size-3" />} label="AI Score: 92% человек" />
                  <Badge color="emerald" icon={<Check className="size-3" />} label="Тургенев: 2 балла" />
                  <Badge color="amber" icon={<Trophy className="size-3" />} label="ОТЛИЧНО" />
                </div>
              )}
            </div>
          </div>

          {/* Side facts */}
          <div className="space-y-4">
            <FactCard
              icon={<Zap className="size-5" />}
              value="60 сек"
              label="время создания статьи"
              accent="primary"
            />
            <FactCard
              icon={<Trophy className="size-5" />}
              value="87/100"
              label="средний SEO Score"
              accent="amber"
            />
            <FactCard
              icon={<ShieldCheck className="size-5" />}
              value="94%"
              label="средняя уникальность текста"
              accent="emerald"
            />
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="mt-12 text-center">
          <Button
            asChild
            size="lg"
            className={`h-14 px-8 text-base bg-gradient-to-r from-primary to-[#a855f7] hover:opacity-95 transition-all ${
              pulseCta ? "shadow-[0_0_40px_-5px_hsl(var(--primary)/0.6)]" : ""
            }`}
          >
            <Link to="/auth">
              Создать первую статью бесплатно
              <span className="ml-1">-&gt;</span>
            </Link>
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            Без карты. 3 статьи в подарок при регистрации.
          </p>
        </div>
      </div>
    </section>
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
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium ${cls}`}>
      {icon}
      {label}
    </span>
  );
}

function FactCard({
  icon, value, label, accent,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  accent: "primary" | "amber" | "emerald";
}) {
  const accentCls =
    accent === "primary"
      ? "text-primary bg-primary/10 border-primary/20"
      : accent === "amber"
      ? "text-amber-300 bg-amber-500/10 border-amber-500/20"
      : "text-emerald-300 bg-emerald-500/10 border-emerald-500/20";
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur p-4">
      <div className={`inline-flex items-center justify-center size-10 rounded-lg border ${accentCls} mb-3`}>
        {icon}
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function wait(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

export default SectionVideoDemo;