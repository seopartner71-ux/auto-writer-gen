import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Activity, Plus, Loader2, MoreHorizontal, Pause, Play, Trash2, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/shared/hooks/useI18n";
import { SEVERITY_META, summarizeChange } from "@/features/competitor-monitoring/constants";
import {
  fetchMonitors, fetchPages, fetchChanges, fetchDashboardStats, runCheck,
  type MonitorRow, type PageRow, type ChangeRow,
} from "@/features/competitor-monitoring/api";
import { AddCompetitorDialog } from "@/features/competitor-monitoring/AddCompetitorDialog";
import { PageDetailDialog } from "@/features/competitor-monitoring/PageDetailDialog";
import { ChangeDetailDialog } from "@/features/competitor-monitoring/ChangeDetailDialog";

const CHANGES_PAGE_SIZE = 15;

export default function CompetitorMonitoringPage() {
  const { lang } = useI18n();
  const ru = lang !== "en";

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ competitors: 0, pages: 0, changesThisWeek: 0, importantChanges: 0 });
  const [monitors, setMonitors] = useState<MonitorRow[]>([]);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [changesTotal, setChangesTotal] = useState(0);
  const [changesOffset, setChangesOffset] = useState(0);
  const [important, setImportant] = useState<ChangeRow[]>([]);

  const [addOpen, setAddOpen] = useState(false);
  const [addToMonitor, setAddToMonitor] = useState<string | undefined>(undefined);
  const [openPage, setOpenPage] = useState<PageRow | null>(null);
  const [openChange, setOpenChange] = useState<ChangeRow | null>(null);
  const [deleteMonitor, setDeleteMonitor] = useState<MonitorRow | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);

  const pageById = useMemo(() => new Map(pages.map(p => [p.id, p])), [pages]);
  const monitorById = useMemo(() => new Map(monitors.map(m => [m.id, m])), [monitors]);

  const load = useCallback(async (offset = 0) => {
    setLoading(true);
    try {
      const [s, m, p, c, imp] = await Promise.all([
        fetchDashboardStats(),
        fetchMonitors(),
        fetchPages(),
        fetchChanges({ limit: CHANGES_PAGE_SIZE, offset }),
        fetchChanges({ limit: 5, offset: 0, onlyImportant: true }),
      ]);
      setStats(s); setMonitors(m); setPages(p);
      setChanges(c.rows); setChangesTotal(c.total); setChangesOffset(offset);
      setImportant(imp.rows);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(0); }, [load]);

  const pageLabel = (id: string) => {
    const p = pageById.get(id);
    if (!p) return "-";
    try { return new URL(p.url).pathname || "/"; } catch { return p.url; }
  };
  const competitorLabel = (id: string) => monitorById.get(id)?.domain || "-";

  const toggleMonitor = async (m: MonitorRow) => {
    const { error } = await supabase.from("competitor_monitors").update({ is_active: !m.is_active }).eq("id", m.id);
    if (error) return toast.error(error.message);
    await supabase.from("competitor_pages").update({ is_enabled: !m.is_active }).eq("monitor_id", m.id);
    load(changesOffset);
  };

  const removeMonitor = async () => {
    if (!deleteMonitor) return;
    const { error } = await supabase.from("competitor_monitors").delete().eq("id", deleteMonitor.id);
    if (error) toast.error(error.message);
    else toast.success(ru ? "Конкурент удален" : "Competitor deleted");
    setDeleteMonitor(null);
    load(0);
  };

  const checkMonitor = async (m: MonitorRow) => {
    const list = pages.filter(p => p.monitor_id === m.id && p.is_enabled);
    if (!list.length) return toast.error(ru ? "Нет активных страниц" : "No active pages");
    setCheckingAll(true);
    try {
      for (const p of list) await runCheck(p.id);
      toast.success(ru ? "Проверка завершена" : "Check finished");
      load(0);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCheckingAll(false);
    }
  };

  const statCards = [
    { label: ru ? "Конкуренты" : "Competitors", value: stats.competitors },
    { label: ru ? "Страниц на мониторинге" : "Monitored pages", value: stats.pages },
    { label: ru ? "Изменений за неделю" : "Changes this week", value: stats.changesThisWeek },
    { label: ru ? "Важные изменения" : "Important changes", value: stats.importantChanges },
  ];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">{ru ? "Мониторинг конкурентов" : "Competitor Monitoring"}</h1>
            <p className="text-sm text-muted-foreground">
              {ru
                ? "Автоматические snapshot'ы страниц конкурентов и разбор того, что именно изменилось."
                : "Automatic snapshots of competitor pages and a breakdown of what exactly changed."}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => load(changesOffset)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> {ru ? "Обновить" : "Refresh"}
          </Button>
          <Button onClick={() => { setAddToMonitor(undefined); setAddOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> {ru ? "Добавить конкурента" : "Add competitor"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map(c => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{c.label}</p>
              <p className="text-3xl font-semibold mt-1">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {important.length > 0 && (
        <Card className="border-orange-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" /> {ru ? "Важные изменения" : "Important changes"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {important.map(c => (
              <button key={c.id} onClick={() => setOpenChange(c)}
                className="w-full text-left rounded-md border p-3 hover:bg-muted/40 transition-colors">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{competitorLabel(c.monitor_id)}</span>
                  <span className="text-muted-foreground">{pageLabel(c.page_id)}</span>
                  <Badge variant="outline" className={(SEVERITY_META[c.severity] || SEVERITY_META.low).className}>
                    {ru ? (SEVERITY_META[c.severity] || SEVERITY_META.low).ru : (SEVERITY_META[c.severity] || SEVERITY_META.low).en}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{summarizeChange(c.summary, ru)}</p>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="changes">
        <TabsList>
          <TabsTrigger value="changes">{ru ? "Последние изменения" : "Recent changes"}</TabsTrigger>
          <TabsTrigger value="competitors">{ru ? "Конкуренты" : "Competitors"}</TabsTrigger>
          <TabsTrigger value="pages">{ru ? "Страницы" : "Pages"}</TabsTrigger>
        </TabsList>

        <TabsContent value="changes" className="pt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{ru ? "Дата" : "Date"}</TableHead>
                    <TableHead>{ru ? "Конкурент" : "Competitor"}</TableHead>
                    <TableHead>{ru ? "Страница" : "Page"}</TableHead>
                    <TableHead>{ru ? "Изменения" : "Changes"}</TableHead>
                    <TableHead>{ru ? "Значимость" : "Severity"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {changes.map(c => {
                    const sev = SEVERITY_META[c.severity] || SEVERITY_META.low;
                    return (
                      <TableRow key={c.id} className="cursor-pointer" onClick={() => setOpenChange(c)}>
                        <TableCell>{new Date(c.detected_at).toLocaleDateString(ru ? "ru-RU" : "en-GB")}</TableCell>
                        <TableCell>{competitorLabel(c.monitor_id)}</TableCell>
                        <TableCell className="max-w-[240px] truncate">{pageLabel(c.page_id)}</TableCell>
                        <TableCell className="max-w-[360px]">{summarizeChange(c.summary, ru)}</TableCell>
                        <TableCell><Badge variant="outline" className={sev.className}>{ru ? sev.ru : sev.en}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                  {!changes.length && !loading && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      {ru ? "Изменений пока нет. Добавьте конкурента и страницы - первая проверка создаст baseline." : "No changes yet. Add a competitor and pages - the first check creates a baseline."}
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {changesTotal > CHANGES_PAGE_SIZE && (
            <div className="flex items-center gap-2 pt-3">
              <Button variant="outline" size="sm" disabled={changesOffset === 0} onClick={() => load(Math.max(0, changesOffset - CHANGES_PAGE_SIZE))}>
                {ru ? "Назад" : "Prev"}
              </Button>
              <Button variant="outline" size="sm" disabled={changesOffset + CHANGES_PAGE_SIZE >= changesTotal} onClick={() => load(changesOffset + CHANGES_PAGE_SIZE)}>
                {ru ? "Дальше" : "Next"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {changesOffset + 1}-{Math.min(changesOffset + CHANGES_PAGE_SIZE, changesTotal)} / {changesTotal}
              </span>
            </div>
          )}
        </TabsContent>

        <TabsContent value="competitors" className="pt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{ru ? "Конкурент" : "Competitor"}</TableHead>
                    <TableHead>{ru ? "Страниц" : "Pages"}</TableHead>
                    <TableHead>{ru ? "Последняя проверка" : "Last check"}</TableHead>
                    <TableHead>{ru ? "Изменений" : "Changes"}</TableHead>
                    <TableHead>{ru ? "Статус" : "Status"}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monitors.map(m => {
                    const own = pages.filter(p => p.monitor_id === m.id);
                    const last = own.map(p => p.last_checked_at).filter(Boolean).sort().pop();
                    const cnt = changes.filter(c => c.monitor_id === m.id).length;
                    return (
                      <TableRow key={m.id}>
                        <TableCell>
                          <div className="font-medium">{m.name}</div>
                          <div className="text-xs text-muted-foreground">{m.domain}</div>
                        </TableCell>
                        <TableCell>{own.length}</TableCell>
                        <TableCell>{last ? new Date(last).toLocaleString(ru ? "ru-RU" : "en-GB") : "-"}</TableCell>
                        <TableCell>{cnt}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={m.is_active ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" : ""}>
                            {m.is_active ? (ru ? "Активен" : "Active") : (ru ? "Пауза" : "Paused")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" disabled={checkingAll}><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setAddToMonitor(m.id); setAddOpen(true); }}>
                                <Plus className="h-4 w-4 mr-2" /> {ru ? "Добавить страницы" : "Add pages"}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => checkMonitor(m)}>
                                <RefreshCw className="h-4 w-4 mr-2" /> {ru ? "Проверить сейчас" : "Check now"}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => toggleMonitor(m)}>
                                {m.is_active ? <Pause className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                                {m.is_active ? (ru ? "Приостановить" : "Pause monitoring") : (ru ? "Возобновить" : "Resume")}
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteMonitor(m)}>
                                <Trash2 className="h-4 w-4 mr-2" /> {ru ? "Удалить" : "Delete"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!monitors.length && !loading && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      {ru ? "Конкуренты еще не добавлены." : "No competitors yet."}
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pages" className="pt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>URL</TableHead>
                    <TableHead>{ru ? "Конкурент" : "Competitor"}</TableHead>
                    <TableHead>{ru ? "Частота" : "Frequency"}</TableHead>
                    <TableHead>{ru ? "Проверена" : "Last check"}</TableHead>
                    <TableHead>{ru ? "Статус" : "Status"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pages.map(p => (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => setOpenPage(p)}>
                      <TableCell className="max-w-[320px] truncate">{p.label || p.url}</TableCell>
                      <TableCell>{competitorLabel(p.monitor_id)}</TableCell>
                      <TableCell>{p.frequency}</TableCell>
                      <TableCell>{p.last_checked_at ? new Date(p.last_checked_at).toLocaleString(ru ? "ru-RU" : "en-GB") : "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          p.status === "error" ? SEVERITY_META.critical.className
                            : p.is_enabled ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" : ""}>
                          {p.status === "error" ? (ru ? "Ошибка" : "Error") : p.is_enabled ? (ru ? "Активна" : "Active") : (ru ? "Пауза" : "Paused")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!pages.length && !loading && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      {ru ? "Страницы не добавлены." : "No pages yet."}
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {loading && <div className="flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

      <AddCompetitorDialog open={addOpen} onOpenChange={setAddOpen} ru={ru} monitorId={addToMonitor} onSaved={() => load(0)} />
      <PageDetailDialog page={openPage} ru={ru} onOpenChange={() => setOpenPage(null)} onChanged={() => load(changesOffset)} />
      <ChangeDetailDialog change={openChange} pageUrl={openChange ? pageById.get(openChange.page_id)?.url : undefined}
        ru={ru} onOpenChange={() => setOpenChange(null)} />

      <AlertDialog open={!!deleteMonitor} onOpenChange={(v) => !v && setDeleteMonitor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ru ? "Удалить конкурента?" : "Delete competitor?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {ru
                ? "Будут удалены все страницы, snapshot'ы и история изменений этого конкурента."
                : "All pages, snapshots and change history for this competitor will be deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ru ? "Отмена" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={removeMonitor}>{ru ? "Удалить" : "Delete"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
