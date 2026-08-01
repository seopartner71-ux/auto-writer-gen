import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, RefreshCw, Download, ExternalLink, FileDown, Loader2, Globe, Archive } from "lucide-react";
import { toast } from "sonner";

interface PubRow {
  id: string;
  published_url: string | null;
  pdf_url: string | null;
  deployed_at: string | null;
  indexing_status: string;
  indexing_status_google: string;
  indexing_status_yandex: string;
  indexnow_submitted_at: string | null;
  archive_org_status: string;
  archive_org_url: string | null;
  archive_org_pdf_url: string | null;
  archive_org_uploaded_at: string | null;
  archive_org_error: string | null;
  clientName: string;
  docType: string;
  typeSlug: string;
  title: string;
}

const ARCHIVE_ORG_TYPES = ["whitepaper", "encyclopedia", "catalog", "expert_pdf", "ranking", "comparison_review", "glossary"];

const ARCHIVE_META: Record<string, { ru: string; en: string; cls: string }> = {
  pending: { ru: "Не отправлено", en: "Pending", cls: "bg-muted text-muted-foreground" },
  uploading: { ru: "Загрузка", en: "Uploading", cls: "bg-amber-500/15 text-amber-500" },
  uploaded: { ru: "Загружено", en: "Uploaded", cls: "bg-amber-500/15 text-amber-500" },
  processing: { ru: "Обработка", en: "Processing", cls: "bg-amber-500/15 text-amber-500" },
  available: { ru: "Доступно", en: "Available", cls: "bg-emerald-500/15 text-emerald-500" },
  error: { ru: "Ошибка", en: "Error", cls: "bg-destructive/15 text-destructive" },
};

const STATUS_META: Record<string, { ru: string; en: string; cls: string }> = {
  pending: { ru: "Не отправлено", en: "Pending", cls: "bg-muted text-muted-foreground" },
  submitted: { ru: "Отправлено", en: "Submitted", cls: "bg-primary/15 text-primary" },
  indexed: { ru: "В индексе", en: "Indexed", cls: "bg-emerald-500/15 text-emerald-500" },
  error: { ru: "Ошибка", en: "Error", cls: "bg-destructive/15 text-destructive" },
};

function StatusBadge({ status, lang }: { status: string; lang: string }) {
  const m = STATUS_META[status] || STATUS_META.pending;
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs ${m.cls}`}>{lang === "ru" ? m.ru : m.en}</span>;
}

function ArchiveBadge({ row, lang }: { row: PubRow; lang: string }) {
  const m = ARCHIVE_META[row.archive_org_status] || ARCHIVE_META.pending;
  const label = lang === "ru" ? m.ru : m.en;
  const badge = (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs ${m.cls}`} title={row.archive_org_error || undefined}>
      {label}
    </span>
  );
  if (row.archive_org_status === "available" && row.archive_org_url) {
    return (
      <a href={row.archive_org_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
        {badge}
      </a>
    );
  }
  return badge;
}

export default function PublicationsPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [archiveFilter, setArchiveFilter] = useState("all");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"indexnow" | "check" | "archive" | "archive-check" | null>(null);

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ["publications", user?.id],
    queryFn: async (): Promise<PubRow[]> => {
      const { data, error } = await supabase
        .from("format_deployments")
        .select("id, published_url, pdf_url, deployed_at, indexing_status, indexing_status_google, indexing_status_yandex, indexnow_submitted_at, archive_org_status, archive_org_url, archive_org_pdf_url, archive_org_uploaded_at, archive_org_error, ecosystem_formats!inner(format_type, document_types(name, slug), content_ecosystems!inner(clients(name), articles(title)))")
        .eq("status", "deployed")
        .order("deployed_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return ((data || []) as any[]).map((d) => {
        const fmt = d.ecosystem_formats || {};
        const dt = fmt.document_types || {};
        const eco = fmt.content_ecosystems || {};
        return {
          id: d.id,
          published_url: d.published_url,
          pdf_url: d.pdf_url,
          deployed_at: d.deployed_at,
          indexing_status: d.indexing_status || "pending",
          indexing_status_google: d.indexing_status_google || "pending",
          indexing_status_yandex: d.indexing_status_yandex || "pending",
          indexnow_submitted_at: d.indexnow_submitted_at,
          archive_org_status: d.archive_org_status || "pending",
          archive_org_url: d.archive_org_url,
          archive_org_pdf_url: d.archive_org_pdf_url,
          archive_org_uploaded_at: d.archive_org_uploaded_at,
          archive_org_error: d.archive_org_error,
          clientName: eco.clients?.name || "-",
          docType: dt.name || dt.slug || fmt.format_type || "-",
          typeSlug: dt.slug || fmt.format_type || "",
          title: eco.articles?.title || dt.name || "-",
        } as PubRow;
      });
    },
    enabled: !!user,
  });

  const clients = useMemo(() => Array.from(new Set(rows.map((r) => r.clientName))).sort(), [rows]);
  const types = useMemo(() => Array.from(new Set(rows.map((r) => r.docType))).sort(), [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (clientFilter !== "all" && r.clientName !== clientFilter) return false;
    if (typeFilter !== "all" && r.docType !== typeFilter) return false;
    if (statusFilter !== "all" && r.indexing_status !== statusFilter) return false;
    if (archiveFilter !== "all" && r.archive_org_status !== archiveFilter) return false;
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      if (!`${r.title} ${r.published_url || ""} ${r.clientName}`.toLowerCase().includes(s)) return false;
    }
    return true;
  }), [rows, clientFilter, typeFilter, statusFilter, archiveFilter, search]);

  const selectedIds = Object.keys(selected).filter((k) => selected[k]);
  const allChecked = filtered.length > 0 && filtered.every((r) => selected[r.id]);

  const toggleAll = () => {
    const next = { ...selected };
    for (const r of filtered) next[r.id] = !allChecked;
    setSelected(next);
  };

  const runIndexNow = async () => {
    if (selectedIds.length === 0) return;
    setBusy("indexnow");
    try {
      const { data, error } = await supabase.functions.invoke("submit-to-indexnow", {
        body: { deployment_ids: selectedIds },
      });
      if (error) throw error;
      toast.success(lang === "ru"
        ? `Отправлено в IndexNow: ${data?.submitted ?? 0} публикаций`
        : `Submitted to IndexNow: ${data?.submitted ?? 0} publications`);
      await refetch();
    } catch (e: any) {
      toast.error(e?.message || (lang === "ru" ? "Ошибка отправки" : "Submit failed"));
    } finally {
      setBusy(null);
    }
  };

  const runCheck = async () => {
    setBusy("check");
    try {
      const { data, error } = await supabase.functions.invoke("check-indexing-status", {
        body: selectedIds.length > 0 ? { deployment_ids: selectedIds } : { limit: 25 },
      });
      if (error) throw error;
      toast.success(lang === "ru"
        ? `Проверено публикаций: ${data?.checked ?? 0}`
        : `Checked: ${data?.checked ?? 0}`);
      await refetch();
    } catch (e: any) {
      toast.error(e?.message || (lang === "ru" ? "Ошибка проверки" : "Check failed"));
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = () => {
    const head = ["client", "type", "title", "url", "pdf_url", "deployed_at", "indexing_status", "google", "yandex", "indexnow_submitted_at", "archive_org_url", "archive_org_status", "archive_org_uploaded_at"];
    const lines = [head.join(",")];
    for (const r of filtered) {
      lines.push([
        r.clientName, r.docType, r.title, r.published_url || "", r.pdf_url || "",
        r.deployed_at || "", r.indexing_status, r.indexing_status_google, r.indexing_status_yandex,
        r.indexnow_submitted_at || "", r.archive_org_url || "", r.archive_org_status,
        r.archive_org_uploaded_at || "",
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `publications-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const stats = useMemo(() => ({
    total: rows.length,
    indexed: rows.filter((r) => r.indexing_status === "indexed").length,
    submitted: rows.filter((r) => r.indexing_status === "submitted").length,
    pending: rows.filter((r) => r.indexing_status === "pending").length,
  }), [rows]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {lang === "ru" ? "Публикации" : "Publications"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {lang === "ru"
            ? "Все опубликованные URL Экосистемы: страницы и PDF, отправка в индексаторы и мониторинг статуса."
            : "All published ecosystem URLs: pages and PDFs, index submission and status monitoring."}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: lang === "ru" ? "Всего URL" : "Total", value: stats.total },
          { label: lang === "ru" ? "В индексе" : "Indexed", value: stats.indexed },
          { label: lang === "ru" ? "Отправлено" : "Submitted", value: stats.submitted },
          { label: lang === "ru" ? "Не отправлено" : "Pending", value: stats.pending },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-2xl font-semibold mt-1">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4" />
            {lang === "ru" ? "Реестр публикаций" : "Publications registry"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-4">
            <Input
              placeholder={lang === "ru" ? "Поиск по названию или URL" : "Search title or URL"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger><SelectValue placeholder={lang === "ru" ? "Клиент" : "Client"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{lang === "ru" ? "Все клиенты" : "All clients"}</SelectItem>
                {clients.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger><SelectValue placeholder={lang === "ru" ? "Тип" : "Type"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{lang === "ru" ? "Все типы" : "All types"}</SelectItem>
                {types.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue placeholder={lang === "ru" ? "Статус" : "Status"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{lang === "ru" ? "Любой статус" : "Any status"}</SelectItem>
                {Object.keys(STATUS_META).map((k) => (
                  <SelectItem key={k} value={k}>{lang === "ru" ? STATUS_META[k].ru : STATUS_META[k].en}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={runIndexNow} disabled={selectedIds.length === 0 || busy !== null}>
              {busy === "indexnow" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              {lang === "ru" ? `Отправить в IndexNow (${selectedIds.length})` : `Submit to IndexNow (${selectedIds.length})`}
            </Button>
            <Button size="sm" variant="outline" onClick={runCheck} disabled={busy !== null}>
              {busy === "check" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              {lang === "ru" ? "Проверить индексацию" : "Check indexing"}
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              {lang === "ru" ? "Экспорт CSV" : "Export CSV"}
            </Button>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox checked={allChecked} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead>{lang === "ru" ? "Документ" : "Document"}</TableHead>
                  <TableHead>{lang === "ru" ? "Клиент" : "Client"}</TableHead>
                  <TableHead>{lang === "ru" ? "Дата" : "Date"}</TableHead>
                  <TableHead>{lang === "ru" ? "Статус" : "Status"}</TableHead>
                  <TableHead>Google</TableHead>
                  <TableHead>{lang === "ru" ? "Яндекс" : "Yandex"}</TableHead>
                  <TableHead className="text-right">{lang === "ru" ? "Ссылки" : "Links"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                    {lang === "ru" ? "Загрузка" : "Loading"}
                  </TableCell></TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                    {lang === "ru" ? "Публикаций пока нет" : "No publications yet"}
                  </TableCell></TableRow>
                )}
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Checkbox
                        checked={!!selected[r.id]}
                        onCheckedChange={(v) => setSelected((s) => ({ ...s, [r.id]: !!v }))}
                      />
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <div className="truncate text-sm font-medium">{r.title}</div>
                      <Badge variant="outline" className="mt-1 text-[10px]">{r.docType}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{r.clientName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {r.deployed_at ? new Date(r.deployed_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US") : "-"}
                    </TableCell>
                    <TableCell><StatusBadge status={r.indexing_status} lang={lang} /></TableCell>
                    <TableCell><StatusBadge status={r.indexing_status_google} lang={lang} /></TableCell>
                    <TableCell><StatusBadge status={r.indexing_status_yandex} lang={lang} /></TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {r.published_url && (
                        <Button asChild size="icon" variant="ghost" className="h-8 w-8">
                          <a href={r.published_url} target="_blank" rel="noopener noreferrer" title={r.published_url}>
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                      {r.pdf_url && (
                        <Button asChild size="icon" variant="ghost" className="h-8 w-8">
                          <a href={r.pdf_url} target="_blank" rel="noopener noreferrer" title="PDF">
                            <FileDown className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
