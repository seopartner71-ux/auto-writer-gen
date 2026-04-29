import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, Loader2, RefreshCw, Trash2, Globe } from "lucide-react";

interface SiteRow {
  id: string;
  name: string;
  domain: string | null;
  hosting_platform: string | null;
  created_at: string;
}

function pagesHost(domain: string | null): string | null {
  if (!domain) return null;
  return domain.replace(/^https?:\/\//, "").replace(/\/$/, "") || null;
}

export function SitesListTable() {
  const { user } = useAuth();
  const { toast } = useToast();
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
      .select("id, name, domain, hosting_platform, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Ошибка загрузки сайтов", description: error.message, variant: "destructive" });
    }
    setRows((data || []) as SiteRow[]);
    setSelected(new Set());
    setLoading(false);
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
        title: "Сайт удалён",
        description: data?.deleted_cf
          ? `Cloudflare-проект и ${data?.articles_deleted ?? 0} статей удалены`
          : `Запись удалена. ${data?.cf_message || "Cloudflare-проект пропущен."}`,
      });
      return true;
    } catch (e: any) {
      toast({ title: "Ошибка удаления", description: e?.message || String(e), variant: "destructive" });
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
      title: "Массовое удаление завершено",
      description: `Удалено: ${ok}${fail ? `, ошибок: ${fail}` : ""}`,
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
            Мои сайты <span className="text-xs text-muted-foreground font-normal">({rows.length})</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Удаление сайта стирает Cloudflare Pages-проект, запись и все его статьи.
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
                Удалить выбранные {selected.size > 0 && `(${selected.size})`}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Удалить выбранные сайты?</AlertDialogTitle>
                <AlertDialogDescription>
                  Будет удалено {selected.size} сайт(ов) с Cloudflare Pages, их записи и все связанные статьи. Действие необратимо.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleBulkDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Удалить
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Обновить
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : sites.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">
            Сайтов пока нет. Создайте первую сетку выше.
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
                      aria-label="Выбрать все"
                    />
                  </th>
                  <th className="text-left px-3 py-2 font-medium">Название</th>
                  <th className="text-left px-3 py-2 font-medium">Домен</th>
                  <th className="text-left px-3 py-2 font-medium">Хостинг</th>
                  <th className="text-left px-3 py-2 font-medium">Создан</th>
                  <th className="text-right px-3 py-2 font-medium">Действия</th>
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
                          aria-label={`Выбрать ${s.name}`}
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
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[10px]">
                          {s.hosting_platform || "—"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {new Date(s.created_at).toLocaleDateString()}
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
                                Удалить сайт {host || s.name}?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Cloudflare Pages-проект, запись в базе и все статьи этого сайта будут удалены безвозвратно.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Отмена</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={async () => { const ok = await deleteOne(s); if (ok) load(); }}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Удалить
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