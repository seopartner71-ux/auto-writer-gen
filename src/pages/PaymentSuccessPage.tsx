import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, CreditCard, ArrowRight, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/shared/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const PLAN_LABELS: Record<string, string> = {
  free: "NANO",
  basic: "PRO",
  pro: "FACTORY",
};

export default function PaymentSuccessPage() {
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const queryClient = useQueryClient();
  const [refreshed, setRefreshed] = useState(false);

  // Refresh profile to pick up plan change from webhook
  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(async () => {
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      await queryClient.invalidateQueries({ queryKey: ["auth"] });
      setRefreshed(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, [user, queryClient]);

  const plan = profile?.plan ?? "free";
  const credits = profile?.credits_amount ?? 0;
  const planName = PLAN_LABELS[plan] || plan.toUpperCase();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full bg-card border-border shadow-xl">
        <CardContent className="pt-8 pb-6 px-6 text-center space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
            <CheckCircle className="h-10 w-10 text-emerald-500" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold">Оплата прошла успешно!</h1>
            <p className="text-muted-foreground text-sm">
              Спасибо за покупку. Ваш тариф активирован.
            </p>
          </div>

          {!refreshed ? (
            <div className="flex items-center justify-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Обновляем данные…</span>
            </div>
          ) : (
            <div className="space-y-3 bg-muted/50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Тариф</span>
                <Badge variant="default" className="text-sm font-semibold px-3">
                  {planName}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Баланс</span>
                <div className="flex items-center gap-1.5">
                  <CreditCard className="h-4 w-4 text-primary" />
                  <span className="font-semibold">{credits} кредитов</span>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2 pt-2">
            <Button className="w-full" onClick={() => navigate("/dashboard")}>
              Перейти в кабинет
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => navigate("/articles")}>
              Создать статью
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
