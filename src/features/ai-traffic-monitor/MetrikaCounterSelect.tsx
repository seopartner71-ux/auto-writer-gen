import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeErrorMessage } from "@/shared/utils/invokeError";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw } from "lucide-react";

type Counter = { id: string; name: string; site: string };

export function MetrikaCounterSelect({ siteId, value, onSaved }: { siteId: string; value?: string | null; onSaved: () => void }) {
  const [counters, setCounters] = useState<Counter[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true); setError("");
    try {
      const { data, error } = await supabase.functions.invoke("metrika-stats", { body: { action: "counters" } });
      if (error) throw new Error(await invokeErrorMessage(error));
      setCounters(data.counters ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить счетчики"); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  const save = async (counterId: string) => {
    setBusy(true); setError("");
    try {
      const { error } = await supabase.functions.invoke("metrika-stats", { body: { action: "bind", site_id: siteId, counter_id: counterId === "none" ? null : counterId } });
      if (error) throw new Error(await invokeErrorMessage(error));
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить счетчик"); }
    finally { setBusy(false); }
  };
  return <div className="min-w-64 space-y-2">
    <div className="flex items-center gap-2">
      <Select value={value || "none"} onValueChange={save} disabled={busy}>
        <SelectTrigger aria-label="Счетчик Яндекс Метрики"><SelectValue placeholder="Выберите счетчик" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Не подключена</SelectItem>
          {value && !counters.some(c => c.id === value) && <SelectItem value={value}>Счетчик {value}</SelectItem>}
          {counters.map(c => <SelectItem key={c.id} value={c.id}>{c.name} - {c.site || c.id} ({c.id})</SelectItem>)}
        </SelectContent>
      </Select>
      <Button size="icon" variant="outline" onClick={load} disabled={busy} title="Обновить список счетчиков" aria-label="Обновить список счетчиков"><RefreshCw className="h-4 w-4" /></Button>
    </div>
    {error && <p className="text-sm text-destructive whitespace-normal break-words">{error}</p>}
  </div>;
}