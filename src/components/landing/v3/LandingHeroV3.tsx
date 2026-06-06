import { useNavigate } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Search, FileText, BarChart3, Sparkles } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";
import { Button } from "@/components/ui/button";

export function LandingHeroV3() {
  const navigate = useNavigate();
  const { lang } = useI18n();

  return (
    <section className="relative pt-32 pb-24 px-4 border-b border-border">
      <div className="container mx-auto max-w-6xl flex flex-col items-center text-center">
        {/* Pill badge */}
        <button
          onClick={() => navigate("/changelog")}
          className="group inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors animate-fade-in"
        >
          <span className="font-mono text-[10px] tracking-wider uppercase text-foreground/70">
            {lang === "ru" ? "Новое" : "New"}
          </span>
          <span className="h-3 w-px bg-border" />
          <span>{lang === "ru" ? "GEO Радар 2.0 для AI-поиска" : "Announcing GEO Radar 2.0 for AI search"}</span>
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </button>

        {/* H1 */}
        <h1 className="mt-8 text-5xl md:text-7xl font-bold tracking-tighter max-w-4xl leading-[1.02] text-foreground animate-fade-in">
          {lang === "ru" ? (
            <>SEO-контент, который<br />ранжируется и в Google,<br />и в AI-поиске.</>
          ) : (
            <>SEO content that ranks<br />in Google and in<br />AI search engines.</>
          )}
        </h1>

        {/* Subhead */}
        <p className="mt-6 max-w-xl text-base md:text-lg text-muted-foreground leading-relaxed animate-fade-in">
          {lang === "ru"
            ? "AI-экосистема для синтеза экспертных статей. Smart Research, Bento-сборка структуры, защита от детекторов AI и Anti-Hallucination guard."
            : "End-to-end AI pipeline for expert-grade articles. Smart Research, structure builder, anti-detector humanizer and hallucination guard."}
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-wrap gap-3 justify-center animate-fade-in">
          <Button size="lg" onClick={() => navigate("/register")} className="text-sm font-medium">
            {lang === "ru" ? "Начать бесплатно" : "Start for free"}
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
          <Button size="lg" variant="outline" onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })} className="text-sm font-medium">
            {lang === "ru" ? "Смотреть демо" : "View demo"}
          </Button>
        </div>

        {/* Dashboard mockup */}
        <div className="mt-20 w-full max-w-5xl rounded-xl border border-border bg-card overflow-hidden animate-fade-in">
          {/* mock window chrome */}
          <div className="flex items-center gap-1.5 px-4 py-3 border-b border-border bg-card/80">
            <span className="h-2.5 w-2.5 rounded-full bg-muted" />
            <span className="h-2.5 w-2.5 rounded-full bg-muted" />
            <span className="h-2.5 w-2.5 rounded-full bg-muted" />
            <div className="ml-4 flex-1 max-w-md mx-auto rounded border border-border bg-background/50 px-3 py-1 text-[11px] font-mono text-muted-foreground text-center">
              app.seo-modul.pro/dashboard
            </div>
          </div>

          {/* mock body */}
          <div className="grid grid-cols-12 min-h-[420px]">
            {/* sidebar */}
            <aside className="hidden md:flex col-span-2 flex-col gap-1 p-3 border-r border-border">
              {[
                { i: BarChart3, l: lang === "ru" ? "Главная" : "Dashboard", active: true },
                { i: FileText, l: lang === "ru" ? "Статьи" : "Articles" },
                { i: Search, l: lang === "ru" ? "Research" : "Research" },
                { i: Sparkles, l: "GEO" },
              ].map((it, i) => (
                <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${it.active ? "bg-muted text-foreground" : "text-muted-foreground"}`}>
                  <it.i className="h-3.5 w-3.5" />
                  <span>{it.l}</span>
                </div>
              ))}
            </aside>

            {/* main */}
            <main className="col-span-12 md:col-span-10 p-6 space-y-5 text-left">
              {/* KPI row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: lang === "ru" ? "Статей" : "Articles", value: "247", delta: "+18" },
                  { label: lang === "ru" ? "AI-Score" : "AI Score", value: "94", delta: "+6" },
                  { label: lang === "ru" ? "Уникальность" : "Uniqueness", value: "98%", delta: "+2" },
                ].map((k, i) => (
                  <div key={i} className="rounded-lg border border-border p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">{k.label}</div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-2xl font-mono font-semibold text-foreground">{k.value}</span>
                      <span className="text-[11px] font-mono text-foreground/60">{k.delta}</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* chart placeholder */}
              <div className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground">{lang === "ru" ? "Видимость в SERP" : "SERP Visibility"}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">30D</span>
                </div>
                <svg viewBox="0 0 600 120" className="w-full h-28">
                  <polyline
                    fill="none"
                    stroke="hsl(var(--foreground))"
                    strokeWidth="1.25"
                    strokeOpacity="0.7"
                    points="0,90 50,82 100,86 150,70 200,72 250,58 300,55 350,42 400,38 450,30 500,28 550,20 600,14"
                  />
                  {[0,50,100,150,200,250,300,350,400,450,500,550,600].map((x, i) => (
                    <line key={i} x1={x} y1="0" x2={x} y2="120" stroke="hsl(var(--border))" strokeOpacity="0.4" />
                  ))}
                </svg>
              </div>
              {/* rows */}
              <div className="rounded-lg border border-border divide-y divide-border">
                {[
                  { t: lang === "ru" ? "Как выбрать диван" : "How to choose a sofa", s: 96 },
                  { t: lang === "ru" ? "Лучшие матрасы 2026" : "Best mattresses 2026", s: 92 },
                  { t: lang === "ru" ? "Гид по садовой мебели" : "Outdoor furniture guide", s: 88 },
                ].map((r, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 text-xs">
                    <span className="text-foreground">{r.t}</span>
                    <span className="font-mono text-muted-foreground">{r.s}</span>
                  </div>
                ))}
              </div>
            </main>
          </div>
        </div>
      </div>
    </section>
  );
}