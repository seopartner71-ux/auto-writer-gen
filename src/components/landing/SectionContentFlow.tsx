import { motion } from "framer-motion";
import { Map, Search, Sparkles, BarChart2, Shield, Send, TrendingUp, ArrowRight } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.7 },
};

export function SectionContentFlow() {
  const { lang } = useI18n();
  const isEn = lang === "en";

  const steps = [
    { icon: Map, label: isEn ? "Topical Map" : "Карта тем", color: "#8b5cf6" },
    { icon: Search, label: isEn ? "Research" : "Исследование", color: "#06b6d4" },
    { icon: Sparkles, label: isEn ? "Generation" : "Генерация", color: "#3b82f6" },
    { icon: BarChart2, label: isEn ? "Quality" : "Проверка", color: "#10b981" },
    { icon: Shield, label: isEn ? "Turgenev" : "Тургенев", color: "#f59e0b" },
    { icon: Send, label: isEn ? "Publish" : "Публикация", color: "#ef4444" },
    { icon: TrendingUp, label: isEn ? "Rankings" : "Позиции", color: "#10b981" },
  ];

  return (
    <section className="relative py-28 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] rounded-full bg-primary/[0.04] blur-[200px]" />

      <div className="container mx-auto px-4 max-w-6xl">
        <motion.div className="text-center mb-16" {...fadeUp}>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 mb-6">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] font-tech font-medium text-primary uppercase tracking-widest">
              {isEn ? "Full cycle" : "Полный цикл"}
            </span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-[1.05]" style={{ letterSpacing: "-0.05em" }}>
            {isEn ? "Full content cycle" : "Полный цикл контента"}
          </h2>
          <p className="mt-5 text-[#9ca3af] max-w-xl mx-auto text-[15px] leading-[1.6]">
            {isEn ? "From idea to top - all in one tool" : "От идеи до топа - все в одном инструменте"}
          </p>
        </motion.div>

        <motion.div
          className="flex flex-wrap items-center justify-center gap-3 sm:gap-4"
          {...fadeUp}
          transition={{ duration: 0.7, delay: 0.15 }}
        >
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="flex items-center gap-3 sm:gap-4">
                <div
                  className="group flex flex-col items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md px-4 py-3 sm:px-5 sm:py-4 hover:border-primary/20 hover:scale-[1.04] transition-all duration-300"
                  style={{ minWidth: 110 }}
                >
                  <div
                    className="inline-flex items-center justify-center w-10 h-10 rounded-xl"
                    style={{ background: `${s.color}1a` }}
                  >
                    <Icon className="h-5 w-5" style={{ color: s.color }} />
                  </div>
                  <span className="text-xs font-tech font-medium text-foreground/80 tracking-wide">{s.label}</span>
                </div>
                {i < steps.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground/30 hidden sm:block" />
                )}
              </div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}