import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Archive, Pencil, Plus, Link2, MoreVertical, ExternalLink, Unlink, FileText, Copy } from "lucide-react";
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
  const [documents, setDocuments] = useState<any[]>([]);
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
      const ecoIds = (e || []).map((x: any) => x.id);
      if (ecoIds.length) {
        const { data: fmts } = await supabase
          .from("ecosystem_formats")
          .select("id, format_type, pdf_url, generated_at, ecosystem_id, status, document_type_id, document_types(name)")
          .in("ecosystem_id", ecoIds)
          .order("generated_at", { ascending: false });
        const fmtIds = (fmts || []).map((f: any) => f.id);
        let deploys: any[] = [];
        if (fmtIds.length) {
          const { data: d } = await supabase
            .from("format_deployments")
            .select("ecosystem_format_id, platform, published_url, deployed_at, status")
            .in("ecosystem_format_id", fmtIds)
            .eq("status", "success");
          deploys = d || [];
        }
        const docs = (fmts || []).flatMap((f: any) => {
          const rows: any[] = [];
          const typeName = f.document_types?.name || f.format_type;
          if (f.pdf_url) rows.push({ key: `${f.id}-pdf`, format: f.format_type, typeName, kind: "PDF", url: f.pdf_url, date: f.generated_at });
          deploys.filter(d => d.ecosystem_format_id === f.id && d.published_url).forEach(d => {
            rows.push({ key: `${f.id}-${d.platform}`, format: f.format_type, typeName, kind: d.platform, url: d.published_url, date: d.deployed_at });
          });
          return rows;
        });
        setDocuments(docs);
      } else {
        setDocuments([]);
      }
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
                <TabsTrigger value="documents">Документы ({documents.length})</TabsTrigger>
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
              <TabsContent value="documents" className="mt-4 space-y-2">
                {documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Пока нет размещённых документов.</p>
                ) : documents.map(d => (
                  <div key={d.key} className="flex items-center gap-2 p-2 border rounded text-sm hover:bg-accent">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{d.typeName}</div>
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground truncate block hover:text-primary">
                        {d.url}
                      </a>
                    </div>
                    <Badge variant="outline" className="shrink-0">{d.kind}</Badge>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { navigator.clipboard.writeText(d.url); toast.success("Ссылка скопирована"); }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" asChild>
                      <a href={d.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /></a>
                    </Button>
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