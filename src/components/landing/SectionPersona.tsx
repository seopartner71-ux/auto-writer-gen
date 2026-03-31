import { useState } from "react";
import { motion } from "framer-motion";
import { Stethoscope, TrendingDown, Terminal, BrainCircuit } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const personas = [
  { icon: Stethoscope, nameRu: "Врач-доказательник", nameEn: "Evidence MD", color: "#10b981",
    textRu: "Тут такое дело: метаанализ 2024 года ломает старую парадигму. Забудьте то, что писали в учебниках (честно, сам в шоке).",
    textEn: "Here's the deal: the 2024 meta-analysis breaks the old paradigm. Forget what textbooks say (honestly, I'm shocked too)." },
  { icon: TrendingDown, nameRu: "Скептичный инвестор", nameEn: "Skeptic Investor", color: "#f59e0b",
    textRu: "Рынок просел на 12%. Хомяки паникуют, а кто с головой - фиксирует профит. Деньги можно потерять в один клик.",
    textEn: "Market's down 12%. Retail panics while the smart money takes profit. You can lose everything in one click." },
  { icon: Terminal, nameRu: "Senior Developer", nameEn: "Senior Developer", color: "#3b82f6",
    textRu: "Под капотом - чистый Rust. Латенси 4ms. Да, это костыль, но он работает стабильнее 90% 'элегантных' решений.",
    textEn: "Under the hood - pure Rust. 4ms latency. Yes, it's a hack, but it's more stable than 90% of 'elegant' solutions." },
  { icon: BrainCircuit, nameRu: "Прямой терапевт", nameEn: "Direct Therapist", color: "#ec4899",
    textRu: "Ваш мозг вас обманывает. Дофаминовая ловушка. Это не слабость - это нейрохимия (честно, это больно, но необходимо).",
    textEn: "Your brain is lying to you. Dopamine trap. It's not weakness - it's neurochemistry (honestly, it hurts but it's necessary)." },
];

export function SectionPersona() {
  const { t, lang } = useI18n();
  const [active, setActive] = useState(0);
  const isEn = lang === "en";

  return (
    <section className="relative min-h-screen flex items-center justify-center snap-start overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] rounded-full bg-[#ec4899]/[0.04] blur-[220px]" />

      <div className="relative z-10 container mx-auto px-4 max-w-5xl">
        <motion.div initial={{ opacity: 0, y: 50 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
          className="text-center mb-16">
          <h2 className="text-5xl sm:text-6xl md:text-7xl font-black leading-[0.95]" style={{ letterSpacing: "-0.06em", textShadow: "0 0 80px rgba(236,72,153,0.08)" }}>
            {t("lp.personaTitle")}
          </h2>
          <p className="mt-5 text-muted-foreground text-[15px] max-w-2xl mx-auto leading-[1.7]">{t("lp.personaSub")}</p>
        </motion.div>

        {/* Floating persona cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {personas.map((p, i) => {
            const Icon = p.icon;
            const isActive = active === i;
            return (
              <motion.button
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                whileHover={{ y: -6, scale: 1.03 }}
                onClick={() => setActive(i)}
                className={`group relative rounded-2xl border-t border-l border-r border-b p-5 text-left transition-all duration-500 backdrop-blur-2xl cursor-pointer ${
                  isActive
                    ? "border-t-white/30 border-l-white/15 border-r-white/10 border-b-white/[0.03] bg-white/[0.04]"
                    : "border-t-white/10 border-l-white/5 border-r-white/[0.03] border-b-white/[0.01] bg-white/[0.01] hover:bg-white/[0.03]"
                }`}
                style={{
                  boxShadow: isActive
                    ? `0 20px 50px rgba(0,0,0,0.5), 0 0 30px ${p.color}15`
                    : "0 10px 30px rgba(0,0,0,0.3)",
                }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: `${p.color}15` }}>
                  <Icon className="h-5 w-5" style={{ color: p.color }} />
                </div>
                <p className="text-sm font-semibold">{isEn ? p.nameEn : p.nameRu}</p>
                {isActive && <motion.div layoutId="persona-dot" className="absolute top-3 right-3 w-2 h-2 rounded-full" style={{ background: p.color }} />}
              </motion.button>
            );
          })}
        </div>

        {/* Active persona text preview */}
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 }}
          className="rounded-3xl border-t border-l border-r border-b border-t-white/20 border-l-white/10 border-r-white/5 border-b-white/[0.02] bg-white/[0.02] backdrop-blur-2xl p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.5),0_0_20px_rgba(139,92,246,0.08)]">
          <div className="rounded-2xl bg-[#06060b]/90 p-6 sm:p-8">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full" style={{ background: personas[active].color }} />
              <span className="text-[10px] font-tech uppercase tracking-wider" style={{ color: personas[active].color }}>
                {isEn ? personas[active].nameEn : personas[active].nameRu}
              </span>
            </div>
            <motion.p key={active} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
              className="text-sm text-foreground/80 leading-[1.8] max-w-2xl">
              {isEn ? personas[active].textEn : personas[active].textRu}
            </motion.p>
          </div>
        </motion.div>

        <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.5 }}
          className="text-center mt-8 text-sm font-tech text-[#ec4899]/80 tracking-wide">
          {t("lp.personaMetric")}
        </motion.p>
      </div>
    </section>
  );
}
