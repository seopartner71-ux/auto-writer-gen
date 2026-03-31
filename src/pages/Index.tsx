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
    <div className="min-h-screen bg-[#050505] text-foreground relative">
      {/* Noise texture overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-[1] opacity-[0.02]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
        }}
      />
      {/* Background glow blobs */}
      <div className="pointer-events-none fixed top-[40%] left-[20%] w-[600px] h-[500px] rounded-full bg-primary/[0.04] blur-[220px] z-[1]" />
      <div className="pointer-events-none fixed top-[60%] right-[15%] w-[500px] h-[400px] rounded-full bg-[#3b82f6]/[0.03] blur-[200px] z-[1]" />
      <div className="relative z-[2]">
        <LandingNav />
        <LandingHero />
        <LandingBento />
        <LandingDataDriven />
        <LandingTrust />
        <LandingPricing />
        <LandingFooter />
      </div>
    </div>
  );
}
