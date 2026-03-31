import { motion } from "framer-motion";
import { Search, ListTree, UserCircle, Factory, Radar, Zap } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const reveal = {
  hidden: { opacity: 0, y: 30 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] },
  }),
};

export function LandingBento() {
  const { t } = useI18n();

  const features = [
    {
      icon: Search,
      title: t("lp.feat1Title"),
      desc: t("lp.feat1Desc"),
      color: "#8b5cf6",
      span: "md:col-span-2",
    },
    {
      icon: ListTree,
      title: t("lp.feat2Title"),
      desc: t("lp.feat2Desc"),
      color: "#3b82f6",
      span: "",
    },
    {
      icon: UserCircle,
      title: t("lp.feat3Title"),
      desc: t("lp.feat3Desc"),
      color: "#10b981",
      span: "",
    },
    {
      icon: Factory,
      title: t("lp.feat4Title"),
      desc: t("lp.feat4Desc"),
      color: "#f59e0b",
      span: "md:col-span-2",
    },
  ];

  return (
    <section className="relative py-24 overflow-hidden">
      <div className="container mx-auto px-4 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold">
            {t("lp.featuresTitle")}
          </h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
            {t("lp.featuresSub")}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <motion.div
              key={i}
              custom={i}
              variants={reveal}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className={`group relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm p-6 sm:p-8 hover:border-white/[0.12] transition-all duration-500 ${f.span}`}
            >
              {/* Glow on hover */}
              <div
                className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{
                  background: `radial-gradient(400px circle at 50% 50%, ${f.color}10, transparent 70%)`,
                }}
              />
              <div className="relative z-10">
                <div
                  className="inline-flex items-center justify-center w-10 h-10 rounded-xl mb-4"
                  style={{ backgroundColor: `${f.color}15` }}
                >
                  <f.icon className="h-5 w-5" style={{ color: f.color }} />
                </div>
                <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
