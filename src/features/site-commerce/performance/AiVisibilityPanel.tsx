// P22 - AI Visibility matrix: query x model (ChatGPT / Gemini / Claude).

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeErrorMessage } from "@/shared/utils/invokeError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Bot, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { VisibilityRow } from "./types";

const MODELS: { key: string; label: string }[] = [
  { key: "chatgpt", label: "ChatGPT" },
  { key: "gemini", label: "Gemini" },
  { key: "claude", label: "Claude" },
];

export function AiVisibilityPanel({
  projectId, ru, defaultEntity, onChecked,
}: { projectId: string; ru: boolean; defaultEntity: string; onChecked?: () => void }) {
  const [rows, setRows] = useState<VisibilityRow[]>([]);
  const [queries, setQueries] = useState("");
  const [entity, setEntity] = useState(defaultEntity);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setEntity(defaultEntity); }, [defaultEntity]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("ai-visibility", {
      body: { action: "list", project_id: projectId },
    });
    setLoading(false);
    if (error) { toast.error(await invokeErrorMessage(error)); return; }
    setRows(((data as { rows?: VisibilityRow[] })?.rows) || []);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const suggest = async () => {
    const { data, error } = await supabase.functions.invoke("ai-visibility", {
      body: { action: "suggest", project_id: projectId },
    });
    if (error) { toast.error(await invokeErrorMessage(error)); return; }
    const list = ((data as { queries?: string[] })?.queries || []).slice(0, 8);
    if (!list.length) { toast.error(ru ? "Нет семантики для подсказки" : "No semantics to suggest from"); return; }
    setQueries(list.join("\n"));
  };

  const run = async () => {
    const list = queries.split("\n").map((q) => q.trim()).filter(Boolean).slice(0, 10);
    if (!list.length) { toast.error(ru ? "Добавьте хотя бы один запрос" : "Add at least one query"); return; }
    setBusy(true);
    const { error } = await supabase.functions.invoke("ai-visibility", {
      body: { action: "check", project_id: projectId, queries: list, entity: entity.trim() },
    });
    setBusy(false);
    if (error) { toast.error(await invokeErrorMessage(error)); return; }
    toast.success(ru ? "Проверка завершена" : "Check finished");
    await load();
    onChecked?.();
  };

  const latest = new Map<string, VisibilityRow>();
  for (const r of rows) {
    const k = `${r.query}|${r.model}`;
    if (!latest.has(k)) latest.set(k, r);
  }
  const uniqueQueries = Array.from(new Set(rows.map((r) => r.query)));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">{ru ? "Бренд / сущность" : "Brand / entity"}</Label>
          <Input value={entity} onChange={(e) => setEntity(e.target.value)} className="h-8"
            placeholder={ru ? "Название компании" : "Company name"} />
        </div>
        <div className="space-y-1.5 sm:row-span-2">
          <Label className="text-xs">{ru ? "Запросы (по одному в строке, до 10)" : "Queries (one per line, max 10)"}</Label>
          <Textarea value={queries} onChange={(e) => setQueries(e.target.value)} rows={5}
            placeholder={ru ? "DIN 931\nзаклепки оптом" : "DIN 931\nrivets wholesale"} />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" onClick={run} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Bot className="h-4 w-4 mr-2" />}
            {ru ? "Проверить видимость" : "Check visibility"}
          </Button>
          <Button size="sm" variant="outline" onClick={suggest} disabled={busy}>
            <Sparkles className="h-4 w-4 mr-2" />{ru ? "Подсказать запросы" : "Suggest queries"}
          </Button>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="overflow-auto rounded border border-border/60">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left p-2 font-medium">{ru ? "Запрос" : "Query"}</th>
              {MODELS.map((m) => <th key={m.key} className="text-left p-2 font-medium">{m.label}</th>)}
              <th className="text-left p-2 font-medium">{ru ? "Проверено" : "Checked"}</th>
            </tr>
          </thead>
          <tbody>
            {uniqueQueries.map((q) => {
              const any = MODELS.map((m) => latest.get(`${q}|${m.key}`));
              const when = any.find(Boolean)?.checked_at;
              return (
                <tr key={q} className="border-t border-border/40">
                  <td className="p-2">{q}</td>
                  {MODELS.map((m, i) => {
                    const r = any[i];
                    if (!r) return <td key={m.key} className="p-2 text-muted-foreground">-</td>;
                    if (!r.mentioned) return <td key={m.key} className="p-2 text-muted-foreground">-</td>;
                    return (
                      <td key={m.key} className="p-2">
                        <span className={r.position && r.position <= 3 ? "text-green-500" : "text-yellow-500"}>
                          #{r.position ?? "?"}
                        </span>
                        {r.cited && <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0">cite</Badge>}
                      </td>
                    );
                  })}
                  <td className="p-2 text-muted-foreground">
                    {when ? new Date(when).toLocaleDateString(ru ? "ru-RU" : "en-US") : "-"}
                  </td>
                </tr>
              );
            })}
            {!uniqueQueries.length && (
              <tr><td colSpan={5} className="p-3 text-muted-foreground">
                {ru ? "Проверок пока нет." : "No checks yet."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
