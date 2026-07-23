import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Archive, Pencil, Plus } from "lucide-react";
import { Client, ContentEcosystem } from "./types";
import { toast } from "sonner";

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
  const [articles, setArticles] = useState<any[]>([]);
  const [ecosystems, setEcosystems] = useState<ContentEcosystem[]>([]);

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
  }, [open, client]);

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
                <Button size="sm" onClick={() => navigate(`/articles?client_id=${client.id}`)}>
                  <Plus className="h-4 w-4 mr-2" /> Создать статью для клиента
                </Button>
                {articles.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Пока нет статей.</p>
                ) : articles.map(a => (
                  <div key={a.id} className="flex justify-between items-center p-2 border rounded text-sm hover:bg-accent cursor-pointer"
                    onClick={() => navigate(`/articles?edit=${a.id}`)}>
                    <span className="truncate">{a.title || "Без названия"}</span>
                    <Badge variant="outline">{a.status}</Badge>
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
    </Dialog>
  );
}