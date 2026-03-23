import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Circle, Shield, Activity, Zap } from "lucide-react";

interface HumanScorePanelProps {
  content: string;
  lsiKeywords: string[];
}

// ─── Burstiness: measures sentence length variation ─────────────────────
function computeBurstiness(text: string): { score: number; lengths: number[] } {
  const sentences = text
    .replace(/([.!?])\s+/g, "$1\n")
    .split("\n")
    .map(s => s.trim())
    .filter(s => s.length > 2);

  if (sentences.length < 5) return { score: 0, lengths: [] };

  const lengths = sentences.map(s => s.split(/\s+/).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((sum, l) => sum + Math.pow(l - mean, 2), 0) / lengths.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? (stdDev / mean) * 100 : 0;

  // CV > 60 = excellent burstiness, < 30 = robotic
  const score = Math.min(100, Math.round(cv * 1.5));
  return { score, lengths };
}

// ─── AI Probability: heuristic based on pattern detection ───────────────
function computeAiProbability(text: string): { score: number; flags: string[] } {
  const flags: string[] = [];
  let penalty = 0;

  const lower = text.toLowerCase();

  // Check for AI-typical phrases
  const aiPhrases = [
    "важно отметить", "следует подчеркнуть", "в заключение", "необходимо учитывать",
    "в современном мире", "комплексный подход", "на сегодняшний день",
    "it's important to note", "in conclusion", "it should be emphasized",
    "furthermore", "moreover", "additionally", "it's worth mentioning",
    "comprehensive", "leverage", "streamline", "utilize",
  ];
  const foundPhrases = aiPhrases.filter(p => lower.includes(p));
  if (foundPhrases.length > 0) {
    penalty += foundPhrases.length * 8;
    flags.push(`AI-фразы: ${foundPhrases.length}`);
  }

  // Check paragraph uniformity
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 20);
  if (paragraphs.length >= 3) {
    const pLens = paragraphs.map(p => p.split(/\s+/).length);
    const pMean = pLens.reduce((a, b) => a + b, 0) / pLens.length;
    const pVariance = pLens.reduce((s, l) => s + Math.pow(l - pMean, 2), 0) / pLens.length;
    const pCv = pMean > 0 ? Math.sqrt(pVariance) / pMean : 0;
    if (pCv < 0.25) {
      penalty += 15;
      flags.push("Однородные абзацы");
    }
  }

  // Check for same-start paragraphs
  if (paragraphs.length >= 4) {
    const starts = paragraphs.map(p => p.trim().split(/\s+/)[0]?.toLowerCase());
    const startCounts: Record<string, number> = {};
    starts.forEach(s => { if (s) startCounts[s] = (startCounts[s] || 0) + 1; });
    const maxRepeat = Math.max(...Object.values(startCounts));
    if (maxRepeat >= 3) {
      penalty += 12;
      flags.push("Повторяющиеся начала абзацев");
    }
  }

  // Check burstiness
  const { score: burstScore } = computeBurstiness(text);
  if (burstScore < 30) {
    penalty += 20;
    flags.push("Низкая burstiness");
  } else if (burstScore < 50) {
    penalty += 10;
    flags.push("Средняя burstiness");
  }

  // Check for rhetorical questions
  const questions = (text.match(/[а-яёa-z][^.!]*\?/gi) || []).length;
  if (questions < 2) {
    penalty += 8;
    flags.push("Мало риторических вопросов");
  }

  // Check for first-person usage
  const firstPerson = /\b(я считаю|по моему|на мой взгляд|i believe|in my experience|from what i've seen|меня|мне|мой)\b/i;
  if (!firstPerson.test(text)) {
    penalty += 10;
    flags.push("Нет первого лица");
  }

  // Safety score (100 = safe, 0 = detected as AI)
  const safety = Math.max(0, Math.min(100, 100 - penalty));

  if (flags.length === 0) flags.push("Текст выглядит человеческим ✓");

  return { score: safety, flags };
}

function getBurstLabel(score: number): { label: string; color: string; progressColor: string } {
  if (score >= 70) return { label: "Отлично", color: "text-green-500", progressColor: "bg-green-500" };
  if (score >= 45) return { label: "Хорошо", color: "text-yellow-500", progressColor: "bg-yellow-500" };
  return { label: "Низкая", color: "text-red-500", progressColor: "bg-red-500" };
}

function getAiSafetyLabel(score: number): { label: string; color: string; progressColor: string } {
  if (score >= 75) return { label: "Безопасно", color: "text-green-500", progressColor: "bg-green-500" };
  if (score >= 50) return { label: "Средний риск", color: "text-yellow-500", progressColor: "bg-yellow-500" };
  return { label: "Высокий риск", color: "text-red-500", progressColor: "bg-red-500" };
}

export function HumanScorePanel({ content, lsiKeywords }: HumanScorePanelProps) {
  const burstiness = useMemo(() => computeBurstiness(content), [content]);
  const aiProb = useMemo(() => computeAiProbability(content), [content]);
  const burstLabel = getBurstLabel(burstiness.score);
  const aiLabel = getAiSafetyLabel(aiProb.score);

  const lsiStatus = useMemo(() => {
    const lower = content.toLowerCase();
    return lsiKeywords.map(kw => ({
      keyword: kw,
      found: lower.includes(kw.toLowerCase()),
    }));
  }, [content, lsiKeywords]);
  const lsiFoundCount = lsiStatus.filter(s => s.found).length;

  const wordCount = useMemo(() => content.trim().split(/\s+/).filter(Boolean).length, [content]);

  if (wordCount < 30) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-8 text-center">
          <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Сгенерируйте или вставьте текст для анализа на человечность
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* AI Safety Score */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            AI Probability
            <Badge variant="outline" className={`ml-auto text-[10px] ${aiLabel.color}`}>
              {aiLabel.label}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Безопасность от детекторов</span>
              <span className={`font-bold ${aiLabel.color}`}>{aiProb.score}%</span>
            </div>
            <Progress value={aiProb.score} className="h-2.5" indicatorClassName={aiLabel.progressColor} />
          </div>
          <div className="space-y-1">
            {aiProb.flags.map((flag, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px]">
                {aiProb.score >= 75 ? (
                  <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                ) : (
                  <Circle className="h-3 w-3 text-yellow-500 shrink-0" />
                )}
                <span className="text-muted-foreground">{flag}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Burstiness Index */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Burstiness Index
            <Badge variant="outline" className={`ml-auto text-[10px] ${burstLabel.color}`}>
              {burstLabel.label}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Разнообразие длины предложений</span>
              <span className="font-mono font-bold">{burstiness.score}%</span>
            </div>
            <Progress value={burstiness.score} className="h-2.5" indicatorClassName={burstLabel.progressColor} />
            <p className="text-[10px] text-muted-foreground mt-1">
              Чем выше — тем больше вариация (как у человека)
            </p>
          </div>

          {/* Mini sentence length visualization */}
          {burstiness.lengths.length > 0 && (
            <div className="flex items-end gap-px h-10 mt-2">
              {burstiness.lengths.slice(0, 40).map((len, i) => {
                const maxL = Math.max(...burstiness.lengths.slice(0, 40));
                const h = maxL > 0 ? (len / maxL) * 100 : 0;
                const color = len <= 5 ? "bg-blue-400" : len <= 15 ? "bg-primary" : "bg-orange-400";
                return (
                  <div
                    key={i}
                    className={`${color} rounded-t-sm opacity-70`}
                    style={{ height: `${h}%`, width: `${100 / Math.min(40, burstiness.lengths.length)}%`, minWidth: "2px" }}
                    title={`${len} слов`}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* LSI Tracker */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            LSI Tracker
            <Badge variant="outline" className="ml-auto text-[10px]">
              {lsiFoundCount}/{lsiKeywords.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lsiStatus.length > 0 ? (
            <div className="space-y-1 max-h-[250px] overflow-y-auto">
              {lsiStatus.map((item, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 text-xs rounded-md px-2 py-1.5 transition-colors ${
                    item.found
                      ? "bg-green-500/10 text-green-600 dark:text-green-400"
                      : "bg-muted/50 text-muted-foreground"
                  }`}
                >
                  {item.found ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                  ) : (
                    <Circle className="h-3 w-3 shrink-0" />
                  )}
                  <span className="font-mono text-[11px]">{item.keyword}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">
              Выберите ключевое слово для LSI
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
