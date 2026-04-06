import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Hexagon, Send } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export function LandingFooter() {
  const navigate = useNavigate();
  const { t, lang, setLang } = useI18n();

  const columns = [
    {
      title: lang === "ru" ? "Продукт" : "Product",
      links: [
        { label: lang === "ru" ? "Возможности" : "Features", action: () => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" }) },
        { label: lang === "ru" ? "Тарифы" : "Pricing", action: () => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" }) },
        { label: lang === "ru" ? "База знаний" : "Wiki", action: () => navigate("/wiki") },
      ],
    },
    {
      title: lang === "ru" ? "Поддержка" : "Support",
      links: [
        { label: "FAQ", action: () => { navigate("/"); setTimeout(() => document.getElementById("faq")?.scrollIntoView({ behavior: "smooth" }), 100); } },
        { label: lang === "ru" ? "Связаться" : "Contact", action: () => navigate("/support") },
      ],
    },
    {
      title: lang === "ru" ? "Юридическая информация" : "Legal",
      links: [
        { label: lang === "ru" ? "Публичная оферта" : "Public Offer", action: () => navigate("/offer") },
        { label: lang === "ru" ? "Политика конфиденциальности" : "Privacy Policy", action: () => navigate("/privacy") },
        { label: lang === "ru" ? "Пользовательское соглашение" : "Terms of Service", action: () => navigate("/terms") },
        { label: lang === "ru" ? "Политика Cookie" : "Cookie Policy", action: () => navigate("/cookies") },
      ],
    },
  ];

  return (
    <footer className="relative border-t border-primary/20 bg-[#050505]/90 backdrop-blur-2xl"
      style={{ boxShadow: "0 -1px 40px rgba(139,92,246,0.06)" }}>
      <div className="container mx-auto px-4 py-14 max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-10 md:gap-8">
          {/* Logo + status */}
          <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} className="space-y-5">
            <div className="flex items-center gap-2">
              <Hexagon className="h-5 w-5 text-primary" />
              <span className="text-lg font-brand tracking-tight">
                СЕО-<span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-[#3b82f6]">Модуль</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              <span className="text-[11px] font-tech text-emerald-400/80 tracking-wide">
                {t("lp.footerStatus")}
              </span>
            </div>
          </motion.div>

          {/* Columns */}
          {columns.map((col, ci) => (
            <motion.div key={ci} variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} className="space-y-4">
              <h4 className="text-xs font-tech uppercase tracking-widest text-muted-foreground/60">{col.title}</h4>
              <ul className="space-y-2.5 text-left items-start">
                {col.links.map((link, li) => (
                  <li key={li} className="text-left">
                    <button onClick={link.action} className="text-sm text-gray-400 hover:text-white transition-colors text-left">
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}

          {/* Social + Lang */}
          <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} className="space-y-4">
            <h4 className="text-xs font-tech uppercase tracking-widest text-muted-foreground/60">Social</h4>
            <div className="flex items-center gap-2">
              {[
                { icon: Send, href: "#", label: "Telegram" },
                { icon: Twitter, href: "#", label: "Twitter" },
              ].map((s, i) => (
                <a key={i} href={s.href} aria-label={s.label}
                  className="w-8 h-8 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:border-white/[0.12] transition-all">
                  <s.icon className="h-3.5 w-3.5" />
                </a>
              ))}
            </div>

            {/* Lang */}
            <div className="flex items-center rounded-full border border-white/[0.08] bg-white/[0.02] p-0.5 w-fit">
              <button onClick={() => setLang("ru")}
                className={`px-3 py-1 text-xs font-tech rounded-full transition-all ${lang === "ru" ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground/50 hover:text-foreground border border-transparent"}`}>
                RU
              </button>
              <button onClick={() => setLang("en")}
                className={`px-3 py-1 text-xs font-tech rounded-full transition-all ${lang === "en" ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground/50 hover:text-foreground border border-transparent"}`}>
                EN
              </button>
            </div>
          </motion.div>
        </div>

        {/* Requisites */}
        <div className="mt-10 pt-6 border-t border-white/[0.04]">
          <p className="text-[11px] font-mono text-gray-400 leading-relaxed">
            {lang === "ru"
              ? "Самозанятый. Контактный email: support@seo-modul.ru"
              : "Self-employed. Contact email: support@seo-modul.ru"
            }
          </p>
        </div>

        {/* Legal */}
        <div className="mt-4 pt-4 border-t border-white/[0.04] flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[10px] font-mono text-gray-500 tracking-wide">
            © {new Date().getFullYear()} СЕО-Модуль — {t("landing.copyright")}
          </p>
          <p className="text-[9px] font-mono text-gray-500 tracking-wider max-w-md text-center sm:text-right leading-relaxed">
            {t("lp.footerLegal")}
          </p>
        </div>
      </div>
    </footer>
  );
}