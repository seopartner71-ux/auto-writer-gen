import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/shared/api/supabase";
import { useAuth } from "@/shared/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sparkles, Loader2, Shield, Star, Eye, Award,
  CheckCircle2, Lightbulb, Users, ArrowRight
} from "lucide-react";
import { toast } from "sonner";

interface CommonTopic {
  topic: string;
  coverage_count: number;
  importance: "critical" | "high" | "medium";
}

interface UniqueTopic {
  topic: string;
  found_in: string;
  differentiation_value: "high" | "medium" | "low";
}

interface MissingTopic {
  topic: string;
  why_important: string;
  eeat_aspect: "experience" | "expertise" | "authority" | "trust";
}

interface ExpertInsight {
  recommendation: string;
  eeat_category: "experience" | "expertise" | "authority" | "trust";
  impact: "high" | "medium";
}

interface GapAnalysis {
  common_topics: CommonTopic[];
  unique_topics: UniqueTopic[];
  missing_topics: MissingTopic[];
  expert_insights: ExpertInsight[];
}

interface Props {
  keywordId: string;
  onAddToOutline?: (text: string, level: "h2" | "h3") => void;
}

const EEAT_ICONS: Record<string, React.ReactNode> = {
  experience: <Eye className="h-3.5 w-3.5" />,
  expertise: <Star className="h-3.5 w-3.5" />,
  authority: <Award className="h-3.5 w-3.5" />,
  trust: <Shield className="h-3.5 w-3.5" />,
};

const EEAT_LABELS: Record<string, string> = {
  experience: "Experience",
  expertise: "Expertise",
  authority: "Authority",
  trust: "Trust",
};

const EEAT_COLORS: Record<string, string> = {
  experience: "bg-info/15 text-info border-info/30",
  expertise: "bg-warning/15 text-warning border-warning/30",
  authority: "bg-primary/15 text-primary border-primary/30",
  trust: "bg-success/15 text-success border-success/30",
};

const IMPORTANCE_COLORS: Record<string, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  high: "bg-warning/15 text-warning border-warning/30",
  medium: "bg-muted text-muted-foreground border-border",
};

const DIFF_COLORS: Record<string, string> = {
  high: "bg-success/15 text-success border-success/30",
  medium: "bg-warning/15 text-warning border-warning/30",
  low: "bg-muted text-muted-foreground border-border",
};

export function ExpertInsightsBlock({ keywordId, onAddToOutline }: Props) {
  const { session } = useAuth();
  const [analysis, setAnalysis] = useState<GapAnalysis | null>(null);

  const analyze = useMutation({
    mutationFn: async () => {
      if (!session?.access_token) throw new Error("Сессия истекла");
      const { data, error } = await supabase.functions.invoke("analyze-content-gaps", {
        body: { keyword_id: keywordId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data as GapAnalysis;
    },
    onSuccess: (data) => {
      setAnalysis(data);
      toast.success("Content Gap Analysis завершён");
    },
    onError: (e) => toast.error(e.message),
  });

  if (!analysis) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-6 flex flex-col items-center gap-3">
          <Sparkles className="h-8 w-8 text-primary/40" />
          <p className="text-sm text-muted-foreground text-center">
            Глубокий анализ пробелов контента на основе конкурентов
          </p>
          <Button
            onClick={() => analyze.mutate()}
            disabled={analyze.isPending}
            className="gap-2"
            variant="outline"
          >
            {analyze.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {analyze.isPending ? "Анализ пробелов..." : "Найти пробелы"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Expert Insights (E-E-A-T recommendations) */}
      <Card className="bg-card border-primary/30 border-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Expert Insights (E-E-A-T)
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {analysis.expert_insights.length} рекомендаций
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {analysis.expert_insights.map((insight, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-md bg-primary/5 border border-primary/10 p-3"
            >
              <div className={`mt-0.5 p-1 rounded ${EEAT_COLORS[insight.eeat_category]}`}>
                {EEAT_ICONS[insight.eeat_category]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm">{insight.recommendation}</p>
                <div className="flex gap-1.5 mt-1.5">
                  <Badge variant="outline" className={`text-[9px] ${EEAT_COLORS[insight.eeat_category]}`}>
                    {EEAT_LABELS[insight.eeat_category]}
                  </Badge>
                  {insight.impact === "high" && (
                    <Badge className="text-[9px] bg-success/15 text-success border-success/30">
                      Высокое влияние
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Missing Topics (Gap) */}
      <Card className="bg-card border-destructive/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-destructive" />
            Missing Topics (Gap)
            <Badge className="ml-auto text-[10px] bg-destructive/15 text-destructive border-destructive/30">
              {analysis.missing_topics.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {analysis.missing_topics.map((topic, i) => (
            <div
              key={i}
              className="rounded-md bg-destructive/5 border border-destructive/10 p-3 group"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{topic.topic}</p>
                {onAddToOutline && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={() => onAddToOutline(topic.topic, "h2")}
                  >
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{topic.why_important}</p>
              <Badge variant="outline" className={`text-[9px] mt-1.5 ${EEAT_COLORS[topic.eeat_aspect]}`}>
                {EEAT_ICONS[topic.eeat_aspect]}
                <span className="ml-1">{EEAT_LABELS[topic.eeat_aspect]}</span>
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Common Topics */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            Общие темы
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {analysis.common_topics.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {analysis.common_topics.map((topic, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 group"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
              <span className="text-sm flex-1">{topic.topic}</span>
              <Badge variant="outline" className={`text-[9px] ${IMPORTANCE_COLORS[topic.importance]}`}>
                {topic.importance === "critical" ? "Критично" : topic.importance === "high" ? "Важно" : "Средне"}
              </Badge>
              <span className="text-[10px] text-muted-foreground">{topic.coverage_count}/10</span>
              {onAddToOutline && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100"
                  onClick={() => onAddToOutline(topic.topic, "h2")}
                >
                  <ArrowRight className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Unique Topics */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Star className="h-4 w-4 text-warning" />
            Уникальные темы
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {analysis.unique_topics.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {analysis.unique_topics.map((topic, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 group"
            >
              <Star className="h-3.5 w-3.5 text-warning shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm">{topic.topic}</span>
                <p className="text-[10px] text-muted-foreground truncate">{topic.found_in}</p>
              </div>
              <Badge variant="outline" className={`text-[9px] ${DIFF_COLORS[topic.differentiation_value]}`}>
                {topic.differentiation_value === "high" ? "Высокая" : topic.differentiation_value === "medium" ? "Средняя" : "Низкая"}
              </Badge>
              {onAddToOutline && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100"
                  onClick={() => onAddToOutline(topic.topic, "h2")}
                >
                  <ArrowRight className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Re-analyze button */}
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-2"
        onClick={() => analyze.mutate()}
        disabled={analyze.isPending}
      >
        {analyze.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        Повторный анализ
      </Button>
    </div>
  );
}
