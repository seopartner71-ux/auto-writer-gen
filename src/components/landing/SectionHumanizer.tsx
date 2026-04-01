import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, ShieldCheck, Zap } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function SectionHumanizer() {
  const { t } = useI18n();
  const [score, setScore] = useState(94);
  const [humanized, setHumanized] = useState(false);

  useEffect(() => {
    if (!humanized) return;
    const interval = setInterval(() => {
      setScore((p) => { if (p <= 0) { clearInterval(interval); return 0; } return p - 2; });
    }, 40);
    return () => clearInterval(interval);
  }, [humanized]);

  return (
    <section className="relative py-32 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] rounded-full bg-primary/[0.03] blur-[300px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="text-xs font-mono text-primary/70 uppercase tracking-widest mb-4 block">
            Stealth Engine
          </span>
          <h2 className="text-3xl md:text-5xl font-extrabold tracking-[-0.03em] text-white mb-5">
            {t("hum.title")}
          </h2>
          <p className="text-foreground/50 text-base max-w-xl mx-auto leading-relaxed">
            {t("hum.sub")}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left — AI text (bad) */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="rounded-2xl border border-red-500/15 bg-red-500/[0.03] p-7 relative overflow-hidden"
          >
            <div className="pointer-events-none absolute top-0 right-0 w-[200px] h-[200px] rounded-full bg-red-500/[0.04] blur-[100px]" />
            
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-6">
                <AlertTriangle className="h-4 w-4 text-red-400/80" />
                <span className="text-sm font-tech font-bold text-red-400/90">{t("hum.labelAi")}</span>
                <span className="ml-auto text-xs font-mono text-red-400/70 border border-red-500/25 bg-red-500/[0.08] px-2.5 py-0.5 rounded-full animate-pulse">
                  AI: {humanized ? `${score}%` : "94%"}
                </span>
              </div>
              <div className="space-y-4">
                {[
                  { key: "hum.ai1", cliche: true },
                  { key: "hum.ai2", cliche: true },
                  { key: "hum.ai3", cliche: false },
                  { key: "hum.ai4", cliche: true },
                ].map((line, i) => (
                  <p key={i} className="text-sm leading-relaxed text-foreground/55 relative">
                    {line.cliche && (
                      <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-red-400/40 to-transparent" style={{
                        backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(248,113,113,0.3) 2px, rgba(248,113,113,0.3) 4px)",
                      }} />
                    )}
                    {t(line.key)}
                    {line.cliche && (
                      <span className="ml-1.5 text-[9px] font-mono text-red-400/50 align-super">CLICHÉ</span>
                    )}
                  </p>
                ))}
              </div>
              
              <div className="mt-6 pt-4 border-t border-red-500/15">
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4].map((i) => (
                    <span key={i} className="text-[10px] font-mono text-red-400/50 bg-red-500/[0.06] border border-red-500/15 px-2.5 py-0.5 rounded-full">
                      ⚠ Pattern #{i}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right — Human text (good) */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.03] p-7 relative overflow-hidden"
          >
            <div className="pointer-events-none absolute top-0 right-0 w-[200px] h-[200px] rounded-full bg-emerald-500/[0.04] blur-[100px]" />
            
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-6">
                <CheckCircle2 className="h-4 w-4 text-emerald-400/80" />
                <span className="text-sm font-tech font-bold text-emerald-400/90">{t("hum.labelHuman")}</span>
                <span className="ml-auto text-xs font-mono text-emerald-400/70 border border-emerald-500/25 bg-emerald-500/[0.08] px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                  AI: 0%
                </span>
              </div>
              <div className="space-y-4">
                {["hum.hu1", "hum.hu2", "hum.hu3", "hum.hu4"].map((key, i) => (
                  <p key={i} className="text-sm leading-relaxed text-foreground/65">
                    {t(key)}
                  </p>
                ))}
              </div>
              
              <div className="mt-6 pt-4 border-t border-emerald-500/15">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[11px] font-mono text-emerald-400/60 border border-emerald-500/15 bg-emerald-500/[0.05] px-3 py-1 rounded-full flex items-center gap-1">
                    <Zap className="h-3 w-3" /> Perplexity: 82.4
                  </span>
                  <span className="text-[11px] font-mono text-emerald-400/60 border border-emerald-500/15 bg-emerald-500/[0.05] px-3 py-1 rounded-full flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" /> Burstiness: 71.2
                  </span>
                  <span className="text-[11px] font-mono text-emerald-400/60 border border-emerald-500/15 bg-emerald-500/[0.05] px-3 py-1 rounded-full">
                    E-E-A-T: ✓
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Humanize CTA */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="flex justify-center mt-10"
          onViewportEnter={() => !humanized && setTimeout(() => setHumanized(true), 1500)}
        >
          <div className="inline-flex items-center gap-4 rounded-full border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl px-6 py-3">
            <span className="text-xs font-mono text-foreground/50">
              {humanized ? "✓ Humanization complete" : "Processing..."}
            </span>
            <div className="h-4 w-px bg-white/[0.08]" />
            <span className={`text-sm font-tech font-bold ${humanized && score <= 0 ? "text-emerald-400" : "text-primary/90"}`}>
              Human Score: {humanized ? (score <= 0 ? "99%" : `${100 - score}%`) : "—"}
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
