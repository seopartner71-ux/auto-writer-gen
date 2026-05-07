import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import {
  CheckCircle2, Circle, Shield, Activity, Zap, Brain, AlertTriangle,
  Plus, Search, ChevronDown, ChevronUp, Eye, Wrench, Loader2, Radar,
} from "lucide-react";
import {
  computeBurstiness, computeAiProbability, computePerplexity,
  computeSymmetry, findAiStopWords, getKeywordDensity, getLocalizedLabels,
} from "./humanScore/analysis";
import { detectContentLanguage } from "./humanScore/constants";
import { getEnStealthStats, type EnStealthStats } from "@/shared/utils/contentValidator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface HumanScorePanelProps {
  content: string;
  lsiKeywords: string[];
  onHighlightStopWords?: (words: string[]) => void;
  onFixIssue?: (issueKey: string, instruction: string) => void;
  isFixing?: string | null;
  personaStyle?: string;
}

export function getFixInstructions(lang: "ru" | "en", personaStyle?: string): Record<string, string> {
  const personaBlock = personaStyle
    ? (lang === "ru"
      ? `\n\nАДАПТАЦИЯ К ПЕРСОНЕ: Сохрани тон и стиль выбранного автора: "${personaStyle}". Если автор 'Скептик' — сделай текст ворчливым и прямым. Если 'Блогер' — более эмоциональным и неформальным. Если стиль нейтральный — сделай профессиональную, чистую, человечную редактуру.`
      : `\n\nPERSONA ADAPTATION: Maintain the tone and style of the chosen author: "${personaStyle}". If "Skeptical Pro" — make the fix more grumpy and direct. If "Lifestyle Blogger" — more emotional and informal. If neutral — make it a professional, clean human-like edit.`)
    : "";

  if (lang === "ru") {
    return {
      "ai-cliches": "Найди и замени ВСЕ ИИ-клише и штампы (например: 'важно отметить', 'следует подчеркнуть', 'в заключение', 'необходимо учитывать', 'таким образом', 'комплексный подход', 'представляет собой', 'рассмотрим подробнее') на живые, разговорные авторские обороты. Каждое заменённое выражение должно быть уникальным. Используй нишевый сленг и разговорные фразы.",
      "first-person": "Добавь в текст 3-5 высказываний от первого лица: 'Я считаю', 'По моему опыту', 'На мой взгляд', 'Мы видим', 'Меня удивило'. Вставь их в уже существующие абзацы естественно, не создавая новые разделы.",
      "paragraph-variety": "Измени длину абзацев так, чтобы они были РАЗНЫМИ: один абзац - 1-2 предложения, следующий - 4-5, потом снова короткий. Не делай все абзацы одинаковой длины.",
      "paragraph-starts": "Измени начала абзацев так, чтобы каждый начинался с другого слова/конструкции. Используй инверсии, вопросы, факты.",
      "burstiness": "Чередуй длину предложений: минимум 30% предложений должны быть очень короткими (3-7 слов), а 20% - длинными ветвистыми конструкциями (25-40 слов). Используй тире, двоеточия и парентетические вставки.",
      "rhetorical": "Добавь 3-4 риторических вопроса в тело статьи (НЕ в FAQ). Используй их для перехода между мыслями.",
      "humanize-all": `UNIVERSAL STEALTH BYPASS (0% AI TARGET):
Ты — элитный человеческий редактор. Твоя задача — переписать текст для 0% AI Score, СТРОГО сохраняя тон выбранной персоны.${personaBlock}

ОСНОВНЫЕ ПРАВИЛА:
1. ОЧИСТКА: Удали ВСЕ символы ** (жирный шрифт). Человеческие эксперты не выделяют ключевые слова bold в плавном тексте.

2. ЛИНГВИСТИЧЕСКИЙ ХАОС (Burstiness): Сломай ритмическую симметрию GPT.
   - Правило: Одно очень короткое предложение (3-5 слов) каждые 3-4 предложения.
   - Используй двоеточия (:) и ремарки в скобках (например: 'поверьте, я это видел', 'сам долго не верил') для имитации человеческого мышления.

3. УБИЙЦА ШТАМПОВ: Удали: 'является', 'кроме того', 'важно понимать', 'стоит отметить', 'наука не стоит на месте', 'представляет собой', 'таким образом', 'на сегодняшний день'.
   Замени на: 'база', 'честно', 'по факту', 'вот в чем фишка', 'звоночки', 'короче', 'тут такое дело'.

4. СИНТАКСИЧЕСКАЯ ИНВЕРСИЯ: Измени стандартный порядок слов на более разговорный, эмфатический поток.

5. РЕЖИМ ПРЯМОГО ОТВЕТА: Первое предложение после каждого H2/H3 - грубый, чёткий ответ без 'пустых' вступлений.

6. FAQ РЕДИЗАЙН: Переделай FAQ в формат 'Вопросы и ответы'. Тон - как у эксперта, отвечающего другу.

7. ЗАПРЕТ НА ТИРЕ: НИКОГДА не используй длинное тире (—) или среднее тире (–). Используй ТОЛЬКО обычный дефис-минус (-) для всех пунктуаций, списков и диалогов. Это техническое требование для совместимости с CMS.

ЦЕЛЬ: Результат должен выглядеть так, будто человек набрал его за один присест, со всеми естественными несовершенствами, сленгом и уникальным ритмом, который ИИ не может предсказать. 0% AI Score - единственный приемлемый результат.`,
    };
  }
  return {
    "ai-cliches": "Find and replace ALL AI clichés (e.g., 'it's important to note', 'furthermore', 'in conclusion', 'comprehensive', 'leverage', 'delve', 'uncover', 'meticulously') with natural, conversational authorial phrases. Each replacement must be unique. Use industry jargon and colloquial speech.",
    "first-person": "Add 3-5 first-person statements: 'I believe', 'In my experience', 'From what I've seen', 'We found', 'This surprised me'. Insert them naturally into existing paragraphs.",
    "paragraph-variety": "Vary paragraph lengths: one paragraph 1-2 sentences, next 4-5, then short again. Don't make all paragraphs the same length.",
    "paragraph-starts": "Change paragraph beginnings so each starts with a different word/construction. Use inversions, questions, facts.",
    "burstiness": "Alternate sentence lengths: at least 30% should be very short (3-7 words), and 20% long complex constructions (25-40 words). Use dashes, colons, and parenthetical asides.",
    "rhetorical": "Add 3-4 rhetorical questions in the body (NOT in FAQ). Use them as transitions between ideas.",
    "humanize-all": `Rewrite this text to sound like a real human expert. You are an elite human editor targeting 0% AI detection on Originality.ai.${personaBlock}

WRITING STYLE RULES:
- Use contractions ALWAYS: it's, don't, you'll, can't, won't, I've, we've, they're, isn't, wasn't, wouldn't, shouldn't. NEVER write "it is", "do not", "you will" in full form.
- Start some sentences with And, But, So — this is how real people write.
- Add rhetorical questions every 3-4 paragraphs to break monotony.
- Mix very short sentences (3-5 words) with long ones (25-35 words). Pattern: short-long-medium-short-long.
- Add specific personal observations and opinions: "I've seen this happen with...", "Most clients I work with..."
- Remove any formal academic tone completely.
- Use 'you' to address the reader directly throughout.

HUMANIZATION RULES:
- Occasionally use em-dashes — like this — for emphasis and asides.
- Add 1-2 industry-specific slang terms per 500 words ("the kicker", "game-changer", "no-brainer", "bottom line").
- Include at least one counterintuitive statement per section ("Sounds crazy, but...", "Against popular belief...").
- Use specific numbers instead of round ones: not "50%" but "47%", not "10 years" but "9 years".
- Add occasional self-corrections: "Actually, let me rephrase that...", "Wait, that's not quite right..."
- Use sentence fragments occasionally. For emphasis. Like this.
- Reference real-world scenarios: "I've seen this happen with..." or "Most clients I work with..."
- Vary paragraph length dramatically — one sentence, then five sentences, then two.
- Add qualifiers: "In most cases...", "This won't work if...", "The exception here is..."
- Never start two consecutive paragraphs with the same word.
- Include at least one direct quote or paraphrased expert opinion per section.

ZERO TOLERANCE — BANNED PHRASES (delete on sight, replace with natural transitions):
- "It is worth noting" / "It is worth noting that"
- "In conclusion"
- "Furthermore"
- "Moreover"
- "It is important to note" / "It is important to"
- "This is because"
- "In summary"
- "It should be noted"
- "One of the key"
- "In today's world"
- "In the realm of"
- "It goes without saying"
- "Needless to say"
- "As previously mentioned"
- "Comprehensive" / "Comprehensive guide"
- "Leverage" / "Streamline" / "Utilize"
- "Delve" / "Uncover" / "Meticulously"

FORMATTING:
1. STRIP ALL BOLD: Remove all ** formatting. Human experts don't bold keywords.
2. First sentence after each H2/H3 — blunt, clear answer. No fluff intros.
3. FAQ section tone: like an expert answering a friend, not a textbook.

Keep all facts, structure, headings, and SEO keywords intact. Only change the writing style.

FINAL GOAL: Output must look typed by a human in one sitting — with all natural imperfections, slang, and unique rhythm that AI cannot predict. 0% AI Score is the only acceptable result.`,
  };
}

function getTrafficColor(score: number, lang: "ru" | "en", thresholds: [number, number] = [45, 70]) {
  const labels = getLocalizedLabels(lang);
  if (score >= thresholds[1]) return { text: "text-green-500", bg: "bg-green-500", label: labels.excellent };
  if (score >= thresholds[0]) return { text: "text-yellow-500", bg: "bg-yellow-500", label: labels.medium };
  return { text: "text-red-500", bg: "bg-red-500", label: labels.low };
}

function getAiSafetyColor(score: number, lang: "ru" | "en") {
  const labels = getLocalizedLabels(lang);
  if (score >= 75) return { text: "text-green-500", bg: "bg-green-500", label: labels.safe };
  if (score >= 50) return { text: "text-yellow-500", bg: "bg-yellow-500", label: labels.mediumRisk };
  return { text: "text-red-500", bg: "bg-red-500", label: labels.highRisk };
}

export function HumanScorePanel({ content, lsiKeywords, onHighlightStopWords, onFixIssue, isFixing, personaStyle }: HumanScorePanelProps) {
  const [customKeywords, setCustomKeywords] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [showStopWords, setShowStopWords] = useState(false);
  const [stopWordsHighlighted, setStopWordsHighlighted] = useState(false);

  const contentLang = useMemo(() => detectContentLanguage(content), [content]);
  const labels = useMemo(() => getLocalizedLabels(contentLang), [contentLang]);
  const FIX_INSTRUCTIONS = useMemo(() => getFixInstructions(contentLang, personaStyle), [contentLang, personaStyle]);

  const FLAG_TO_FIX_KEY: Record<string, string> = useMemo(() => ({
    [labels.authorVoice]: "first-person",
    [labels.paragraphVariety]: "paragraph-variety",
    [labels.paragraphStarts]: "paragraph-starts",
    [labels.burstiness]: "burstiness",
    [labels.rhetoricalQuestions]: "rhetorical",
  }), [labels]);

  const wordCount = useMemo(() => content.trim().split(/\s+/).filter(Boolean).length, [content]);
  const burstiness = useMemo(() => computeBurstiness(content), [content]);
  const aiProb = useMemo(() => computeAiProbability(content), [content]);
  const perplexity = useMemo(() => computePerplexity(content), [content]);
  const symmetry = useMemo(() => computeSymmetry(content), [content]);
  const stopWords = useMemo(() => findAiStopWords(content), [content]);
  const stealthStats = useMemo<EnStealthStats | null>(() => {
    if (contentLang !== "en") return null;
    return getEnStealthStats(content);
  }, [content, contentLang]);

  const allLsiKeywords = useMemo(
    () => [...lsiKeywords, ...customKeywords],
    [lsiKeywords, customKeywords]
  );

  const lsiStatus = useMemo(() => {
    const lower = content.toLowerCase();
    return allLsiKeywords.map(kw => {
      const found = lower.includes(kw.toLowerCase());
      const density = found ? getKeywordDensity(content, kw) : 0;
      const isSpam = density > 3;
      return { keyword: kw, found, density, isSpam };
    });
  }, [content, allLsiKeywords]);

  const sortedLsi = useMemo(() =>
    [...lsiStatus].sort((a, b) => {
      if (a.found === b.found) return 0;
      return a.found ? 1 : -1;
    }),
    [lsiStatus]
  );

  const lsiFoundCount = lsiStatus.filter(s => s.found).length;
  const burstColor = getTrafficColor(burstiness.score, contentLang);
  const aiColor = getAiSafetyColor(aiProb.score, contentLang);
  const perplexityColor = getTrafficColor(perplexity.score, contentLang);

  const handleAddCustomKeywords = useCallback(() => {
    if (!customInput.trim()) return;
    const newKws = customInput
      .split(/[,\n]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !allLsiKeywords.includes(s));
    setCustomKeywords(prev => [...prev, ...newKws]);
    setCustomInput("");
  }, [customInput, allLsiKeywords]);

  const handleToggleHighlight = useCallback(() => {
    const words = stopWords.map(sw => sw.word);
    if (stopWordsHighlighted) {
      onHighlightStopWords?.([]);
    } else {
      onHighlightStopWords?.(words);
    }
    setStopWordsHighlighted(!stopWordsHighlighted);
  }, [stopWords, stopWordsHighlighted, onHighlightStopWords]);

  const failedFlags = aiProb.flags.filter(f => !f.passed);
  const hasFixableIssues = failedFlags.length > 0 || stopWords.length > 0;

  // ─── Real AI Detector (server-side) ─────────────────────────────────
  const [detectorScore, setDetectorScore] = useState<number | null>(null);
  const [detectorVerdict, setDetectorVerdict] = useState<string | null>(null);
  const [detectorLoading, setDetectorLoading] = useState(false);
  const [autoLoop, setAutoLoop] = useState(false);
  const loopIterRef = useRef(0);

  const runDetector = useCallback(async (): Promise<number | null> => {
    if (wordCount < 30) return null;
    setDetectorLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("detect-ai", {
        body: { content, language: contentLang },
      });
      if (error) throw error;
      const score = typeof data?.ai_score === "number" ? data.ai_score : null;
      setDetectorScore(score);
      setDetectorVerdict(data?.verdict || null);
      return score;
    } catch (e: any) {
      toast.error(contentLang === "ru" ? "Сканер недоступен" : "Detector unavailable");
      return null;
    } finally {
      setDetectorLoading(false);
    }
  }, [content, contentLang, wordCount]);

  // Reset detector when content changes significantly.
  useEffect(() => {
    setDetectorScore(null);
    setDetectorVerdict(null);
  }, [content]);

  // Auto-loop: when humanize finishes (isFixing returns to null) and we are
  // in auto mode, re-scan; if still high, fire humanize-all again (max 2x).
  useEffect(() => {
    if (!autoLoop || !onFixIssue) return;
    if (isFixing) return; // wait for fix to finish
    if (loopIterRef.current === 0) return; // not in loop

    let cancelled = false;
    (async () => {
      const score = await runDetector();
      if (cancelled || score === null) { loopIterRef.current = 0; return; }
      if (score >= 40 && loopIterRef.current < 2) {
        loopIterRef.current += 1;
        toast.info(
          contentLang === "ru"
            ? `AI score ${score}% - запускаю humanize (проход ${loopIterRef.current}/2)`
            : `AI score ${score}% - running humanize (pass ${loopIterRef.current}/2)`
        );
        const instr = FIX_INSTRUCTIONS["humanize-all"];
        onFixIssue("humanize-all", instr);
      } else {
        loopIterRef.current = 0;
        setAutoLoop(false);
        toast.success(
          contentLang === "ru"
            ? `Готово. Финальный AI score: ${score}%`
            : `Done. Final AI score: ${score}%`
        );
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFixing, autoLoop]);

  const startAutoLoop = useCallback(async () => {
    if (!onFixIssue) return;
    const score = await runDetector();
    if (score === null) return;
    if (score < 40) {
      toast.success(contentLang === "ru" ? `Текст уже человечный (${score}%)` : `Already human-like (${score}%)`);
      return;
    }
    setAutoLoop(true);
    loopIterRef.current = 1;
    toast.info(
      contentLang === "ru"
        ? `AI score ${score}% - запускаю humanize (проход 1/2)`
        : `AI score ${score}% - running humanize (pass 1/2)`
    );
    onFixIssue("humanize-all", FIX_INSTRUCTIONS["humanize-all"]);
  }, [onFixIssue, runDetector, contentLang, FIX_INSTRUCTIONS]);

  const detectorColor =
    detectorScore === null ? { text: "text-muted-foreground", bg: "bg-muted" } :
    detectorScore >= 70 ? { text: "text-red-500", bg: "bg-red-500" } :
    detectorScore >= 40 ? { text: "text-yellow-500", bg: "bg-yellow-500" } :
    { text: "text-green-500", bg: "bg-green-500" };

  if (wordCount < 30) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-8 text-center">
          <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {labels.generateText}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Humanize Fix removed - use unified "Улучшить качество текста" in right panel */}

      {/* ─── Real AI Detector + Auto-Loop ─────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Radar className="h-4 w-4 text-primary" />
            {contentLang === "ru" ? "Сканер ИИ-текста" : "AI Text Scanner"}
            {detectorScore !== null && (
              <Badge variant="outline" className={`ml-auto text-[10px] ${detectorColor.text}`}>
                {detectorScore}%
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {detectorScore !== null && (
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{contentLang === "ru" ? "Похожесть на ИИ" : "AI likelihood"}</span>
                <span className={`font-bold ${detectorColor.text}`}>{detectorScore}%</span>
              </div>
              <Progress value={detectorScore} className="h-2.5" indicatorClassName={detectorColor.bg} />
              <p className="text-[10px] text-muted-foreground mt-1">
                {detectorVerdict === "high_risk" && (contentLang === "ru" ? "Высокий риск - нужен humanize." : "High risk - run humanize.")}
                {detectorVerdict === "medium_risk" && (contentLang === "ru" ? "Средний риск." : "Medium risk.")}
                {detectorVerdict === "human_like" && (contentLang === "ru" ? "Похоже на живого автора." : "Looks human.")}
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={detectorLoading || !!isFixing}
              onClick={runDetector}
            >
              {detectorLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              {contentLang === "ru" ? "Скан" : "Scan"}
            </Button>
            <Button
              size="sm"
              variant="default"
              className="gap-1.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              disabled={!onFixIssue || detectorLoading || !!isFixing}
              onClick={startAutoLoop}
            >
              <Zap className="h-3.5 w-3.5" />
              {contentLang === "ru" ? "Авто-фикс" : "Auto-fix"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {contentLang === "ru"
              ? "Эвристика + LLM-кросс-чек. Авто-фикс прогоняет humanize до 2 раз, пока score не упадёт ниже 40%."
              : "Heuristic + LLM cross-check. Auto-fix runs humanize up to 2 times until score drops below 40%."}
          </p>
        </CardContent>
      </Card>

      {/* ─── EN Stealth Stats (only for English content) ──────────── */}
      {stealthStats && (stealthStats.bannedPhrasesFound > 0 || stealthStats.contractionsApplied > 0) && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Stealth Post-Processing
              <Badge variant="outline" className={`ml-auto text-[10px] ${
                stealthStats.bannedPhrasesFound === 0 && stealthStats.contractionsApplied === 0
                  ? "text-green-500" : "text-yellow-500"
              }`}>
                {stealthStats.bannedPhrasesFound + stealthStats.contractionsApplied} fixes pending
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border p-2 text-center">
                <div className="text-lg font-bold text-red-400">{stealthStats.bannedPhrasesFound}</div>
                <div className="text-[10px] text-muted-foreground">AI phrases found</div>
              </div>
              <div className="rounded-md border border-border p-2 text-center">
                <div className="text-lg font-bold text-yellow-400">{stealthStats.contractionsApplied}</div>
                <div className="text-[10px] text-muted-foreground">Contractions needed</div>
              </div>
              <div className="rounded-md border border-border p-2 text-center">
                <div className="text-lg font-bold text-blue-400">{stealthStats.sentencesShortened}</div>
                <div className="text-[10px] text-muted-foreground">Sentences to shorten</div>
              </div>
              <div className="rounded-md border border-border p-2 text-center">
                <div className="text-lg font-bold text-purple-400">{stealthStats.informalInjectionsAdded}</div>
                <div className="text-[10px] text-muted-foreground">Informal hooks to add</div>
              </div>
            </div>
            {stealthStats.bannedPhrasesList.length > 0 && (
              <div className="text-[10px] text-muted-foreground">
                <span className="font-medium text-red-400">Banned: </span>
                {stealthStats.bannedPhrasesList.slice(0, 5).map((p, i) => (
                  <span key={i}>"{p}"{i < Math.min(4, stealthStats.bannedPhrasesList.length - 1) ? ", " : ""}</span>
                ))}
                {stealthStats.bannedPhrasesList.length > 5 && ` +${stealthStats.bannedPhrasesList.length - 5} more`}
              </div>
            )}
            {stealthStats.contractionsList.length > 0 && (
              <div className="text-[10px] text-muted-foreground">
                <span className="font-medium text-yellow-400">Expand: </span>
                {stealthStats.contractionsList.slice(0, 5).map((p, i) => (
                  <span key={i}>"{p}"{i < Math.min(4, stealthStats.contractionsList.length - 1) ? ", " : ""}</span>
                ))}
                {stealthStats.contractionsList.length > 5 && ` +${stealthStats.contractionsList.length - 5} more`}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Quick Fix All - hidden, use unified "Улучшить качество текста" in right panel */}
      {false && hasFixableIssues && onFixIssue && (
        <Button
          size="sm"
          variant="default"
          className="w-full gap-2"
          disabled={!!isFixing}
          onClick={() => {
            const allInstructions: string[] = [];
            if (stopWords.length > 0) allInstructions.push(FIX_INSTRUCTIONS["ai-cliches"]);
            failedFlags.forEach(flag => {
              const key = FLAG_TO_FIX_KEY[flag.label.replace(/ \(.*\)/, "")];
              if (key && FIX_INSTRUCTIONS[key]) allInstructions.push(FIX_INSTRUCTIONS[key]);
            });
            onFixIssue("all", allInstructions.join("\n\n"));
          }}
        >
          {isFixing === "all" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Wrench className="h-4 w-4" />
          )}
          {labels.fixAllProblems} ({failedFlags.length + (stopWords.length > 0 ? 1 : 0)})
        </Button>
      )}

      {/* ─── 1. AI Probability ─────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            AI Probability
            <Badge variant="outline" className={`ml-auto text-[10px] ${aiColor.text}`}>
              {aiColor.label}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>{labels.detectorSafety}</span>
              <span className={`font-bold ${aiColor.text}`}>{aiProb.score}%</span>
            </div>
            <Progress value={aiProb.score} className="h-2.5" indicatorClassName={aiColor.bg} />
          </div>
          <div className="space-y-1">
            {aiProb.flags.map((flag, i) => {
              const cleanLabel = flag.label.replace(/ \(.*\)/, "");
              const fixKey = FLAG_TO_FIX_KEY[cleanLabel];
              return (
                <div key={i} className="flex items-center gap-1.5 text-[11px]">
                  {flag.passed ? (
                    <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                  ) : (
                    <Circle className="h-3 w-3 text-red-500 shrink-0" />
                  )}
                  <span className={`flex-1 ${flag.passed ? "text-muted-foreground" : "text-red-400"}`}>
                    {flag.label}
                  </span>
                  {!flag.passed && fixKey && onFixIssue && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-[10px] text-primary hover:text-primary/80"
                      disabled={!!isFixing}
                      onClick={() => onFixIssue(fixKey, FIX_INSTRUCTIONS[fixKey])}
                    >
                      {isFixing === fixKey ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Wrench className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ─── 2. Perplexity Score ───────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            Perplexity Score
            <Badge variant="outline" className={`ml-auto text-[10px] ${perplexityColor.text}`}>
              {perplexity.label}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>{labels.lexicalComplexity}</span>
              <span className={`font-bold ${perplexityColor.text}`}>{perplexity.score}%</span>
            </div>
            <Progress value={perplexity.score} className="h-2.5" indicatorClassName={perplexityColor.bg} />
          </div>
          <p className="text-[10px] text-muted-foreground">
            {labels.vocabularyDesc} <span className={`font-semibold ${perplexityColor.text}`}>{perplexity.label.toLowerCase()}</span> {labels.vocabularySuffix}
          </p>
        </CardContent>
      </Card>

      {/* ─── 3. AI Stop-Words Detector ─────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-primary" />
            AI Stop-Words
            <Badge
              variant="outline"
              className={`ml-auto text-[10px] cursor-pointer ${
                stopWords.length === 0 ? "text-green-500" : stopWords.length <= 3 ? "text-yellow-500" : "text-red-500"
              }`}
              onClick={() => setShowStopWords(!showStopWords)}
            >
              {stopWords.length === 0 ? labels.clean : `${stopWords.reduce((s, w) => s + w.count, 0)} ${labels.found}`}
              {stopWords.length > 0 && (showStopWords ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />)}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {stopWords.length === 0 ? (
            <p className="text-xs text-green-500 text-center py-2">
              <CheckCircle2 className="h-4 w-4 inline mr-1" />
              {labels.noClichesFound}
            </p>
          ) : (
            <>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={stopWordsHighlighted ? "default" : "outline"}
                  className="flex-1 text-xs h-7"
                  onClick={handleToggleHighlight}
                >
                  <Eye className="h-3 w-3 mr-1" />
                  {stopWordsHighlighted ? labels.hideHighlight : labels.highlightInText}
                </Button>
                {onFixIssue && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 gap-1 text-primary border-primary/30"
                    disabled={!!isFixing}
                    onClick={() => onFixIssue("ai-cliches", FIX_INSTRUCTIONS["ai-cliches"])}
                  >
                    {isFixing === "ai-cliches" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Wrench className="h-3 w-3" />
                    )}
                    {labels.fix}
                  </Button>
                )}
              </div>
              {showStopWords && (
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {stopWords.map((sw, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] bg-yellow-500/10 rounded px-2 py-1">
                      <span className="text-yellow-600 dark:text-yellow-400 font-mono">«{sw.word}»</span>
                      <Badge variant="outline" className="text-[9px] text-yellow-500">×{sw.count}</Badge>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                💡 {labels.replaceTip}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* ─── 4. Burstiness Index ───────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Burstiness Index
            <Badge variant="outline" className={`ml-auto text-[10px] ${burstColor.text}`}>
              {burstColor.label}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>{labels.sentenceVariety}</span>
              <span className="font-mono font-bold">{burstiness.score}%</span>
            </div>
            <Progress value={burstiness.score} className="h-2.5" indicatorClassName={burstColor.bg} />
            <p className="text-[10px] text-muted-foreground mt-1">
              {labels.higherIsBetter}
            </p>
          </div>

          {/* Symmetry badge */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">{labels.structure}</span>
            <Badge
              variant="outline"
              className={`text-[10px] ${symmetry.isRobotic ? "text-red-500 border-red-500/30" : "text-green-500 border-green-500/30"}`}
            >
              {symmetry.isRobotic && <AlertTriangle className="h-2.5 w-2.5 mr-1" />}
              {symmetry.message}
            </Badge>
          </div>
          {symmetry.isRobotic && (
            <p className="text-[10px] text-yellow-500">
              ⚠ {labels.roboticWarning}
            </p>
          )}

          {/* Mini bar chart */}
          {burstiness.lengths.length > 0 && (
            <div className="flex items-end gap-px h-10 mt-2">
              {burstiness.lengths.slice(0, 40).map((len, i) => {
                const maxL = Math.max(...burstiness.lengths.slice(0, 40));
                const h = maxL > 0 ? (len / maxL) * 100 : 0;
                const color = len <= 5 ? "bg-red-400" : len <= 15 ? "bg-yellow-400" : "bg-green-400";
                return (
                  <div
                    key={i}
                    className={`${color} rounded-t-sm opacity-70`}
                    style={{ height: `${h}%`, width: `${100 / Math.min(40, burstiness.lengths.length)}%`, minWidth: "2px" }}
                    title={`${len} ${labels.words}`}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── 5. LSI Tracker ────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            LSI Tracker
            <Badge variant="outline" className="ml-auto text-[10px]">
              {lsiFoundCount}/{allLsiKeywords.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Add custom keywords */}
          <div className="flex gap-1">
            <Input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder={labels.customKeysPlaceholder}
              className="h-7 text-xs"
              onKeyDown={(e) => e.key === "Enter" && handleAddCustomKeywords()}
            />
            <Button size="sm" variant="outline" className="h-7 px-2 shrink-0" onClick={handleAddCustomKeywords}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          {sortedLsi.length > 0 ? (
            <div className="space-y-1 max-h-[250px] overflow-y-auto">
              {sortedLsi.map((item, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 text-xs rounded-md px-2 py-1.5 transition-colors ${
                    item.isSpam
                      ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                      : item.found
                      ? "bg-green-500/10 text-green-600 dark:text-green-400"
                      : "bg-muted/50 text-muted-foreground"
                  }`}
                >
                  {item.isSpam ? (
                    <AlertTriangle className="h-3 w-3 shrink-0 text-yellow-500" />
                  ) : item.found ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                  ) : (
                    <Circle className="h-3 w-3 shrink-0" />
                  )}
                  <span className="font-mono text-[11px] flex-1">{item.keyword}</span>
                  {item.isSpam && (
                    <Badge variant="outline" className="text-[9px] text-yellow-500 border-yellow-500/30">
                      {item.density.toFixed(1)}% {labels.spam}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">
              {labels.selectKeyword}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
