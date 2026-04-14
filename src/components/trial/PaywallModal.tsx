import { useI18n } from "@/shared/hooks/useI18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Crown, Zap, Factory } from "lucide-react";

interface PaywallModalProps {
  reason: "no_credits" | "trial_expired";
}

export function PaywallModal({ reason }: PaywallModalProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [declined, setDeclined] = useState(false);

  if (declined) return null;

  const title = reason === "trial_expired" ? t("trial.expired") : t("trial.noCredits");
  const desc = reason === "trial_expired" ? t("trial.expiredDesc") : t("trial.noCreditsDesc");

  const plans = [
    { key: "nano", icon: Zap, name: t("trial.nano"), desc: t("trial.nanoDesc"), color: "text-blue-400" },
    { key: "pro", icon: Crown, name: t("trial.pro"), desc: t("trial.proDesc"), color: "text-primary" },
    { key: "factory", icon: Factory, name: t("trial.factory"), desc: t("trial.factoryDesc"), color: "text-amber-400" },
  ];

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md [&>button]:hidden" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {plans.map((p) => (
            <button
              key={p.key}
              onClick={() => navigate("/pricing")}
              className="w-full flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors text-left"
            >
              <p.icon className={`h-5 w-5 ${p.color} shrink-0`} />
              <div>
                <div className="text-sm font-medium text-foreground">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.desc}</div>
              </div>
            </button>
          ))}
        </div>
        <div className="flex justify-between mt-4">
          <Button variant="ghost" size="sm" onClick={() => setDeclined(true)}>
            {t("trial.declineLater")}
          </Button>
          <Button onClick={() => navigate("/pricing")}>
            {t("trial.choosePlan")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
