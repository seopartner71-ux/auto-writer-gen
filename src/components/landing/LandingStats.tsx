import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const stats = [
  { value: "47.2%", label: "Avg. ranking improvement" },
  { value: "3,841", label: "Articles generated" },
  { value: "12 min", label: "Avg. time to publish" },
];

function AnimatedStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <p className="text-3xl sm:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-violet-400">
        {value}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function LandingStats() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="relative z-10 mt-20 flex flex-wrap items-center justify-center gap-12 sm:gap-20"
    >
      {stats.map((s) => (
        <AnimatedStat key={s.label} {...s} />
      ))}
    </motion.div>
  );
}
