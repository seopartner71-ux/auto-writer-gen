import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, Trash2, Check, FileText, Loader2, Download, FileSpreadsheet, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import JSZip from "jszip";
import { useI18n } from "@/shared/hooks/useI18n";
import { QualityBadge } from "@/features/article-quality/QualityBadge";
import { useConfirm } from "@/shared/components/ConfirmDialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Client } from "@/features/content-ecosystem/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface MyArticlesPageProps {
  onArticleSelect?: () => void;
}

export default function MyArticlesPage({ onArticleSelect }: MyArticlesPageProps = {}) {
  const confirm = useConfirm();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [sourceTab, setSourceTab] = useState<"all" | "manual" | "content_plan">("all");
  const [clientFilter, setClientFilter] = useState<string>("all"); // "all" | "none" | <clientId>

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ["my-articles-list"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, content, created_at, status, quality_badge, quality_status, ai_score, burstiness_score, burstiness_status, keyword_density, keyword_density_status, meta_description, source, client_id, clients:client_id(id, name, logo_url, brand_color, domain), content_topic_id, content_topics:content_topic_id(plan_id, content_plans:plan_id(content_clients:client_id(name)))")
        .eq("user_id", user.id)
        .eq("is_ab_test", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: myClients = [] } = useQuery({
    queryKey: ["my-clients-list"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [] as Client[];
      const { data } = await supabase
        .from("clients")
        .select("id, name, logo_url, brand_color")
        .eq("user_id", user.id)
        .eq("archived", false)
        .order("updated_at", { ascending: false });
      return (data || []) as any as Client[];
    },
  });

  const filteredArticles = useMemo(() => {
    let list = articles as any[];
    if (sourceTab !== "all") list = list.filter((a) => (a.source ?? "manual") === sourceTab);
    if (clientFilter === "none") list = list.filter((a) => !a.client_id);
    else if (clientFilter !== "all") list = list.filter((a) => a.client_id === clientFilter);
    return list;
  }, [articles, sourceTab, clientFilter]);

  const clientNameOf = (a: any): string | null =>
    a?.content_topics?.content_plans?.content_clients?.name ?? null;

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allSelected = filteredArticles.length > 0 && selected.size === filteredArticles.length;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filteredArticles.map((a: any) => a.id)));
  };
  const clearSelection = () => setSelected(new Set());

  const slugify = (s: string) =>
    (s || "article")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^a-zа-я0-9\s-]/gi, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "article";

  const selectedArticles = useMemo(
    () => (filteredArticles as any[]).filter((a: any) => selected.has(a.id)),
    [filteredArticles, selected]
  );

  const handleZipExport = async () => {
    if (selectedArticles.length === 0) return;
    setExporting(true);
    try {
      const zip = new JSZip();
      const used = new Set<string>();
      for (const a of selectedArticles as any[]) {
        let name = slugify(a.title || "article");
        let unique = name;
        let i = 2;
        while (used.has(unique)) unique = `${name}-${i++}`;
        used.add(unique);
        const html = `<!DOCTYPE html>
<html lang="ru"><head>
<meta charset="utf-8" />
<title>${(a.title || "Untitled").replace(/</g, "&lt;")}</title>
<meta name="description" content="${(a.meta_description || "").replace(/"/g, "&quot;")}" />
</head><body>
${a.content || ""}
</body></html>`;
        zip.file(`${unique}.html`, html);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `articles-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(t("myArticles.zipCreated", { n: selectedArticles.length }));
    } catch (e: any) {
      toast.error(e.message || t("myArticles.exportError"));
    } finally {
      setExporting(false);
    }
  };

  const handleCsvExport = () => {
    if (selectedArticles.length === 0) return;
    const esc = (v: any) => {
      const s = String(v ?? "");
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [
      [t("myArticles.csvTitle"), "URL", t("myArticles.csvWords"), "SEO Score", "AI Score", t("myArticles.csvDate")],
      ...selectedArticles.map((a: any) => [
        a.title || "",
        `${window.location.origin}/articles?edit=${a.id}`,
        a.content ? String(a.content).split(/\s+/).filter(Boolean).length : "",
        "",
        a.ai_score ?? "",
        a.created_at ? format(new Date(a.created_at), "dd.MM.yyyy HH:mm") : "",
      ]),
    ];
    const csv = "\uFEFF" + rows.map(r => r.map(esc).join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `articles-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(t("myArticles.csvCreated", { n: selectedArticles.length }));
  };

  const handleBatchDelete = async () => {
    if (selectedArticles.length === 0) return;
    if (!(await confirm({ title: t("myArticles.batchDeleteTitle"), description: t("myArticles.batchDeleteDesc", { n: selectedArticles.length }), destructive: true, confirmText: t("common.delete") }))) return;
    const ids = selectedArticles.map((a: any) => a.id);
    const { error } = await supabase.from("articles").delete().in("id", ids);
    if (error) { toast.error(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ["my-articles-list"] });
    clearSelection();
    toast.success(t("myArticles.batchDeleted", { n: ids.length }));
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("articles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-articles-list"] });
      toast.success(t("myArticles.deleted"));
    },
    onError: () => toast.error(t("myArticles.deleteError")),
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("articles").delete().eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-articles-list"] });
      toast.success(t("myArticles.allDeleted"));
    },
    onError: () => toast.error(t("myArticles.deleteError")),
  });

  const handleCopy = async (article: any) => {
    const text = article.content || article.title || "";
    await navigator.clipboard.writeText(text);
    setCopiedId(article.id);
    toast.success(t("myArticles.copied"));
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("myArticles.title")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("myArticles.subtitleCount")} - {articles.length} {t("myArticles.pcs")}
          </p>
        </div>
        {articles.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={deleteAllMutation.isPending}>
                <Trash2 className="h-4 w-4 mr-1" />
                {t("myArticles.deleteAll")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("myArticles.deleteAllTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("myArticles.deleteAllDesc")} ({articles.length})
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteAllMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t("myArticles.deleteAll")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <div className="px-4 pt-4 flex flex-wrap items-center justify-between gap-3">
            <Tabs value={sourceTab} onValueChange={(v) => { setSourceTab(v as any); clearSelection(); }}>
              <TabsList>
                <TabsTrigger value="all">{t("myArticles.tabAll")} ({articles.length})</TabsTrigger>
                <TabsTrigger value="manual">{t("myArticles.tabManual")} ({(articles as any[]).filter((a) => (a.source ?? "manual") === "manual").length})</TabsTrigger>
                <TabsTrigger value="content_plan">{t("myArticles.tabContentPlan")} ({(articles as any[]).filter((a) => a.source === "content_plan").length})</TabsTrigger>
              </TabsList>
            </Tabs>
            <Select value={clientFilter} onValueChange={(v) => { setClientFilter(v); clearSelection(); }}>
              <SelectTrigger className="h-9 w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все клиенты</SelectItem>
                <SelectItem value="none">Без клиента (личные)</SelectItem>
                {myClients.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="inline-flex items-center gap-2">
                      {c.logo_url ? (
                        <img src={c.logo_url} alt="" className="h-4 w-4 rounded object-cover" />
                      ) : (
                        <span className="h-4 w-4 rounded text-white text-[8px] font-bold flex items-center justify-center"
                          style={{ background: c.brand_color }}>
                          {c.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      {c.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filteredArticles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileText className="h-12 w-12 mb-3 opacity-40" />
              <p className="text-lg font-medium">{t("myArticles.noArticles")}</p>
              <p className="text-sm">{t("myArticles.generateFirst")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      aria-label={t("myArticles.selectAll")}
                    />
                  </TableHead>
                  <TableHead className="w-16">№</TableHead>
                  <TableHead className="w-12 text-center">Q</TableHead>
                  <TableHead>{t("myArticles.heading")}</TableHead>
                  <TableHead className="w-40">Клиент</TableHead>
                  <TableHead className="w-40">{t("myArticles.dateGen")}</TableHead>
                  <TableHead className="w-32 text-right">{t("myArticles.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredArticles.map((article: any, index: number) => (
                  <TableRow
                    key={article.id}
                    className={`border-border cursor-pointer hover:bg-muted/40 transition-colors group ${selected.has(article.id) ? "bg-primary/5" : ""}`}
                    onClick={() => {
                      navigate(`/articles?edit=${article.id}`);
                      onArticleSelect?.();
                    }}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(article.id)}
                        onCheckedChange={() => toggleOne(article.id)}
                        className={`${selected.has(article.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity`}
                        aria-label={t("myArticles.selectRow")}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {index + 1}
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <TooltipProvider>
                        <QualityBadge
                          articleId={article.id}
                          initial={{
                            quality_status: (article as any).quality_status
                              || ((article as any).quality_badge === "excellent" ? "ok"
                                : (article as any).quality_badge === "good" ? "warning"
                                : (article as any).quality_badge === "needs_work" ? "fail"
                                : null),
                            ai_score: (article as any).ai_score,
                            burstiness_score: (article as any).burstiness_score,
                            burstiness_status: (article as any).burstiness_status,
                            keyword_density: (article as any).keyword_density,
                            keyword_density_status: (article as any).keyword_density_status,
                          }}
                        />
                      </TooltipProvider>
                    </TableCell>
                    <TableCell className="font-medium max-w-[400px]">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className="line-clamp-2">
                          {article.title || t("myArticles.noTitle")}
                        </span>
                        {article.source === "content_plan" && (
                          <Badge variant="secondary" className="text-[10px] shrink-0">
                            {t("myArticles.tabContentPlan")}{clientNameOf(article) ? ` · ${clientNameOf(article)}` : ""}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {article.clients ? (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          {article.clients.logo_url ? (
                            <img src={article.clients.logo_url} alt="" className="h-4 w-4 rounded object-cover" />
                          ) : (
                            <span className="h-4 w-4 rounded text-white text-[8px] font-bold flex items-center justify-center"
                              style={{ background: article.clients.brand_color }}>
                              {String(article.clients.name).slice(0, 2).toUpperCase()}
                            </span>
                          )}
                          <span className="truncate max-w-[120px]">{article.clients.name}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {article.created_at
                        ? format(new Date(article.created_at), "dd.MM.yyyy HH:mm")
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCopy(article)}
                          title={t("common.copy")}
                        >
                          {copiedId === article.id ? (
                            <Check className="h-4 w-4 text-success" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              title={t("common.delete")}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("myArticles.deleteTitle")}</AlertDialogTitle>
                              <AlertDialogDescription>
                                «{article.title || t("myArticles.noTitle")}» {t("myArticles.willBeDeleted")}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(article.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {t("common.delete")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-border bg-background/95 backdrop-blur px-4 py-2.5 shadow-lg">
          <span className="text-sm font-medium pr-2 border-r border-border">
            {t("myArticles.selectedCount", { n: selected.size })}
          </span>
          <Button size="sm" variant="outline" onClick={handleZipExport} disabled={exporting} className="gap-1.5">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t("myArticles.downloadZip")}
          </Button>
          <Button size="sm" variant="outline" onClick={handleCsvExport} className="gap-1.5">
            <FileSpreadsheet className="h-4 w-4" />
            {t("myArticles.exportCsv")}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleBatchDelete} className="gap-1.5 text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" />
            {t("common.delete")}
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection} className="gap-1.5">
            <X className="h-4 w-4" />
            {t("common.cancel")}
          </Button>
        </div>
      )}
    </div>
  );
}
