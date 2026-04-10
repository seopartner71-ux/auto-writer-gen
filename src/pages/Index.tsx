import { lazy, Suspense } from "react";
import { LandingNav } from "@/components/landing/LandingNav";
import { SectionHero } from "@/components/landing/SectionHero";
import { SectionFaq } from "@/components/landing/SectionFaq";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { CookieConsent } from "@/components/landing/CookieConsent";
import { ScrollToTop } from "@/components/landing/ScrollToTop";
import { FloatingCTA } from "@/components/landing/FloatingCTA";
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

  // JSON-LD structured data
  useEffect(() => {
    const existing = document.getElementById("ld-json-landing");
    if (existing) existing.remove();

    const isEn = lang === "en";

    const organization = {
      "@type": "Organization",
      "@id": "https://seo-modul.pro/#organization",
      name: "СЕО-Модуль",
      url: "https://seo-modul.pro",
      logo: "https://seo-modul.pro/og-image.png",
      description: isEn
        ? "AI-powered SEO content ecosystem for expert-level articles"
        : "AI-экосистема для создания SEO-контента экспертного уровня",
      sameAs: [],
    };

    const website = {
      "@type": "WebSite",
      "@id": "https://seo-modul.pro/#website",
      url: "https://seo-modul.pro",
      name: "СЕО-Модуль",
      publisher: { "@id": "https://seo-modul.pro/#organization" },
    };

    const webApp = {
      "@type": "SoftwareApplication",
      "@id": "https://seo-modul.pro/#app",
      name: "СЕО-Модуль",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: "https://seo-modul.pro",
      offers: [
        { "@type": "Offer", name: "Starter", price: "0", priceCurrency: "RUB", description: isEn ? "3 articles/month free" : "3 статьи/месяц бесплатно" },
        { "@type": "Offer", name: "Pro", price: "1990", priceCurrency: "RUB", description: isEn ? "30 articles/month" : "30 статей/месяц" },
        { "@type": "Offer", name: "Business", price: "4990", priceCurrency: "RUB", description: isEn ? "100 articles/month" : "100 статей/месяц" },
      ],
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: "4.9",
        bestRating: "5",
        ratingCount: "312",
        reviewCount: "12",
      },
      review: [
        { "@type": "Review", author: { "@type": "Person", name: isEn ? "Alex M." : "Алексей М." }, reviewRating: { "@type": "Rating", ratingValue: "5" }, reviewBody: isEn ? "Factory + Persona Engine gave us scale without losing quality." : "Factory + Persona Engine дал масштаб без потери качества." },
        { "@type": "Review", author: { "@type": "Person", name: isEn ? "Irina S." : "Ирина С." }, reviewRating: { "@type": "Rating", ratingValue: "5" }, reviewBody: isEn ? "Stealth Engine is magic. 1.57% AI detection." : "Stealth Engine — это магия. 1.57% AI detection на выходе." },
        { "@type": "Review", author: { "@type": "Person", name: isEn ? "Sergey L." : "Сергей Л." }, reviewRating: { "@type": "Rating", ratingValue: "5" }, reviewBody: isEn ? "100 articles in a week via Factory." : "100 статей за неделю через Factory." },
      ],
    };

    const faqItems = isEn
      ? [
          { q: "How does СЕО-Модуль differ from ChatGPT?", a: "СЕО-Модуль is a specialized SEO ecosystem with Smart Research, competitor analysis, GEO optimization, and Stealth Engine — not a general chatbot." },
          { q: "What is GEO Radar?", a: "GEO Radar monitors how AI assistants (ChatGPT, Perplexity, Gemini) mention your brand and tracks your visibility in AI-generated answers." },
          { q: "Is there a free plan?", a: "Yes, the Starter plan includes 3 free article generations per month with full Smart Research capabilities." },
        ]
      : [
          { q: "Чем СЕО-Модуль отличается от ChatGPT?", a: "СЕО-Модуль — это специализированная SEO-экосистема со Smart Research, анализом конкурентов, GEO-оптимизацией и Stealth Engine, а не общий чат-бот." },
          { q: "Что такое GEO Радар?", a: "GEO Радар отслеживает, как AI-ассистенты (ChatGPT, Perplexity, Gemini) упоминают ваш бренд и мониторит вашу видимость в AI-ответах." },
          { q: "Есть ли бесплатный тариф?", a: "Да, тариф Starter включает 3 бесплатные генерации статей в месяц с полным доступом к Smart Research." },
        ];

    const faqPage = {
      "@type": "FAQPage",
      mainEntity: faqItems.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    };

    const jsonLd = { "@context": "https://schema.org", "@graph": [organization, website, webApp, faqPage] };

    const script = document.createElement("script");
    script.id = "ld-json-landing";
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(jsonLd);
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
      <FloatingCTA />
    </div>
  );
}
