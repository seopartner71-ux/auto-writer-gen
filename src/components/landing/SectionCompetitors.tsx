import { useI18n } from "@/shared/hooks/useI18n";
import { motion } from "framer-motion";
import { Check, Minus, Sparkles } from "lucide-react";

type Cell = true | false | string;

const content = {
  ru: {
    heading: "СЕО-Модуль vs конкуренты",
    sub: "Сравнение по фичам, которые реально влияют на ТОП и обход AI-детекторов",
    us: "СЕО-Модуль",
    rows: [
      { f: "Humanize Fix + Stealth Pipeline", us: true, c1: false, c2: false, c3: "частично", c4: false },
      { f: "Серверный Quality Gate (метрики, фейк-чек)", us: true, c1: false, c2: false, c3: false, c4: false },
      { f: "GEO Radar (отслеживание AI-выдачи)", us: true, c1: false, c2: false, c3: false, c4: false },
      { f: "Persona Engine (15+ авторских стилей)", us: true, c1: false, c2: false, c3: "базово", c4: false },
      { f: "Site Factory (массовые PBN-сайты)", us: true, c1: false, c2: false, c3: false, c4: "услуга" },
      { f: "Programmatic SEO + Smart Interlinking", us: true, c1: false, c2: false, c3: false, c4: false },
      { f: "Анализ конкурентов из ТОПа (Deep Parse)", us: true, c1: true, c2: true, c3: "частично", c4: false },
      { f: "Авто-публикация в WP / Telegra.ph / Ghost", us: true, c1: false, c2: false, c3: false, c4: true },
      { f: "Мульти-модельная генерация (GPT, Claude, Gemini)", us: true, c1: false, c2: false, c3: true, c4: false },
      { f: "Self-service SaaS (личный кабинет, не услуга)", us: true, c1: true, c2: true, c3: true, c4: false },
      { f: "Открытая регистрация без брони", us: true, c1: true, c2: false, c3: true, c4: false },
      { f: "Цена входа", us: "от 2 490 ₽", c1: "от 2 990 ₽", c2: "по запросу", c3: "от 1 500 ₽", c4: "от 30 000 ₽" },
    ] as { f: string; us: Cell; c1: Cell; c2: Cell; c3: Cell; c4: Cell }[],
    competitors: ["Сеометрия", "ИСПОЛИН", "SEOGENOTEXT", "Контентзавод"],
    note: "Данные на основе публичных описаний сервисов на дату публикации. Если что-то изменилось - напишите в поддержку.",
  },
  en: {
    heading: "SEO-Module vs competitors",
    sub: "Feature comparison on what actually drives rankings and bypasses AI detectors",
    us: "SEO-Module",
    rows: [
      { f: "Humanize Fix + Stealth Pipeline", us: true, c1: false, c2: "partial", c3: false, c4: false },
      { f: "Server-side Quality Gate (metrics, fact-check)", us: true, c1: false, c2: false, c3: false, c4: false },
      { f: "GEO Radar (AI search visibility)", us: true, c1: false, c2: false, c3: false, c4: false },
      { f: "Persona Engine (15+ author styles)", us: true, c1: "basic", c2: false, c3: false, c4: false },
      { f: "Site Factory (bulk PBN sites)", us: true, c1: false, c2: false, c3: false, c4: false },
      { f: "Programmatic SEO + Smart Interlinking", us: true, c1: false, c2: false, c3: false, c4: false },
      { f: "SERP competitor deep parse", us: true, c1: true, c2: "partial", c3: true, c4: true },
      { f: "Auto-publish to WP / Telegra.ph / Ghost", us: true, c1: false, c2: false, c3: false, c4: true },
      { f: "Multi-model generation (GPT, Claude, Gemini)", us: true, c1: false, c2: true, c3: true, c4: false },
      { f: "Self-service SaaS (not an agency)", us: true, c1: true, c2: true, c3: true, c4: false },
      { f: "Open signup, no waitlist", us: true, c1: true, c2: true, c3: false, c4: true },
      { f: "Entry price", us: "from $19", c1: "from $49", c2: "from $29", c3: "on request", c4: "from $99" },
    ] as { f: string; us: Cell; c1: Cell; c2: Cell; c3: Cell; c4: Cell }[],
    competitors: ["Jasper SEO", "Surfer AI", "Frase", "MarketMuse"],
    note: "Based on publicly available service descriptions at time of publication.",
  },
};

function CellView({ v }: { v: Cell }) {
  if (v === true) {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/10 border border-emerald-500/30">
        <Check className="w-3.5 h-3.5 text-emerald-400" />
      </span>
    );
  }
  if (v === false) {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/[0.02] border border-white/10">
        <Minus className="w-3.5 h-3.5 text-slate-600" />
      </span>
    );
  }
  return (
    <span className="text-[11px] font-mono text-slate-400 px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.02]">
      {v}
    </span>
  );
}

export function SectionCompetitors() {
  const { lang } = useI18n();
  const c = content[lang] || content.en;

  return (
    <section className="relative py-32 px-4 overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] rounded-full bg-primary/[0.03] blur-[250px]" />

      <div className="relative max-w-6xl mx-auto">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-4xl md:text-5xl lg:text-6xl font-black tracking-[-0.06em] text-center text-white mb-4"
          style={{ textShadow: "0 0 60px hsl(var(--primary) / 0.15)" }}
        >
          {c.heading}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="text-center text-slate-500 text-sm md:text-base font-mono mb-14 max-w-2xl mx-auto"
        >
          {c.sub}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15 }}
          className="rounded-2xl border border-white/[0.06] bg-white/[0.015] backdrop-blur-xl overflow-hidden"
        >
          <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                  <th className="text-left px-5 py-4 text-slate-500 font-mono text-xs uppercase tracking-wider font-medium">
                    {lang === "ru" ? "Фича" : "Feature"}
                  </th>
                  <th className="px-3 py-4">
                    <div className="flex items-center justify-center gap-1.5 text-emerald-400 font-semibold text-xs">
                      <Sparkles className="w-3.5 h-3.5" />
                      {c.us}
                    </div>
                  </th>
                  {c.competitors.map((name) => (
                    <th key={name} className="px-3 py-4 text-slate-500 font-mono text-xs font-medium">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.rows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.015] transition-colors"
                  >
                    <td className="px-5 py-3.5 text-slate-300 text-sm">{row.f}</td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center justify-center">
                        <CellView v={row.us} />
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center justify-center">
                        <CellView v={row.c1} />
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center justify-center">
                        <CellView v={row.c2} />
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center justify-center">
                        <CellView v={row.c3} />
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center justify-center">
                        <CellView v={row.c4} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-white/[0.06] px-5 py-3 bg-white/[0.01]">
            <p className="text-[11px] font-mono text-slate-600 text-center">{c.note}</p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
