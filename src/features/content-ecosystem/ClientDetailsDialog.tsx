import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Archive, Pencil, Plus, Link2, MoreVertical, ExternalLink, Unlink } from "lucide-react";
import { Client, ContentEcosystem } from "./types";
import { toast } from "sonner";
import { LinkExistingArticleModal } from "./LinkExistingArticleModal";
import { useConfirm } from "@/shared/components/ConfirmDialog";
import { trackActivation } from "@/shared/utils/activationTracking";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  client: Client | null;
  onEdit: (c: Client) => void;
  onArchived: () => void;
  canCreateEcosystem: boolean;
  onCreateEcosystem: () => void;
}

export function ClientDetailsDialog({ open, onOpenChange, client, onEdit, onArchived, canCreateEcosystem, onCreateEcosystem }: Props) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [articles, setArticles] = useState<any[]>([]);
  const [ecosystems, setEcosystems] = useState<ContentEcosystem[]>([]);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!open || !client) return;
    void (async () => {
      const [{ data: a }, { data: e }] = await Promise.all([
        supabase.from("articles").select("id,title,created_at,status").eq("client_id", client.id).order("created_at", { ascending: false }).limit(50),
        supabase.from("content_ecosystems").select("*").eq("client_id", client.id).order("created_at", { ascending: false }),
      ]);
      setArticles(a || []);
      setEcosystems((e || []) as ContentEcosystem[]);
    })();
  }, [open, client, refreshKey]);

  const handleUnlink = async (articleId: string) => {
    if (!client) return;
    const ok = await confirm({
      title: "Отвязать статью?",
      description: "Статья останется в общем списке, но перестанет отображаться у этого клиента.",
      confirmText: "Отвязать",
    });
    if (!ok) return;
    const { error } = await supabase.from("articles").update({ client_id: null }).eq("id", articleId);
    if (error) { toast.error(error.message); return; }
    void trackActivation("article_unlinked_from_client", { article_id: articleId, previous_client_id: client.id });
    toast.success("Статья отвязана от клиента");
    setRefreshKey(k => k + 1);
  };

  const handleArchive = async () => {
    if (!client) return;
    const { error } = await supabase.from("clients").update({ archived: true }).eq("id", client.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Клиент архивирован");
    onArchived();
    onOpenChange(false);
  };

  if (!client) return null;

  const initials = client.name.slice(0, 2).toUpperCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{client.name}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-6">
          <div className="space-y-3">
            {client.logo_url ? (
              <img src={client.logo_url} alt={client.name} className="w-full aspect-square rounded object-cover border" />
            ) : (
              <div className="w-full aspect-square rounded flex items-center justify-center text-2xl font-bold text-white" style={{ background: client.brand_color }}>
                {initials}
              </div>
            )}
            <div className="text-sm">
              <div className="font-medium">{client.name}</div>
              {client.domain && <div className="text-muted-foreground">{client.domain}</div>}
              <div className="text-xs text-muted-foreground mt-1">
                с {new Date(client.created_at).toLocaleDateString("ru-RU")}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button size="sm" variant="outline" onClick={() => onEdit(client)}>
                <Pencil className="h-4 w-4 mr-2" /> Редактировать
              </Button>
              <Button size="sm" variant="outline" onClick={handleArchive}>
                <Archive className="h-4 w-4 mr-2" /> Архивировать
              </Button>
            </div>
          </div>

          <div className="col-span-2">
            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Обзор</TabsTrigger>
                <TabsTrigger value="articles">Статьи ({articles.length})</TabsTrigger>
                <TabsTrigger value="ecosystems">Экосистемы ({ecosystems.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="space-y-4 mt-4">
                {client.description && (
                  <div>
                    <div className="text-xs uppercase text-muted-foreground mb-1">Описание</div>
                    <p className="text-sm">{client.description}</p>
                  </div>
                )}
                {client.expert_name && (
                  <div>
                    <div className="text-xs uppercase text-muted-foreground mb-1">Эксперт</div>
                    <p className="text-sm font-medium">{client.expert_name}</p>
                    {client.expert_bio && <p className="text-xs text-muted-foreground mt-1">{client.expert_bio}</p>}
                  </div>
                )}
                {client.brand_voice && (
                  <div>
                    <div className="text-xs uppercase text-muted-foreground mb-1">Тональность</div>
                    <p className="text-sm whitespace-pre-wrap">{client.brand_voice}</p>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="articles" className="mt-4 space-y-2">
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => navigate(`/articles?client_id=${client.id}`)}>
                    <Plus className="h-4 w-4 mr-2" /> Создать новую
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setLinkModalOpen(true)}>
                    <Link2 className="h-4 w-4 mr-2" /> Привязать существующую
                  </Button>
                </div>
                {articles.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Пока нет статей.</p>
                ) : articles.map(a => (
                  <div key={a.id} className="flex justify-between items-center p-2 border rounded text-sm hover:bg-accent gap-2">
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left truncate"
                      onClick={() => navigate(`/articles?edit=${a.id}`)}
                    >
                      {a.title || "Без названия"}
                    </button>
                    <Badge variant="outline">{a.status}</Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/articles?edit=${a.id}`)}>
                          <ExternalLink className="h-4 w-4 mr-2" /> Открыть
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleUnlink(a.id)} className="text-destructive focus:text-destructive">
                          <Unlink className="h-4 w-4 mr-2" /> Отвязать от клиента
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </TabsContent>
              <TabsContent value="ecosystems" className="mt-4 space-y-2">
                <Button size="sm" onClick={onCreateEcosystem} disabled={!canCreateEcosystem}>
                  <Plus className="h-4 w-4 mr-2" /> Развернуть экосистему
                </Button>
                {ecosystems.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Пока нет экосистем.</p>
                ) : ecosystems.map(e => (
                  <div key={e.id} className="flex justify-between items-center p-2 border rounded text-sm hover:bg-accent cursor-pointer"
                    onClick={() => navigate(`/content-ecosystem/${e.id}`)}>
                    <span>Экосистема от {new Date(e.created_at).toLocaleDateString("ru-RU")}</span>
                    <Badge>{e.status}</Badge>
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
      {client && (
        <LinkExistingArticleModal
          open={linkModalOpen}
          onOpenChange={setLinkModalOpen}
          client={client}
          onLinked={() => setRefreshKey(k => k + 1)}
        />
      )}
    </Dialog>
  );
}