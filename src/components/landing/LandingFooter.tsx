import { useNavigate } from "react-router-dom";
import { Hexagon, Send, Youtube, Github } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function LandingFooter() {
  const navigate = useNavigate();
  const { t, lang, setLang } = useI18n();

  const navLinks = [
    { label: t("nav.wiki"), to: "/wiki" },
    { label: t("lp.footerSupport"), to: "/support" },
    { label: t("footer.roadmap"), to: "#" },
    { label: t("nav.landingPricing"), to: "/pricing" },
  ];

  return (
    <footer className="relative border-t border-white/[0.04] bg-[#030303]">
      <div className="container mx-auto px-4 py-14 max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-6 items-start">
          {/* Logo */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Hexagon className="h-5 w-5 text-primary/70" />
              <span className="text-lg font-brand tracking-tight">
                SERP<span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-[#3b82f6]">blueprint</span>{" "}
                <span className="text-xs text-muted-foreground/40 font-mono">v2.0</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              <span className="text-[11px] font-tech text-emerald-400/60 tracking-wide">{t("lp.footerStatus")}</span>
            </div>
          </div>

          {/* Nav */}
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-3">
            {navLinks.map((link, i) => (
              <button key={i} onClick={() => navigate(link.to)}
                className="text-sm text-muted-foreground/40 hover:text-foreground/70 transition-colors duration-200">{link.label}</button>
            ))}
          </div>

          {/* Socials */}
          <div className="flex items-center justify-end gap-4">
            <div className="flex items-center rounded-full border border-white/[0.06] bg-white/[0.015] p-0.5">
              <button onClick={() => setLang("ru")}
                className={`px-3 py-1 text-xs font-tech font-medium rounded-full transition-all ${lang === "ru" ? "bg-primary/15 text-primary border border-primary/20" : "text-muted-foreground/40 hover:text-foreground border border-transparent"}`}>RU</button>
              <button onClick={() => setLang("en")}
                className={`px-3 py-1 text-xs font-tech font-medium rounded-full transition-all ${lang === "en" ? "bg-primary/15 text-primary border border-primary/20" : "text-muted-foreground/40 hover:text-foreground border border-transparent"}`}>EN</button>
            </div>
            <div className="flex items-center gap-2">
              {[
                { icon: Send, label: "Telegram" },
                { icon: Youtube, label: "YouTube" },
                { icon: Github, label: "GitHub" },
              ].map((s, i) => (
                <a key={i} href="#" aria-label={s.label}
                  className="w-8 h-8 rounded-lg border border-white/[0.04] bg-white/[0.01] flex items-center justify-center text-muted-foreground/30 hover:text-foreground/60 hover:border-white/[0.08] transition-all duration-200">
                  <s.icon className="h-3.5 w-3.5" />
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-white/[0.03] flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[10px] font-mono text-muted-foreground/20 tracking-wide">
            © {new Date().getFullYear()} SERPblueprint v2.0
          </p>
          <p className="text-[9px] font-mono text-muted-foreground/15 tracking-wider max-w-md text-center sm:text-right leading-relaxed">
            {t("lp.footerLegal")}
          </p>
        </div>
      </div>
    </footer>
  );
}
