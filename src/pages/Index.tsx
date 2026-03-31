import { LandingNav } from "@/components/landing/LandingNav";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingBento } from "@/components/landing/LandingBento";
import { LandingHumanScore } from "@/components/landing/LandingHumanScore";
import { LandingRadar } from "@/components/landing/LandingRadar";
import { LandingFactory } from "@/components/landing/LandingFactory";
import { LandingPricing } from "@/components/landing/LandingPricing";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { useI18n } from "@/shared/hooks/useI18n";
import { useEffect } from "react";

export default function Index() {
  const { t, lang } = useI18n();

  useEffect(() => {
    document.title = lang === "ru"
      ? "SERPblueprint - AI-платформа для SEO-контента"
      : "SERPblueprint - AI-Powered SEO Content Platform";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute("content", lang === "ru"
        ? "Профессиональная экосистема для проектирования SEO-статей. Анализ конкурентов, AI Writer, GEO Radar."
        : "Professional ecosystem for engineering SEO content. Competitor analysis, AI Writer, GEO Radar."
      );
    }
  }, [lang]);

  return (
    <div className="min-h-screen bg-[#050505] text-foreground">
      <LandingNav />
      <LandingHero />
      <LandingBento />
      <LandingHumanScore />
      <LandingRadar />
      <LandingFactory />
      <LandingPricing />
      <LandingFooter />
    </div>
  );
}
