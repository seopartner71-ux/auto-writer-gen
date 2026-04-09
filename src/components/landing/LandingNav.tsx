import { useNavigate } from "react-router-dom";
import { Hexagon, Globe } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function LandingNav() {
  const navigate = useNavigate();
  const { lang, setLang, t } = useI18n();

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#050505]/80 backdrop-blur-xl">
      <div className="container mx-auto flex items-center justify-between px-3 sm:px-4 h-14">
        <div className="flex items-center gap-1.5 sm:gap-2 cursor-pointer shrink-0" onClick={() => navigate("/")}>
          <Hexagon className="h-5 w-5 text-primary" />
          <span className="text-base sm:text-xl font-brand tracking-tight whitespace-nowrap">СЕО-<span className="gradient-text">Модуль</span></span>
        </div>

        {/* Nav links — hidden on mobile */}
        <div className="hidden md:flex items-center gap-6">
          <button onClick={() => scrollTo("features")} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            {t("lp.navFeatures")}
          </button>
          <button onClick={() => scrollTo("pricing")} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            {t("nav.pricing")}
          </button>
          <button onClick={() => scrollTo("faq")} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            FAQ
          </button>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3">
          <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] p-0.5">
            <Globe className="w-3.5 h-3.5 text-muted-foreground ml-2" />
            <button
              onClick={() => setLang("ru")}
              className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
                lang === "ru" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              RU
            </button>
            <button
              onClick={() => setLang("en")}
              className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
                lang === "en" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              EN
            </button>
          </div>

          {/* Mobile lang toggle */}
          <button
            onClick={() => setLang(lang === "ru" ? "en" : "ru")}
            className="sm:hidden px-2 py-1 text-xs font-bold uppercase text-muted-foreground hover:text-foreground border border-white/[0.08] rounded-full"
          >
            {lang}
          </button>

          <button
            onClick={() => navigate("/login")}
            className="text-xs sm:text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-2 sm:px-3 py-1.5 whitespace-nowrap"
          >
            {t("auth.login")}
          </button>
          <button
            onClick={() => navigate("/register")}
            className="text-xs sm:text-sm font-semibold rounded-full bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] px-3 sm:px-5 py-1.5 text-white hover:shadow-[0_0_20px_rgba(139,92,246,0.4)] transition-all whitespace-nowrap"
          >
            {t("landing.getStarted")}
          </button>
        </div>
      </div>
    </nav>
  );
}
