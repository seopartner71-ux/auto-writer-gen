import { useEffect, useState } from "react";
import { AlertTriangle, Sparkles, ShieldCheck, ShieldAlert, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  authorSelected: boolean;
  onPickAuthor: () => void;
  authorLabel?: string | null;
  aiScore: number | null;
  onRunStealth: () => void;
  stealthRunning: boolean;
  factIssuesCount: number;
  factCheckStatus: "verified" | "warning" | null;
  onOpenFactCheck: () => void;
  onAutoFix: () => void;
  hasContent: boolean;
}

export function ArticleQualityHints({
  authorSelected, onPickAuthor, authorLabel,
  aiScore, onRunStealth, stealthRunning,
  factIssuesCount, factCheckStatus, onOpenFactCheck, onAutoFix,
  hasContent,
}: Props) {
  const [stealthDismissed, setStealthDismissed] = useState(false);
  const [factDismissed, setFactDismissed] = useState(false);

  useEffect(() => {
    setStealthDismissed(false);
    setFactDismissed(false);
  }, [aiScore, factIssuesCount]);

  const showStealthHint = hasContent && aiScore != null && aiScore < 70 && !stealthDismissed;
  const showFactWarning = hasContent && factCheckStatus === "warning" && factIssuesCount > 0 && !factDismissed;
  const showFactOk = hasContent && factCheckStatus === "verified" && factIssuesCount === 0;

  return (
    <div className="space-y-2">
      {/* Persona / Author hint */}
      {!authorSelected ? (
        <button
          type="button"
          onClick={onPickAuthor}
          className="w-full flex items-center gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-left hover:bg-yellow-500/15 transition-colors"
        >
          <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
          <span className="text-xs text-yellow-100">
            Автор не выбран - текст будет шаблонным. Выберите Persona для уникального стиля.
          </span>
          <UserPlus className="h-3.5 w-3.5 ml-auto text-yellow-300 shrink-0" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onPickAuthor}
          className="inline-flex items-center gap-2 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-left hover:bg-violet-500/15 transition-colors"
          title="Сменить автора"
        >
          <Sparkles className="h-3.5 w-3.5 text-violet-300 shrink-0" />
          <span className="text-xs text-violet-100 font-medium">
            Persona: {authorLabel || "выбран"}
          </span>
        </button>
      )}

      {/* Stealth Pass hint */}
      {showStealthHint && (
        <div className="flex items-center gap-2 rounded-md border border-orange-500/40 bg-orange-500/10 px-3 py-2">
          <span className="text-base">🤖</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-orange-100">
              Текст похож на ИИ (AI Score: {aiScore}%). Запустить Stealth Pass для улучшения?
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-orange-500/60 text-orange-100 hover:bg-orange-500/20"
            onClick={() => { onRunStealth(); setStealthDismissed(true); }}
            disabled={stealthRunning}
          >
            ✨ {stealthRunning ? "..." : "Да, улучшить"}
          </Button>
          <button
            type="button"
            className="text-orange-300/70 hover:text-orange-200"
            onClick={() => setStealthDismissed(true)}
            title="Пропустить"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Fact Check hint */}
      {showFactWarning && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-amber-100">
              Fact Check: найдено {factIssuesCount}{" "}
              {factIssuesCount === 1 ? "утверждение" : factIssuesCount < 5 ? "утверждения" : "утверждений"}{" "}
              требующих проверки
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={onOpenFactCheck}
          >
            Проверить
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => { onAutoFix(); setFactDismissed(true); }}
          >
            Исправить авто
          </Button>
          <button
            type="button"
            className="text-amber-300/70 hover:text-amber-200"
            onClick={() => setFactDismissed(true)}
            title="Скрыть"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {showFactOk && (
        <div className="inline-flex items-center gap-1.5 rounded-md border border-green-500/40 bg-green-500/10 px-2.5 py-1">
          <ShieldCheck className="h-3.5 w-3.5 text-green-400" />
          <span className="text-[11px] text-green-100">Fact Check: OK</span>
        </div>
      )}
    </div>
  );
}