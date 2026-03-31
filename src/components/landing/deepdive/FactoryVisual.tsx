import { motion } from "framer-motion";
import { FileText } from "lucide-react";
import { useState, useEffect } from "react";

const nodes = [
  { label: "SERP", color: "#8b5cf6", x: 15 },
  { label: "SYNTHESIS", color: "#3b82f6", x: 45 },
  { label: "STEALTH FIX", color: "#10b981", x: 75 },
];

function DataPacket({ delay }: { delay: number }) {
  return (
    <motion.div
      className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_12px_rgba(139,92,246,0.7)]"
      initial={{ left: "5%", opacity: 0 }}
      animate={{
        left: ["5%", "15%", "45%", "75%", "95%"],
        opacity: [0, 1, 1, 1, 0],
        scale: [0.6, 1, 1.2, 1, 0.6],
      }}
      transition={{
        duration: 4,
        delay,
        repeat: Infinity,
        ease: "easeInOut",
        times: [0, 0.15, 0.45, 0.75, 1],
      }}
    />
  );
}

export function FactoryVisual() {
  const [activeNode, setActiveNode] = useState(-1);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveNode((p) => (p + 1) % 4);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative w-full max-w-[520px]">
      <div className="rounded-2xl border border-white/[0.06] bg-[#08080f]/95 backdrop-blur-2xl shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_40px_rgba(245,158,11,0.06)] overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.04] bg-white/[0.01]">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/40" />
            </div>
            <span className="text-[9px] font-mono text-muted-foreground/30 ml-2">factory-pipeline.run</span>
          </div>
          <span className="text-[8px] font-mono text-[#f59e0b]/50">batch: 48/100</span>
        </div>

        {/* Pipeline area */}
        <div className="p-6 relative" style={{ minHeight: 200 }}>
          {/* Connection lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
            <line x1="20%" y1="50%" x2="42%" y2="50%" stroke="rgba(255,255,255,0.04)" strokeWidth="2" />
            <line x1="50%" y1="50%" x2="72%" y2="50%" stroke="rgba(255,255,255,0.04)" strokeWidth="2" />
            <line x1="80%" y1="50%" x2="95%" y2="50%" stroke="rgba(255,255,255,0.04)" strokeWidth="2" />
          </svg>

          {/* Animated data packets */}
          <DataPacket delay={0} />
          <DataPacket delay={1.3} />
          <DataPacket delay={2.6} />

          {/* Nodes */}
          <div className="relative flex items-center justify-between px-4" style={{ minHeight: 160 }}>
            {nodes.map((node, i) => (
              <motion.div
                key={i}
                className="flex flex-col items-center gap-3 z-10"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2 + i * 0.15 }}
              >
                <motion.div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center border"
                  style={{
                    borderColor: `${node.color}30`,
                    background: `${node.color}08`,
                  }}
                  animate={activeNode === i ? {
                    boxShadow: [`0 0 0px ${node.color}00`, `0 0 30px ${node.color}40`, `0 0 0px ${node.color}00`],
                    scale: [1, 1.1, 1],
                  } : {}}
                  transition={{ duration: 0.8 }}
                >
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ background: node.color, boxShadow: `0 0 10px ${node.color}60` }}
                  />
                </motion.div>
                <span className="text-[8px] font-mono uppercase tracking-widest" style={{ color: node.color }}>
                  {node.label}
                </span>
              </motion.div>
            ))}

            {/* Output: WP card */}
            <motion.div
              className="flex flex-col items-center gap-3 z-10"
              initial={{ opacity: 0, scale: 0.8 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.7 }}
            >
              <motion.div
                className="w-16 h-16 rounded-2xl flex items-center justify-center border border-[#f59e0b]/30 bg-[#f59e0b]/[0.06]"
                animate={activeNode === 3 ? {
                  boxShadow: ["0 0 0px transparent", "0 0 30px rgba(245,158,11,0.3)", "0 0 0px transparent"],
                  scale: [1, 1.1, 1],
                } : {}}
                transition={{ duration: 0.8 }}
              >
                <FileText className="h-5 w-5 text-[#f59e0b]" />
              </motion.div>
              <span className="text-[8px] font-mono uppercase tracking-widest text-[#f59e0b]">WP PUBLISH</span>
            </motion.div>
          </div>

          {/* Bottom stats */}
          <div className="flex items-center justify-between mt-2 px-2">
            <span className="text-[8px] font-mono text-muted-foreground/20">throughput: 6.2 art/min</span>
            <span className="text-[8px] font-mono text-emerald-400/40">● all nodes healthy</span>
          </div>
        </div>
      </div>
    </div>
  );
}
