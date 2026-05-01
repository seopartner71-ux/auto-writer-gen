import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/hooks/useI18n";
import { Sparkles, Zap, ListTree, FileText } from "lucide-react";

interface OnboardingModalProps {
  open: boolean;
  onDismiss: () => void;
}

export function OnboardingModal({ open, onDismiss }: OnboardingModalProps) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();

  const steps = [
    { title: t("onboarding.step1Title"), desc: t("onboarding.step1Desc") },
    { title: t("onboarding.step2Title"), desc: t("onboarding.step2Desc") },
    { title: t("onboarding.step3Title"), desc: t("onboarding.step3Desc") },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onDismiss()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl text-center">{t("onboarding.welcomeTitle")}</DialogTitle>
          <DialogDescription className="text-center">{t("onboarding.welcomeSubtitle")}</DialogDescription>
        </DialogHeader>

        {/* Quick Start spotlight */}
        <div
          onClick={() => { onDismiss(); navigate("/quick-start"); }}
          className="group relative cursor-pointer rounded-xl border border-primary/40 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 transition-all hover:border-primary/60 hover:shadow-[0_0_30px_-10px_hsl(var(--primary)/0.5)]"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-[#3b82f6] text-white">
              <Zap className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">
                  {lang === "ru" ? "Статья за 60 секунд" : "Article in 60 seconds"}
                </span>
                <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                  {lang === "ru" ? "Рекомендуем" : "Recommended"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {lang === "ru"
                  ? "Введите ключ - получите готовую статью с проверкой качества"
                  : "Enter a keyword - get a ready article with quality check"}
              </p>
            </div>
            <Sparkles className="h-4 w-4 text-primary self-center transition-transform group-hover:scale-110" />
          </div>
        </div>

        <div className="relative my-2">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-[10px] uppercase tracking-wider">
            <span className="bg-background px-2 text-muted-foreground">
              {lang === "ru" ? "или вручную по шагам" : "or step by step"}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-3 items-start p-2.5 rounded-lg bg-muted/30 border border-border/50">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                {i + 1}
              </div>
              <div>
                <p className="font-medium text-sm">{step.title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{step.desc}</p>
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
            variant="outline"
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
