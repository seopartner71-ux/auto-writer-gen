import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, RefreshCw, ExternalLink, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { MONITOR_KEYS, FREQUENCIES, SEVERITY_META, defaultMonitorConfig, summarizeChange } from "./constants";
import { fetchChanges, fetchSnapshot, runCheck, type ChangeRow, type PageRow } from "./api";
import { ChangeDetailDialog } from "./ChangeDetailDialog";

interface Props { page: PageRow | null; ru: boolean; onOpenChange: (v: boolean) => void; onChanged: () => void }

const PAGE_SIZE = 10;

export function PageDetailDialog({ page, ru, onOpenChange, onChanged }: Props) {
  const [snapshot, setSnapshot] = useState<any>(null);
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [selected, setSelected] = useState<ChangeRow | null>(null);
  const [config, setConfig] = useState<Record<string, boolean>>(defaultMonitorConfig());
  const [frequency, setFrequency] = useState("weekly");
  const [enabled, setEnabled] = useState(true);

  const load = useCallback(async (nextOffset = 0) => {
    if (!page) return;
    setLoading(true);
    try {
      const [snap, list] = await Promise.all([
        fetchSnapshot(page.id),
        fetchChanges({ pageId: page.id, limit: PAGE_SIZE, offset: nextOffset }),
      ]);
      setSnapshot(snap);
      setChanges(list.rows);
      setTotal(list.total);
      setOffset(nextOffset);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (!page) return;
    setConfig({ ...defaultMonitorConfig(), ...(page.monitor_config || {}) });
    setFrequency(page.frequency);
    setEnabled(page.is_enabled);
    load(0);
  }, [page, load]);

  const saveSettings = async (patch: Record<string, unknown>) => {
    if (!page) return;
    const { error } = await supabase.from("competitor_pages").update(patch).eq("id", page.id);
    if (error) toast.error(error.message);
    else onChanged();
  };

  const check = async () => {
    if (!page) return;
    setChecking(true);
    try {
      const res = await runCheck(page.id);
      const status = res?.results?.[0]?.status;
      const map: Record<string, string> = {
        baseline: ru ? "Создан первый snapshot (baseline)" : "Baseline snapshot created",
        no_changes: ru ? "Изменений не обнаружено" : "No changes detected",
        change_detected: ru ? "Обнаружено изменение" : "Change detected",
        fetch_failed: ru ? "Страница недоступна" : "Fetch failed",
        parse_failed: ru ? "Не удалось разобрать страницу" : "Parse failed",
      };
      const msg = map[status || ""] || (ru ? "Проверка выполнена" : "Check finished");
      if (status === "fetch_failed" || status === "parse_failed") toast.error(msg);
      else toast.success(msg);
      await load(0);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  if (!page) return null;
  const statusColor = page.status === "error" ? "text-red-500" : page.is_enabled ? "text-emerald-500" : "text-muted-foreground";

  return (
    <>
      <Dialog open={!!page} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="break-all text-base">{page.url}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className={statusColor}>
                {page.status === "error"
                  ? (ru ? "Ошибка загрузки" : "Fetch failed")
                  : page.is_enabled ? (ru ? "Мониторинг активен" : "Monitoring active") : (ru ? "Пауза" : "Paused")}
              </span>
              <span className="text-muted-foreground">
                {ru ? "Последняя проверка" : "Last check"}: {page.last_checked_at ? new Date(page.last_checked_at).toLocaleString(ru ? "ru-RU" : "en-GB") : "-"}
              </span>
              <span className="text-muted-foreground">
                {ru ? "Следующая" : "Next check"}: {frequency === "manual" ? (ru ? "вручную" : "manual") : new Date(page.next_check_at).toLocaleString(ru ? "ru-RU" : "en-GB")}
              </span>
              <a href={page.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary">
                <ExternalLink className="h-3.5 w-3.5" /> {ru ? "Открыть" : "Open"}
              </a>
              <Button size="sm" onClick={check} disabled={checking}>
                {checking ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                {ru ? "Проверить сейчас" : "Check now"}
              </Button>
            </div>

            {page.last_error && <p className="text-sm text-red-500">{page.last_error}</p>}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <span className="text-xs uppercase text-muted-foreground">{ru ? "Частота проверки" : "Check frequency"}</span>
                <Select value={frequency} onValueChange={(v) => { setFrequency(v); saveSettings({ frequency: v }); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map(f => <SelectItem key={f.value} value={f.value}>{ru ? f.ru : f.en}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-end gap-2 text-sm pb-2 cursor-pointer">
                <Checkbox checked={enabled} onCheckedChange={(v) => { setEnabled(Boolean(v)); saveSettings({ is_enabled: Boolean(v) }); }} />
                {ru ? "Мониторинг включен" : "Monitoring enabled"}
              </label>
            </div>

            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="px-0">
                  <ChevronDown className="h-4 w-4 mr-1" /> {ru ? "Что отслеживать" : "What to monitor"}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 grid gap-2 sm:grid-cols-3">
                {MONITOR_KEYS.map(m => (
                  <label key={m.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={config[m.key] !== false}
                      onCheckedChange={(v) => {
                        const next = { ...config, [m.key]: Boolean(v) };
                        setConfig(next);
                        saveSettings({ monitor_config: next });
                      }}
                    />
                    {ru ? m.ru : m.en}
                  </label>
                ))}
              </CollapsibleContent>
            </Collapsible>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {ru ? "Текущий snapshot" : "Current snapshot"}
              </h4>
              {snapshot ? (
                <Card><CardContent className="p-4 grid gap-2 sm:grid-cols-2 text-sm">
                  <p><span className="text-muted-foreground">Title: </span>{snapshot.title || "-"}</p>
                  <p><span className="text-muted-foreground">H1: </span>{snapshot.h1 || "-"}</p>
                  <p><span className="text-muted-foreground">{ru ? "Слов" : "Word count"}: </span>{snapshot.word_count}</p>
                  <p><span className="text-muted-foreground">{ru ? "Заголовков" : "Headings"}: </span>{(snapshot.headings || []).length}</p>
                  <p><span className="text-muted-foreground">FAQ: </span>{(snapshot.faq || []).length}</p>
                  <p><span className="text-muted-foreground">{ru ? "Изображений" : "Images"}: </span>{(snapshot.images || []).length}</p>
                  <p><span className="text-muted-foreground">{ru ? "Ссылок" : "Links"}: </span>
                    {(snapshot.internal_links || []).length} / {(snapshot.external_links || []).length}</p>
                  <p><span className="text-muted-foreground">Canonical: </span>{snapshot.canonical || "-"}</p>
                </CardContent></Card>
              ) : (
                <p className="text-sm text-muted-foreground">{ru ? "Snapshot еще не создан." : "No snapshot yet."}</p>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {ru ? "История изменений" : "Change history"}
              </h4>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {!loading && !changes.length && (
                <p className="text-sm text-muted-foreground">{ru ? "Значимых изменений пока не было." : "No significant changes yet."}</p>
              )}
              <div className="space-y-2">
                {changes.map(c => {
                  const sev = SEVERITY_META[c.severity] || SEVERITY_META.low;
                  return (
                    <button key={c.id} onClick={() => setSelected(c)}
                      className="w-full text-left rounded-md border p-3 hover:bg-muted/40 transition-colors">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm">{new Date(c.detected_at).toLocaleDateString(ru ? "ru-RU" : "en-GB")}</span>
                        <Badge variant="outline" className={sev.className}>{ru ? sev.ru : sev.en}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{summarizeChange(c.summary, ru)}</p>
                    </button>
                  );
                })}
              </div>
              {total > PAGE_SIZE && (
                <div className="flex items-center gap-2 pt-1">
                  <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => load(Math.max(0, offset - PAGE_SIZE))}>
                    {ru ? "Назад" : "Prev"}
                  </Button>
                  <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => load(offset + PAGE_SIZE)}>
                    {ru ? "Дальше" : "Next"}
                  </Button>
                  <span className="text-xs text-muted-foreground">{offset + 1}-{Math.min(offset + PAGE_SIZE, total)} / {total}</span>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ChangeDetailDialog change={selected} pageUrl={page.url} ru={ru} onOpenChange={() => setSelected(null)} />
    </>
  );
}
