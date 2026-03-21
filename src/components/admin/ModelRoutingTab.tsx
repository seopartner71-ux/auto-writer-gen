import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/shared/api/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Brain, PenTool, Sparkles } from "lucide-react";

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
      <p className="text-sm text-muted-foreground">
        Выберите модель ИИ для каждой задачи в системе.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {TASKS.map((task) => {
          const current = assignments.find((a) => a.task_key === task.key);
          return (
            <Card key={task.key} className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <task.icon className="h-4 w-4 text-primary" />
                  {task.label}
                </CardTitle>
                <p className="text-xs text-muted-foreground">{task.description}</p>
              </CardHeader>
              <CardContent>
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
                    {models.map((m) => (
                      <SelectItem key={m.model_key} value={m.model_key}>
                        {m.display_name || m.model_key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
