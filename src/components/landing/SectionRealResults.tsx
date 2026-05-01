import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { FileText, BarChart3, Trophy, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface Stats {
  articles_30d: number;
  avg_seo_score: number;
  top10_count: number;
}

function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const duration = 1400;
    const from = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value]);
  return (
    <span>
      {display.toLocaleString()}
      {suffix}
    </span>
  );
}

export function SectionRealResults() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch(`${SUPABASE_URL}/functions/v1/public-stats`, {
      headers: { apikey: ANON_KEY },
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.error) setStats(d);
      })
      .catch(() => {});
  }, []);

  // Fallback display values while loading
  const items = [
    {
      icon: FileText,
      value: stats?.articles_30d ?? 0,
      label: "статей создано за 30 дней",
      color: "text-primary",
    },
    {
      icon: BarChart3,
      value: stats?.avg_seo_score ?? 0,
      suffix: "/100",
      label: "средний SEO-Score",
      color: "text-emerald-400",
    },
    {
      icon: Trophy,
      value: stats?.top10_count ?? 0,
      label: "статей в топ-10 Google",
      color: "text-amber-400",
    },
  ];

  return (
    <section className="py-16 md:py-24 px-4 relative">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-10">
          <Badge variant="outline" className="mb-3 border-emerald-500/30 text-emerald-400">
            <TrendingUp className="w-3 h-3 mr-1" />
            Реальные результаты
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Не маркетинг, а <span className="text-primary">живые цифры из БД</span>
          </h2>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
            Обновляется каждые 10 минут. Вы видите ровно то, что делают пользователи прямо сейчас.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          {items.map((it, i) => (
            <motion.div
              key={it.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
              className="p-6 rounded-2xl bg-card/40 backdrop-blur-xl border border-border/40 hover:border-primary/30 transition-colors text-center"
            >
              <it.icon className={`w-8 h-8 mx-auto mb-3 ${it.color}`} />
              <div className={`text-4xl md:text-5xl font-bold tabular-nums ${it.color}`}>
                <AnimatedNumber value={it.value} suffix={it.suffix} />
              </div>
              <div className="text-sm text-muted-foreground mt-2">{it.label}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}