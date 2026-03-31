import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useI18n } from "@/shared/hooks/useI18n";
import { Globe, Shield, Layers, MessageSquare } from "lucide-react";
import { useEffect, useRef } from "react";

const fadeUp = {
  initial: { opacity: 0, y: 50 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.7 },
};

/* ── Gradient divider ── */
function Divider() {
  return (
    <div className="container mx-auto px-4 max-w-4xl">
      <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
    </div>
  );
}

/* ── Block 1 visual: Typing chatbot ── */
function ChatbotVisual({ text }: { text: string }) {
  const displayed = useMotionValue(0);
  const rounded = useTransform(displayed, (v) => Math.round(v));
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const ctrl = animate(displayed, text.length, { duration: 3, delay: 0.5, ease: "easeOut" });
    const unsub = rounded.on("change", (v) => {
      if (ref.current) ref.current.textContent = text.slice(0, v);
    });
    return () => { ctrl.stop(); unsub(); };
  }, [text]);

  return (
    <div className="w-full max-w-[380px] rounded-2xl border-t border-l border-r border-b border-t-white/15 border-l-white/8 border-r-white/4 border-b-white/[0.02] bg-white/[0.02] backdrop-blur-2xl p-1 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
      <div className="rounded-xl bg-[#06060b]/90 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-5 h-5 rounded bg-[#06b6d4]/20 flex items-center justify-center">
            <MessageSquare className="h-3 w-3 text-[#06b6d4]" />
          </div>
          <span className="text-[10px] font-tech text-muted-foreground/50">AI Assistant</span>
        </div>
        <p className="text-xs text-foreground/70 leading-[1.8] min-h-[3.5em]">
          <span ref={ref} />
          <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.6, repeat: Infinity }} className="text-[#06b6d4]">|</motion.span>
        </p>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#06b6d4]/20 bg-[#06b6d4]/[0.04] w-fit mt-3">
          <div className="w-1.5 h-1.5 rounded-full bg-[#06b6d4]" />
          <span className="text-[9px] font-tech text-[#06b6d4]">{`Source: YourDomain.com`}</span>
        </div>
      </div>
    </div>
  );
}

/* ── Block 2 visual: Spectrum graph ── */
function SpectrumGraph() {
  const aiPath = "M0,50 L30,48 L60,52 L90,49 L120,51 L150,50 L180,48 L210,52 L240,50 L270,49 L300,51";
  const humanPath = "M0,55 L30,30 L60,70 L90,20 L120,60 L150,35 L180,75 L210,25 L240,65 L270,40 L300,45";

  return (
    <div className="w-full max-w-[380px] rounded-2xl border-t border-l border-r border-b border-t-white/15 border-l-white/8 border-r-white/4 border-b-white/[0.02] bg-white/[0.02] backdrop-blur-2xl p-1 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
      <div className="rounded-xl bg-[#06060b]/90 p-5">
        <p className="text-[9px] font-tech text-muted-foreground/40 uppercase tracking-widest mb-4">Spectral Analysis</p>
        <svg viewBox="0 0 300 90" className="w-full h-auto">
          {/* AI line — flat */}
          <motion.path
            d={aiPath} fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 4" opacity={0.5}
            initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }}
            transition={{ duration: 1.5 }}
          />
          {/* Human line — chaotic */}
          <motion.path
            d={humanPath} fill="none" stroke="#10b981" strokeWidth="2"
            initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }}
            transition={{ duration: 2, delay: 0.5 }}
          />
        </svg>
        <div className="flex items-center gap-6 mt-3">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-px bg-red-400 opacity-50" style={{ borderTop: "1.5px dashed #ef4444" }} />
            <span className="text-[8px] font-tech text-red-400/60">LLM Pattern</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-emerald-400 rounded" />
            <span className="text-[8px] font-tech text-emerald-400/60">Human Signal</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Block 3 visual: Pipeline ── */
function PipelineVisual() {
  const steps = [
    { label: "SERP Analysis", color: "#8b5cf6" },
    { label: "Content Synthesis", color: "#3b82f6" },
    { label: "WP Publish", color: "#10b981" },
  ];

  return (
    <div className="w-full max-w-[380px] rounded-2xl border-t border-l border-r border-b border-t-white/15 border-l-white/8 border-r-white/4 border-b-white/[0.02] bg-white/[0.02] backdrop-blur-2xl p-1 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
      <div className="rounded-xl bg-[#06060b]/90 p-5">
        <p className="text-[9px] font-tech text-muted-foreground/40 uppercase tracking-widest mb-5">Pipeline</p>
        <div className="flex items-center gap-2">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2 flex-1">
              <motion.div
                className="flex flex-col items-center gap-1.5 flex-1"
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 + i * 0.15 }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center border border-white/[0.06]"
                  style={{ background: `${step.color}12`, boxShadow: `0 0 20px ${step.color}10` }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: step.color, boxShadow: `0 0 8px ${step.color}` }} />
                </div>
                <span className="text-[7px] font-tech uppercase tracking-wider text-center" style={{ color: step.color }}>{step.label}</span>
              </motion.div>
              {i < steps.length - 1 && (
                <div className="w-6 h-px shrink-0 -mt-4" style={{ background: `linear-gradient(90deg, ${step.color}40, ${steps[i + 1].color}40)` }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Main export ── */
export function SectionDeepDive() {
  const { t } = useI18n();

  return (
    <div className="relative py-16">

      {/* ═══ Block 1: GEO Evolution — visual left, text right ═══ */}
      <section className="relative py-32 overflow-hidden">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="flex flex-col lg:flex-row-reverse items-center gap-16 lg:gap-24">
            <motion.div className="flex-1 space-y-6" {...fadeUp}>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#06b6d4]/20 bg-[#06b6d4]/5 px-4 py-1.5">
                <Globe className="h-3.5 w-3.5 text-[#06b6d4]" />
                <span className="text-[10px] font-tech font-medium text-[#06b6d4] uppercase tracking-widest">GEO</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-[1.05]" style={{ letterSpacing: "-0.05em", textShadow: "0 0 60px rgba(6,182,212,0.08)" }}>
                {t("deep2.geoH1")}{" "}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#06b6d4] to-[#3b82f6]">{t("deep2.geoH2")}</span>
              </h2>
              <p className="text-[15px] text-muted-foreground/80 leading-[1.8] max-w-xl" dangerouslySetInnerHTML={{ __html: t("deep2.geoBody") }} />
              <p className="text-sm font-tech text-[#06b6d4]/80 tracking-wider">{t("deep2.geoMetric")}</p>
            </motion.div>

            <motion.div className="flex-1 flex justify-center" {...fadeUp} transition={{ duration: 0.8, delay: 0.15 }}>
              <ChatbotVisual text={t("deep2.geoTyping")} />
            </motion.div>
          </div>
        </div>
      </section>

      <Divider />

      {/* ═══ Block 2: Stealth — text left, visual right ═══ */}
      <section className="relative py-32 overflow-hidden">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="flex flex-col lg:flex-row items-center gap-16 lg:gap-24">
            <motion.div className="flex-1 space-y-6" {...fadeUp}>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5">
                <Shield className="h-3.5 w-3.5 text-primary" />
                <span className="text-[10px] font-tech font-medium text-primary uppercase tracking-widest">Stealth Engine</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-[1.05]" style={{ letterSpacing: "-0.05em", textShadow: "0 0 60px rgba(139,92,246,0.08)" }}>
                {t("deep2.stealthH1")}{" "}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-[#3b82f6]">{t("deep2.stealthH2")}</span>
              </h2>
              <p className="text-[15px] text-muted-foreground/80 leading-[1.8] max-w-xl" dangerouslySetInnerHTML={{ __html: t("deep2.stealthBody") }} />
              <p className="text-sm font-tech text-emerald-400/80 tracking-wider">{t("deep2.stealthMetric")}</p>
            </motion.div>

            <motion.div className="flex-1 flex justify-center" {...fadeUp} transition={{ duration: 0.8, delay: 0.15 }}>
              <SpectrumGraph />
            </motion.div>
          </div>
        </div>
      </section>

      <Divider />

      {/* ═══ Block 3: Factory Scale — visual left, text right ═══ */}
      <section className="relative py-32 overflow-hidden">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="flex flex-col lg:flex-row-reverse items-center gap-16 lg:gap-24">
            <motion.div className="flex-1 space-y-6" {...fadeUp}>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#f59e0b]/20 bg-[#f59e0b]/5 px-4 py-1.5">
                <Layers className="h-3.5 w-3.5 text-[#f59e0b]" />
                <span className="text-[10px] font-tech font-medium text-[#f59e0b] uppercase tracking-widest">Factory</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-[1.05]" style={{ letterSpacing: "-0.05em", textShadow: "0 0 60px rgba(245,158,11,0.08)" }}>
                {t("deep2.factoryH1")}{" "}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#f59e0b] to-[#ef4444]">{t("deep2.factoryH2")}</span>
              </h2>
              <p className="text-[15px] text-muted-foreground/80 leading-[1.8] max-w-xl" dangerouslySetInnerHTML={{ __html: t("deep2.factoryBody") }} />
              <p className="text-sm font-tech text-[#f59e0b]/80 tracking-wider">{t("deep2.factoryMetric")}</p>
            </motion.div>

            <motion.div className="flex-1 flex justify-center" {...fadeUp} transition={{ duration: 0.8, delay: 0.15 }}>
              <PipelineVisual />
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}
