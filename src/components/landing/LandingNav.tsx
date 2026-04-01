import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Hexagon, Menu, X } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function LandingNav() {
  const navigate = useNavigate();
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);

  const anchors = [
    { label: t("nav.features"), href: "#features" },
    { label: t("nav.howItWorks"), href: "#how-it-works" },
    { label: t("nav.pricing"), href: "#pricing" },
  ];

  const scrollTo = (href: string) => {
    setOpen(false);
    const el = document.querySelector(href);
    el?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#050505]/80 backdrop-blur-xl">
      <div className="container mx-auto flex items-center justify-between px-4 h-14 max-w-7xl">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate("/")}>
          <Hexagon className="h-5 w-5 text-primary" />
          <span className="text-lg font-brand tracking-tight">Auto-Writer<span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-[#3b82f6]">-Gen</span></span>
        </div>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6">
          {anchors.map((a) => (
            <button key={a.href} onClick={() => scrollTo(a.href)}
              className="text-sm text-muted-foreground/70 hover:text-foreground transition-colors">{a.label}</button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {/* Lang */}
          <div className="flex items-center rounded-full border border-white/[0.08] bg-white/[0.02] p-0.5">
            <button onClick={() => setLang("ru")}
              className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${lang === "ru" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>RU</button>
            <button onClick={() => setLang("en")}
              className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${lang === "en" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>EN</button>
          </div>

          <button onClick={() => navigate("/login")}
            className="hidden md:block text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5">{t("auth.login")}</button>
          <button onClick={() => navigate("/register")}
            className="hidden md:block text-sm font-semibold rounded-full bg-gradient-to-r from-primary to-[#3b82f6] px-5 py-1.5 text-white hover:shadow-[0_0_20px_rgba(139,92,246,0.4)] transition-all">
            {t("nav.startFree")}</button>

          {/* Mobile burger */}
          <button className="md:hidden text-muted-foreground" onClick={() => setOpen(!open)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-white/[0.06] bg-[#050505]/95 backdrop-blur-xl px-4 py-4 space-y-3">
          {anchors.map((a) => (
            <button key={a.href} onClick={() => scrollTo(a.href)}
              className="block w-full text-left text-sm text-muted-foreground/70 hover:text-foreground py-2">{a.label}</button>
          ))}
          <button onClick={() => { setOpen(false); navigate("/register"); }}
            className="w-full text-sm font-semibold rounded-full bg-gradient-to-r from-primary to-[#3b82f6] px-5 py-2.5 text-white mt-2">
            {t("nav.startFree")}</button>
        </div>
      )}
    </nav>
  );
}
