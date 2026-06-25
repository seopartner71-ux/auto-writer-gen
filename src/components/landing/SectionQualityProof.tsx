import { motion } from "framer-motion";
import { useState } from "react";
import { ShieldCheck, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/hooks/useI18n";
import turgenev from "@/assets/proof/turgenev.webp";
import textru from "@/assets/proof/textru.webp";
import glvrd94 from "@/assets/proof/glvrd-94.webp";
import glvrd81 from "@/assets/proof/glvrd-81.webp";

type Proof = {
  src: string;
  service: string;
  metric: string;
  caption: string;
  tone: "emerald" | "sky" | "violet" | "amber";
};

const PROOFS_RU: Proof[] = [
  { src: turgenev, service: "Тургенев", metric: "0 баллов риска", caption: "Характеристики не превышают допустимые значения", tone: "emerald" },
  { src: textru, service: "Text.ru - AI-детектор", metric: "1.90%", caption: "Текст распознан как написанный человеком", tone: "emerald" },
  { src: glvrd94, service: "Главред", metric: "9.4 / 10", caption: "1691 слово, 169 предложений - чистый редакторский стиль", tone: "sky" },
  { src: glvrd81, service: "Главред", metric: "8.1 / 10", caption: "Высокая плотность смысла на длинной статье", tone: "violet" },
];
const PROOFS_EN: Proof[] = [
  { src: turgenev, service: "Turgenev", metric: "0 risk points", caption: "All metrics within safe limits", tone: "emerald" },
  { src: textru, service: "Text.ru - AI detector", metric: "1.90%", caption: "Text detected as human-written", tone: "emerald" },
  { src: glvrd94, service: "Glavred", metric: "9.4 / 10", caption: "1,691 words, 169 sentences - clean editorial style", tone: "sky" },
  { src: glvrd81, service: "Glavred", metric: "8.1 / 10", caption: "High meaning density on a long-form article", tone: "violet" },
];

const TONE_CLASSES: Record<Proof["tone"], { border: string; glow: string; text: string; bg: string }> = {
  emerald: {
    border: "border-emerald-500/30",
    glow: "bg-emerald-500/10",
    text: "text-emerald-400",
    bg: "bg-emerald-500/15",
  },
  sky: {
    border: "border-sky-500/30",
    glow: "bg-sky-500/10",
    text: "text-sky-400",
    bg: "bg-sky-500/15",
  },
  violet: {
    border: "border-violet-500/30",
    glow: "bg-violet-500/10",
    text: "text-violet-400",
    bg: "bg-violet-500/15",
  },
  amber: {
    border: "border-amber-500/30",
    glow: "bg-amber-500/10",
    text: "text-amber-400",
    bg: "bg-amber-500/15",
  },
};

export function SectionQualityProof() {
  const { lang } = useI18n();
  const isEn = lang === "en";
  const PROOFS = isEn ? PROOFS_EN : PROOFS_RU;
  const [zoom, setZoom] = useState<Proof | null>(null);

  return (
    <section className="py-16 md:py-24 px-4 relative">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-10">
          <Badge variant="outline" className="mb-3 border-emerald-500/30 text-emerald-400">
            <ShieldCheck className="w-3 h-3 mr-1" />
            {isEn ? "Quality proof" : "Доказательства качества"}
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            {isEn
              ? <>Articles that pass <span className="text-emerald-400">every key check</span></>
              : <>Тексты, которые проходят <span className="text-emerald-400">все ключевые проверки</span></>}
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl mx-auto">
            {isEn
              ? "Screenshots from independent content scoring services - real articles generated in SEO-Module. Click to enlarge."
              : "Скриншоты из независимых сервисов оценки контента - реальные статьи, сгенерированные в СЕО-Модуле. Кликните, чтобы увеличить."}
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {PROOFS.map((p, i) => {
            const t = TONE_CLASSES[p.tone];
            return (
              <motion.button
                key={p.service + p.metric}
                type="button"
                onClick={() => setZoom(p)}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: i * 0.08 }}
                whileHover={{ y: -4 }}
                className={`group text-left relative rounded-2xl overflow-hidden border ${t.border} bg-gradient-to-br from-card/60 to-card/30 backdrop-blur-xl transition-shadow hover:shadow-2xl`}
              >
                <div className={`pointer-events-none absolute -top-16 -right-16 w-48 h-48 rounded-full ${t.glow} blur-3xl`} />

                <div className="relative aspect-[16/10] overflow-hidden bg-white">
                  <img
                    src={p.src}
                    alt={`${p.service} - ${p.metric}`}
                    loading="lazy" decoding="async"
                    className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                </div>

                <div className="relative p-5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">{p.service}</div>
                    <div className={`w-7 h-7 rounded-lg ${t.bg} border ${t.border} flex items-center justify-center`}>
                      <Sparkles className={`w-3.5 h-3.5 ${t.text}`} />
                    </div>
                  </div>
                  <div className={`text-2xl font-bold ${t.text}`}>{p.metric}</div>
                  <p className="text-sm text-muted-foreground leading-snug">{p.caption}</p>
                </div>
              </motion.button>
            );
          })}
        </div>

        <p className="text-center text-xs text-muted-foreground/70 mt-6">
          {isEn
            ? "Turgenev, text.ru and Glavred are quality-check services for Russian-language content."
            : "Тургенев - text.ru - Главред. Сервисы проверки русскоязычного контента."}
        </p>
      </div>

      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
        >
          <button
            type="button"
            onClick={() => setZoom(null)}
            aria-label={isEn ? "Close" : "Закрыть"}
            className="absolute top-5 right-5 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={zoom.src}
            alt={`${zoom.service} - ${zoom.metric}`}
            onClick={(e) => e.stopPropagation()}
            className="max-w-[95vw] max-h-[90vh] rounded-xl shadow-2xl border border-white/10 bg-white"
          />
        </div>
      )}
    </section>
  );
}