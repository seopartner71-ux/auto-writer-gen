import { motion } from "framer-motion";
import { Workflow, Calendar, Globe, Plug } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function LandingFactory() {
  const { t } = useI18n();

  const integrations = [
    { icon: "⚡", label: "WordPress" },
    { icon: "📊", label: "Yoast SEO" },
    { icon: "🏆", label: "RankMath" },
    { icon: "📅", label: "Scheduler" },
  ];

  return (
    <section className="relative py-24 overflow-hidden">
      <div className="pointer-events-none absolute bottom-0 left-1/4 w-[500px] h-[400px] rounded-full bg-[#3b82f6]/6 blur-[160px]" />

      <div className="container mx-auto px-4 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold">
            {t("lp.factoryTitle")}
          </h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
            {t("lp.factorySub")}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { icon: Workflow, title: t("lp.factF1Title"), desc: t("lp.factF1Desc"), color: "#3b82f6" },
            { icon: Calendar, title: t("lp.factF2Title"), desc: t("lp.factF2Desc"), color: "#8b5cf6" },
            { icon: Plug, title: t("lp.factF3Title"), desc: t("lp.factF3Desc"), color: "#10b981" },
          ].map((f, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="group rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm p-6 hover:border-white/[0.12] transition-all"
            >
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl mb-4" style={{ backgroundColor: `${f.color}15` }}>
                <f.icon className="h-5 w-5" style={{ color: f.color }} />
              </div>
              <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Integration badges */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="mt-12 flex flex-wrap items-center justify-center gap-3"
        >
          {integrations.map((int, i) => (
            <div key={i} className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm px-5 py-2.5">
              <span className="text-lg">{int.icon}</span>
              <span className="text-sm font-medium">{int.label}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
