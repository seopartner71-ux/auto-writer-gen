import { useNavigate } from "react-router-dom";
import { Hexagon } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";
import { Button } from "@/components/ui/button";

export function LandingNavV3() {
  const navigate = useNavigate();
  const { lang, setLang } = useI18n();

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex items-center justify-between px-4 h-14">
        <button onClick={() => navigate("/")} className="flex items-center gap-2 shrink-0">
          <Hexagon className="h-4 w-4 text-foreground" strokeWidth={1.75} />
          <span className="text-sm font-semibold tracking-tight">
            {lang === "ru" ? "СЕО-Модуль" : "SEO-Module"}
          </span>
        </button>

        <div className="hidden md:flex items-center gap-7 absolute left-1/2 -translate-x-1/2">
          <button onClick={() => scrollTo("features")} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            {lang === "ru" ? "Возможности" : "Features"}
          </button>
          <button onClick={() => scrollTo("pricing")} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            {lang === "ru" ? "Тарифы" : "Pricing"}
          </button>
          <button onClick={() => scrollTo("faq")} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            FAQ
          </button>
          <button onClick={() => navigate("/wiki")} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            {lang === "ru" ? "База знаний" : "Docs"}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setLang(lang === "ru" ? "en" : "ru")}
            className="hidden sm:inline-flex text-xs font-mono text-muted-foreground hover:text-foreground px-2 py-1 rounded transition-colors"
          >
            {lang === "ru" ? "EN" : "RU"}
          </button>
          <Button variant="ghost" size="sm" onClick={() => navigate("/login")} className="text-sm">
            {lang === "ru" ? "Войти" : "Log in"}
          </Button>
          <Button size="sm" onClick={() => navigate("/register")} className="text-sm">
            {lang === "ru" ? "Начать" : "Get Started"}
          </Button>
        </div>
      </div>
    </nav>
  );
}