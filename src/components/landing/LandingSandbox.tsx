import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Loader2, Target, TrendingUp, Brain, Search, ArrowRight, FileText, Lock, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "react-router-dom";

interface SandboxResult {
  intent: string;
  competition: string;
  estimated_difficulty: number;
  outline: string[];
  lsi_keywords: string[];
  ai_score_sample: number;
  seo_score_sample: number;
  article_title?: string;
  meta_description?: string;
  direct_answer?: string;
  intro_paragraph?: string;
  first_section_title?: string;
  first_section_paragraph?: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export function LandingSandbox() {
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SandboxResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

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
      if (typeof data.remaining === "number") setRemaining(data.remaining);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const scoreColor = (s: number) => (s >= 70 ? "text-emerald-400" : s >= 30 ? "text-amber-400" : "text-rose-400");
  const hasArticlePreview = result && (result.intro_paragraph || result.article_title);

  return (
    <section id="try-now" className="py-20 md:py-28 px-4 relative overflow-hidden scroll-mt-20">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/5 to-transparent pointer-events-none" />
      <div className="container mx-auto max-w-5xl relative">
        <div className="text-center mb-12">
          <Badge variant="outline" className="mb-4 border-emerald-500/30 text-emerald-400">
            <Zap className="w-3 h-3 mr-1" />
            Без регистрации - реальная статья за 10 секунд
          </Badge>
          <h2 className="text-3xl md:text-5xl font-bold mb-4 tracking-tight">
            Сгенерируйте статью <span className="text-primary">прямо сейчас</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Введите ключевик - получите H1, meta description, Direct Answer и реальное вступление статьи. Без email, без пароля.
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
                  Генерирую превью...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Сгенерировать
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
            {remaining !== null && (
              <span className="text-xs text-muted-foreground self-center ml-auto">
                Осталось попыток в этот час: <span className="text-emerald-400 font-semibold">{remaining}</span>
              </span>
            )}
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
                <Tabs defaultValue={hasArticlePreview ? "article" : "analysis"} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 bg-background/40">
                    <TabsTrigger value="article" className="data-[state=active]:bg-primary/20">
                      <FileText className="w-4 h-4 mr-2" />
                      Превью статьи
                    </TabsTrigger>
                    <TabsTrigger value="analysis" className="data-[state=active]:bg-primary/20">
                      <Brain className="w-4 h-4 mr-2" />
                      SEO-анализ
                    </TabsTrigger>
                  </TabsList>

                  {/* === ARTICLE PREVIEW TAB === */}
                  <TabsContent value="article" className="mt-4 space-y-4">
                    {hasArticlePreview ? (
                      <div className="relative">
                        <article className="p-5 md:p-7 rounded-lg bg-background/70 border border-border/40 prose prose-invert max-w-none">
                          {result.article_title && (
                            <h1 className="text-xl md:text-2xl font-bold leading-tight m-0 mb-2 text-foreground">
                              {result.article_title}
                            </h1>
                          )}
                          {result.meta_description && (
                            <div className="text-xs text-muted-foreground mb-4 italic border-l-2 border-primary/30 pl-3">
                              meta: {result.meta_description}
                            </div>
                          )}

                          {result.direct_answer && (
                            <div className="my-4 p-4 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                              <div className="text-[11px] uppercase tracking-wider text-emerald-400 font-semibold mb-1">
                                Direct Answer (для AI Overviews)
                              </div>
                              <p className="text-sm text-foreground/90 m-0">{result.direct_answer}</p>
                            </div>
                          )}

                          {result.intro_paragraph && (
                            <p className="text-sm md:text-base leading-relaxed text-foreground/85 m-0 mb-4">
                              {result.intro_paragraph}
                            </p>
                          )}

                          {result.first_section_title && (
                            <h2 className="text-lg md:text-xl font-semibold m-0 mt-5 mb-3 text-foreground">
                              {result.first_section_title}
                            </h2>
                          )}
                          {result.first_section_paragraph && (
                            <div className="relative">
                              <p className="text-sm md:text-base leading-relaxed text-foreground/85 m-0">
                                {result.first_section_paragraph}
                              </p>
                              {/* Faded continuation effect */}
                              <div className="mt-3 space-y-2 select-none pointer-events-none" aria-hidden="true">
                                <div className="h-3 rounded bg-foreground/10 w-full" />
                                <div className="h-3 rounded bg-foreground/10 w-[92%]" />
                                <div className="h-3 rounded bg-foreground/10 w-[78%]" />
                                <div className="h-3 rounded bg-foreground/[0.06] w-[88%]" />
                                <div className="h-3 rounded bg-foreground/[0.04] w-[60%]" />
                              </div>
                            </div>
                          )}
                        </article>

                        {/* Bottom fade overlay */}
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-card via-card/80 to-transparent rounded-b-lg" />
                      </div>
                    ) : (
                      <div className="p-6 text-center text-sm text-muted-foreground">
                        Превью не сгенерировано. Попробуйте другой запрос.
                      </div>
                    )}
                  </TabsContent>

                  {/* === ANALYSIS TAB === */}
                  <TabsContent value="analysis" className="mt-4 space-y-4">
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
                  </TabsContent>
                </Tabs>

                <div className="relative p-5 md:p-6 rounded-lg bg-gradient-to-r from-primary/15 via-primary/10 to-emerald-500/10 border border-primary/30 overflow-hidden">
                  <div className="absolute -top-8 -right-8 w-32 h-32 bg-primary/20 blur-3xl rounded-full pointer-events-none" />
                  <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Lock className="w-4 h-4 text-primary" />
                        <span className="font-semibold text-base">Дочитать всю статью + получить .docx</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Регистрация за 30 секунд - и СЕО-Модуль допишет полную статью на 2500+ слов с конкурентным анализом, fact-check и Stealth Engine. <span className="text-emerald-400 font-medium">3 кредита бесплатно.</span>
                      </div>
                    </div>
                    <Link to="/register" className="w-full md:w-auto">
                      <Button size="lg" className="w-full md:w-auto whitespace-nowrap shadow-lg shadow-primary/20">
                        Дописать бесплатно
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </div>
    </section>
  );
}