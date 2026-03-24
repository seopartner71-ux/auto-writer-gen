import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Brain, PenTool, Sparkles, Zap, Clock, AlertTriangle, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface TaskAssignment {
  id: string;
  task_key: string;
  model_key: string;
}

interface AiModel {
  id: string;
  model_key: string;
  display_name: string | null;
  tier: string | null;
  is_active: boolean;
}

const TASKS = [
  { key: "researcher", label: "Researcher", description: "Анализ конкурентов и SERP", icon: Brain },
  { key: "writer_basic", label: "Writer Basic", description: "Генерация для Free/Basic", icon: PenTool },
  { key: "writer_pro", label: "Writer Pro", description: "Генерация для Pro", icon: Sparkles },
];

const MODEL_SPEED_INFO: Record<string, { speed: "fast" | "medium" | "slow"; note: string }> = {
  "google/gemini-2.5-flash-lite": { speed: "fast", note: "Самая быстрая, ~20-40с на статью. Подходит для простых тем." },
  "google/gemini-2.5-flash": { speed: "fast", note: "Быстрая, ~30-60с. Хороший баланс скорости и качества." },
  "google/gemini-3-flash-preview": { speed: "fast", note: "Быстрая нового поколения, ~30-60с. Отличный баланс." },
  "google/gemini-2.5-pro": { speed: "slow", note: "Медленная, ~2-5 мин. Лучшее качество и глубина анализа." },
  "google/gemini-3.1-pro-preview": { speed: "slow", note: "Медленная нового поколения, ~2-5 мин. Максимальное качество." },
  "openai/gpt-5": { speed: "slow", note: "Медленная, ~2-4 мин. Отличное качество, высокая стоимость." },
  "openai/gpt-5-mini": { speed: "medium", note: "Средняя, ~1-2 мин. Хорошее качество за разумную цену." },
  "openai/gpt-5-nano": { speed: "fast", note: "Быстрая, ~20-40с. Экономичная для массовой генерации." },
  "openai/gpt-5.2": { speed: "slow", note: "Медленная, ~3-5 мин. Улучшенные рассуждения." },
};

function SpeedBadge({ speed }: { speed: "fast" | "medium" | "slow" }) {
  const config = {
    fast: { label: "Быстрая", icon: Zap, className: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
    medium: { label: "Средняя", icon: Clock, className: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
    slow: { label: "Медленная", icon: AlertTriangle, className: "text-red-400 bg-red-500/10 border-red-500/20" },
  }[speed];

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${config.className}`}>
      <config.icon className="h-2.5 w-2.5" />
      {config.label}
    </span>
  );
}

export function ModelRoutingTab() {
  const queryClient = useQueryClient();

  const { data: assignments = [] } = useQuery({
    queryKey: ["task-model-assignments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("task_model_assignments").select("*");
      if (error) throw error;
      return data as TaskAssignment[];
    },
  });

  const { data: models = [] } = useQuery({
    queryKey: ["ai-models"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ai_models").select("*").eq("is_active", true);
      if (error) throw error;
      return data as AiModel[];
    },
  });

  const updateAssignment = useMutation({
    mutationFn: async ({ taskKey, modelKey }: { taskKey: string; modelKey: string }) => {
      const existing = assignments.find((a) => a.task_key === taskKey);
      if (existing) {
        const { error } = await supabase
          .from("task_model_assignments")
          .update({ model_key: modelKey })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("task_model_assignments")
          .insert({ task_key: taskKey, model_key: modelKey });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-model-assignments"] });
      toast.success("Модель обновлена");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Alert className="border-primary/20 bg-primary/5">
        <Info className="h-4 w-4 text-primary" />
        <AlertDescription className="text-sm text-muted-foreground">
          <strong className="text-foreground">Скорость генерации</strong> напрямую зависит от выбранной модели.
          Flash-модели генерируют статью за 20-60 секунд, Pro-модели — за 2-5 минут, но с лучшим качеством.
          Для массовой генерации рекомендуется <code className="text-primary">flash-lite</code>.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-3">
        {TASKS.map((task) => {
          const current = assignments.find((a) => a.task_key === task.key);
          const currentSpeed = current ? MODEL_SPEED_INFO[current.model_key] : null;

          return (
            <Card key={task.key} className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <task.icon className="h-4 w-4 text-primary" />
                  {task.label}
                </CardTitle>
                <p className="text-xs text-muted-foreground">{task.description}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select
                  value={current?.model_key ?? ""}
                  onValueChange={(val) =>
                    updateAssignment.mutate({ taskKey: task.key, modelKey: val })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите модель" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => {
                      const speedInfo = MODEL_SPEED_INFO[m.model_key];
                      return (
                        <SelectItem key={m.model_key} value={m.model_key}>
                          <span className="flex items-center gap-2">
                            {m.display_name || m.model_key}
                            {speedInfo && <SpeedBadge speed={speedInfo.speed} />}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>

                {currentSpeed && (
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {currentSpeed.note}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}