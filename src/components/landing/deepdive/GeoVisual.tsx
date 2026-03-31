import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/* Floating particles */
function Particles() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {Array.from({ length: 8 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-[#06b6d4]/60"
          style={{ left: `${10 + Math.random() * 30}%`, top: `${20 + Math.random() * 60}%` }}
          animate={{
            x: [0, 150 + Math.random() * 100],
            y: [0, -20 + Math.random() * 40],
            opacity: [0, 0.8, 0],
            scale: [0.5, 1, 0.3],
          }}
          transition={{ duration: 3 + Math.random() * 2, repeat: Infinity, delay: i * 0.5, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

export function GeoVisual({ typingText }: { typingText: string }) {
  const displayed = useMotionValue(0);
  const rounded = useTransform(displayed, (v) => Math.round(v));
  const ref = useRef<HTMLSpanElement>(null);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    const ctrl = animate(displayed, typingText.length, {
      duration: 4,
      delay: 0.8,
      ease: "easeOut",
      onComplete: () => setShowSource(true),
    });
    const unsub = rounded.on("change", (v) => {
      if (ref.current) ref.current.textContent = typingText.slice(0, v);
    });
    return () => { ctrl.stop(); unsub(); };
  }, [typingText]);

  return (
    <div className="relative w-full max-w-[520px]">
      <Particles />

      {/* Terminal window */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#08080f]/95 backdrop-blur-2xl shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_40px_rgba(6,182,212,0.06)] overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.04] bg-white/[0.01]">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/40" />
          </div>
          <span className="text-[9px] font-mono text-muted-foreground/30 ml-2">ai-assistant — inference</span>
        </div>

        {/* Content */}
        <div className="p-6 min-h-[200px]">
          <div className="flex items-start gap-3 mb-5">
            <div className="w-7 h-7 rounded-lg bg-[#06b6d4]/15 border border-[#06b6d4]/20 flex items-center justify-center shrink-0 mt-0.5">
              <MessageSquare className="h-3.5 w-3.5 text-[#06b6d4]" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-mono text-[#06b6d4]/70">AI Assistant</span>
                <span className="text-[8px] font-mono text-muted-foreground/20">streaming...</span>
              </div>
              <p className="text-sm text-foreground/80 leading-[1.8] font-mono">
                <span ref={ref} />
                <motion.span
                  animate={{ opacity: [1, 0] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                  className="text-[#06b6d4] ml-0.5"
                >▊</motion.span>
              </p>
            </div>
          </div>

          {/* Source card */}
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={showSource ? { opacity: 1, y: 0, scale: 1 } : {}}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-[#06b6d4]/20 bg-[#06b6d4]/[0.04]"
          >
            <div className="w-8 h-8 rounded-lg bg-[#06b6d4]/10 flex items-center justify-center">
              <div className="w-2.5 h-2.5 rounded-full bg-[#06b6d4] shadow-[0_0_12px_rgba(6,182,212,0.6)]" />
            </div>
            <div>
              <p className="text-[10px] font-mono text-[#06b6d4] font-medium">Cited as Primary Source</p>
              <p className="text-[9px] font-mono text-muted-foreground/40">YourDomain.com — Trust Score: 94%</p>
            </div>
            <motion.div
              className="ml-auto"
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            </motion.div>
          </motion.div>
        </div>

        {/* Status bar */}
        <div className="px-4 py-2 border-t border-white/[0.03] bg-white/[0.005] flex items-center justify-between">
          <span className="text-[8px] font-mono text-muted-foreground/20">model: gpt-5 | tokens: 847</span>
          <span className="text-[8px] font-mono text-emerald-400/40">● connected</span>
        </div>
      </div>
    </div>
  );
}
