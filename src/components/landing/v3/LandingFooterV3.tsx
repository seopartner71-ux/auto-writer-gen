import { useNavigate } from "react-router-dom";
import { Hexagon } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function LandingFooterV3() {
  const navigate = useNavigate();
  const { lang } = useI18n();
  const ru = lang === "ru";

  const cols = [
    {
      title: ru ? "Продукт" : "Product",
      links: [
        { l: ru ? "Возможности" : "Features", to: "#features" },
        { l: ru ? "Тарифы" : "Pricing", to: "#pricing" },
        { l: ru ? "База знаний" : "Docs", to: "/wiki" },
        { l: ru ? "Изменения" : "Changelog", to: "/changelog" },
      ],
    },
    {
      title: ru ? "Поддержка" : "Support",
      links: [
        { l: "FAQ", to: "#faq" },
        { l: ru ? "Связаться" : "Contact", to: "/support" },
      ],
    },
    {
      title: ru ? "Юридическая" : "Legal",
      links: [
        { l: ru ? "Оферта" : "Offer", to: "/offer" },
        { l: ru ? "Конфиденциальность" : "Privacy", to: "/privacy" },
        { l: ru ? "Условия" : "Terms", to: "/terms" },
        { l: "Cookies", to: "/cookies" },
      ],
    },
  ];

  const go = (to: string) => {
    if (to.startsWith("#")) {
      document.getElementById(to.slice(1))?.scrollIntoView({ behavior: "smooth" });
    } else {
      navigate(to);
    }
  };

  return (
    <footer className="py-16 px-4 border-t border-border">
      <div className="container mx-auto max-w-6xl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
          <div>
            <div className="flex items-center gap-2">
              <Hexagon className="h-4 w-4 text-foreground" strokeWidth={1.75} />
              <span className="text-sm font-semibold tracking-tight">
                {ru ? "СЕО-Модуль" : "SEO-Module"}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground max-w-[12rem]">
              {ru ? "AI-экосистема для SEO-контента." : "AI ecosystem for SEO content."}
            </p>
          </div>
          {cols.map((c) => (
            <div key={c.title}>
              <p className="text-xs font-mono uppercase tracking-wider text-foreground/70">{c.title}</p>
              <ul className="mt-3 space-y-2">
                {c.links.map((it) => (
                  <li key={it.l}>
                    <button onClick={() => go(it.to)} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {it.l}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 pt-6 border-t border-border flex flex-col md:flex-row gap-3 items-center justify-between">
          <p className="text-xs text-muted-foreground font-mono">
            © {new Date().getFullYear()} {ru ? "СЕО-Модуль" : "SEO-Module"}
          </p>
          <p className="text-xs text-muted-foreground">
            seo-modul.pro
          </p>
        </div>
      </div>
    </footer>
  );
}