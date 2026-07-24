import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/shared/components/ConfirmDialog";
import { toast } from "sonner";
import { trackActivation } from "@/shared/utils/activationTracking";
import { Client } from "./types";

type Filter = "all" | "unassigned" | "other_client";

interface ArticleRow {
  id: string;
  title: string | null;
  content: string | null;
  main_keyword: string | null;
  client_id: string | null;
  created_at: string;
}

interface ClientLite {
  id: string;
  name: string;
  brand_color: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  client: Client;
  onLinked: () => void;
}

export function LinkExistingArticleModal({ open, onOpenChange, client, onLinked }: Props) {
  const confirm = useConfirm();
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [clientsMap, setClientsMap] = useState<Record<string, ClientLite>>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("unassigned");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    void (async () => {
      setLoading(true);
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) { setLoading(false); return; }
      const { data } = await supabase
        .from("articles")
        .select("id,title,content,main_keyword,client_id,created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(500);
      const rows = (data || []) as unknown as ArticleRow[];
      setArticles(rows);
      const otherIds = Array.from(new Set(rows.map(r => r.client_id).filter((v): v is string => !!v && v !== client.id)));
      if (otherIds.length) {
        const { data: cs } = await supabase.from("clients").select("id,name,brand_color").in("id", otherIds);
        const map: Record<string, ClientLite> = {};
        (cs || []).forEach((c: any) => { map[c.id] = c; });
        setClientsMap(map);
      } else setClientsMap({});
      setLoading(false);
    })();
  }, [open, client.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return articles.filter(a => {
      if (a.client_id === client.id) return false;
      if (filter === "unassigned" && a.client_id) return false;
      if (filter === "other_client" && !a.client_id) return false;
      if (q) {
        const hay = `${a.title || ""} ${a.main_keyword || ""} ${a.content || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [articles, search, filter, client.id]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const linkOne = async (a: ArticleRow) => {
    const previous = a.client_id;
    if (previous && previous !== client.id) {
      const other = clientsMap[previous]?.name || "другому клиенту";
      const ok = await confirm({
        title: "Переприкрепить статью?",
        description: `Статья сейчас привязана к клиенту "${other}". Переприкрепить к "${client.name}"?`,
        confirmText: "Переприкрепить",
      });
      if (!ok) return;
    }
    const { error } = await supabase.from("articles").update({ client_id: client.id }).eq("id", a.id);
    if (error) { toast.error(error.message); return; }
    void trackActivation(previous ? "article_relinked" : "article_linked_to_client", {
      article_id: a.id,
      client_id: client.id,
      from_client_id: previous,
      to_client_id: client.id,
      source: "existing",
    });
    toast.success(`Статья привязана к клиенту ${client.name}`);
    onLinked();
    onOpenChange(false);
  };

  const linkBulk = async () => {
    if (!selected.size) return;
    const ids = Array.from(selected);
    const selectedRows = articles.filter(a => ids.includes(a.id));
    const hasOther = selectedRows.some(a => a.client_id && a.client_id !== client.id);
    if (hasOther) {
      const ok = await confirm({
        title: "Переприкрепить статьи?",
        description: `Некоторые статьи уже привязаны к другим клиентам. Переприкрепить все ${ids.length} к "${client.name}"?`,
        confirmText: "Переприкрепить",
      });
      if (!ok) return;
    }
    setLinking(true);
    const { error } = await supabase.from("articles").update({ client_id: client.id }).in("id", ids);
    setLinking(false);
    if (error) { toast.error(error.message); return; }
    selectedRows.forEach(a => {
      void trackActivation(a.client_id && a.client_id !== client.id ? "article_relinked" : "article_linked_to_client", {
        article_id: a.id,
        client_id: client.id,
        from_client_id: a.client_id,
        to_client_id: client.id,
        source: "bulk",
      });
    });
    toast.success(`Привязано статей: ${ids.length}`);
    onLinked();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Привязать статью к клиенту {client.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Поиск по ключевому слову, заголовку или содержанию..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex gap-2 text-sm">
            <span className="text-muted-foreground self-center">Показать:</span>
            {([
              ["unassigned", "Только без клиента"],
              ["all", "Все статьи"],
              ["other_client", "Привязанные к другим"],
            ] as [Filter, string][]).map(([v, l]) => (
              <Button key={v} size="sm" variant={filter === v ? "default" : "outline"} onClick={() => setFilter(v)}>
                {l}
              </Button>
            ))}
          </div>
        </div>
        <ScrollArea className="flex-1 -mx-6 px-6 mt-2">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Загрузка...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Ничего не найдено.</p>
          ) : (
            <div className="space-y-2 py-1">
              {filtered.map(a => {
                const other = a.client_id && a.client_id !== client.id ? clientsMap[a.client_id] : null;
                const isChecked = selected.has(a.id);
                return (
                  <div key={a.id} className="flex gap-3 p-3 border rounded hover:bg-accent/50 transition-colors">
                    <Checkbox checked={isChecked} onCheckedChange={() => toggleSelect(a.id)} className="mt-1" />
                    <button
                      type="button"
                      onClick={() => linkOne(a)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-sm truncate">{a.title || "Без названия"}</div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {new Date(a.created_at).toLocaleDateString("ru-RU")}
                        </span>
                      </div>
                      {a.content && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {a.content.replace(/[#*`>_-]/g, "").slice(0, 100)}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {a.main_keyword && <Badge variant="outline" className="text-xs">{a.main_keyword}</Badge>}
                        {other && (
                          <Badge
                            className="text-xs text-white"
                            style={{ background: other.brand_color || "#666" }}
                          >
                            {other.name}
                          </Badge>
                        )}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
        {selected.size > 0 && (
          <div className="border-t pt-3 flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Выбрано: {selected.size}</span>
            <Button onClick={linkBulk} disabled={linking}>
              {linking ? "Привязка..." : `Привязать выбранные (${selected.size})`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}