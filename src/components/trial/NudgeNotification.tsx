import { useI18n } from "@/shared/hooks/useI18n";
import { Button } from "@/components/ui/button";
import { Lightbulb, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export function NudgeNotification() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="relative mx-6 mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 flex items-center gap-3">
      <Lightbulb className="h-5 w-5 text-amber-400 shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">{t("trial.nudgeTitle")}</p>
        <button
          onClick={() => navigate("/articles")}
          className="text-sm text-primary hover:underline"
        >
          {t("trial.nudgeDesc")}
        </button>
      </div>
      <button onClick={() => setDismissed(true)} className="absolute top-2 right-2 text-muted-foreground hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
