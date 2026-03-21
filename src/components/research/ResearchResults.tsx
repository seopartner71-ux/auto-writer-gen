import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Target, Lightbulb, HelpCircle, Hash, BarChart3, FileText,
  ExternalLink, ChevronDown, ChevronUp, ListTree, ArrowRight
} from "lucide-react";
import type { ResearchData, Competitor } from "@/pages/KeywordsPage";

interface Props {
  data: ResearchData;
}

const INTENT_LABELS: Record<string, { label: string; color: string }> = {
  informational: { label: "Информационный", color: "bg-info/20 text-info" },
  transactional: { label: "Транзакционный", color: "bg-success/20 text-success" },
  navigational: { label: "Навигационный", color: "bg-warning/20 text-warning" },
  commercial: { label: "Коммерческий", color: "bg-primary/20 text-primary" },
};

const DIFFICULTY_LABELS: Record<string, { label: string; color: string }> = {
  easy: { label: "Лёгкая", color: "bg-success/20 text-success" },
  medium: { label: "Средняя", color: "bg-warning/20 text-warning" },
  hard: { label: "Сложная", color: "bg-destructive/20 text-destructive" },
  very_hard: { label: "Очень сложная", color: "bg-destructive/30 text-destructive" },
};

export function ResearchResults({ data }: Props) {
  const navigate = useNavigate();
  const { analysis, competitors: initialCompetitors } = data;
  const [competitors, setCompetitors] = useState<Competitor[]>(
    initialCompetitors.map((c) => ({ ...c, excluded: false }))
  );
  const [showAllCompetitors, setShowAllCompetitors] = useState(false);

  const toggleExclude = (position: number) => {
    setCompetitors((prev) =>
      prev.map((c) => (c.position === position ? { ...c, excluded: !c.excluded } : c))
    );
  };

  const intentInfo = INTENT_LABELS[analysis.intent] || INTENT_LABELS.informational;
  const difficultyInfo = DIFFICULTY_LABELS[analysis.difficulty_estimate] || DIFFICULTY_LABELS.medium;

  const visibleCompetitors = showAllCompetitors ? competitors : competitors.slice(0, 5);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Overview Cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Интент</div>
            <Badge className={`${intentInfo.color} border-0`}>{intentInfo.label}</Badge>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Сложность</div>
            <Badge className={`${difficultyInfo.color} border-0`}>{difficultyInfo.label}</Badge>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Рек. объём</div>
            <span className="text-lg font-semibold">{analysis.recommended_word_count.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground ml-1">слов</span>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">LSI-ключи</div>
            <span className="text-lg font-semibold">{analysis.lsi_keywords.length}</span>
            <span className="text-xs text-muted-foreground ml-1">найдено</span>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Competitors */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Конкуренты (ТОП-10)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {visibleCompetitors.map((c) => (
              <div
                key={c.position}
                className={`flex items-start gap-3 rounded-md p-3 transition-colors ${
                  c.excluded ? "bg-muted/30 opacity-50" : "bg-muted/50"
                }`}
              >
                <span className="text-xs font-mono text-muted-foreground w-5 shrink-0 pt-0.5">
                  #{c.position}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium hover:text-primary truncate flex items-center gap-1"
                    >
                      {c.title}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {c.snippet}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate font-mono">
                    {c.url}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">
                    {c.excluded ? "Исключён" : "Активен"}
                  </span>
                  <Switch
                    checked={!c.excluded}
                    onCheckedChange={() => toggleExclude(c.position)}
                  />
                </div>
              </div>
            ))}
            {competitors.length > 5 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setShowAllCompetitors(!showAllCompetitors)}
              >
                {showAllCompetitors ? (
                  <>
                    <ChevronUp className="h-3 w-3 mr-1" /> Свернуть
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3 mr-1" /> Показать ещё {competitors.length - 5}
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Must Cover + Content Gaps */}
        <div className="space-y-4">
          {/* Must Cover Topics */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="h-4 w-4 text-success" />
                Обязательные темы
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {analysis.must_cover_topics.map((topic, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {topic}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Content Gaps */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-warning" />
                Content Gaps
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {analysis.content_gaps.map((gap, i) => (
                <div key={i} className="rounded-md bg-muted/50 p-3">
                  <p className="text-sm font-medium">{gap.topic}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{gap.reason}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Top Questions */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-info" />
              Популярные вопросы
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {analysis.top_questions.map((q, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="text-xs text-muted-foreground font-mono w-4 shrink-0">{i + 1}.</span>
                <span>{q}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* LSI Keywords */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Hash className="h-4 w-4 text-primary" />
              LSI-ключевые слова
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {analysis.lsi_keywords.map((kw, i) => (
                <Badge key={i} variant="outline" className="text-xs font-mono">
                  {kw}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recommended Headings */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <ListTree className="h-4 w-4 text-accent" />
              Рекомендуемая структура
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {analysis.recommended_headings.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                <span>{h}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Navigation to Plan Builder */}
      <div className="flex justify-end pt-2">
        <Button
          size="lg"
          className="gap-2"
          onClick={() => navigate("/plan-builder")}
        >
          Перейти в конструктор плана
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
