import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Client, FORMAT_LABELS, MVP_FORMATS, GUIDE_FORMATS, FormatType } from "./types";

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
  const [selectedFormats, setSelectedFormats] = useState<FormatType[]>([...MVP_FORMATS]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setClientId(preselectedClientId || "");
    setArticleId("");
    setSelectedFormats([...MVP_FORMATS]);
  }, [open, preselectedClientId]);

  useEffect(() => {
    if (!clientId) { setArticles([]); return; }
    void supabase.from("articles").select("id,title,created_at").eq("client_id", clientId).order("created_at", { ascending: false })
      .then(({ data }) => setArticles(data || []));
  }, [clientId]);

  const toggle = (f: FormatType) => {
    setSelectedFormats(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  };

  const handleCreate = async () => {
    if (!user || !clientId || !articleId) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.from("content_ecosystems").insert({
        user_id: user.id,
        client_id: clientId,
        source_article_id: articleId,
        status: "draft",
        formats_requested: selectedFormats,
        formats_completed: [],
      }).select().single();
      if (error) throw error;

      // Seed format rows
      await supabase.from("ecosystem_formats").insert(
        selectedFormats.map(f => ({ ecosystem_id: data.id, format_type: f, status: "pending" }))
      );

      try {
        await supabase.from("activation_events").insert({
          user_id: user.id,
          event_name: "ecosystem_creation_completed",
          session_id: "app",
          metadata: { ecosystem_id: data.id, client_id: clientId, formats: selectedFormats },
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
            <p className="text-sm text-muted-foreground">Форматы для генерации</p>
            {MVP_FORMATS.map(f => (
              <label key={f} className="flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-accent">
                <Checkbox checked={selectedFormats.includes(f)} onCheckedChange={() => toggle(f)} />
                <span className="text-sm">{FORMAT_LABELS[f].ru}</span>
              </label>
            ))}
            {GUIDE_FORMATS.map(f => (
              <div key={f} className="flex items-center justify-between p-2 border border-dashed rounded text-sm text-muted-foreground">
                <span>{FORMAT_LABELS[f].ru}</span>
                <Badge variant="outline">Инструкция</Badge>
              </div>
            ))}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">Подтвердите развёртывание:</p>
            <div className="p-3 border rounded space-y-1">
              <div>Клиент: <strong>{clients.find(c => c.id === clientId)?.name}</strong></div>
              <div>Статья: <strong>{articles.find(a => a.id === articleId)?.title || "-"}</strong></div>
              <div>Форматов: <strong>{selectedFormats.length}</strong></div>
            </div>
            <p className="text-xs text-muted-foreground">Генерация форматов появится в следующих обновлениях. Сейчас создастся структура экосистемы.</p>
          </div>
        )}

        <DialogFooter>
          {step > 1 && <Button variant="outline" onClick={() => setStep(s => s - 1)}>Назад</Button>}
          {step < 4 && (
            <Button
              onClick={() => setStep(s => s + 1)}
              disabled={(step === 1 && !clientId) || (step === 2 && !articleId) || (step === 3 && selectedFormats.length === 0)}
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