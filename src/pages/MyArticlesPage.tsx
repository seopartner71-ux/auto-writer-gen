import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, Trash2, Check, FileText, Loader2, Download, FileSpreadsheet, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import JSZip from "jszip";
import { useI18n } from "@/shared/hooks/useI18n";
import { QualityBadge } from "@/features/article-quality/QualityBadge";
import { TooltipProvider } from "@/components/ui/tooltip";
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
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ["my-articles-list"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, content, created_at, status, quality_badge, quality_status, ai_score, burstiness_score, burstiness_status, keyword_density, keyword_density_status, meta_description")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allSelected = articles.length > 0 && selected.size === articles.length;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(articles.map((a: any) => a.id)));
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
    () => articles.filter((a: any) => selected.has(a.id)),
    [articles, selected]
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
      toast.success(`ZIP создан: ${selectedArticles.length} файлов`);
    } catch (e: any) {
      toast.error(e.message || "Ошибка экспорта");
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
      ["Заголовок", "URL", "Слов", "SEO Score", "AI Score", "Дата создания"],
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
    toast.success(`CSV создан: ${selectedArticles.length} строк`);
  };

  const handleBatchDelete = async () => {
    if (selectedArticles.length === 0) return;
    if (!confirm(`Удалить ${selectedArticles.length} статей?`)) return;
    const ids = selectedArticles.map((a: any) => a.id);
    const { error } = await supabase.from("articles").delete().in("id", ids);
    if (error) { toast.error(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ["my-articles-list"] });
    clearSelection();
    toast.success(`Удалено: ${ids.length}`);
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
            {t("myArticles.subtitleCount")} — {articles.length} {t("myArticles.pcs")}
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
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : articles.length === 0 ? (
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
                      aria-label="Выбрать все"
                    />
                  </TableHead>
                  <TableHead className="w-16">№</TableHead>
                  <TableHead className="w-12 text-center">Q</TableHead>
                  <TableHead>{t("myArticles.heading")}</TableHead>
                  <TableHead className="w-40">{t("myArticles.dateGen")}</TableHead>
                  <TableHead className="w-32 text-right">{t("myArticles.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {articles.map((article, index) => (
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
                        aria-label="Выбрать"
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
                      <span className="line-clamp-2">
                        {article.title || t("myArticles.noTitle")}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {article.created_at
                        ? format(new Date(article.created_at), "dd.MM.yyyy HH:mm")
                        : "—"}
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
    </div>
  );
}
