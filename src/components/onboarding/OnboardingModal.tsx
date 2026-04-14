import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/hooks/useI18n";

interface OnboardingModalProps {
  open: boolean;
  onDismiss: () => void;
}

export function OnboardingModal({ open, onDismiss }: OnboardingModalProps) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const steps = [
    { title: t("onboarding.step1Title"), desc: t("onboarding.step1Desc") },
    { title: t("onboarding.step2Title"), desc: t("onboarding.step2Desc") },
    { title: t("onboarding.step3Title"), desc: t("onboarding.step3Desc") },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onDismiss()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl text-center">{t("onboarding.welcomeTitle")}</DialogTitle>
          <DialogDescription className="text-center">{t("onboarding.welcomeSubtitle")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-4 items-start p-3 rounded-lg bg-muted/50 border border-border">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                {i + 1}
              </div>
              <div>
                <p className="font-semibold text-sm">{step.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            {t("onboarding.skip")}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onDismiss();
              navigate("/keywords");
            }}
          >
            {t("onboarding.startResearch")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
