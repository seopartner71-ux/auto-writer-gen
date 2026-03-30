import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/shared/hooks/useI18n";
import { ChevronDown, ChevronUp, BookOpen, MessageSquareQuote } from "lucide-react";

interface Props {
  analysis: Record<string, unknown>;
  compact?: boolean;
}

const FIELD_KEYS: Record<string, string> = {
  paragraph_length: "sa.paragraphLength",
  avg_sentences_per_paragraph: "sa.sentencesPerParagraph",
  sentence_complexity: "sa.sentenceComplexity",
  tone_description: "sa.toneDescription",
  metaphor_usage: "sa.metaphorUsage",
  emoji_frequency: "sa.emojiFrequency",
  vocabulary_level: "sa.vocabularyLevel",
  formality: "sa.formality",
};

const VALUE_COLORS: Record<string, string> = {
  none: "bg-muted text-muted-foreground",
  rare: "bg-info/20 text-info",
  moderate: "bg-warning/20 text-warning",
  frequent: "bg-primary/20 text-primary",
  short: "bg-info/20 text-info",
  medium: "bg-warning/20 text-warning",
  long: "bg-primary/20 text-primary",
  simple: "bg-success/20 text-success",
  complex: "bg-destructive/20 text-destructive",
  basic: "bg-muted text-muted-foreground",
  intermediate: "bg-info/20 text-info",
  advanced: "bg-warning/20 text-warning",
  expert: "bg-primary/20 text-primary",
  casual: "bg-info/20 text-info",
  neutral: "bg-muted text-muted-foreground",
  formal: "bg-warning/20 text-warning",
  academic: "bg-primary/20 text-primary",
};

export function StyleAnalysisCard({ analysis, compact = false }: Props) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(!compact);
  const mainFields = Object.entries(FIELD_KEYS);
  const devices = (analysis.stylistic_devices as string[]) || [];
  const stopWords = (analysis.stop_words as string[]) || [];
  const recommendedPrompt = analysis.recommended_system_prompt as string | undefined;

  // Compact preview: show key badges inline
  if (compact && !expanded) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-primary hover:text-primary"
          onClick={() => setExpanded(true)}
        >
          <BookOpen className="h-3 w-3" />
          {t("sa.viewAnalysis")}
          <ChevronDown className="h-3 w-3" />
        </Button>
        {analysis.formality && (
          <Badge variant="secondary" className={`text-[10px] border-0 ${VALUE_COLORS[String(analysis.formality)] || ""}`}>
            {String(analysis.formality)}
          </Badge>
        )}
        {analysis.vocabulary_level && (
          <Badge variant="secondary" className={`text-[10px] border-0 ${VALUE_COLORS[String(analysis.vocabulary_level)] || ""}`}>
            {String(analysis.vocabulary_level)}
          </Badge>
        )}
        {analysis.sentence_complexity && (
          <Badge variant="secondary" className={`text-[10px] border-0 ${VALUE_COLORS[String(analysis.sentence_complexity)] || ""}`}>
            {String(analysis.sentence_complexity)}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{t("sa.resultTitle")}</Label>
        {compact && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpanded(false)}>
            <ChevronUp className="h-3 w-3 mr-1" />
            {t("common.collapse")}
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {mainFields.map(([key, i18nKey]) => {
          const value = analysis[key];
          if (value === undefined || value === null) return null;

          const strValue = String(value);
          const colorClass = VALUE_COLORS[strValue] || "bg-muted text-muted-foreground";

          return (
            <div key={key} className="flex items-center justify-between rounded-md bg-background px-3 py-2">
              <span className="text-xs text-muted-foreground">{t(i18nKey)}</span>
              {key === "tone_description" ? (
                <span className="text-xs font-medium text-right max-w-[60%]">{strValue}</span>
              ) : key === "avg_sentences_per_paragraph" ? (
                <span className="text-xs font-mono font-medium">{strValue}</span>
              ) : (
                <Badge variant="secondary" className={`text-xs border-0 ${colorClass}`}>
                  {strValue}
                </Badge>
              )}
            </div>
          );
        })}
      </div>

      {devices.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">{t("sa.stylisticDevices")}</span>
          <div className="flex flex-wrap gap-1.5">
            {devices.map((d, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {d}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {stopWords.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">{t("sa.stopWords")}</span>
          <div className="flex flex-wrap gap-1.5">
            {stopWords.map((w, i) => (
              <Badge key={i} variant="destructive" className="text-xs font-normal">
                {w}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {recommendedPrompt && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <MessageSquareQuote className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium">{t("sa.recommendedPrompt")}</span>
          </div>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap font-mono bg-background rounded-md p-3 border border-border">
            {recommendedPrompt}
          </p>
        </div>
      )}
    </div>
  );
}