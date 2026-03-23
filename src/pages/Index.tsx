import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingStats } from "@/components/landing/LandingStats";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { useI18n } from "@/shared/hooks/useI18n";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const } },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.15, delayChildren: 0.3 } },
};

export default function Index() {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <LandingNav />

      <section className="relative flex flex-col items-center justify-center pt-32 pb-20 overflow-hidden">
        <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full bg-primary/15 blur-[160px]" />

        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="relative z-10 container mx-auto px-4 text-center max-w-4xl"
        >
          <motion.h1
            variants={fadeUp}
            className={`font-extrabold tracking-tight leading-[1.05] ${lang === "ru" ? "text-4xl sm:text-5xl md:text-6xl lg:text-7xl" : "text-5xl sm:text-6xl md:text-7xl lg:text-8xl"}`}
          >
            {t("landing.headlinePart1")}{" "}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary via-violet-500 to-purple-400">
              {t("landing.headlinePart2")}
            </span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="mx-auto mt-6 max-w-2xl text-lg sm:text-xl text-muted-foreground leading-relaxed"
          >
            {t("landing.subtitle")}
          </motion.p>

          <motion.div variants={fadeUp} className="mt-10">
            <button
              onClick={() => navigate("/register")}
              className="group inline-flex items-center gap-2 rounded-full bg-primary px-8 py-4 text-base font-semibold text-primary-foreground shadow-[0_0_24px_hsl(var(--primary)/0.4)] transition-all duration-300 hover:scale-[1.04] hover:shadow-[0_0_36px_hsl(var(--primary)/0.6)] active:scale-[0.98]"
            >
              {t("landing.startBuilding")}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </motion.div>
        </motion.div>

        <LandingStats />
      </section>
    </div>
  );
}
