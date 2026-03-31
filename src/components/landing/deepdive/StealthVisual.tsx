import { motion, useInView } from "framer-motion";
import { useRef, useState, useEffect } from "react";

/* Generate noisy human-like data */
const humanData = Array.from({ length: 50 }, (_, i) => ({
  x: i * 6,
  y: 30 + Math.sin(i * 0.4) * 20 + (Math.random() - 0.5) * 30,
}));
const aiData = Array.from({ length: 50 }, (_, i) => ({
  x: i * 6,
  y: 50 + Math.sin(i * 0.15) * 3,
}));

function toPath(data: { x: number; y: number }[]) {
  return data.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
}

export function StealthVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const [cursorX, setCursorX] = useState(150);

  useEffect(() => {
    if (!inView) return;
    const interval = setInterval(() => {
      setCursorX((p) => {
        const next = p + 2;
        return next > 294 ? 0 : next;
      });
    }, 50);
    return () => clearInterval(interval);
  }, [inView]);

  const cursorHumanY = humanData[Math.min(Math.floor(cursorX / 6), humanData.length - 1)]?.y ?? 50;
  const perplexityVal = (30 + Math.abs(cursorHumanY - 50) * 1.5).toFixed(1);

  return (
    <div ref={ref} className="relative w-full max-w-[520px]">
      <div className="rounded-2xl border border-white/[0.06] bg-[#08080f]/95 backdrop-blur-2xl shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_40px_rgba(139,92,246,0.06)] overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.04] bg-white/[0.01]">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/40" />
            </div>
            <span className="text-[9px] font-mono text-muted-foreground/30 ml-2">spectral-analysis.exe</span>
          </div>
          <motion.span
            className="text-[9px] font-mono text-emerald-400/70 tracking-wider"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            NOISE INJECTION ACTIVE
          </motion.span>
        </div>

        {/* Graph area */}
        <div className="p-5">
          <svg viewBox="0 0 300 100" className="w-full h-auto" preserveAspectRatio="none">
            {/* Grid */}
            {[0, 25, 50, 75, 100].map((y) => (
              <line key={y} x1="0" y1={y} x2="300" y2={y} stroke="rgba(255,255,255,0.02)" strokeWidth="0.5" />
            ))}
            {[0, 60, 120, 180, 240, 300].map((x) => (
              <line key={x} x1={x} y1="0" x2={x} y2="100" stroke="rgba(255,255,255,0.02)" strokeWidth="0.5" />
            ))}

            {/* AI line */}
            <motion.path
              d={toPath(aiData)}
              fill="none"
              stroke="#ef4444"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              opacity={0.35}
              initial={{ pathLength: 0 }}
              animate={inView ? { pathLength: 1 } : {}}
              transition={{ duration: 2 }}
            />

            {/* Human line */}
            <motion.path
              d={toPath(humanData)}
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
              initial={{ pathLength: 0 }}
              animate={inView ? { pathLength: 1 } : {}}
              transition={{ duration: 2.5, delay: 0.5 }}
              style={{ filter: "drop-shadow(0 0 6px rgba(16,185,129,0.5))" }}
            />

            {/* Human area fill */}
            <motion.path
              d={toPath(humanData) + " L300,100 L0,100 Z"}
              fill="url(#humanGradient)"
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: 1 } : {}}
              transition={{ duration: 1, delay: 1.5 }}
            />

            <defs>
              <linearGradient id="humanGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.1" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Scanning cursor */}
            {inView && (
              <>
                <line x1={cursorX} y1="0" x2={cursorX} y2="100" stroke="rgba(139,92,246,0.3)" strokeWidth="0.5" strokeDasharray="2 2" />
                <circle cx={cursorX} cy={cursorHumanY} r="3" fill="#10b981" opacity="0.8" style={{ filter: "drop-shadow(0 0 4px rgba(16,185,129,0.6))" }} />
              </>
            )}
          </svg>

          {/* Cursor tooltip */}
          {inView && (
            <motion.div
              className="absolute px-2 py-1 rounded bg-primary/20 border border-primary/30 backdrop-blur-sm"
              style={{ left: `calc(${(cursorX / 300) * 100}% + 20px)`, top: "45%" }}
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <span className="text-[8px] font-mono text-primary">PPL: {perplexityVal}</span>
            </motion.div>
          )}

          {/* Legend */}
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-px border-t border-dashed border-red-400/40" />
                <span className="text-[9px] font-mono text-red-400/50">LLM Pattern</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 bg-emerald-400 rounded shadow-[0_0_4px_rgba(16,185,129,0.5)]" />
                <span className="text-[9px] font-mono text-emerald-400/60">Human Signal</span>
              </div>
            </div>
            <span className="text-[8px] font-mono text-muted-foreground/20">burstiness: 0.87 | entropy: high</span>
          </div>
        </div>
      </div>
    </div>
  );
}
