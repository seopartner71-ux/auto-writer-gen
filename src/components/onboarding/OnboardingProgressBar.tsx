import { useNavigate } from "react-router-dom";
import { CheckCircle2, Circle, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/hooks/useI18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useState, useEffect } from "react";

interface Props {
  completedSteps: number;
  researchDone: boolean;
  structureDone: boolean;
  articleDone: boolean;
  showCongrats: boolean;
  onCongratsShown: () => void;
}

export function OnboardingProgressBar({ completedSteps, researchDone, structureDone, articleDone, showCongrats, onCongratsShown }: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [congratsOpen, setCongratsOpen] = useState(false);

  useEffect(() => {
    if (showCongrats) setCongratsOpen(true);
  }, [showCongrats]);

  if (completedSteps === 3 && !showCongrats) return null;

  const steps = [
    { done: researchDone, label: t("onboarding.step1Done") },
    { done: structureDone, label: t("onboarding.step2Done") },
    { done: articleDone, label: t("onboarding.step3Done") },
  ];

  return (
    <>
      <div className="mx-4 mt-2 mb-0 p-3 rounded-lg bg-muted/50 border border-border flex items-center gap-4 text-sm">
        <span className="font-medium text-muted-foreground whitespace-nowrap">
          {t("onboarding.progress")}: {completedSteps}/3 {t("onboarding.stepsOf")}
        </span>
        <div className="flex items-center gap-3 flex-1">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {step.done ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/40" />
              )}
              <span className={step.done ? "text-foreground" : "text-muted-foreground/60"}>
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={congratsOpen} onOpenChange={(o) => {
        if (!o) {
          setCongratsOpen(false);
          onCongratsShown();
        }
      }}>
        <DialogContent className="sm:max-w-md text-center">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center justify-center gap-2">
              <PartyPopper className="h-6 w-6 text-primary" />
              {t("onboarding.congratsTitle")}
            </DialogTitle>
            <DialogDescription>{t("onboarding.congratsDesc")}</DialogDescription>
          </DialogHeader>
          <Button
            className="mt-4"
            onClick={() => {
              setCongratsOpen(false);
              onCongratsShown();
              navigate("/pricing");
            }}
          >
            {t("onboarding.upgradePro")}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
