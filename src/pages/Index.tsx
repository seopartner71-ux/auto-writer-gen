import { LandingNav } from "@/components/landing/LandingNav";
import { SectionHero } from "@/components/landing/SectionHero";
import { SectionResults } from "@/components/landing/SectionResults";
import { SectionHowItWorks } from "@/components/landing/SectionHowItWorks";
import { SectionFeatures } from "@/components/landing/SectionFeatures";
import { SectionPricing } from "@/components/landing/SectionPricing";
import { SectionFinalCta } from "@/components/landing/SectionFinalCta";
import { SectionTestimonials } from "@/components/landing/SectionTestimonials";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { CookieConsent } from "@/components/landing/CookieConsent";
import { ScrollToTop } from "@/components/landing/ScrollToTop";
import { useI18n } from "@/shared/hooks/useI18n";
import { useEffect } from "react";

export default function Index() {
  const { lang } = useI18n();

  useEffect(() => {
    document.title = lang === "ru"
      ? "Auto-Writer-Gen — AI-генератор SEO-контента"
      : "Auto-Writer-Gen — AI SEO Content Generator";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute("content", lang === "ru"
        ? "Auto-Writer-Gen — профессиональный AI-генератор SEO-статей. Smart Research, Expert Personas, Stealth Engine. 0% AI Detection."
        : "Auto-Writer-Gen — professional AI SEO article generator. Smart Research, Expert Personas, Stealth Engine. 0% AI Detection."
      );
    }

    const existingLd = document.querySelector('script[data-ld="serpblueprint"]');
    if (existingLd) existingLd.remove();

    const ldOrg = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "name": "Auto-Writer-Gen",
          "url": window.location.origin,
          "logo": `${window.location.origin}/placeholder.svg`,
          "description": lang === "ru"
            ? "AI-генератор SEO-контента экспертного уровня"
            : "AI-powered expert-level SEO content generator",
        },
        {
          "@type": "WebApplication",
          "name": "Auto-Writer-Gen",
          "applicationCategory": "SEO Tool",
          "operatingSystem": "Web",
          "offers": {
            "@type": "AggregateOffer",
            "priceCurrency": "USD",
            "lowPrice": "0",
            "highPrice": "169",
            "offerCount": "3"
          }
        },
        {
          "@type": "WebPage",
          "@id": window.location.href,
          "name": document.title,
          "description": meta?.getAttribute("content") || "",
          "isPartOf": { "@type": "WebSite", "name": "Auto-Writer-Gen", "url": window.location.origin }
        }
      ]
    };

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute("data-ld", "serpblueprint");
    script.textContent = JSON.stringify(ldOrg);
    document.head.appendChild(script);

    return () => { script.remove(); };
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
        <SectionResults />
        <SectionHowItWorks />
        <SectionFeatures />
        <SectionTestimonials />
        <SectionPricing />
        <SectionFinalCta />
        <LandingFooter />
      </div>

      <CookieConsent />
      <ScrollToTop />
    </div>
  );
}
