import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, Trash2, Check, FileText, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useI18n } from "@/shared/hooks/useI18n";
import { QualityBadgeIcon } from "@/components/article/QualityCheckPanel";
import { AutoQualityBadge } from "@/components/article/AutoQualityBadge";
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

export default function MyArticlesPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ["my-articles-list"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, content, created_at, status, quality_badge, quality_status, ai_score, burstiness_score, burstiness_status, keyword_density, keyword_density_status")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

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
                    className="border-border cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() => navigate(`/articles?edit=${article.id}`)}
                  >
                    <TableCell className="font-mono text-muted-foreground">
                      {index + 1}
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <TooltipProvider>
                        {(article as any).quality_status ? (
                          <AutoQualityBadge
                            articleId={article.id}
                            initial={{
                              quality_status: (article as any).quality_status,
                              ai_score: (article as any).ai_score,
                              burstiness_score: (article as any).burstiness_score,
                              burstiness_status: (article as any).burstiness_status,
                              keyword_density: (article as any).keyword_density,
                              keyword_density_status: (article as any).keyword_density_status,
                            }}
                          />
                        ) : (
                          <QualityBadgeIcon badge={(article as any).quality_badge} />
                        )}
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
