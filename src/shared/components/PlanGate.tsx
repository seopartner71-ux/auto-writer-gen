import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface PlanGateProps {
  children: React.ReactNode;
  allowed: boolean;
  featureName: string;
  requiredPlan?: string;
}

export function PlanGate({ children, allowed, featureName, requiredPlan = "Базовый" }: PlanGateProps) {
  const navigate = useNavigate();

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
            Доступно на тарифе <span className="font-semibold text-primary">{requiredPlan}</span> и выше
          </p>
        </div>
        <Button size="sm" onClick={() => navigate("/pricing")}>
          Обновить тариф
        </Button>
      </CardContent>
    </Card>
  );
}
