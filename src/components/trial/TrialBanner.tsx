import { useI18n } from "@/shared/hooks/useI18n";
import { Button } from "@/components/ui/button";
import { Sparkles, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export function TrialBanner() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="relative mx-6 mt-4 rounded-lg border border-primary/30 bg-primary/10 p-4 flex items-center gap-3">
      <Sparkles className="h-5 w-5 text-primary shrink-0" />
      <p className="text-sm text-foreground flex-1">{t("trial.bannerLastCredit")}</p>
      <Button size="sm" onClick={() => navigate("/pricing")} className="shrink-0">
        {t("trial.goToPro")}
      </Button>
      <button onClick={() => setDismissed(true)} className="absolute top-2 right-2 text-muted-foreground hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
