import { useI18n } from "@/shared/hooks/useI18n";

export function LandingTrustV3() {
  const { lang } = useI18n();
  const logos = ["Google", "Yandex", "Perplexity", "OpenAI", "Anthropic", "Mistral"];
  return (
    <section className="py-16 px-4 border-b border-border">
      <div className="container mx-auto max-w-6xl">
        <p className="text-center text-xs text-muted-foreground font-mono uppercase tracking-wider">
          {lang === "ru" ? "Оптимизировано под основные поисковые системы и AI-ассистенты" : "Optimised for major search engines and AI assistants"}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-12 gap-y-6 grayscale opacity-50">
          {logos.map((l) => (
            <span key={l} className="text-base font-semibold text-foreground tracking-tight">
              {l}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}