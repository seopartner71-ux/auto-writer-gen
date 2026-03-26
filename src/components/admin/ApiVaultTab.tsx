import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, EyeOff, Save, Trash2, Wallet, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

const PROVIDERS = [
  { key: "openrouter", label: "OpenRouter", placeholder: "sk-or-v1-...", hasBalance: true },
  { key: "openai", label: "OpenAI", placeholder: "sk-...", hasBalance: false },
  { key: "anthropic", label: "Anthropic", placeholder: "sk-ant-...", hasBalance: false },
  { key: "gemini", label: "Google Gemini", placeholder: "AIza...", hasBalance: false },
  { key: "serper", label: "Serper.dev", placeholder: "your-serper-key", hasBalance: false },
  { key: "fal_ai", label: "Fal.ai", placeholder: "your-fal-ai-key", hasBalance: true },
];

interface ApiKey {
  id: string;
  provider: string;
  api_key: string;
  label: string | null;
  is_valid: boolean;
  last_checked_at: string | null;
}

interface BalanceData {
  balance: string;
  limit: string;
  usage: string;
}

export function ApiVaultTab() {
  const queryClient = useQueryClient();
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => {
      const { data, error } = await supabase.from("api_keys").select("*");
      if (error) throw error;
      return data as ApiKey[];
    },
  });

  const { data: balances, isLoading: isLoadingBalances, refetch: refetchBalances, isFetching: isFetchingBalances } = useQuery({
    queryKey: ["api-balances"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("check-balance", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw error;
      return (data?.balances || {}) as Record<string, BalanceData>;
    },
    staleTime: 60_000,
  });

  const upsertKey = useMutation({
    mutationFn: async ({ provider, apiKey }: { provider: string; apiKey: string }) => {
      const existing = keys.find((k) => k.provider === provider);
      if (existing) {
        const { error } = await supabase
          .from("api_keys")
          .update({ api_key: apiKey })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("api_keys")
          .insert({ provider, api_key: apiKey, label: provider });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      queryClient.invalidateQueries({ queryKey: ["api-balances"] });
      toast.success("Ключ сохранён");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteKey = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("api_keys").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("Ключ удалён");
    },
    onError: (e) => toast.error(e.message),
  });

  const maskKey = (key: string) => {
    if (key.length <= 8) return "••••••••";
    return key.slice(0, 4) + "••••••••" + key.slice(-4);
  };

  const toggleVisibility = (provider: string) => {
    setVisibleKeys((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  if (isLoading) {
    return <div className="text-muted-foreground">Загрузка ключей...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Balance summary */}
      {balances && Object.keys(balances).length > 0 && (
        <Card className="bg-card border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-primary" />
                Баланс API-провайдеров
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetchBalances()}
                disabled={isFetchingBalances}
                className="h-7 px-2"
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${isFetchingBalances ? "animate-spin" : ""}`} />
                Обновить
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(balances).map(([provider, data]) => {
                const providerInfo = PROVIDERS.find((p) => p.key === provider);
                const isUnlimited = data.balance === "Unlimited";
                const numericBalance = data.balance.startsWith("$") ? parseFloat(data.balance.replace("$", "")) : null;
                const isLow = numericBalance !== null && numericBalance < 5;
                return (
                  <div
                    key={provider}
                    className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3"
                  >
                    <div>
                      <p className="text-xs text-muted-foreground">{providerInfo?.label || provider}</p>
                      <p className={`text-lg font-bold ${isLow ? "text-destructive" : isUnlimited ? "text-success" : "text-foreground"}`}>
                        {data.balance}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">Использовано</p>
                      <p className="text-xs text-muted-foreground">{data.usage}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Лимит: {data.limit}</p>
                      {isLow && (
                        <Badge variant="destructive" className="mt-1 text-[10px] px-1.5 py-0">
                          Мало!
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* API keys grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((p) => {
          const existing = keys.find((k) => k.provider === p.key);
          const currentValue = editValues[p.key] ?? "";

          return (
            <Card key={p.key} className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>{p.label}</span>
                  {existing && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        existing.is_valid
                          ? "bg-success/20 text-success"
                          : "bg-destructive/20 text-destructive"
                      }`}
                    >
                      {existing.is_valid ? "Valid" : "Invalid"}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {existing && !editValues.hasOwnProperty(p.key) ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-sm text-muted-foreground font-mono bg-muted px-3 py-2 rounded-md">
                        {visibleKeys[p.key] ? existing.api_key : maskKey(existing.api_key)}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleVisibility(p.key)}
                      >
                        {visibleKeys[p.key] ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditValues((prev) => ({ ...prev, [p.key]: "" }))}
                      >
                        Изменить
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => deleteKey.mutate(existing.id)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" /> Удалить
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">API Key</Label>
                    <Input
                      type="password"
                      placeholder={p.placeholder}
                      value={currentValue}
                      onChange={(e) =>
                        setEditValues((prev) => ({ ...prev, [p.key]: e.target.value }))
                      }
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={!currentValue.trim()}
                        onClick={() => {
                          upsertKey.mutate({ provider: p.key, apiKey: currentValue.trim() });
                          setEditValues((prev) => {
                            const next = { ...prev };
                            delete next[p.key];
                            return next;
                          });
                        }}
                      >
                        <Save className="h-3 w-3 mr-1" /> Сохранить
                      </Button>
                      {existing && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setEditValues((prev) => {
                              const next = { ...prev };
                              delete next[p.key];
                              return next;
                            })
                          }
                        >
                          Отмена
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
