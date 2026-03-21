import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/shared/api/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, CheckCircle2, XCircle, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface TestResult {
  provider: string;
  status: "valid" | "invalid" | "error";
  message: string;
}

const providerLabels: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  serper: "Serper.dev",
};

export function HealthCheckTab() {
  const [results, setResults] = useState<TestResult[]>([]);

  const runCheck = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("health-check");
      if (error) throw error;
      return data as { results: TestResult[]; message?: string };
    },
    onSuccess: (data) => {
      setResults(data.results);
      if (data.results.length === 0) {
        toast.info(data.message || "Нет настроенных ключей");
      } else {
        const valid = data.results.filter((r) => r.status === "valid").length;
        toast.success(`Проверено: ${valid}/${data.results.length} ключей валидны`);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case "valid":
        return <CheckCircle2 className="h-5 w-5 text-success" />;
      case "invalid":
        return <XCircle className="h-5 w-5 text-destructive" />;
      default:
        return <AlertTriangle className="h-5 w-5 text-warning" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Проверить все API-ключи минимальным запросом к каждому провайдеру.
        </p>
        <Button onClick={() => runCheck.mutate()} disabled={runCheck.isPending}>
          {runCheck.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Activity className="h-4 w-4 mr-2" />
          )}
          Test All Keys
        </Button>
      </div>

      {results.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {results.map((r) => (
            <Card key={r.provider} className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>{providerLabels[r.provider] || r.provider}</span>
                  <StatusIcon status={r.status} />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{r.message}</p>
                <span
                  className={`inline-block mt-2 text-xs px-2 py-0.5 rounded-full font-medium ${
                    r.status === "valid"
                      ? "bg-success/20 text-success"
                      : r.status === "invalid"
                      ? "bg-destructive/20 text-destructive"
                      : "bg-warning/20 text-warning"
                  }`}
                >
                  {r.status.toUpperCase()}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {results.length === 0 && !runCheck.isPending && (
        <div className="text-center py-12 text-muted-foreground">
          <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Нажмите «Test All Keys» для проверки</p>
        </div>
      )}
    </div>
  );
}
