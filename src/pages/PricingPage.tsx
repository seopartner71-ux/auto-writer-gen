import { Check, X, Zap, Crown, Sparkles, CreditCard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/shared/hooks/useAuth";
import { supabase } from "@/shared/api/supabase";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const plans = [
  {
    id: "free" as const,
    name: "Free",
    price: "0 ₽",
    period: "/ мес",
    icon: Sparkles,
    description: "Для знакомства с платформой",
    badge: null,
    credits: 5,
    features: [
      { text: "5 SEO-статей под ключ", included: true },
      { text: "Базовое исследование ключевых слов", included: true },
      { text: "1 профиль автора", included: true },
      { text: "Экспорт в HTML", included: true },
      { text: "Просмотр HTML-кода с подсветкой синтаксиса", included: true },
      { text: "SEO-аналитика (базовая)", included: true },
      { text: "AI модели: Gemini Flash Lite", included: true },
      { text: "Проверка уникальности", included: false },
      { text: "JSON-LD микроразметка", included: false },
      { text: "Публикация в WordPress", included: false },
      { text: "Массовая генерация (Factory Mode)", included: false },
      { text: "Pro Visual Synthesis (AI-обложки)", included: false },
      { text: "Мгновенная индексация", included: false },
      { text: "Приоритетная поддержка", included: false },
    ],
  },
  {
    id: "basic" as const,
    name: "Базовый",
    price: "4 900",
    period: "₽/мес",
    icon: Zap,
    description: "Для контент-маркетологов и блогеров",
    badge: "Популярный",
    credits: 30,
    features: [
      { text: "30 SEO-статей под ключ", included: true },
      { text: "Полное SERP-исследование", included: true },
      { text: "5 профилей авторов", included: true },
      { text: "Экспорт в HTML + Markdown", included: true },
      { text: "Просмотр HTML-кода с подсветкой синтаксиса", included: true },
      { text: "SEO-аналитика (расширенная)", included: true },
      { text: "AI модели: Gemini Flash + GPT-5 Nano", included: true },
      { text: "Проверка уникальности", included: true },
      { text: "JSON-LD микроразметка", included: true },
      { text: "Публикация в WordPress", included: true },
      { text: "Массовая генерация (Factory Mode)", included: false },
      { text: "Pro Visual Synthesis (AI-обложки)", included: false },
      { text: "Мгновенная индексация", included: false },
      { text: "Приоритетная поддержка", included: false },
    ],
  },
  {
    id: "pro" as const,
    name: "Pro",
    price: "12 400",
    period: "₽/мес",
    icon: Crown,
    description: "Для агентств и SEO-команд",
    badge: "Максимум",
    credits: 100,
    features: [
      { text: "100 SEO-статей под ключ", included: true },
      { text: "Полное SERP + конкурентный анализ", included: true },
      { text: "Безлимитные профили авторов", included: true },
      { text: "Все форматы экспорта", included: true },
      { text: "Просмотр HTML-кода с подсветкой синтаксиса", included: true },
      { text: "SEO-аналитика (полная + AI аудит)", included: true },
      { text: "AI модели: Gemini Pro + GPT-5 + все", included: true },
      { text: "Планировщик + массовая генерация", included: true },
      { text: "Проверка уникальности + Anti-AI", included: true },
      { text: "JSON-LD + все типы разметки", included: true },
      { text: "Публикация в WordPress", included: true },
      { text: "Pro Visual Synthesis — 100 AI-обложек/мес", included: true },
      { text: "Мгновенная индексация", included: true },
      { text: "Приоритетная поддержка 24/7", included: true },
    ],
  },
];

export default function PricingPage() {
  const { profile, user } = useAuth();
  const queryClient = useQueryClient();
  const currentPlan = profile?.plan ?? "free";
  const currentCredits = profile?.credits_amount ?? 0;

  const handleSelectPlan = async (planId: string) => {
    if (!user) {
      toast.error("Необходимо войти в систему");
      return;
    }
    if (planId === currentPlan) return;

    const selectedPlan = plans.find(p => p.id === planId);
    const { error } = await supabase
      .from("profiles")
      .update({
        plan: planId,
        credits_amount: selectedPlan?.credits ?? 0,
      })
      .eq("id", user.id);

    if (error) {
      toast.error("Ошибка смены тарифа");
    } else {
      toast.success(`Тариф изменён на ${selectedPlan?.name}. Начислено ${selectedPlan?.credits} кредитов.`);
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    }
  };

  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">Тарифные планы</h1>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Выберите подходящий тариф. 1 кредит = 1 полноценная SEO-статья под ключ.
        </p>
      </div>

      {/* Current balance card */}
      <div className="max-w-sm mx-auto">
        <Card className="bg-card border-border">
          <CardContent className="flex items-center justify-between py-4 px-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <CreditCard className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ваш баланс</p>
                <p className="text-lg font-bold">{currentCredits} кредитов</p>
              </div>
            </div>
            <Badge variant="outline" className="uppercase">{currentPlan}</Badge>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3 max-w-5xl mx-auto">
        {plans.map((plan) => {
          const isCurrentPlan = currentPlan === plan.id;
          const Icon = plan.icon;
          const isPopular = plan.badge === "Популярный";

          return (
            <Card
              key={plan.id}
              className={`relative bg-card border-border flex flex-col ${
                isPopular
                  ? "border-primary shadow-lg shadow-primary/10 scale-[1.02]"
                  : ""
              }`}
            >
              {plan.badge && (
                <Badge
                  className={`absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 ${
                    isPopular
                      ? "bg-primary text-primary-foreground"
                      : "bg-accent text-accent-foreground"
                  }`}
                >
                  {plan.badge}
                </Badge>
              )}

              <CardHeader className="text-center pb-2 pt-6">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                <p className="text-xs text-muted-foreground">{plan.description}</p>
                <div className="pt-3">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-sm text-muted-foreground ml-1">{plan.period}</span>
                </div>
                <div className="pt-2">
                  <Badge variant="secondary" className="text-sm font-semibold px-3 py-1">
                    {plan.credits} статей / мес
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="flex-1 flex flex-col">
                <ul className="space-y-2.5 flex-1 mb-6">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      {feature.included ? (
                        <Check className="h-4 w-4 text-success shrink-0 mt-0.5" />
                      ) : (
                        <X className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />
                      )}
                      <span className={feature.included ? "text-foreground" : "text-muted-foreground/50"}>
                        {feature.text}
                      </span>
                    </li>
                  ))}
                </ul>

                <Button
                  className="w-full"
                  variant={isCurrentPlan ? "secondary" : isPopular ? "default" : "outline"}
                  disabled={isCurrentPlan}
                  onClick={() => handleSelectPlan(plan.id)}
                >
                  {isCurrentPlan ? "Текущий тариф" : "Выбрать"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="text-center text-xs text-muted-foreground max-w-lg mx-auto">
        1 кредит = 1 полноценная SEO-статья. Кредит списывается только после успешной генерации.
        При смене тарифа кредиты обновляются.
      </div>
    </div>
  );
}
