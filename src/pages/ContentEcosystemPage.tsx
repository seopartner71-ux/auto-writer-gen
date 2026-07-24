import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Boxes, MoreVertical, Lock, ArrowUpRight, Archive, Pencil, Eye, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Client, ContentEcosystem, limitsForPlan } from "@/features/content-ecosystem/types";
import { ClientFormDialog } from "@/features/content-ecosystem/ClientFormDialog";
import { ClientDetailsDialog } from "@/features/content-ecosystem/ClientDetailsDialog";
import { EcosystemWizard } from "@/features/content-ecosystem/EcosystemWizard";

export default function ContentEcosystemPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const limits = limitsForPlan(profile?.plan);

  const [formOpen, setFormOpen] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardClientId, setWizardClientId] = useState<string | undefined>();
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [deleteEco, setDeleteEco] = useState<(ContentEcosystem & { articles?: any; clients?: any }) | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;
    void supabase.from("activation_events").insert({
      user_id: user.id,
      event_name: "content_ecosystem_screen_opened",
      session_id: "app",
      metadata: { plan: profile?.plan },
    }).then(() => {}, () => {});
    if (limits.clientLimit === 0) {
      void supabase.from("activation_events").insert({
        user_id: user.id, event_name: "tariff_lock_shown_nano", session_id: "app", metadata: {},
      });
    }
  }, [user, profile?.plan]);

  const { data: clients = [] } = useQuery({
    queryKey: ["ce-clients", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("archived", false).order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Client[];
    },
    enabled: !!user,
  });

  const { data: ecosystems = [] } = useQuery({
    queryKey: ["ce-ecosystems", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("content_ecosystems").select("*, articles(title), clients(name, logo_url, brand_color)").order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as (ContentEcosystem & { articles?: any; clients?: any })[];
    },
    enabled: !!user,
  });

  const monthlyFormatCount = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return ecosystems.reduce((acc, e) => {
      const list = Array.isArray(e.formats_completed) ? e.formats_completed : [];
      return acc + (new Date(e.updated_at) >= monthStart ? list.length : 0);
    }, 0);
  }, [ecosystems]);

  const clientLimit = limits.clientLimit;
  const clientCount = clients.length;
  const clientLimitReached = clientLimit !== -1 && clientCount >= clientLimit;

  const openCreateClient = () => {
    if (clientLimit === 0) return;
    if (clientLimitReached) {
      toast.error(`Достигнут лимит клиентов на вашем тарифе (${clientLimit}). Апгрейд →`, {
        action: { label: "Апгрейд", onClick: () => navigate("/pricing") },
      });
      return;
    }
    setEditClient(null);
    setFormOpen(true);
  };

  const openEcosystemWizard = (clientId?: string) => {
    if (!limits.ecosystemsEnabled) {
      setUpsellOpen(true);
      void supabase.from("activation_events").insert({
        user_id: user!.id, event_name: "ecosystem_upsell_shown", session_id: "app",
        metadata: { plan: profile?.plan },
      });
      return;
    }
    if (clients.length === 0) {
      toast.error("Сначала добавьте клиента");
      return;
    }
    setWizardClientId(clientId);
    setWizardOpen(true);
    void supabase.from("activation_events").insert({
      user_id: user!.id, event_name: "ecosystem_creation_started", session_id: "app", metadata: {},
    });
  };

  const archiveClient = async (c: Client) => {
    const { error } = await supabase.from("clients").update({ archived: true }).eq("id", c.id);
    if (error) { toast.error(error.message); return; }
    toast.success("В архиве");
    qc.invalidateQueries({ queryKey: ["ce-clients"] });
  };

  const confirmDeleteEcosystem = async () => {
    if (!deleteEco) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-ecosystem", {
        body: { ecosystem_id: deleteEco.id },
      });
      if (error) throw new Error(error.message || "delete failed");
      if (data && (data as any).error) throw new Error((data as any).error);
      toast.success("Экосистема удалена");
      setDeleteEco(null);
      qc.invalidateQueries({ queryKey: ["ce-ecosystems"] });
    } catch (e: any) {
      toast.error(`Не удалось удалить: ${e?.message || "ошибка"}`);
    } finally {
      setDeleting(false);
    }
  };

  // NANO tariff lock
  if (clientLimit === 0) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Boxes className="h-8 w-8 text-primary" /> Контентная экосистема
          </h1>
          <p className="text-muted-foreground">
            Один экспертный материал - девять форматов - десятки точек контакта с аудиторией
          </p>
        </header>
        <Card className="p-8 space-y-4 border-dashed">
          <h2 className="text-2xl font-semibold">Контентная экосистема - от одной статьи до девяти форматов</h2>
          <p className="text-muted-foreground">
            Работайте с клиентами как агентство. Каждая статья превращается в 9 деривативных форматов: от статьи на VC.ru до брендированного PDF и презентации.
          </p>
          <ul className="space-y-2 text-sm">
            <li>- Персональные бренды и профили клиентов</li>
            <li>- PDF-гайды и брендированные лид-магниты</li>
            <li>- Автоматические презентации по вашей теме</li>
            <li>- Чек-листы для лидогенерации</li>
            <li>- Публикации на VC.ru, Дзен, Google Docs</li>
            <li>- UTM-разметка и трекинг по каждому клиенту</li>
          </ul>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button onClick={() => navigate("/pricing")}>Апгрейд до PRO для управления клиентами</Button>
            <Button variant="outline" onClick={() => navigate("/pricing")}>Апгрейд до FACTORY для полного функционала</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Boxes className="h-8 w-8 text-primary" /> Контентная экосистема
        </h1>
        <p className="text-muted-foreground">
          Один экспертный материал - девять форматов - десятки точек контакта с аудиторией
        </p>
      </header>

      {clients.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatTile label="Активных клиентов" value={`${clientCount}${clientLimit === -1 ? "" : ` / ${clientLimit}`}`} />
          <StatTile label="Экосистем в работе" value={String(ecosystems.length)} />
          <StatTile label="Форматов сгенерировано в этом месяце" value={String(monthlyFormatCount)} />
        </section>
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Мои клиенты</h2>
          <Button size="sm" onClick={openCreateClient}>
            <Plus className="h-4 w-4 mr-2" /> Добавить клиента
          </Button>
        </div>

        {clients.length === 0 ? (
          <Card className="p-10 text-center space-y-3 border-dashed">
            <Boxes className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Добавьте первого клиента, чтобы начать работу с контентными экосистемами
            </p>
            <Button onClick={openCreateClient}><Plus className="h-4 w-4 mr-2" /> Добавить клиента</Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {clients.map(c => (
              <ClientCard
                key={c.id}
                client={c}
                articleCount={0}
                ecosystemCount={ecosystems.filter(e => e.client_id === c.id).length}
                onOpen={() => { setActiveClient(c); setDetailsOpen(true); void supabase.from("activation_events").insert({ user_id: user!.id, event_name: "client_details_opened", session_id: "app", metadata: { client_id: c.id } }); }}
                onEdit={() => { setEditClient(c); setFormOpen(true); }}
                onArchive={() => archiveClient(c)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Мои экосистемы</h2>
          <Button size="sm" onClick={() => openEcosystemWizard()} disabled={clients.length === 0 && limits.ecosystemsEnabled}>
            {!limits.ecosystemsEnabled && <Lock className="h-4 w-4 mr-2" />}
            <Plus className="h-4 w-4 mr-2" /> Развернуть новую экосистему
          </Button>
        </div>

        {ecosystems.length === 0 ? (
          <Card className="p-8 text-center border-dashed">
            <p className="text-sm text-muted-foreground">
              Экосистемы появятся здесь после того как вы развернёте первую. Нужна готовая статья с привязкой к клиенту.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ecosystems.map(e => (
              <Card key={e.id} className="p-4 cursor-pointer hover:border-primary transition-colors"
                onClick={() => navigate(`/content-ecosystem/${e.id}`)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{e.articles?.title || "Без базовой статьи"}</p>
                    <div className="flex items-center gap-2 mt-2">
                      {e.clients?.logo_url ? (
                        <img src={e.clients.logo_url} className="h-5 w-5 rounded" alt="" />
                      ) : (
                        <div className="h-5 w-5 rounded" style={{ background: e.clients?.brand_color || "#7C3AED" }} />
                      )}
                      <span className="text-xs text-muted-foreground">{e.clients?.name || "-"}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={e.status === "completed" ? "default" : "outline"}>{e.status}</Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(ev) => ev.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(ev) => { ev.stopPropagation(); navigate(`/content-ecosystem/${e.id}`); }}>
                          <Eye className="h-4 w-4 mr-2" /> Открыть
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(ev) => { ev.stopPropagation(); setDeleteEco(e); }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Удалить
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Прогресс: {(e.formats_completed || []).length}/{(e.formats_requested || []).length}</span>
                  <span>{formatCreatedAt(e.created_at)}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <ClientFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        client={editClient}
        onSaved={() => qc.invalidateQueries({ queryKey: ["ce-clients"] })}
      />

      <ClientDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        client={activeClient}
        onEdit={(c) => { setDetailsOpen(false); setEditClient(c); setFormOpen(true); }}
        onArchived={() => qc.invalidateQueries({ queryKey: ["ce-clients"] })}
        canCreateEcosystem={limits.ecosystemsEnabled}
        onCreateEcosystem={() => { setDetailsOpen(false); openEcosystemWizard(activeClient?.id); }}
      />

      <EcosystemWizard
        open={wizardOpen}
        onOpenChange={(v) => { setWizardOpen(v); if (!v) qc.invalidateQueries({ queryKey: ["ce-ecosystems"] }); }}
        clients={clients}
        preselectedClientId={wizardClientId}
      />

      <Dialog open={upsellOpen} onOpenChange={setUpsellOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Разворачивание Контентных экосистем доступно с тарифа FACTORY</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            На вашем тарифе доступно управление клиентами, но разворачивание экосистемы в 9 форматов - только с FACTORY.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpsellOpen(false)}>Позже</Button>
            <Button onClick={() => navigate("/pricing")}>Апгрейд <ArrowUpRight className="h-4 w-4 ml-1" /></Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteEco} onOpenChange={(v) => { if (!v && !deleting) setDeleteEco(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить экосистему?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Экосистема "{deleteEco?.articles?.title || "без названия"}" будет удалена вместе со всеми сгенерированными форматами (чек-лист, будущие Дзен/VC.ru/презентация и т.д.) и связанными PDF-файлами. Действие нельзя отменить.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteEco(null)} disabled={deleting}>Отмена</Button>
            <Button
              onClick={confirmDeleteEcosystem}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Удаляем...</>) : "Удалить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  const hhmm = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `Создано сегодня, ${hhmm}`;
  if (diffDays === 1) return `Создано вчера, ${hhmm}`;
  return `Создано ${d.toLocaleDateString("ru-RU")}`;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </Card>
  );
}

function ClientCard({
  client, articleCount, ecosystemCount, onOpen, onEdit, onArchive,
}: {
  client: Client;
  articleCount: number;
  ecosystemCount: number;
  onOpen: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const initials = client.name.slice(0, 2).toUpperCase();
  return (
    <Card className="p-4 hover:border-primary transition-colors cursor-pointer" onClick={onOpen}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {client.logo_url ? (
            <img src={client.logo_url} alt={client.name} className="h-10 w-10 rounded object-cover" />
          ) : (
            <div className="h-10 w-10 rounded flex items-center justify-center text-white text-sm font-bold shrink-0"
              style={{ background: client.brand_color }}>{initials}</div>
          )}
          <div className="min-w-0">
            <p className="font-medium truncate">{client.name}</p>
            {client.domain && <p className="text-xs text-muted-foreground truncate">{client.domain}</p>}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}><Pencil className="h-4 w-4 mr-2" /> Редактировать</DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onArchive(); }}><Archive className="h-4 w-4 mr-2" /> Архивировать</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
        <span>{articleCount} статей</span>
        <span>·</span>
        <span>{ecosystemCount} экосистем</span>
      </div>
    </Card>
  );
}