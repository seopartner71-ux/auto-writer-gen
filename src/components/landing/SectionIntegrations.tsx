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
    <section className="relative py-16 overflow-hidden border-y border-white/[0.03]">
      <div className="container mx-auto px-4 max-w-6xl">
        <p className="text-center text-[11px] font-mono text-muted-foreground/25 uppercase tracking-widest mb-8">
          {t("integ.title")}
        </p>

        {/* Marquee */}
        <div className="relative overflow-hidden">
          <div className="flex animate-marquee gap-12 items-center">
            {[...logos, ...logos].map((logo, i) => (
              <div key={i} className="flex items-center gap-2 shrink-0 opacity-30 hover:opacity-60 transition-opacity duration-300">
                <div className="w-8 h-8 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center text-[10px] font-tech font-bold text-white/40">
                  {logo.svg}
                </div>
                <span className="text-[11px] font-tech text-white/30 whitespace-nowrap">{logo.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
