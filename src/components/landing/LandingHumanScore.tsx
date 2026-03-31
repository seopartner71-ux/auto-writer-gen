import { useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Bot, User } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function LandingHumanScore() {
  const { t } = useI18n();
  const [showAfter, setShowAfter] = useState(false);

  return (
    <section className="relative py-24 overflow-hidden">
      {/* Glow */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-[#10b981]/8 blur-[160px]" />

      <div className="container mx-auto px-4 max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold">
            {t("lp.humanTitle")}
          </h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
            {t("lp.humanSub")}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm p-6 sm:p-10"
        >
          {/* Toggle */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <button
              onClick={() => setShowAfter(false)}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                !showAfter
                  ? "bg-red-500/20 text-red-400 border border-red-500/30"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Bot className="inline h-4 w-4 mr-1.5 -mt-0.5" />
              Before
            </button>
            <button
              onClick={() => setShowAfter(true)}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                showAfter
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <User className="inline h-4 w-4 mr-1.5 -mt-0.5" />
              After
            </button>
          </div>

          {/* Score visualization */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="space-y-4">
              {/* Score bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Human Score</span>
                  <span className={`font-bold ${showAfter ? "text-emerald-400" : "text-red-400"}`}>
                    {showAfter ? "94%" : "23%"}
                  </span>
                </div>
                <div className="h-3 rounded-full bg-white/5 overflow-hidden">
                  <motion.div
                    initial={false}
                    animate={{ width: showAfter ? "94%" : "23%" }}
                    transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                    className={`h-full rounded-full ${showAfter ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : "bg-gradient-to-r from-red-600 to-red-400"}`}
                  />
                </div>
              </div>

              {/* Perplexity */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Perplexity</span>
                  <span className={`font-bold ${showAfter ? "text-emerald-400" : "text-red-400"}`}>
                    {showAfter ? "142" : "18"}
                  </span>
                </div>
                <div className="h-3 rounded-full bg-white/5 overflow-hidden">
                  <motion.div
                    initial={false}
                    animate={{ width: showAfter ? "85%" : "12%" }}
                    transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                    className={`h-full rounded-full ${showAfter ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : "bg-gradient-to-r from-red-600 to-red-400"}`}
                  />
                </div>
              </div>

              {/* Burstiness */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Burstiness</span>
                  <span className={`font-bold ${showAfter ? "text-emerald-400" : "text-yellow-400"}`}>
                    {showAfter ? "0.89" : "0.31"}
                  </span>
                </div>
                <div className="h-3 rounded-full bg-white/5 overflow-hidden">
                  <motion.div
                    initial={false}
                    animate={{ width: showAfter ? "89%" : "31%" }}
                    transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                    className={`h-full rounded-full ${showAfter ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : "bg-gradient-to-r from-yellow-600 to-yellow-400"}`}
                  />
                </div>
              </div>
            </div>

            <div className="text-center space-y-4">
              <motion.div
                initial={false}
                animate={{ scale: showAfter ? 1 : 0.9 }}
                transition={{ duration: 0.5 }}
              >
                <ShieldCheck
                  className={`mx-auto h-20 w-20 transition-colors duration-500 ${showAfter ? "text-emerald-400" : "text-red-400"}`}
                />
              </motion.div>
              <p className={`text-lg font-semibold transition-colors duration-500 ${showAfter ? "text-emerald-400" : "text-red-400"}`}>
                {showAfter ? t("lp.humanPass") : t("lp.humanFail")}
              </p>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                {showAfter ? t("lp.humanPassDesc") : t("lp.humanFailDesc")}
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
