import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

interface Props {
  analysis: Record<string, unknown>;
}

const FIELD_LABELS: Record<string, string> = {
  paragraph_length: "Длина абзацев",
  avg_sentences_per_paragraph: "Предложений/абзац",
  sentence_complexity: "Сложность предложений",
  tone_description: "Описание тона",
  metaphor_usage: "Метафоры",
  emoji_frequency: "Эмодзи",
  vocabulary_level: "Уровень словаря",
  formality: "Формальность",
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

export function StyleAnalysisCard({ analysis }: Props) {
  const mainFields = Object.entries(FIELD_LABELS);
  const devices = (analysis.stylistic_devices as string[]) || [];

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
      <Label className="text-sm font-medium">Результат анализа стиля</Label>

      <div className="grid gap-3 sm:grid-cols-2">
        {mainFields.map(([key, label]) => {
          const value = analysis[key];
          if (value === undefined || value === null) return null;

          const strValue = String(value);
          const colorClass = VALUE_COLORS[strValue] || "bg-muted text-muted-foreground";

          return (
            <div key={key} className="flex items-center justify-between rounded-md bg-background px-3 py-2">
              <span className="text-xs text-muted-foreground">{label}</span>
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
          <span className="text-xs text-muted-foreground">Стилистические приёмы</span>
          <div className="flex flex-wrap gap-1.5">
            {devices.map((d, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {d}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
