import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/shared/hooks/useI18n";

interface PlanGateProps {
  children: React.ReactNode;
  allowed: boolean;
  featureName: string;
  requiredPlan?: string;
}

export function PlanGate({ children, allowed, featureName, requiredPlan = "Basic" }: PlanGateProps) {
  const navigate = useNavigate();
  const { t } = useI18n();

  if (allowed) return <>{children}</>;

  return (
    <Card className="bg-card border-border border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center space-y-3">
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium text-foreground">{featureName}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {t("gate.availableOn")} <span className="font-semibold text-primary">{requiredPlan}</span> {t("gate.andAbove")}
          </p>
        </div>
        <Button size="sm" onClick={() => navigate("/pricing")}>
          {t("gate.upgrade")}
        </Button>
      </CardContent>
    </Card>
  );
}
