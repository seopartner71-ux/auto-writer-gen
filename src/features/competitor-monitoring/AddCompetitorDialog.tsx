import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, Trash2, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MONITOR_KEYS, FREQUENCIES, defaultMonitorConfig, type MonitorKey } from "./constants";
import { createMonitor, addPages, isValidPageUrl, normalizeDomain } from "./api";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ru: boolean;
  /** When set, the dialog only adds pages to an existing competitor. */
  monitorId?: string;
  onSaved: () => void;
}

interface DraftPage { url: string; label: string; frequency: string }

export function AddCompetitorDialog({ open, onOpenChange, ru, monitorId, onSaved }: Props) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [pages, setPages] = useState<DraftPage[]>([{ url: "", label: "", frequency: "weekly" }]);
  const [bulk, setBulk] = useState("");
  const [config, setConfig] = useState<Record<MonitorKey, boolean>>(defaultMonitorConfig());
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName(""); setDomain(""); setPages([{ url: "", label: "", frequency: "weekly" }]);
    setBulk(""); setConfig(defaultMonitorConfig());
  };

  const applyBulk = () => {
    const urls = bulk.split(/\s+/).map(s => s.trim()).filter(Boolean);
    const valid = urls.filter(isValidPageUrl);
    if (!valid.length) { toast.error(ru ? "Не найдено корректных URL" : "No valid URLs found"); return; }
    setPages(prev => [
      ...prev.filter(p => p.url.trim()),
      ...valid.map(u => ({ url: u, label: "", frequency: "weekly" })),
    ]);
    setBulk("");
    toast.success(ru ? `Добавлено ${valid.length} URL` : `Added ${valid.length} URLs`);
  };

  const save = async () => {
    const list = pages.filter(p => p.url.trim());
    if (!monitorId && !name.trim()) { toast.error(ru ? "Укажите название конкурента" : "Competitor name is required"); return; }
    if (!monitorId && !normalizeDomain(domain)) { toast.error(ru ? "Укажите домен" : "Domain is required"); return; }
    const bad = list.find(p => !isValidPageUrl(p.url));
    if (bad) { toast.error(`${ru ? "Некорректный URL" : "Invalid URL"}: ${bad.url}`); return; }
    if (!list.length) { toast.error(ru ? "Добавьте хотя бы одну страницу" : "Add at least one page"); return; }

    setSaving(true);
    try {
      if (monitorId) await addPages(monitorId, list, config);
      else await createMonitor({ name: name.trim(), domain, projectId: null, pages: list, monitorConfig: config });
      toast.success(ru ? "Сохранено. Первая проверка создаст baseline." : "Saved. The first check creates a baseline.");
      reset();
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {monitorId ? (ru ? "Добавить страницы" : "Add pages") : (ru ? "Добавить конкурента" : "Add competitor")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {!monitorId && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{ru ? "Название конкурента" : "Competitor name"}</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder={ru ? "Конкурент №1" : "Competitor #1"} />
              </div>
              <div className="space-y-2">
                <Label>{ru ? "Домен" : "Domain"}</Label>
                <Input value={domain} onChange={e => setDomain(e.target.value)} placeholder="https://competitor.ru" />
              </div>
            </div>
          )}

          <div className="space-y-3">
            <Label>{ru ? "Страницы" : "Pages"}</Label>
            {pages.map((p, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_180px_150px_40px] items-center">
                <Input value={p.url} placeholder="https://competitor.ru/seo/"
                  onChange={e => setPages(v => v.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} />
                <Input value={p.label} placeholder={ru ? "Название страницы" : "Page name"}
                  onChange={e => setPages(v => v.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                <Select value={p.frequency} onValueChange={val => setPages(v => v.map((x, j) => j === i ? { ...x, frequency: val } : x))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map(f => <SelectItem key={f.value} value={f.value}>{ru ? f.ru : f.en}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" disabled={pages.length === 1}
                  onClick={() => setPages(v => v.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setPages(v => [...v, { url: "", label: "", frequency: "weekly" }])}>
              <Plus className="h-4 w-4 mr-1" /> {ru ? "Добавить страницу" : "Add page"}
            </Button>
          </div>

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="px-0">
                <ChevronDown className="h-4 w-4 mr-1" /> {ru ? "Массовое добавление URL" : "Bulk add URLs"}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-2">
              <Textarea rows={4} value={bulk} onChange={e => setBulk(e.target.value)}
                placeholder={"https://competitor.ru/seo/\nhttps://competitor.ru/uslugi/seo/"} />
              <Button variant="outline" size="sm" onClick={applyBulk}>{ru ? "Добавить в список" : "Add to list"}</Button>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible defaultOpen>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="px-0">
                <ChevronDown className="h-4 w-4 mr-1" /> {ru ? "Что отслеживать" : "What to monitor"}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="grid gap-2 sm:grid-cols-3">
                {MONITOR_KEYS.map(m => (
                  <label key={m.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={config[m.key]} onCheckedChange={v => setConfig(c => ({ ...c, [m.key]: Boolean(v) }))} />
                    {ru ? m.ru : m.en}
                  </label>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{ru ? "Отмена" : "Cancel"}</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {ru ? "Сохранить" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
