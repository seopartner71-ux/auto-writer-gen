import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Radar } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const models = [
  { name: "ChatGPT", angle: 45, found: true },
  { name: "Perplexity", angle: 135, found: true },
  { name: "Claude", angle: 225, found: false },
  { name: "Gemini", angle: 315, found: true },
];

export function SectionGeo() {
  const { t } = useI18n();
  const [sweepAngle, setSweepAngle] = useState(0);
  const [revealed, setRevealed] = useState<boolean[]>([false, false, false, false]);

  useEffect(() => {
    const interval = setInterval(() => {
      setSweepAngle(prev => {
        const next = (prev + 2) % 360;
        models.forEach((m, i) => {
          if (!revealed[i] && Math.abs(next - m.angle) < 15) {
            setRevealed(r => { const copy = [...r]; copy[i] = true; return copy; });
          }
        });
        return next;
      });
    }, 30);
    return () => clearInterval(interval);
  }, [revealed]);

  return (
    <section className="relative min-h-screen flex items-center justify-center snap-start overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-[#06b6d4]/[0.04] blur-[220px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-5xl">
        <motion.div initial={{ opacity: 0, y: 50 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
          className="text-center mb-14">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#06b6d4]/20 bg-[#06b6d4]/5 px-4 py-1.5 mb-6">
            <Radar className="h-3.5 w-3.5 text-[#06b6d4]" />
            <span className="text-xs font-tech font-medium text-[#06b6d4] uppercase tracking-wider">GEO Radar</span>
          </div>
          <h2 className="text-5xl sm:text-6xl md:text-7xl font-black leading-[0.95]" style={{ letterSpacing: "-0.06em" }}>
            {t("lp.geoTitle")}
          </h2>
          <p className="mt-5 text-muted-foreground text-[15px] max-w-2xl mx-auto leading-[1.7]">{t("lp.geoSub")}</p>
        </motion.div>

        {/* Radar visualization */}
        <motion.div initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.15 }}
          className="flex justify-center">
          <div className="relative w-[320px] h-[320px] sm:w-[400px] sm:h-[400px]">
            {/* Concentric circles */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 400">
              {[60, 120, 180].map(r => (
                <circle key={r} cx="200" cy="200" r={r} fill="none" stroke="rgba(6,182,212,0.06)" strokeWidth="1" />
              ))}
              <line x1="200" y1="20" x2="200" y2="380" stroke="rgba(6,182,212,0.04)" strokeWidth="1" />
              <line x1="20" y1="200" x2="380" y2="200" stroke="rgba(6,182,212,0.04)" strokeWidth="1" />
              {/* Sweep line */}
              <line
                x1="200" y1="200"
                x2={200 + 180 * Math.cos((sweepAngle * Math.PI) / 180)}
                y2={200 + 180 * Math.sin((sweepAngle * Math.PI) / 180)}
                stroke="#06b6d4" strokeWidth="1.5" opacity="0.4"
              />
              {/* Sweep glow */}
              <defs>
                <radialGradient id="sweepGlow">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle
                cx={200 + 90 * Math.cos((sweepAngle * Math.PI) / 180)}
                cy={200 + 90 * Math.sin((sweepAngle * Math.PI) / 180)}
                r="60" fill="url(#sweepGlow)"
              />
            </svg>

            {/* Model dots */}
            {models.map((m, i) => {
              const rad = (m.angle * Math.PI) / 180;
              const dist = 120;
              const x = 50 + (dist / 200) * 50 * Math.cos(rad);
              const y = 50 + (dist / 200) * 50 * Math.sin(rad);
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={revealed[i] ? { opacity: 1, scale: 1 } : {}}
                  transition={{ duration: 0.4, type: "spring" }}
                  className="absolute flex flex-col items-center gap-1"
                  style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
                >
                  <div className={`w-3 h-3 rounded-full ${m.found ? "bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "bg-red-400 shadow-[0_0_10px_rgba(239,68,68,0.5)]"}`} />
                  <span className="text-[9px] font-tech text-muted-foreground whitespace-nowrap">{m.name}</span>
                  <span className={`text-[8px] font-tech ${m.found ? "text-emerald-400" : "text-red-400"}`}>
                    {m.found ? t("lp.geoBrandFound") : t("lp.geoBrandMissing")}
                  </span>
                </motion.div>
              );
            })}

            {/* Center */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[#06b6d4] shadow-[0_0_20px_rgba(6,182,212,0.5)]" />
          </div>
        </motion.div>

        <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.5 }}
          className="text-center mt-8 text-sm font-tech text-[#06b6d4]/80 tracking-wide">
          {t("lp.geoMetric")}
        </motion.p>
      </div>
    </section>
  );
}
