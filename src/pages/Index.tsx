import { LandingNav } from "@/components/landing/LandingNav";
import { SectionHero } from "@/components/landing/SectionHero";
import { SectionComparison } from "@/components/landing/SectionComparison";
import { SectionPillars } from "@/components/landing/SectionPillars";
import { SectionExpertProof } from "@/components/landing/SectionExpertProof";
import { SectionWorkflow } from "@/components/landing/SectionWorkflow";
import { SectionDeepDive } from "@/components/landing/SectionDeepDive";
import { SectionPricing } from "@/components/landing/SectionPricing";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { CookieConsent } from "@/components/landing/CookieConsent";
import { ScrollToTop } from "@/components/landing/ScrollToTop";
import { useI18n } from "@/shared/hooks/useI18n";
import { useEffect } from "react";

export default function Index() {
  const { lang } = useI18n();

  useEffect(() => {
    document.title = lang === "ru"
      ? "Auto-Writer-Gen - Enterprise AI Content & GEO Engine"
      : "Auto-Writer-Gen - Enterprise AI Content & GEO Engine";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute("content", lang === "ru"
        ? "Первая в мире экспертная контент-система с GEO-радаром и технологией Stealth-письма."
        : "The world's first Expert Content Engine with integrated GEO Radar and Stealth-Writing technology."
      );
    }
  }, [lang]);

  return (
    <div className="min-h-screen bg-[#050505] text-foreground relative">
      {/* Noise texture */}
      <div className="pointer-events-none fixed inset-0 z-[1] opacity-[0.02]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
        }}
      />
      <div className="pointer-events-none fixed top-[30%] left-[15%] w-[600px] h-[500px] rounded-full bg-[#06b6d4]/[0.03] blur-[250px] z-[1]" />
      <div className="pointer-events-none fixed top-[60%] right-[10%] w-[500px] h-[400px] rounded-full bg-[#8b5cf6]/[0.025] blur-[220px] z-[1]" />

      <div className="relative z-[3]">
        <LandingNav />
      </div>

      <div className="relative z-[2]">
        <SectionHero />
        <SectionComparison />
        <SectionPillars />
        <SectionExpertProof />
        <SectionWorkflow />
        <SectionDeepDive />
        <SectionPricing />
        <LandingFooter />
      </div>

      <CookieConsent />
      <ScrollToTop />
    </div>
  );
}
