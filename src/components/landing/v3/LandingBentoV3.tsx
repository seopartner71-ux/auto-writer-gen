import { Search, Radar, Shield, Zap, Layers, FileText, type LucideIcon } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function LandingBentoV3() {
  const { lang } = useI18n();
  const ru = lang === "ru";

  return (
    <section id="features" className="py-24 px-4 border-b border-border">
      <div className="container mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            {ru ? "Возможности" : "Features"}
          </p>
          <h2 className="mt-3 text-4xl md:text-5xl font-bold tracking-tighter text-foreground">
            {ru ? "Всё, что нужно для SEO нового поколения." : "Everything you need for next-generation SEO."}
          </h2>
          <p className="mt-4 text-base text-muted-foreground max-w-xl">
            {ru
              ? "От исследования темы до публикации - один pipeline, никаких разрозненных инструментов."
              : "From research to publishing - one pipeline, no scattered tools."}
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 md:grid-rows-2 gap-px bg-border border border-border rounded-xl overflow-hidden">
          {/* Large feature - Indexing speed metric */}
          <Cell className="md:col-span-1 md:row-span-2 flex flex-col justify-between min-h-[280px]">
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                {ru ? "Скорость индексации" : "Indexing Speed"}
              </p>
              <h3 className="mt-3 text-xl font-semibold tracking-tight text-foreground">
                {ru ? "От текста до Google за минуты" : "From draft to Google in minutes"}
              </h3>
            </div>
            <div>
              <div className="text-5xl md:text-6xl font-mono font-semibold text-foreground tracking-tighter">
                3<span className="text-muted-foreground">.2</span>m
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {ru ? "Среднее время через Google Indexing API + IndexNow" : "Average via Google Indexing API + IndexNow"}
              </p>
            </div>
          </Cell>

          <Cell>
            <Icon as={Search} />
            <h3 className="mt-4 text-base font-semibold tracking-tight">{ru ? "Smart Research" : "Smart Research"}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {ru ? "Анализ топ-10 SERP, извлечение сущностей и Content Gap за один запрос." : "Top-10 SERP scrape, entity extraction and content-gap analysis in one call."}
            </p>
          </Cell>

          <Cell>
            <Icon as={Radar} />
            <h3 className="mt-4 text-base font-semibold tracking-tight">{ru ? "GEO Радар" : "GEO Radar"}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {ru ? "Отслеживание упоминаний бренда в ChatGPT, Perplexity и Gemini." : "Track brand mentions across ChatGPT, Perplexity and Gemini."}
            </p>
          </Cell>

          <Cell>
            <Icon as={Shield} />
            <h3 className="mt-4 text-base font-semibold tracking-tight">{ru ? "Stealth Engine" : "Stealth Engine"}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {ru ? "Humanize-проход обходит детекторы AI: GPTZero, Originality, Тургенев." : "Humanize pass that bypasses GPTZero, Originality and major detectors."}
            </p>
          </Cell>

          <Cell>
            <Icon as={Layers} />
            <h3 className="mt-4 text-base font-semibold tracking-tight">{ru ? "Persona Engine" : "Persona Engine"}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {ru ? "15+ авторских пресетов с уникальным синтаксисом и tone-of-voice." : "15+ author presets with unique syntax and tone of voice."}
            </p>
          </Cell>
        </div>

        {/* Second strip - secondary features */}
        <div className="mt-px grid grid-cols-1 md:grid-cols-3 gap-px bg-border border border-border rounded-xl overflow-hidden">
          <Cell>
            <Icon as={FileText} />
            <h3 className="mt-4 text-base font-semibold tracking-tight">{ru ? "Site Factory" : "Site Factory"}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {ru ? "Программируемые SEO-сайты на Cloudflare Pages, без VPS." : "Programmatic SEO sites on Cloudflare Pages, no VPS required."}
            </p>
          </Cell>
          <Cell>
            <Icon as={Zap} />
            <h3 className="mt-4 text-base font-semibold tracking-tight">{ru ? "Quality Pipeline" : "Quality Pipeline"}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {ru ? "Fact-check guard, проверка уникальности через text.ru и AI-детекция." : "Fact-check guard, uniqueness check via text.ru and AI detection."}
            </p>
          </Cell>
          <Cell>
            <Icon as={Shield} />
            <h3 className="mt-4 text-base font-semibold tracking-tight">{ru ? "WP / Telegraph / Ghost" : "WP / Telegraph / Ghost"}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {ru ? "Прямая публикация в WordPress, Telegra.ph и Ghost - в один клик." : "One-click publishing to WordPress, Telegra.ph and Ghost."}
            </p>
          </Cell>
        </div>
      </div>
    </section>
  );
}

function Cell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card p-6 transition-colors hover:bg-card/60 ${className}`}>{children}</div>
  );
}

function Icon({ as: Comp }: { as: LucideIcon }) {
  return (
    <div className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background/50">
      <Comp className="h-4 w-4 text-foreground" strokeWidth={1.75} />
    </div>
  );
}