import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type DBPlan = {
  id: string;
  name: string;
  price_rub: number | null;
  price_usd: number | null;
  monthly_article_limit: number;
  description_ru: string | null;
  description_en: string | null;
  features: Array<{ text_ru: string; text_en: string; included: boolean }> | null;
};

const FALLBACK: Record<string, { ru: string[]; en: string[]; rub: number; usd: number; credits: number }> = {
  free: {
    rub: 0, usd: 0, credits: 50,
    ru: ["50 кредитов / месяц", "AI + Тургенев проверка", "15+ авторских профилей", "Realtime SEO Score"],
    en: ["50 credits / month", "AI + Turgenev check", "15+ author profiles", "Realtime SEO Score"],
  },
  basic: {
    rub: 2490, usd: 25, credits: 150,
    ru: ["150 кредитов / месяц", "Smart Research + GEO Радар", "Humanize Stealth Engine", "Прямая публикация в WP / Telegraph"],
    en: ["150 credits / month", "Smart Research + GEO Radar", "Humanize Stealth Engine", "Direct publish to WP / Telegraph"],
  },
  pro: {
    rub: 7990, usd: 79, credits: 800,
    ru: ["800 кредитов / месяц", "Site Factory (программный SEO)", "Claude Opus + GPT-4 routing", "Instant Indexing API", "Приоритетная поддержка"],
    en: ["800 credits / month", "Site Factory (programmatic SEO)", "Claude Opus + GPT-4 routing", "Instant Indexing API", "Priority support"],
  },
};

export function LandingPricingV3() {
  const navigate = useNavigate();
  const { lang } = useI18n();
  const isEn = lang === "en";

  const { data: plans } = useQuery({
    queryKey: ["plans-v3"],
    queryFn: async () => {
      const { data } = await supabase
        .from("subscription_plans")
        .select("*")
        .order("monthly_article_limit");
      return (data || []) as unknown as DBPlan[];
    },
  });

  const fmt = (id: string, fb: { rub: number; usd: number; credits: number }) => {
    const db = plans?.find((p) => p.id === id);
    const rub = db?.price_rub ?? fb.rub;
    const usd = db?.price_usd ?? fb.usd;
    const credits = db?.monthly_article_limit ?? fb.credits;
    const desc = (isEn ? db?.description_en : db?.description_ru) || "";
    const name = db?.name || id.toUpperCase();
    const feats = db?.features?.length
      ? db.features.map((f) => ({ text: isEn ? f.text_en : f.text_ru, included: f.included }))
      : (isEn ? fb.en : fb.ru).map((t) => ({ text: t, included: true }));
    return {
      name,
      price: isEn ? `$${usd}` : `${rub.toLocaleString("ru-RU")} ₽`,
      desc,
      credits,
      feats,
    };
  };

  const tiers = [
    { id: "free", featured: false, ...fmt("free", FALLBACK.free) },
    { id: "pro", featured: true, ...fmt("basic", FALLBACK.basic) },
    { id: "max", featured: false, ...fmt("pro", FALLBACK.pro) },
  ];

  return (
    <section id="pricing" className="py-24 px-4 border-b border-border">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center max-w-2xl mx-auto">
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            {isEn ? "Pricing" : "Тарифы"}
          </p>
          <h2 className="mt-3 text-4xl md:text-5xl font-bold tracking-tighter text-foreground">
            {isEn ? "Simple, transparent pricing." : "Простые и прозрачные тарифы."}
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            {isEn ? "Start free, upgrade when you need more horsepower." : "Начните бесплатно, переходите выше, когда нужно больше мощности."}
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-4">
          {tiers.map((t) => (
            <div
              key={t.id}
              className={`rounded-xl border p-6 flex flex-col bg-card transition-colors ${
                t.featured ? "border-primary" : "border-border hover:border-foreground/20"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold tracking-tight text-foreground">{t.name}</h3>
                {t.featured && (
                  <span className="text-[10px] font-mono uppercase tracking-wider text-primary border border-primary/30 rounded-full px-2 py-0.5">
                    {isEn ? "Popular" : "Хит"}
                  </span>
                )}
              </div>
              {t.desc && <p className="mt-1.5 text-sm text-muted-foreground">{t.desc}</p>}
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-mono font-semibold tracking-tighter text-foreground">{t.price}</span>
                <span className="text-sm text-muted-foreground">/ {isEn ? "mo" : "мес"}</span>
              </div>
              <Button
                onClick={() => navigate("/register")}
                variant={t.featured ? "default" : "outline"}
                className="mt-6 w-full"
              >
                {isEn ? "Get started" : "Начать"}
              </Button>
              <div className="mt-6 pt-6 border-t border-border space-y-2.5">
                {t.feats.filter((f) => f.included).map((f, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 mt-0.5 text-foreground/70 shrink-0" strokeWidth={2} />
                    <span className="text-muted-foreground">{f.text}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}