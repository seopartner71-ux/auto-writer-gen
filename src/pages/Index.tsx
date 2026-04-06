import { lazy, Suspense } from "react";
import { LandingNav } from "@/components/landing/LandingNav";
import { SectionHero } from "@/components/landing/SectionHero";
import { SectionFaq } from "@/components/landing/SectionFaq";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { CookieConsent } from "@/components/landing/CookieConsent";
import { ScrollToTop } from "@/components/landing/ScrollToTop";
import { useI18n } from "@/shared/hooks/useI18n";
import { useEffect } from "react";

// Below-fold sections — lazy loaded
const SectionResearch = lazy(() => import("@/components/landing/SectionResearch").then(m => ({ default: m.SectionResearch })));
const SectionPersona = lazy(() => import("@/components/landing/SectionPersona").then(m => ({ default: m.SectionPersona })));
const SectionGeo = lazy(() => import("@/components/landing/SectionGeo").then(m => ({ default: m.SectionGeo })));
const SectionStealthEngine = lazy(() => import("@/components/landing/SectionStealthEngine").then(m => ({ default: m.SectionStealthEngine })));
const SectionDeepDive = lazy(() => import("@/components/landing/SectionDeepDive").then(m => ({ default: m.SectionDeepDive })));
const SectionComparison = lazy(() => import("@/components/landing/SectionComparison").then(m => ({ default: m.SectionComparison })));
const SectionTestimonials = lazy(() => import("@/components/landing/SectionTestimonials").then(m => ({ default: m.SectionTestimonials })));
const SectionPricing = lazy(() => import("@/components/landing/SectionPricing").then(m => ({ default: m.SectionPricing })));

export default function Index() {
  const { lang } = useI18n();

  useEffect(() => {
    document.title = lang === "ru"
      ? "СЕО-Модуль — AI-экосистема для SEO-контента"
      : "СЕО-Модуль — AI-Powered SEO Content Ecosystem";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute("content", lang === "ru"
        ? "Технологичная экосистема для синтеза SEO-статей экспертного уровня. Захватывайте выдачу Google SGE и AI-ответы."
        : "Professional ecosystem for engineering SEO content. Smart Research, AI Writer, GEO Radar, Human Score."
      );
    }
  }, [lang]);

  return (
    <div className="min-h-screen bg-[#050505] text-foreground relative">
      {/* Noise texture */}
      <div
        className="pointer-events-none fixed inset-0 z-[1] opacity-[0.02]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
        }}
      />
      <div className="pointer-events-none fixed top-[30%] left-[15%] w-[600px] h-[500px] rounded-full bg-primary/[0.03] blur-[250px] z-[1]" />
      <div className="pointer-events-none fixed top-[60%] right-[10%] w-[500px] h-[400px] rounded-full bg-[#3b82f6]/[0.025] blur-[220px] z-[1]" />

      <div className="relative z-[3]">
        <LandingNav />
      </div>

      <div className="relative z-[2]">
        <SectionHero />
        <Suspense fallback={null}>
          <SectionResearch />
          <SectionPersona />
          <SectionGeo />
          <SectionStealthEngine />
          <SectionDeepDive />
          <SectionComparison />
          <SectionTestimonials />
          <SectionPricing />
        </Suspense>
        <SectionFaq />
        <LandingFooter />
      </div>

      <CookieConsent />
      <ScrollToTop />
    </div>
  );
}
