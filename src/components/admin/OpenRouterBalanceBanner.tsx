import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ExternalLink } from "lucide-react";

interface BalanceResp {
  ok: boolean;
  usage?: number;
  limit?: number | null;
  remaining?: number | null;
  low?: boolean;
  is_free_tier?: boolean;
  reason?: string;
  status?: number;
  error?: string;
}

export function OpenRouterBalanceBanner() {
  const { data } = useQuery<BalanceResp>({
    queryKey: ["openrouter-balance"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("openrouter-balance");
      if (error) throw error;
      return data as BalanceResp;
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60_000,
  });

  if (!data) return null;

  const isError = !data.ok;
  const isLow = data.ok && (data.low || (data.remaining != null && data.remaining < 5));
  if (!isError && !isLow) return null;

  const critical = isError || (data.remaining != null && data.remaining < 1);
  const color = critical
    ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
    : "border-amber-500/40 bg-amber-500/10 text-amber-200";

  return (
    <div className={`flex items-start gap-3 rounded-md border p-3 text-sm ${color}`}>
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold">
          {isError
            ? "OpenRouter: ключ недоступен"
            : critical
              ? "OpenRouter: кредиты исчерпаны"
              : "OpenRouter: кредиты заканчиваются"}
        </div>
        <div className="text-xs opacity-90 mt-0.5">
          {isError ? (
            <>Причина: {data.reason || `HTTP ${data.status || "?"} ${data.error || ""}`}. Качество генерации деградирует - humanize, fact-check и quality-gate работают на локальном fallback.</>
          ) : (
            <>Остаток: ${data.remaining?.toFixed(2)} из ${data.limit?.toFixed(2)} (использовано ${data.usage?.toFixed(2)}). При нуле качество статей падает - humanize/quality-check уйдут в локальный fallback.</>
          )}
        </div>
        <a
          href="https://openrouter.ai/settings/credits"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-1.5 text-xs underline hover:no-underline"
        >
          Пополнить баланс <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}