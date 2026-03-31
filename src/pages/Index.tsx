import { LandingNav } from "@/components/landing/LandingNav";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingBento } from "@/components/landing/LandingBento";
import { LandingDataDriven } from "@/components/landing/LandingDataDriven";
import { LandingTrust } from "@/components/landing/LandingTrust";
import { LandingPricing } from "@/components/landing/LandingPricing";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { useI18n } from "@/shared/hooks/useI18n";
import { useEffect } from "react";

export default function Index() {
  const { lang } = useI18n();

  useEffect(() => {
    document.title = lang === "ru"
      ? "SERPblueprint - AI-экосистема для SEO-контента"
      : "SERPblueprint - AI-Powered SEO Content Ecosystem";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute("content", lang === "ru"
        ? "Профессиональная экосистема для проектирования SEO-статей. Smart Research, AI Writer, GEO Radar, Human Score."
        : "Professional ecosystem for engineering SEO content. Smart Research, AI Writer, GEO Radar, Human Score."
      );
    }
  }, [lang]);

  return (
    <div className="min-h-screen bg-[#050505] text-foreground">
      <LandingNav />
      <LandingHero />
      <LandingBento />
      <LandingDataDriven />
      <LandingTrust />
      <LandingPricing />
      <LandingFooter />
    </div>
  );
}
