import { motion } from "framer-motion";
import { TrendingUp, MapPin, Link2, Clock, CheckCircle2, Quote, ArrowRight, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import gscScreenshot from "@/assets/case-pbn-gsc.jpg";

export function SectionRealCase() {
  const metrics = [
    { icon: TrendingUp, label: "Показов в Google", value: "5 170", color: "text-emerald-400" },
    { icon: MapPin, label: "Средняя позиция", value: "17.4", color: "text-emerald-400" },
    { icon: Link2, label: "Внешних ссылок", value: "0", color: "text-emerald-400" },
    { icon: Clock, label: "Срок", value: "3 месяца", color: "text-emerald-400" },
  ];

  const checks = [
    { label: "Тургенев", value: "0 баллов" },
    { label: "AI-детектор", value: "11%" },
    { label: "Песочница Google", value: "обошли" },
  ];

  return (
    <section className="py-16 md:py-24 px-4 relative">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-10">
          <Badge variant="outline" className="mb-3 border-emerald-500/30 text-emerald-400">
            <TrendingUp className="w-3 h-3 mr-1" />
            Кейс из практики
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Реальные результаты, <span className="text-emerald-400">не обещания</span>
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl mx-auto">
            PBN-сайт на автогенерации. Запустили и не трогали 3 месяца. Вот что получилось.
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="relative rounded-3xl overflow-hidden border border-emerald-500/20 bg-gradient-to-br from-emerald-950/30 via-card/40 to-card/40 backdrop-blur-xl"
        >
          {/* Glow */}
          <div className="pointer-events-none absolute -top-20 -left-20 w-72 h-72 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -right-20 w-72 h-72 rounded-full bg-emerald-500/10 blur-3xl" />

          <div className="relative grid lg:grid-cols-2 gap-0">
            {/* Left: data */}
            <div className="p-6 md:p-10 space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-emerald-400/80">Кейс</div>
                  <div className="text-lg font-semibold">PBN-сайт с нуля</div>
                </div>
              </div>

              <p className="text-muted-foreground leading-relaxed">
                Запустили сайт на автогенерации. Не трогали 3 месяца. Без ссылок, без ручной правки.
              </p>

              {/* Big metrics */}
              <div className="grid grid-cols-2 gap-3">
                {metrics.map((m) => (
                  <div
                    key={m.label}
                    className="p-4 rounded-2xl bg-background/40 border border-emerald-500/15 hover:border-emerald-500/40 transition-colors"
                  >
                    <m.icon className={`w-5 h-5 mb-2 ${m.color}`} />
                    <div className={`text-2xl md:text-3xl font-bold tabular-nums ${m.color}`}>{m.value}</div>
                    <div className="text-xs text-muted-foreground mt-1">{m.label}</div>
                  </div>
                ))}
              </div>

              {/* Checks */}
              <div className="space-y-2">
                {checks.map((c) => (
                  <div key={c.label} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-muted-foreground">{c.label}:</span>
                    <span className="font-semibold text-foreground">{c.value}</span>
                  </div>
                ))}
              </div>

              {/* Quote */}
              <div className="relative p-4 rounded-2xl bg-background/30 border-l-2 border-emerald-500/60">
                <Quote className="w-4 h-4 text-emerald-400/60 mb-2" />
                <p className="text-sm text-foreground/90 italic leading-relaxed">
                  Большинство новых сайтов сидят в песочнице 6-12 месяцев. Этот сайт в индексе с первого месяца.
                </p>
              </div>

              {/* Next step */}
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20">
                <ArrowRight className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <div className="font-semibold text-foreground">Следующая точка: 6 месяцев</div>
                  <div className="text-muted-foreground mt-0.5">Добавим ссылки - ждите результатов.</div>
                </div>
              </div>
            </div>

            {/* Right: GSC screenshot */}
            <div className="relative p-6 md:p-10 flex flex-col justify-center bg-background/20 border-t lg:border-t-0 lg:border-l border-emerald-500/15">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                Google Search Console - живые данные
              </div>
              <div className="rounded-xl overflow-hidden border border-border/40 shadow-2xl">
                <img
                  src={gscScreenshot}
                  alt="График показов в Google Search Console: рост с 0 до 150 показов в день за 3 месяца"
                  loading="lazy"
                  className="w-full h-auto block"
                />
              </div>
              <div className="mt-4 text-xs text-muted-foreground">
                Январь - апрель 2026. Органический трафик без единой внешней ссылки.
              </div>
            </div>
          </div>
        </motion.div>

        {/* Telegram CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="mt-8 text-center"
        >
          <a
            href="https://t.me/system_seo"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-emerald-500/20 to-emerald-400/10 border border-emerald-500/40 hover:border-emerald-400 hover:from-emerald-500/30 transition-all group"
          >
            <Send className="w-4 h-4 text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
            <span className="text-sm font-medium">
              Следим за результатами в Telegram-канале
            </span>
            <span className="text-emerald-400 font-semibold">@system_seo</span>
            <ArrowRight className="w-4 h-4 text-emerald-400 group-hover:translate-x-1 transition-transform" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}