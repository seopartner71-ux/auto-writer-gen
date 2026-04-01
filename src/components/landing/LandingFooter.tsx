import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Hexagon, Send, Youtube, Github, ShieldCheck, Sparkles } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const fadeUp = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.5 } } };

const integrations = ["WordPress", "Google Indexing API", "Yoast", "RankMath", "OpenRouter"];

const trustBadges = [
  { labelRu: "Google Helpful Content Safe", labelEn: "Google Helpful Content Safe" },
  { labelRu: "Stealth-Tech Verified", labelEn: "Stealth-Tech Verified" },
];

export function LandingFooter() {
  const navigate = useNavigate();
  const { t, lang, setLang } = useI18n();
  const isEn = lang === "en";

  const navLinks = [
    { label: t("lp.footerProduct"), to: "/dashboard" },
    { label: t("lp.footerSolutions"), to: "/pricing" },
    { label: t("lp.footerWiki"), to: "/wiki" },
    { label: t("lp.footerSupport"), to: "/support" },
  ];

  return (
    <footer className="relative border-t border-[#06b6d4]/10 bg-[#050505]/90 backdrop-blur-2xl"
      style={{ boxShadow: "0 -1px 40px rgba(6,182,212,0.04)" }}>
      <div className="container mx-auto px-4 py-14 max-w-6xl">
        {/* Trust badges + Integrations */}
        <motion.div variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true }}
          className="mb-10 pb-10 border-b border-white/[0.04]">
          {/* Trust */}
          <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-4 mb-6">
            {trustBadges.map((b, i) => (
              <div key={i} className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-[11px] font-tech font-medium text-emerald-400 tracking-wide">{isEn ? b.labelEn : b.labelRu}</span>
              </div>
            ))}
          </motion.div>

          {/* Integrations */}
          <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-3">
            <span className="text-[10px] font-tech text-muted-foreground/40 uppercase tracking-widest mr-2">
              {isEn ? "Integrations:" : "Интеграции:"}
            </span>
            {integrations.map((name, i) => (
              <span key={i} className="text-[10px] font-mono text-muted-foreground/50 px-2.5 py-1 rounded-full border border-white/[0.04] bg-white/[0.01]">
                {name}
              </span>
            ))}
          </motion.div>
        </motion.div>

        <motion.div variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true }}
          className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-6 items-start">
          {/* Left */}
          <motion.div variants={fadeUp} className="space-y-5">
            <div className="flex items-center gap-2">
              <Hexagon className="h-5 w-5 text-[#06b6d4]" />
              <span className="text-lg font-brand tracking-tight">
                Auto-Writer<span className="bg-clip-text text-transparent bg-gradient-to-r from-[#06b6d4] to-[#8b5cf6]">-Gen</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              <span className="text-[11px] font-tech text-emerald-400/80 tracking-wide">{t("lp.footerStatus")}</span>
            </div>
          </motion.div>

          {/* Center */}
          <motion.div variants={fadeUp} className="flex flex-wrap justify-center gap-x-8 gap-y-3">
            {navLinks.map((link, i) => (
              <motion.button key={i} onClick={() => navigate(link.to)} whileHover={{ y: -2 }}
                className="text-sm text-muted-foreground/60 hover:text-foreground transition-all duration-200">
                {link.label}
              </motion.button>
            ))}
          </motion.div>

          {/* Right */}
          <motion.div variants={fadeUp} className="flex items-center justify-end gap-4">
            <div className="flex items-center rounded-full border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl p-0.5">
              <button onClick={() => setLang("ru")}
                className={`px-3 py-1 text-xs font-tech font-medium rounded-full transition-all duration-200 ${lang === "ru" ? "bg-[#06b6d4]/20 text-[#06b6d4] border border-[#06b6d4]/30" : "text-muted-foreground/50 hover:text-foreground border border-transparent"}`}>
                RU
              </button>
              <button onClick={() => setLang("en")}
                className={`px-3 py-1 text-xs font-tech font-medium rounded-full transition-all duration-200 ${lang === "en" ? "bg-[#06b6d4]/20 text-[#06b6d4] border border-[#06b6d4]/30" : "text-muted-foreground/50 hover:text-foreground border border-transparent"}`}>
                EN
              </button>
            </div>
            <div className="flex items-center gap-2">
              {[
                { icon: Send, href: "#", label: "Telegram" },
                { icon: Youtube, href: "#", label: "YouTube" },
                { icon: Github, href: "#", label: "GitHub" },
              ].map((s, i) => (
                <a key={i} href={s.href} aria-label={s.label}
                  className="w-8 h-8 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:border-white/[0.12] transition-all duration-200">
                  <s.icon className="h-3.5 w-3.5" />
                </a>
              ))}
            </div>
          </motion.div>
        </motion.div>

        {/* Legal */}
        <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
          className="mt-12 pt-6 border-t border-white/[0.04] flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[10px] font-mono text-muted-foreground/25 tracking-wide">
            &copy; {new Date().getFullYear()} Auto-Writer-Gen v1.0 - {t("landing.copyright")}
          </p>
          <p className="text-[9px] font-mono text-muted-foreground/20 tracking-wider max-w-md text-center sm:text-right leading-relaxed">
            {t("lp.footerLegal")}
          </p>
        </motion.div>
      </div>
    </footer>
  );
}
