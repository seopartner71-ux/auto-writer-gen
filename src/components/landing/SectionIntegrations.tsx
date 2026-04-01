import { motion } from "framer-motion";
import { useI18n } from "@/shared/hooks/useI18n";

const logos = [
  { name: "WordPress", svg: "W" },
  { name: "Google Search Console", svg: "G" },
  { name: "Yandex Webmaster", svg: "Y" },
  { name: "OpenRouter", svg: "OR" },
  { name: "Originality.ai", svg: "O" },
  { name: "Miralinks", svg: "M" },
  { name: "GoGetLinks", svg: "GL" },
  { name: "Stripe", svg: "S" },
];

export function SectionIntegrations() {
  const { t } = useI18n();

  return (
    <section className="relative py-20 overflow-hidden border-y border-white/[0.06]">
      <div className="container mx-auto px-4 max-w-6xl">
        <p className="text-center text-xs font-mono text-foreground/40 uppercase tracking-widest mb-10">
          {t("integ.title")}
        </p>

        {/* Marquee */}
        <div className="relative overflow-hidden">
          <div className="flex animate-marquee gap-14 items-center">
            {[...logos, ...logos].map((logo, i) => (
              <div key={i} className="flex items-center gap-3 shrink-0 opacity-50 hover:opacity-90 transition-opacity duration-300">
                <div className="w-10 h-10 rounded-xl border border-white/[0.1] bg-white/[0.04] flex items-center justify-center text-xs font-tech font-bold text-white/60 shadow-[0_0_15px_rgba(139,92,246,0.04)]">
                  {logo.svg}
                </div>
                <span className="text-sm font-tech text-white/50 whitespace-nowrap">{logo.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
