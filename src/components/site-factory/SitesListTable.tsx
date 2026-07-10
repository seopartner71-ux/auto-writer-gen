import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, Loader2, RefreshCw, Trash2, Globe } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

interface SiteRow {
  id: string;
  name: string;
  domain: string | null;
  hosting_platform: string | null;
  created_at: string;
  auto_weekly_post?: boolean | null;
}

function pagesHost(domain: string | null): string | null {
  if (!domain) return null;
  return domain.replace(/^https?:\/\//, "").replace(/\/$/, "") || null;
}

export function SitesListTable() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { lang } = useI18n();
  const isRu = lang === "ru";
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, domain, hosting_platform, created_at, auto_weekly_post")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: isRu ? "Ошибка загрузки сайтов" : "Failed to load sites", description: error.message, variant: "destructive" });
    }
    setRows((data || []) as SiteRow[]);
    setSelected(new Set());
    setLoading(false);
  };

  const toggleAuto = async (row: SiteRow) => {
    const next = !row.auto_weekly_post;
    setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, auto_weekly_post: next } : r));
    const { error } = await supabase
      .from("projects")
      .update({ auto_weekly_post: next })
      .eq("id", row.id);
    if (error) {
      setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, auto_weekly_post: !next } : r));
      toast({ title: isRu ? "Не удалось сохранить" : "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: isRu
          ? (next ? "Автопубликация включена" : "Автопубликация выключена")
          : (next ? "Auto-publish enabled" : "Auto-publish disabled"),
        description: next
          ? (isRu ? "Новая статья будет публиковаться раз в 7 дней в рабочие часы." : "A new article will be published every 7 days during working hours.")
          : undefined,
      });
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const allChecked = rows.length > 0 && selected.size === rows.length;
  const someChecked = selected.size > 0 && selected.size < rows.length;

  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const deleteOne = async (row: SiteRow): Promise<boolean> => {
    setDeletingIds((p) => { const n = new Set(p); n.add(row.id); return n; });
    try {
      const { data, error } = await supabase.functions.invoke("delete-cloudflare-site", {
        body: { project_id: row.id },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({
        title: isRu ? "Сайт удалён" : "Site deleted",
        description: data?.deleted_cf
          ? (isRu
              ? `Cloudflare-проект и ${data?.articles_deleted ?? 0} статей удалены`
              : `Cloudflare project and ${data?.articles_deleted ?? 0} articles deleted`)
          : (isRu
              ? `Запись удалена. ${data?.cf_message || "Cloudflare-проект пропущен."}`
              : `Record deleted. ${data?.cf_message || "Cloudflare project skipped."}`),
      });
      return true;
    } catch (e: any) {
      toast({ title: isRu ? "Ошибка удаления" : "Delete failed", description: e?.message || String(e), variant: "destructive" });
      return false;
    } finally {
      setDeletingIds((p) => { const n = new Set(p); n.delete(row.id); return n; });
    }
  };

  const handleBulkDelete = async () => {
    setBulkOpen(false);
    const targets = rows.filter((r) => selected.has(r.id));
    let ok = 0, fail = 0;
    for (const r of targets) {
      const success = await deleteOne(r);
      if (success) ok++; else fail++;
    }
    await load();
    toast({
      title: isRu ? "Массовое удаление завершено" : "Bulk delete finished",
      description: isRu
        ? `Удалено: ${ok}${fail ? `, ошибок: ${fail}` : ""}`
        : `Deleted: ${ok}${fail ? `, failed: ${fail}` : ""}`,
      variant: fail ? "destructive" : "default",
    });
  };

  const sites = useMemo(() => rows, [rows]);

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            {isRu ? "Мои сайты" : "My sites"} <span className="text-xs text-muted-foreground font-normal">({rows.length})</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {isRu
              ? "Удаление сайта стирает Cloudflare Pages-проект, запись и все его статьи."
              : "Deleting a site removes its Cloudflare Pages project, record and every article."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={selected.size === 0}
                className="gap-2"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isRu ? "Удалить выбранные" : "Delete selected"} {selected.size > 0 && `(${selected.size})`}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{isRu ? "Удалить выбранные сайты?" : "Delete selected sites?"}</AlertDialogTitle>
                <AlertDialogDescription>
                  {isRu
                    ? `Будет удалено ${selected.size} сайт(ов) с Cloudflare Pages, их записи и все связанные статьи. Действие необратимо.`
                    : `${selected.size} site(s) will be removed from Cloudflare Pages along with their records and all related articles. This cannot be undone.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{isRu ? "Отмена" : "Cancel"}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleBulkDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isRu ? "Удалить" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {isRu ? "Обновить" : "Refresh"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : sites.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">
            {isRu ? "Сайтов пока нет. Создайте первую сетку выше." : "No sites yet. Create your first grid above."}
          </div>
        ) : (
          <div className="rounded-md border border-border overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <Checkbox
                      checked={allChecked || (someChecked ? "indeterminate" : false)}
                      onCheckedChange={toggleAll}
                      aria-label={isRu ? "Выбрать все" : "Select all"}
                    />
                  </th>
                  <th className="text-left px-3 py-2 font-medium">{isRu ? "Название" : "Name"}</th>
                  <th className="text-left px-3 py-2 font-medium">{isRu ? "Домен" : "Domain"}</th>
                  <th className="text-left px-3 py-2 font-medium">{isRu ? "Хостинг" : "Hosting"}</th>
                  <th className="text-left px-3 py-2 font-medium">{isRu ? "Создан" : "Created"}</th>
                  <th className="text-left px-3 py-2 font-medium">{isRu ? "Авто 7д" : "Auto 7d"}</th>
                  <th className="text-right px-3 py-2 font-medium">{isRu ? "Действия" : "Actions"}</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => {
                  const host = pagesHost(s.domain);
                  const url = host ? `https://${host}` : null;
                  const isDeleting = deletingIds.has(s.id);
                  return (
                    <tr key={s.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={selected.has(s.id)}
                          onCheckedChange={() => toggleOne(s.id)}
                          aria-label={(isRu ? "Выбрать " : "Select ") + s.name}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium truncate max-w-[200px]">{s.name}</td>
                      <td className="px-3 py-2">
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer"
                             className="text-primary hover:underline inline-flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" />
                            <span className="truncate max-w-[200px]">{host}</span>
                          </a>
                        ) : <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[10px]">
                          {s.hosting_platform || "-"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {new Date(s.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2">
                        <Switch
                          checked={!!s.auto_weekly_post}
                          onCheckedChange={() => toggleAuto(s)}
                          aria-label={isRu ? "Автопубликация раз в 7 дней" : "Auto-publish every 7 days"}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" disabled={isDeleting}
                                    className="h-7 w-7 text-destructive hover:text-destructive">
                              {isDeleting
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Trash2 className="h-3.5 w-3.5" />}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {isRu ? `Удалить сайт ${host || s.name}?` : `Delete site ${host || s.name}?`}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {isRu
                                  ? "Cloudflare Pages-проект, запись в базе и все статьи этого сайта будут удалены безвозвратно."
                                  : "The Cloudflare Pages project, database record and every article of this site will be permanently deleted."}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{isRu ? "Отмена" : "Cancel"}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={async () => { const ok = await deleteOne(s); if (ok) load(); }}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {isRu ? "Удалить" : "Delete"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}