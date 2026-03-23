import { useNavigate } from "react-router-dom";
import { Hexagon } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function LandingNav() {
  const navigate = useNavigate();
  const { lang, setLang, t } = useI18n();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate("/")}>
          <Hexagon className="h-5 w-5 text-primary" />
          <span className="text-lg font-bold">SERPblueprint</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Language switcher */}
          <div className="flex items-center rounded-full border border-border bg-muted p-0.5">
            <button
              onClick={() => setLang("en")}
              className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
                lang === "en"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              EN
            </button>
            <button
              onClick={() => setLang("ru")}
              className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
                lang === "ru"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              RU
            </button>
          </div>

          <button
            onClick={() => navigate("/login")}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
          >
            {t("auth.login")}
          </button>
          <button
            onClick={() => navigate("/register")}
            className="text-sm font-semibold rounded-full bg-primary px-5 py-1.5 text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t("landing.getStarted")}
          </button>
        </div>
      </div>
    </nav>
  );
}
