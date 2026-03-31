import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Shield, Lock } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function StealthProofWidget() {
  const { t } = useI18n();
  const [aiPercent, setAiPercent] = useState(85);
  const [phase, setPhase] = useState<"dropping" | "done">("dropping");

  useEffect(() => {
    const timer = setTimeout(() => {
      const interval = setInterval(() => {
        setAiPercent((prev) => {
          if (prev <= 3) {
            clearInterval(interval);
            setPhase("done");
            return 3;
          }
          const step = prev > 40 ? 3 : prev > 15 ? 2 : 1;
          return prev - step;
        });
      }, 50);
      return () => clearInterval(interval);
    }, 1400);
    return () => clearTimeout(timer);
  }, []);

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const progress = (aiPercent / 100) * circumference;
  const gaugeColor =
    aiPercent > 50
      ? "hsl(0 72% 55%)"
      : aiPercent > 20
      ? "hsl(38 90% 55%)"
      : "hsl(142 71% 45%)";

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl p-1.5">
      <div className="rounded-xl bg-[#08080d] p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          <span className="ml-3 text-[10px] text-[#9ca3af] font-mono tracking-wide">
            stealth_protocol.run
          </span>
        </div>

        {/* Gauge */}
        <div className="flex flex-col items-center mb-5">
          <div className="relative w-[148px] h-[148px]">
            <svg
              viewBox="0 0 120 120"
              className="w-full h-full -rotate-90"
            >
              <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke="rgba(255,255,255,0.04)"
                strokeWidth="10"
              />
              <motion.circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={gaugeColor}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference - progress}
                style={{ transition: "stroke-dashoffset 0.08s linear, stroke 0.3s" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="text-3xl font-black tracking-display transition-colors duration-300"
                style={{ color: gaugeColor }}
              >
                {aiPercent}%
              </span>
              <span className="text-[9px] text-[#9ca3af] font-tech uppercase tracking-wider">
                AI Probability
              </span>
            </div>
          </div>
        </div>

        {/* Status badge */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: phase === "done" ? 1 : 0.4 }}
          className="flex items-center justify-center gap-2 mb-4"
        >
          {phase === "done" ? (
            <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-1.5">
              <Shield className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs font-tech font-bold text-emerald-400">
                {t("lp.stealthActive")}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/[0.06] px-4 py-1.5">
              <Lock className="h-3.5 w-3.5 text-primary animate-pulse" />
              <span className="text-xs font-tech font-bold text-primary">
                {t("lp.stealthProcessing")}
              </span>
            </div>
          )}
        </motion.div>

        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-3">
          <div
            className={`rounded-lg border p-3 transition-colors duration-500 ${
              phase === "done"
                ? "border-emerald-500/30 bg-emerald-500/[0.04]"
                : "border-white/[0.04] bg-white/[0.01]"
            }`}
          >
            <p className="text-[10px] font-tech text-[#9ca3af] uppercase tracking-wider mb-1">
              Human Score
            </p>
            <p
              className="text-2xl font-black tracking-display"
              style={{
                color: phase === "done" ? "hsl(142 71% 45%)" : "#9ca3af",
              }}
            >
              {phase === "done" ? "97%" : "—"}
            </p>
          </div>
          <div
            className={`rounded-lg border p-3 transition-colors duration-500 ${
              phase === "done"
                ? "border-emerald-500/30 bg-emerald-500/[0.04]"
                : "border-white/[0.04] bg-white/[0.01]"
            }`}
          >
            <p className="text-[10px] font-tech text-[#9ca3af] uppercase tracking-wider mb-1">
              Burstiness
            </p>
            <p
              className="text-2xl font-black tracking-display"
              style={{
                color: phase === "done" ? "hsl(142 71% 45%)" : "#9ca3af",
              }}
            >
              {phase === "done" ? "High" : "—"}
            </p>
          </div>
        </div>

        {/* Detectors passed */}
        {phase === "done" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-3 flex flex-wrap gap-1.5"
          >
            {["Originality.ai", "GPTZero", "Copyleaks", "ZeroGPT"].map(
              (d, i) => (
                <span
                  key={i}
                  className="text-[9px] font-tech px-2 py-0.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-400"
                >
                  ✓ {d}
                </span>
              )
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
