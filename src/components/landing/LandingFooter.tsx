import { useNavigate } from "react-router-dom";
import { Hexagon } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function LandingFooter() {
  const navigate = useNavigate();
  const { t, lang, setLang } = useI18n();

  return (
    <footer className="border-t border-white/[0.06] bg-[#050505]">
      <div className="container mx-auto px-4 py-10">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <Hexagon className="h-4 w-4 text-primary" />
            <span className="text-sm font-brand tracking-tight">
              SERP<span className="gradient-text">blueprint</span>
            </span>
          </div>

          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <button onClick={() => navigate("/wiki")} className="hover:text-foreground transition-colors">
              {t("lp.footerWiki")}
            </button>
            <button onClick={() => navigate("/support")} className="hover:text-foreground transition-colors">
              {t("lp.footerSupport")}
            </button>
            <button onClick={() => navigate("/pricing")} className="hover:text-foreground transition-colors">
              {t("lp.footerPricing")}
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* Language switcher */}
            <div className="flex items-center rounded-full border border-white/[0.08] bg-white/[0.02] p-0.5">
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
          </div>
        </div>

        <p className="mt-6 text-xs text-muted-foreground text-center">
          © {new Date().getFullYear()} SERPblueprint. {t("landing.copyright")}
        </p>
      </div>
    </footer>
  );
}
