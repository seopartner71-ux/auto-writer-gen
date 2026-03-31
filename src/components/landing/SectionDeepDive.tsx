import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useI18n } from "@/shared/hooks/useI18n";
import { Globe, Shield, Layers, MessageSquare, Wifi, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GeoVisual } from "./deepdive/GeoVisual";
import { StealthVisual } from "./deepdive/StealthVisual";
import { FactoryVisual } from "./deepdive/FactoryVisual";
import { RadarVisual } from "./deepdive/RadarVisual";

const fadeUp = {
  initial: { opacity: 0, y: 50 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.7 },
};

function Divider() {
  return (
    <div className="container mx-auto px-4 max-w-5xl">
      <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
    </div>
  );
}

export function SectionDeepDive() {
  const { t } = useI18n();

  return (
    <div className="relative py-8">
      {/* ═══ Block 1: GEO ═══ */}
      <section className="relative py-28 overflow-hidden">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="flex flex-col lg:flex-row-reverse items-center gap-12 lg:gap-16">
            <motion.div className="flex-1 space-y-6 max-w-lg" {...fadeUp}>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#06b6d4]/20 bg-[#06b6d4]/5 px-4 py-1.5">
                <Globe className="h-3.5 w-3.5 text-[#06b6d4]" />
                <span className="text-[10px] font-tech font-medium text-[#06b6d4] uppercase tracking-widest">GEO</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-[1.05]" style={{ letterSpacing: "-0.05em", textShadow: "0 0 60px rgba(6,182,212,0.08)" }}>
                {t("deep2.geoH1")}{" "}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#06b6d4] to-[#3b82f6]">{t("deep2.geoH2")}</span>
              </h2>
              <p className="text-[15px] text-muted-foreground/80 leading-[1.8]" dangerouslySetInnerHTML={{ __html: t("deep2.geoBody") }} />
              <p className="text-sm font-tech text-[#06b6d4]/80 tracking-wider">{t("deep2.geoMetric")}</p>
            </motion.div>
            <motion.div className="flex-1 flex justify-center w-full" {...fadeUp} transition={{ duration: 0.8, delay: 0.15 }}>
              <GeoVisual typingText={t("deep2.geoTyping")} />
            </motion.div>
          </div>
        </div>
      </section>

      <Divider />

      {/* ═══ Block 2: Stealth ═══ */}
      <section className="relative py-28 overflow-hidden">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
            <motion.div className="flex-1 space-y-6 max-w-lg" {...fadeUp}>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5">
                <Shield className="h-3.5 w-3.5 text-primary" />
                <span className="text-[10px] font-tech font-medium text-primary uppercase tracking-widest">Stealth Engine</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-[1.05]" style={{ letterSpacing: "-0.05em", textShadow: "0 0 60px rgba(139,92,246,0.08)" }}>
                {t("deep2.stealthH1")}{" "}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-[#3b82f6]">{t("deep2.stealthH2")}</span>
              </h2>
              <p className="text-[15px] text-muted-foreground/80 leading-[1.8]" dangerouslySetInnerHTML={{ __html: t("deep2.stealthBody") }} />
              <p className="text-sm font-tech text-emerald-400/80 tracking-wider">{t("deep2.stealthMetric")}</p>
            </motion.div>
            <motion.div className="flex-1 flex justify-center w-full" {...fadeUp} transition={{ duration: 0.8, delay: 0.15 }}>
              <StealthVisual />
            </motion.div>
          </div>
        </div>
      </section>

      <Divider />

      {/* ═══ Block 3: Factory ═══ */}
      <section className="relative py-28 overflow-hidden">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="flex flex-col lg:flex-row-reverse items-center gap-12 lg:gap-16">
            <motion.div className="flex-1 space-y-6 max-w-lg" {...fadeUp}>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#f59e0b]/20 bg-[#f59e0b]/5 px-4 py-1.5">
                <Layers className="h-3.5 w-3.5 text-[#f59e0b]" />
                <span className="text-[10px] font-tech font-medium text-[#f59e0b] uppercase tracking-widest">Factory</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-[1.05]" style={{ letterSpacing: "-0.05em", textShadow: "0 0 60px rgba(245,158,11,0.08)" }}>
                {t("deep2.factoryH1")}{" "}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#f59e0b] to-[#ef4444]">{t("deep2.factoryH2")}</span>
              </h2>
              <p className="text-[15px] text-muted-foreground/80 leading-[1.8]" dangerouslySetInnerHTML={{ __html: t("deep2.factoryBody") }} />
              <p className="text-sm font-tech text-[#f59e0b]/80 tracking-wider">{t("deep2.factoryMetric")}</p>
            </motion.div>
            <motion.div className="flex-1 flex justify-center w-full" {...fadeUp} transition={{ duration: 0.8, delay: 0.15 }}>
              <FactoryVisual />
            </motion.div>
          </div>
        </div>
      </section>

      <Divider />

      {/* ═══ Block 4: AI Radar ═══ */}
      <section className="relative py-28 overflow-hidden">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
            <motion.div className="flex-1 space-y-6 max-w-lg" {...fadeUp}>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#06b6d4]/20 bg-[#06b6d4]/5 px-4 py-1.5">
                <Wifi className="h-3.5 w-3.5 text-[#06b6d4]" />
                <span className="text-[10px] font-tech font-medium text-[#06b6d4] uppercase tracking-widest">AI Radar</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-[1.05]" style={{ letterSpacing: "-0.05em", textShadow: "0 0 60px rgba(6,182,212,0.08)" }}>
                {t("deep2.radarH1")}{" "}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#06b6d4] to-primary">{t("deep2.radarH2")}</span>
              </h2>
              <p className="text-[15px] text-muted-foreground/80 leading-[1.8]" dangerouslySetInnerHTML={{ __html: t("deep2.radarBody") }} />
              <p className="text-sm font-tech text-[#06b6d4]/80 tracking-wider">{t("deep2.radarMetric")}</p>
            </motion.div>
            <motion.div className="flex-1 flex justify-center w-full" {...fadeUp} transition={{ duration: 0.8, delay: 0.15 }}>
              <RadarVisual />
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}
