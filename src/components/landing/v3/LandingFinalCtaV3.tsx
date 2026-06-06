import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";
import { Button } from "@/components/ui/button";

export function LandingFinalCtaV3() {
  const navigate = useNavigate();
  const { lang } = useI18n();
  const ru = lang === "ru";
  return (
    <section className="py-24 px-4 border-b border-border">
      <div className="container mx-auto max-w-4xl">
        <div className="rounded-2xl border border-border bg-card p-10 md:p-16 text-center">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tighter text-foreground">
            {ru ? "Готовы захватить выдачу?" : "Ready to own the SERP?"}
          </h2>
          <p className="mt-4 text-base text-muted-foreground max-w-lg mx-auto">
            {ru
              ? "Создайте первую статью бесплатно. Без карты, без обязательств."
              : "Generate your first article for free. No card, no commitment."}
          </p>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <Button size="lg" onClick={() => navigate("/register")} className="text-sm font-medium">
              {ru ? "Начать бесплатно" : "Start for free"}
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate("/wiki")} className="text-sm font-medium">
              {ru ? "Документация" : "Read the docs"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}