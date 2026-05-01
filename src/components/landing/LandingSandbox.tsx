import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Loader2, Target, TrendingUp, Brain, Search, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";

interface SandboxResult {
  intent: string;
  competition: string;
  estimated_difficulty: number;
  outline: string[];
  lsi_keywords: string[];
  ai_score_sample: number;
  seo_score_sample: number;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export function LandingSandbox() {
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SandboxResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const examples = ["купить ноутбук", "как похудеть", "лучшие CRM 2026"];

  const run = async (kw?: string) => {
    const target = (kw ?? keyword).trim();
    if (target.length < 2) return;
    setKeyword(target);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/sandbox-demo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
        },
        body: JSON.stringify({ keyword: target }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Ошибка анализа");
      setResult(data.result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const scoreColor = (s: number) => (s >= 70 ? "text-emerald-400" : s >= 30 ? "text-amber-400" : "text-rose-400");

  return (
    <section className="py-20 md:py-28 px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/5 to-transparent pointer-events-none" />
      <div className="container mx-auto max-w-5xl relative">
        <div className="text-center mb-12">
          <Badge variant="outline" className="mb-4 border-primary/30 text-primary">
            <Sparkles className="w-3 h-3 mr-1" />
            Песочница - без регистрации
          </Badge>
          <h2 className="text-3xl md:text-5xl font-bold mb-4 tracking-tight">
            Попробуйте СЕО-Модуль <span className="text-primary">прямо сейчас</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Введите любой ключевой запрос - получите анализ интента, структуру статьи и LSI-ключи за 10 секунд.
          </p>
        </div>

        <Card className="p-6 md:p-8 bg-card/40 backdrop-blur-xl border-primary/20">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Например: купить кроссовки nike"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
                className="pl-9 h-12 bg-background/60"
                disabled={loading}
              />
            </div>
            <Button onClick={() => run()} disabled={loading || keyword.length < 2} size="lg" className="h-12 px-8">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Анализирую...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Анализировать
                </>
              )}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            <span className="text-xs text-muted-foreground self-center">Примеры:</span>
            {examples.map((ex) => (
              <button
                key={ex}
                onClick={() => run(ex)}
                disabled={loading}
                className="text-xs px-3 py-1 rounded-full bg-muted/40 hover:bg-muted/60 transition-colors disabled:opacity-50"
              >
                {ex}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm"
              >
                {error}
              </motion.div>
            )}

            {result && (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="mt-6 space-y-4"
              >
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-4 rounded-lg bg-background/60 border border-border/40">
                    <div className="text-xs text-muted-foreground mb-1">Интент</div>
                    <div className="font-semibold text-sm">{result.intent}</div>
                  </div>
                  <div className="p-4 rounded-lg bg-background/60 border border-border/40">
                    <div className="text-xs text-muted-foreground mb-1">Конкуренция</div>
                    <div className="font-semibold text-sm">{result.competition}</div>
                  </div>
                  <div className="p-4 rounded-lg bg-background/60 border border-border/40">
                    <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <Target className="w-3 h-3" /> SEO-Score
                    </div>
                    <div className={`font-bold text-lg ${scoreColor(result.seo_score_sample)}`}>
                      {result.seo_score_sample}/100
                    </div>
                  </div>
                  <div className="p-4 rounded-lg bg-background/60 border border-border/40">
                    <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <Brain className="w-3 h-3" /> AI-Score
                    </div>
                    <div className={`font-bold text-lg ${scoreColor(result.ai_score_sample)}`}>
                      {result.ai_score_sample}/100
                    </div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-background/60 border border-border/40">
                    <div className="flex items-center gap-2 text-sm font-semibold mb-3">
                      <TrendingUp className="w-4 h-4 text-primary" /> Структура статьи
                    </div>
                    <ol className="space-y-2 text-sm">
                      {result.outline.map((h, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-primary font-mono text-xs">{i + 1}.</span>
                          <span className="text-muted-foreground">{h}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div className="p-4 rounded-lg bg-background/60 border border-border/40">
                    <div className="flex items-center gap-2 text-sm font-semibold mb-3">
                      <Sparkles className="w-4 h-4 text-primary" /> LSI-ключи
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {result.lsi_keywords.map((k) => (
                        <Badge key={k} variant="secondary" className="text-xs">
                          {k}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="p-5 rounded-lg bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 flex flex-col md:flex-row items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold mb-1">Это лишь 5% возможностей</div>
                    <div className="text-sm text-muted-foreground">
                      Регистрация - получите полную статью за 60 секунд + 3 кредита бесплатно.
                    </div>
                  </div>
                  <Link to="/register">
                    <Button size="lg" className="whitespace-nowrap">
                      Получить полную статью
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </div>
    </section>
  );
}