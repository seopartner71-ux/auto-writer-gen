import { motion } from "framer-motion";
import { useState, useEffect } from "react";

const models = [
  { name: "ChatGPT", angle: 30, pct: 92, status: "DOMINATING" },
  { name: "Perplexity", angle: 110, pct: 87, status: "DOMINATING" },
  { name: "Gemini", angle: 200, pct: 78, status: "CAPTURED" },
  { name: "Claude", angle: 290, pct: 65, status: "TRACKING" },
];

const logLines = [
  "scan: chatgpt-4o → brand_found: true",
  "scan: perplexity → cited_as_source: true",
  "scan: gemini-2.5 → snippet_matched: 3/4",
  "scan: claude-3.5 → monitoring...",
  "geo_score: 87.4% coverage",
  "next_sweep: 00:04:12",
];

export function RadarVisual() {
  const [sweepAngle, setSweepAngle] = useState(0);
  const [revealed, setRevealed] = useState<boolean[]>(models.map(() => false));
  const [logIndex, setLogIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setSweepAngle((prev) => {
        const next = (prev + 1.5) % 360;
        models.forEach((m, i) => {
          if (!revealed[i] && Math.abs(next - m.angle) < 10) {
            setRevealed((r) => { const c = [...r]; c[i] = true; return c; });
          }
        });
        return next;
      });
    }, 25);
    return () => clearInterval(interval);
  }, [revealed]);

  useEffect(() => {
    const interval = setInterval(() => {
      setLogIndex((p) => (p + 1) % logLines.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 20;

  return (
    <div className="relative w-full max-w-[520px]">
      <div className="rounded-2xl border border-white/[0.06] bg-[#08080f]/95 backdrop-blur-2xl shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_60px_rgba(6,182,212,0.08)] overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.04] bg-white/[0.01]">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/40" />
            </div>
            <span className="text-[9px] font-mono text-muted-foreground/30 ml-2">geo-radar — sweep mode</span>
          </div>
          <motion.span
            className="text-[9px] font-mono text-[#06b6d4]/60"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            SCANNING...
          </motion.span>
        </div>

        {/* Radar */}
        <div className="flex items-start gap-4 p-4">
          <div className="relative flex-1 flex justify-center">
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="w-full h-auto max-w-[320px]">
              {/* Concentric rings */}
              {[0.33, 0.66, 1].map((r, i) => (
                <circle key={i} cx={cx} cy={cy} r={maxR * r} fill="none" stroke="rgba(6,182,212,0.06)" strokeWidth="0.5" />
              ))}
              {/* Cross lines */}
              <line x1={cx} y1={20} x2={cx} y2={size - 20} stroke="rgba(6,182,212,0.04)" strokeWidth="0.5" />
              <line x1={20} y1={cy} x2={size - 20} y2={cy} stroke="rgba(6,182,212,0.04)" strokeWidth="0.5" />

              {/* Sweep gradient cone */}
              <defs>
                <linearGradient id="sweepGrad" gradientTransform={`rotate(${sweepAngle}, 0.5, 0.5)`}>
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                </linearGradient>
                <radialGradient id="centerGlow">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Sweep line */}
              <line
                x1={cx} y1={cy}
                x2={cx + maxR * Math.cos((sweepAngle * Math.PI) / 180)}
                y2={cy + maxR * Math.sin((sweepAngle * Math.PI) / 180)}
                stroke="#06b6d4" strokeWidth="1.5" opacity="0.5"
                style={{ filter: "drop-shadow(0 0 8px rgba(6,182,212,0.4))" }}
              />

              {/* Sweep trail */}
              <path
                d={`M${cx},${cy} L${cx + maxR * Math.cos(((sweepAngle - 30) * Math.PI) / 180)},${cy + maxR * Math.sin(((sweepAngle - 30) * Math.PI) / 180)} A${maxR},${maxR} 0 0,1 ${cx + maxR * Math.cos((sweepAngle * Math.PI) / 180)},${cy + maxR * Math.sin((sweepAngle * Math.PI) / 180)} Z`}
                fill="url(#sweepGrad)"
              />

              {/* Center glow */}
              <circle cx={cx} cy={cy} r="40" fill="url(#centerGlow)" />
              <circle cx={cx} cy={cy} r="4" fill="#06b6d4" style={{ filter: "drop-shadow(0 0 10px rgba(6,182,212,0.6))" }} />
            </svg>

            {/* Model dots overlaid */}
            {models.map((m, i) => {
              const rad = (m.angle * Math.PI) / 180;
              const dist = maxR * 0.65;
              const xPct = 50 + (dist / (size / 2)) * 50 * Math.cos(rad);
              const yPct = 50 + (dist / (size / 2)) * 50 * Math.sin(rad);
              return (
                <motion.div
                  key={i}
                  className="absolute flex flex-col items-center"
                  style={{ left: `${xPct}%`, top: `${yPct}%`, transform: "translate(-50%, -50%)" }}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={revealed[i] ? { opacity: 1, scale: 1 } : {}}
                  transition={{ type: "spring", duration: 0.5 }}
                >
                  <motion.div
                    className="w-3.5 h-3.5 rounded-full bg-emerald-400"
                    animate={revealed[i] ? { boxShadow: ["0 0 0px rgba(16,185,129,0)", "0 0 20px rgba(16,185,129,0.7)", "0 0 6px rgba(16,185,129,0.3)"] } : {}}
                    transition={{ duration: 1 }}
                  />
                  <div className="mt-1 px-2 py-0.5 rounded bg-[#06060b]/90 border border-white/[0.06]">
                    <span className="text-[8px] font-mono text-foreground/80 block">{m.name}</span>
                    <span className="text-[7px] font-mono text-emerald-400/70">{m.status}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Side telemetry */}
          <div className="hidden sm:flex flex-col gap-3 w-[140px] shrink-0 pt-2">
            {models.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 10 }}
                animate={revealed[i] ? { opacity: 1, x: 0 } : {}}
                transition={{ delay: 0.2 }}
                className="px-2 py-1.5 rounded-lg border border-white/[0.04] bg-white/[0.01]"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[8px] font-mono text-foreground/60">{m.name}</span>
                  <span className="text-[8px] font-mono text-emerald-400">{m.pct}%</span>
                </div>
                <div className="h-1 bg-white/[0.04] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-[#06b6d4] to-emerald-400"
                    initial={{ width: 0 }}
                    animate={revealed[i] ? { width: `${m.pct}%` } : {}}
                    transition={{ duration: 1, delay: 0.3 }}
                  />
                </div>
              </motion.div>
            ))}

            {/* Log ticker */}
            <div className="mt-2 px-2 py-1.5 rounded-lg border border-white/[0.03] bg-white/[0.005] overflow-hidden">
              <motion.p
                key={logIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-[7px] font-mono text-muted-foreground/30 leading-relaxed"
              >
                {`> ${logLines[logIndex]}`}
              </motion.p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
