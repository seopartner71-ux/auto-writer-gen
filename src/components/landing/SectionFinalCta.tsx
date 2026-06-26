import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ShieldCheck, Zap, CreditCard } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function SectionFinalCta() {
  const navigate = useNavigate();
  const { lang } = useI18n();
  const isRu = lang === "ru";

  const bullets = [
    {
      icon: CreditCard,
      title: isRu ? "Без карты" : "No card required",
      desc: isRu ? "Регистрация по e-mail, ничего не списываем" : "Email sign-up, zero charges",
    },
    {
      icon: Zap,
      title: isRu ? "2 кредита сразу" : "2 free credits",
      desc: isRu ? "Хватит проверить Smart Research и сгенерировать статью" : "Enough to try Smart Research and one full article",
    },
    {
      icon: ShieldCheck,
      title: isRu ? "Отмена в 1 клик" : "Cancel in 1 click",
      desc: isRu ? "Если не зайдет - уходите без писем в поддержку" : "If it does not click - leave without support tickets",
    },
  ];

  return (
    <section className="relative py-24 px-4 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] rounded-full bg-primary/[0.08] blur-[200px]" />
      </div>

      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7 }}
          className="relative rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-white/[0.01] backdrop-blur-2xl p-8 md:p-14 text-center overflow-hidden"
        >
          <div className="pointer-events-none absolute inset-0 rounded-3xl" style={{
            background: "radial-gradient(600px circle at 50% 0%, rgba(139,92,246,0.12), transparent 60%)",
          }} />

          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 mb-6 text-[10px] font-tech font-medium text-primary uppercase tracking-widest">
              {isRu ? "Закрытая бета · набор открыт" : "Closed beta · accepting users"}
            </span>

            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white leading-[1.05]" style={{ letterSpacing: "-0.04em" }}>
              {isRu ? (
                <>Перестаньте писать руками.<br /><span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-[#3b82f6]">Соберите свой контент-конвейер.</span></>
              ) : (
                <>Stop writing manually.<br /><span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-[#3b82f6]">Build your content pipeline.</span></>
              )}
            </h2>

            <p className="mt-5 max-w-2xl mx-auto text-[15px] text-muted-foreground leading-[1.7]">
              {isRu
                ? "Smart Research, Persona Engine и Stealth Guard - в одной экосистеме. Без подписки на 10 разных сервисов, без промптов на 500 строк."
                : "Smart Research, Persona Engine and Stealth Guard - in one ecosystem. No 10-tool stack, no 500-line prompts."}
            </p>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-3 max-w-3xl mx-auto">
              {bullets.map((b, i) => {
                const Icon = b.icon;
                return (
                  <div key={i} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-left">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Icon className="h-4 w-4 text-emerald-400" />
                      <span className="text-[13px] font-semibold text-white">{b.title}</span>
                    </div>
                    <p className="text-[12px] text-muted-foreground leading-relaxed">{b.desc}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-10 flex flex-col sm:flex-row gap-3 items-center justify-center">
              <a
                href="https://t.me/sin0ptick"
                target="_blank"
                rel="noopener noreferrer"
                className="group relative inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary to-[#3b82f6] px-10 py-5 text-base font-tech font-bold text-white shadow-[0_20px_60px_rgba(139,92,246,0.35)] transition-all duration-300 hover:scale-[1.04] hover:shadow-[0_25px_80px_rgba(139,92,246,0.5)] active:scale-[0.98]"
              >
                <span className="absolute inset-0 rounded-full bg-gradient-to-r from-primary to-[#3b82f6] opacity-20 blur-2xl animate-[pulse_2.5s_ease-in-out_infinite]" />
                <span className="relative flex items-center gap-2">
                  {isRu ? "Написать в поддержку" : "Contact Support"}
                  <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                </span>
              </a>
              <a
                href="#pricing"
                onClick={(e) => {
                  e.preventDefault();
                  const el = document.getElementById("pricing");
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="text-sm font-tech text-muted-foreground/80 hover:text-white transition-colors underline-offset-4 hover:underline"
              >
                {isRu ? "или сначала посмотреть тарифы" : "or check pricing first"}
              </a>
            </div>

            <p className="mt-6 text-[11px] font-tech text-muted-foreground/50 tracking-wider">
              {isRu
                ? "Регистрация занимает 30 секунд · Поддержка отвечает за 15 минут"
                : "Sign-up takes 30 seconds · Support replies within 15 minutes"}
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
