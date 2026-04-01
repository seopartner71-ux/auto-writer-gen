import { LandingNav } from "@/components/landing/LandingNav";
import { SectionHero } from "@/components/landing/SectionHero";
import { SectionBentoFeatures } from "@/components/landing/SectionBentoFeatures";
import { SectionHumanizer } from "@/components/landing/SectionHumanizer";
import { SectionStealth } from "@/components/landing/SectionStealth";
import { SectionTestimonials } from "@/components/landing/SectionTestimonials";
import { SectionPricing } from "@/components/landing/SectionPricing";
import { SectionFinalCta } from "@/components/landing/SectionFinalCta";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { CookieConsent } from "@/components/landing/CookieConsent";
import { ScrollToTop } from "@/components/landing/ScrollToTop";
import { useI18n } from "@/shared/hooks/useI18n";
import { useEffect } from "react";

export default function Index() {
  const { lang } = useI18n();

  useEffect(() => {
    document.title = lang === "ru"
      ? "SERPblueprint v2.0 — Профессиональный SEO-движок"
      : "SERPblueprint v2.0 — Professional SEO Engine";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute("content", lang === "ru"
        ? "SERPblueprint v2.0 — 17-модульная SEO-экосистема. Smart Research, Expert Personas, Stealth Engine. 0% AI Detection."
        : "SERPblueprint v2.0 — 17-module SEO ecosystem. Smart Research, Expert Personas, Stealth Engine. 0% AI Detection."
      );
    }

    const existingLd = document.querySelector('script[data-ld="serpblueprint"]');
    if (existingLd) existingLd.remove();

    const ldOrg = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "name": "SERPblueprint v2.0",
          "url": window.location.origin,
          "logo": `${window.location.origin}/placeholder.svg`,
        },
        {
          "@type": "WebApplication",
          "name": "SERPblueprint v2.0",
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
          "isPartOf": { "@type": "WebSite", "name": "SERPblueprint v2.0", "url": window.location.origin }
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
    <div className="min-h-screen bg-[#030303] text-foreground relative">
      {/* Noise */}
      <div
        className="pointer-events-none fixed inset-0 z-[1] opacity-[0.012]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
        }}
      />

      <div className="relative z-[3]">
        <LandingNav />
      </div>

      <div className="relative z-[2]">
        <SectionHero />
        <SectionBentoFeatures />
        <SectionHumanizer />
        <SectionStealth />
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
