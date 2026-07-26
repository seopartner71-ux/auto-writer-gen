import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Client } from "./types";

interface DocumentType {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  ui_priority: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clients: Client[];
  preselectedClientId?: string;
}

export function EcosystemWizard({ open, onOpenChange, clients, preselectedClientId }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [clientId, setClientId] = useState<string>("");
  const [articleId, setArticleId] = useState<string>("");
  const [articles, setArticles] = useState<any[]>([]);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setClientId(preselectedClientId || "");
    setArticleId("");
    setSelectedTypeIds([]);
  }, [open, preselectedClientId]);

  useEffect(() => {
    if (!open) return;
    void supabase
      .from("document_types")
      .select("id,slug,name,description,ui_priority")
      .eq("is_active", true)
      .eq("category", "pdf")
      .order("ui_priority", { ascending: false })
      .then(({ data }) => {
        const list = (data || []) as DocumentType[];
        setDocumentTypes(list);
        // Preselect all by default (mirrors previous UX where MVP_FORMATS were preselected).
        setSelectedTypeIds(list.map(d => d.id));
      });
  }, [open]);

  useEffect(() => {
    if (!clientId) { setArticles([]); return; }
    void supabase.from("articles").select("id,title,created_at").eq("client_id", clientId).order("created_at", { ascending: false })
      .then(({ data }) => setArticles(data || []));
  }, [clientId]);

  const toggleType = (id: string) => {
    setSelectedTypeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleCreate = async () => {
    if (!user || !clientId || !articleId) return;
    const chosen = documentTypes.filter(d => selectedTypeIds.includes(d.id));
    if (chosen.length === 0) return;
    setSaving(true);
    try {
      const chosenSlugs = chosen.map(d => d.slug);
      const { data, error } = await supabase.from("content_ecosystems").insert({
        user_id: user.id,
        client_id: clientId,
        source_article_id: articleId,
        status: "draft",
        formats_requested: chosenSlugs,
        formats_completed: [],
      }).select().single();
      if (error) throw error;

      // Seed format rows
      await supabase.from("ecosystem_formats").insert(
        chosen.map(d => ({
          ecosystem_id: data.id,
          format_type: d.slug,
          document_type_id: d.id,
          status: "pending",
        }))
      );

      try {
        await supabase.from("activation_events").insert({
          user_id: user.id,
          event_name: "ecosystem_creation_completed",
          session_id: "app",
          metadata: { ecosystem_id: data.id, client_id: clientId, document_type_slugs: chosenSlugs },
        });
      } catch { /* noop */ }

      toast.success("Экосистема создана");
      onOpenChange(false);
      navigate(`/content-ecosystem/${data.id}`);
    } catch (e: any) {
      toast.error(e.message || "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Развернуть экосистему · шаг {step}/4</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Выберите клиента</p>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="Клиент" /></SelectTrigger>
              <SelectContent>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Выберите базовую статью</p>
            {articles.length === 0 ? (
              <div className="p-4 border rounded text-sm">
                У этого клиента ещё нет статей.
                <Button className="mt-2" size="sm" onClick={() => { onOpenChange(false); navigate(`/articles?client_id=${clientId}`); }}>
                  Создать статью для клиента
                </Button>
              </div>
            ) : (
              <Select value={articleId} onValueChange={setArticleId}>
                <SelectTrigger><SelectValue placeholder="Статья" /></SelectTrigger>
                <SelectContent>
                  {articles.map(a => <SelectItem key={a.id} value={a.id}>{a.title || "Без названия"}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Типы документов</p>
            {documentTypes.length === 0 ? (
              <div className="p-3 border border-dashed rounded text-sm text-muted-foreground">
                Нет доступных типов документов.
              </div>
            ) : documentTypes.map(d => (
              <label key={d.id} className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-accent">
                <Checkbox
                  checked={selectedTypeIds.includes(d.id)}
                  onCheckedChange={() => toggleType(d.id)}
                  className="mt-0.5"
                />
                <div className="space-y-1">
                  <div className="text-sm font-medium">{d.name}</div>
                  {d.description && (
                    <div className="text-xs text-muted-foreground">{d.description}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">Подтвердите развёртывание:</p>
            <div className="p-3 border rounded space-y-1">
              <div>Клиент: <strong>{clients.find(c => c.id === clientId)?.name}</strong></div>
              <div>Статья: <strong>{articles.find(a => a.id === articleId)?.title || "-"}</strong></div>
              <div>Типов документов: <strong>{selectedTypeIds.length}</strong></div>
            </div>
            <p className="text-xs text-muted-foreground">Экосистема будет создана; генерация запускается вручную из карточки документа.</p>
          </div>
        )}

        <DialogFooter>
          {step > 1 && <Button variant="outline" onClick={() => setStep(s => s - 1)}>Назад</Button>}
          {step < 4 && (
            <Button
              onClick={() => setStep(s => s + 1)}
              disabled={(step === 1 && !clientId) || (step === 2 && !articleId) || (step === 3 && selectedTypeIds.length === 0)}
            >Далее</Button>
          )}
          {step === 4 && (
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Развернуть экосистему
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}