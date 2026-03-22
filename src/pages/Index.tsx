import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Play, Zap, TrendingUp, Shield } from "lucide-react";
import { useEffect, useState } from "react";

/* ─── animation helpers ─── */
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.15, delayChildren: 0.3 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const } },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] as const, delay: 0.6 } },
};

/* ─── Animated Score Ring ─── */
function ScoreRing({ target = 98, size = 120 }: { target?: number; size?: number }) {
  const [score, setScore] = useState(0);
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;

  useEffect(() => {
    const timer = setTimeout(() => setScore(target), 800);
    return () => clearTimeout(timer);
  }, [target]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(168,85,247,0.15)" strokeWidth={10} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#scoreGrad)"
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - (circ * score) / 100}
          style={{ transition: "stroke-dashoffset 1.8s cubic-bezier(.22,1,.36,1)" }}
        />
        <defs>
          <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#A855F7" />
            <stop offset="100%" stopColor="#7C3AED" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-white tabular-nums">{score}</span>
        <span className="text-xs text-hero-muted">/100</span>
      </div>
    </div>
  );
}

/* ─── Metric Pill ─── */
function MetricPill({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-hero-purple/20">
        <Icon className="h-4 w-4 text-hero-purple" />
      </div>
      <div>
        <p className="text-xs text-hero-muted">{label}</p>
        <p className="text-sm font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}

/* ─── Main Page ─── */
export default function Index() {
  const navigate = useNavigate();

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-hero-bg">
      {/* ── ambient glow ── */}
      <motion.div
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-hero-purple/20 blur-[140px]"
        animate={{ opacity: [0.5, 0.8, 0.5], scale: [1, 1.08, 1] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="pointer-events-none absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_40%,rgba(168,85,247,0.12)_0%,transparent_65%)]" />

      {/* ── content ── */}
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="relative z-10 container mx-auto px-4 pt-24 pb-12 text-center"
      >
        {/* badge */}
        <motion.div variants={fadeUp} className="mb-6 inline-flex items-center gap-2 rounded-full border border-hero-purple/30 bg-hero-purple/10 px-4 py-1.5 text-xs font-medium text-hero-purple">
          <Zap className="h-3.5 w-3.5" /> AI-Powered SEO Platform
        </motion.div>

        {/* headline */}
        <motion.h1
          variants={fadeUp}
          className="mx-auto max-w-4xl text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-extrabold tracking-tight leading-[1.05] text-white"
        >
          Синтезируйте SEO-контент, который{" "}
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 via-violet-500 to-purple-600">
            доминирует&nbsp;в&nbsp;ТОП&#8209;3
          </span>
        </motion.h1>

        {/* sub */}
        <motion.p
          variants={fadeUp}
          className="mx-auto mt-6 max-w-2xl text-lg sm:text-xl text-hero-muted leading-relaxed"
        >
          Первая AI-платформа, объединяющая глубокую аналитику конкурентов и ваш уникальный голос бренда.
          Больше чем текст —&nbsp;чистая стратегия.
        </motion.p>

        {/* CTA */}
        <motion.div variants={fadeUp} className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <button
            onClick={() => navigate("/register")}
            className="group relative inline-flex items-center gap-2 rounded-full bg-hero-purple px-8 py-4 text-base font-semibold text-white shadow-[0_0_24px_rgba(168,85,247,0.45)] transition-all duration-300 hover:scale-[1.04] hover:shadow-[0_0_36px_rgba(168,85,247,0.6)] active:scale-[0.98]"
          >
            Начать синтез
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
          <button
            onClick={() => navigate("/login")}
            className="inline-flex items-center gap-2 rounded-full border border-hero-purple/40 bg-transparent px-8 py-4 text-base font-semibold text-hero-purple transition-all duration-300 hover:bg-hero-purple/10 hover:border-hero-purple/60"
          >
            <Play className="h-4 w-4" />
            Смотреть демо
          </button>
        </motion.div>
      </motion.div>

      {/* ── Floating Widget ── */}
      <motion.div
        variants={scaleIn}
        initial="hidden"
        animate="show"
        className="relative z-10 w-full max-w-4xl mx-auto px-4 pb-24"
      >
        <motion.div
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl p-8 shadow-[0_8px_60px_-12px_rgba(168,85,247,0.25)]"
        >
          {/* widget header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-sm font-medium text-hero-muted">SEO Benchmark</p>
              <p className="text-lg font-bold text-white">«Fitness retreats Arizona 2026»</p>
            </div>
            <span className="rounded-full bg-green-500/20 px-3 py-1 text-xs font-semibold text-green-400">
              Анализ завершён
            </span>
          </div>

          {/* widget body */}
          <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
            <div className="flex justify-center">
              <ScoreRing target={98} size={130} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <MetricPill icon={TrendingUp} label="Релевантность" value="96%" />
              <MetricPill icon={Shield} label="Уникальность" value="99.2%" />
              <MetricPill icon={Zap} label="LSI-покрытие" value="42 / 45" />
              <MetricPill icon={TrendingUp} label="Конкурентный балл" value="ТОП-3" />
            </div>
          </div>

          {/* progress bar */}
          <div className="mt-6">
            <div className="flex items-center justify-between text-xs text-hero-muted mb-1.5">
              <span>Content Score</span>
              <span className="text-white font-semibold">98 / 100</span>
            </div>
            <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-hero-purple to-violet-600"
                initial={{ width: 0 }}
                animate={{ width: "98%" }}
                transition={{ duration: 2, delay: 1, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* ── bottom fade ── */}
      <div className="pointer-events-none absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-hero-bg to-transparent" />
    </section>
  );
}
