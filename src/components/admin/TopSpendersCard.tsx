import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, AlertTriangle, CreditCard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Row = { user_id: string; email: string; plan: string; isPaying: boolean; manual: boolean; reason: string | null; cost: number; opus: number; cap: number; opusCap: number };

function planCaps(plan: string) {
  if (plan === "factory") return { cost: 80, opus: 75 };
  if (plan === "pro") return { cost: 25, opus: 12 };
  return { cost: 3, opus: 0 };
}

export function TopSpendersCard() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
      const { data: costs } = await supabase
        .from("cost_log")
        .select("user_id,cost_usd,model")
        .gte("created_at", since)
        .not("user_id", "is", null)
        .limit(10000);

      const agg = new Map<string, { cost: number; opus: number }>();
      for (const c of costs || []) {
        const uid = (c as any).user_id;
        if (!uid) continue;
        const cur = agg.get(uid) || { cost: 0, opus: 0 };
        cur.cost += Number((c as any).cost_usd || 0);
        if (String((c as any).model || "").toLowerCase().includes("opus")) cur.opus += 1;
        agg.set(uid, cur);
      }

      const ids = Array.from(agg.keys());
      if (ids.length === 0) { if (!cancelled) setRows([]); return; }
      const [{ data: profiles }, { data: payments }] = await Promise.all([
        supabase.from("profiles").select("id,email,plan,is_paying_manual,paying_manual_reason").in("id", ids),
        supabase.from("payment_logs").select("user_id").eq("status", "success").in("user_id", ids),
      ]);

      const payingIds = new Set((payments || []).map((p: any) => p.user_id));

      const merged: Row[] = (profiles || []).map((p: any) => {
        const a = agg.get(p.id)!;
        const caps = planCaps(p.plan || "basic");
        const manual = !!p.is_paying_manual;
        return {
          user_id: p.id,
          email: p.email || p.id.slice(0, 8),
          plan: p.plan || "basic",
          isPaying: payingIds.has(p.id) || manual,
          manual,
          reason: p.paying_manual_reason || null,
          cost: Math.round(a.cost * 100) / 100,
          opus: a.opus,
          cap: caps.cost,
          opusCap: caps.opus,
        };
      });

      // sort by % of cap desc, then cost
      merged.sort((a, b) => (b.cost / b.cap) - (a.cost / a.cap) || b.cost - a.cost);
      if (!cancelled) setRows(merged.slice(0, 10));
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Топ-10 по расходам (30д)</CardTitle>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <div className="flex items-center gap-2 text-muted-foreground py-4 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка...
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет данных</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const pct = r.cap > 0 ? Math.min(100, Math.round((r.cost / r.cap) * 100)) : 0;
              const opusPct = r.opusCap > 0 ? Math.min(100, Math.round((r.opus / r.opusCap) * 100)) : 0;
              const danger = pct >= 90 || opusPct >= 90;
              return (
                <div key={r.user_id} className="flex items-center justify-between text-xs gap-3 py-1 border-b border-border/40 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {danger && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                    <span className="truncate font-medium">{r.email}</span>
                    <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{r.plan}</span>
                    {r.isPaying && (
                      <span title={r.manual ? `Отмечен админом${r.reason ? ": " + r.reason : ""}` : "Есть успешный платёж"} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 shrink-0">
                        <CreditCard className="h-3 w-3" /> оплачивает{r.manual ? " (ручн.)" : ""}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        const next = !r.manual;
                        let reason: string | null = null;
                        if (next) {
                          const input = window.prompt("Причина ручной пометки «оплачивает»:", r.reason || "");
                          if (input === null) return; // отмена
                          reason = input.trim() || null;
                        }
                        const { error } = await supabase
                          .from("profiles")
                          .update({ is_paying_manual: next, paying_manual_reason: next ? reason : null })
                          .eq("id", r.user_id);
                        if (error) { alert("Не удалось сохранить: " + error.message); return; }
                        setRows((cur) => cur ? cur.map((x) => x.user_id === r.user_id ? { ...x, manual: next, reason: next ? reason : null, isPaying: next || x.isPaying } : x) : cur);
                      }}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:border-border shrink-0"
                      title={r.manual && r.reason ? `Причина: ${r.reason}` : "Ручная пометка «оплачивает»"}
                    >
                      {r.manual ? "Снять" : "Отметить"}
                    </button>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 tabular-nums">
                    <span className={pct >= 90 ? "text-red-500" : pct >= 70 ? "text-yellow-500" : "text-foreground"}>
                      ${r.cost.toFixed(2)}/{r.cap}
                    </span>
                    {r.opusCap > 0 && (
                      <span className={opusPct >= 90 ? "text-red-500" : opusPct >= 70 ? "text-yellow-500" : "text-muted-foreground"}>
                        Opus {r.opus}/{r.opusCap}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
