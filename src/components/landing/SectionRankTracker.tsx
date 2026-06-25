import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LineChart, TrendingUp, Globe, Target, CalendarClock, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

type Engine = "google" | "yandex";

const series: Record<Engine, number[]> = {
  // позиции по дням (меньше — лучше). 14 точек
  google: [22, 19, 17, 15, 14, 12, 11, 9, 8, 7, 6, 5, 4, 3],
  yandex: [28, 26, 24, 21, 18, 16, 14, 12, 10, 9, 7, 6, 5, 4],
};

const MAX_POS = 30;
const W = 560;
const H = 220;
const PAD_L = 32;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 24;

function buildPath(points: number[]) {
  const n = points.length;
  const stepX = (W - PAD_L - PAD_R) / (n - 1);
  const innerH = H - PAD_T - PAD_B;
  return points
    .map((p, i) => {
      const x = PAD_L + i * stepX;
      const y = PAD_T + ((p - 1) / (MAX_POS - 1)) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function buildArea(points: number[]) {
  const n = points.length;
  const stepX = (W - PAD_L - PAD_R) / (n - 1);
  const innerH = H - PAD_T - PAD_B;
  const top = points
    .map((p, i) => {
      const x = PAD_L + i * stepX;
      const y = PAD_T + ((p - 1) / (MAX_POS - 1)) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const lastX = PAD_L + (n - 1) * stepX;
  return `${top} L${lastX.toFixed(1)},${H - PAD_B} L${PAD_L},${H - PAD_B} Z`;
}

export function SectionRankTracker() {
  const { lang } = useI18n();
  const isEn = lang === "en";
  const [progress, setProgress] = useState(0); // 0..1 — анимация рисования

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const dur = 1800;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const visibleCount = Math.max(2, Math.round(series.google.length * progress));
  const googlePts = series.google.slice(0, visibleCount);
  const yandexPts = series.yandex.slice(0, visibleCount);

  const lastGoogle = series.google[series.google.length - 1];
  const firstGoogle = series.google[0];
  const lastYandex = series.yandex[series.yandex.length - 1];
  const firstYandex = series.yandex[0];

  const features = isEn
    ? [
        { icon: CalendarClock, title: "Daily auto-check", text: "Background scans every 24h - no manual runs." },
        { icon: Globe, title: "Google + Yandex", text: "Both engines in one report, up to TOP-30 depth." },
        { icon: Target, title: "Landing URL detection", text: "See which page ranks for each query." },
        { icon: TrendingUp, title: "Position history", text: "Charts and trends for every keyword." },
      ]
    : [
        { icon: CalendarClock, title: "Ежедневная авто-проверка", text: "Фоновые сканы каждые 24 часа - без ручного запуска." },
        { icon: Globe, title: "Google и Яндекс", text: "Обе системы в одном отчете, глубина до ТОП-30." },
        { icon: Target, title: "Определение посадочной", text: "Видно какая страница ранжируется по запросу." },
        { icon: TrendingUp, title: "История позиций", text: "Графики и динамика по каждому ключу." },
      ];

  return (
    <section className="relative py-32 flex items-center justify-center overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[600px] rounded-full bg-emerald-500/[0.04] blur-[220px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="text-center mb-14"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-4 py-1.5 mb-6">
            <LineChart className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-xs font-tech font-medium text-emerald-400 uppercase tracking-wider">
              {isEn ? "Rank Tracker" : "Трекер позиций"}
            </span>
          </div>
          <h2
            className="text-5xl sm:text-6xl md:text-7xl font-black leading-[0.95]"
            style={{ letterSpacing: "-0.06em", textShadow: "0 0 80px rgba(16,185,129,0.08)" }}
          >
            {isEn ? "Daily monitoring of Google and Yandex positions" : "Ежедневный мониторинг позиций в Google и Яндекс"}
          </h2>
          <p className="mt-5 text-muted-foreground text-[15px] max-w-2xl mx-auto leading-[1.7]">
            {isEn
              ? "Track every keyword across both search engines, see the exact landing URL and watch the trend - automatically, every day."
              : "Отслеживайте каждый ключ в обеих поисковых системах, видьте посадочную страницу и динамику - автоматически, каждый день."}
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6 lg:gap-10 items-stretch">
          {/* Chart card */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl p-5 sm:p-7 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <div>
                <div className="text-[11px] font-tech text-muted-foreground uppercase tracking-wider mb-1">
                  {isEn ? "Keyword" : "Ключевой запрос"}
                </div>
                <div className="font-tech text-sm text-foreground/90">
                  {isEn ? "ai seo content generator" : "купить букет цветов"}
                </div>
                <div className="text-[11px] font-tech text-muted-foreground/70 mt-1">example.com / catalog/bouquets</div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#4285f4] shadow-[0_0_8px_rgba(66,133,244,0.6)]" />
                  <span className="text-[11px] font-tech text-muted-foreground">Google</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#fc3f1d] shadow-[0_0_8px_rgba(252,63,29,0.6)]" />
                  <span className="text-[11px] font-tech text-muted-foreground">{isEn ? "Yandex" : "Яндекс"}</span>
                </div>
              </div>
            </div>

            {/* SVG chart */}
            <div className="relative w-full">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
                <defs>
                  <linearGradient id="rt-g-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4285f4" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#4285f4" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="rt-y-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fc3f1d" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#fc3f1d" stopOpacity="0" />
                  </linearGradient>
                </defs>

                {/* gridlines */}
                {[1, 10, 20, 30].map((p) => {
                  const innerH = H - PAD_T - PAD_B;
                  const y = PAD_T + ((p - 1) / (MAX_POS - 1)) * innerH;
                  return (
                    <g key={p}>
                      <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4" />
                      <text x={PAD_L - 8} y={y + 3} textAnchor="end" fontSize="9" fill="rgba(255,255,255,0.3)" fontFamily="monospace">
                        {p}
                      </text>
                    </g>
                  );
                })}

                {/* areas */}
                <path d={buildArea(googlePts)} fill="url(#rt-g-grad)" />
                <path d={buildArea(yandexPts)} fill="url(#rt-y-grad)" />

                {/* lines */}
                <path d={buildPath(googlePts)} fill="none" stroke="#4285f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d={buildPath(yandexPts)} fill="none" stroke="#fc3f1d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

                {/* end dots */}
                {(() => {
                  const n = googlePts.length;
                  const stepX = (W - PAD_L - PAD_R) / (series.google.length - 1);
                  const innerH = H - PAD_T - PAD_B;
                  const gx = PAD_L + (n - 1) * stepX;
                  const gy = PAD_T + ((googlePts[n - 1] - 1) / (MAX_POS - 1)) * innerH;
                  const yy = PAD_T + ((yandexPts[n - 1] - 1) / (MAX_POS - 1)) * innerH;
                  return (
                    <g>
                      <circle cx={gx} cy={gy} r="4" fill="#4285f4" />
                      <circle cx={gx} cy={gy} r="8" fill="#4285f4" opacity="0.15" />
                      <circle cx={gx} cy={yy} r="4" fill="#fc3f1d" />
                      <circle cx={gx} cy={yy} r="8" fill="#fc3f1d" opacity="0.15" />
                    </g>
                  );
                })()}
              </svg>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 gap-3 mt-5">
              <div className="rounded-xl border border-white/[0.05] bg-black/30 px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-tech text-muted-foreground uppercase tracking-wider">Google</span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-tech text-emerald-400">
                    <ArrowUpRight className="h-3 w-3" />
                    +{firstGoogle - lastGoogle}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black text-foreground">#{lastGoogle}</span>
                  <span className="text-[11px] font-tech text-muted-foreground line-through">#{firstGoogle}</span>
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.05] bg-black/30 px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-tech text-muted-foreground uppercase tracking-wider">{isEn ? "Yandex" : "Яндекс"}</span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-tech text-emerald-400">
                    <ArrowUpRight className="h-3 w-3" />
                    +{firstYandex - lastYandex}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black text-foreground">#{lastYandex}</span>
                  <span className="text-[11px] font-tech text-muted-foreground line-through">#{firstYandex}</span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Features list */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="flex flex-col gap-3"
          >
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <div
                  key={i}
                  className="group rounded-2xl border border-white/[0.05] bg-white/[0.015] backdrop-blur-md p-5 hover:border-emerald-400/20 hover:bg-emerald-400/[0.02] transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className="shrink-0 w-10 h-10 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] flex items-center justify-center group-hover:border-emerald-400/30 transition-colors">
                      <Icon className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground/90 mb-0.5">{f.title}</div>
                      <div className="text-[13px] text-muted-foreground leading-[1.55]">{f.text}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </motion.div>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
          className="text-center mt-10 text-sm font-tech text-emerald-400/80 tracking-wide"
        >
          {isEn ? "// Auto-scan 24/7 - history - trend - landing URL" : "// Авто-сканирование 24/7 - история - тренд - посадочная страница"}
        </motion.p>
      </div>
    </section>
  );
}