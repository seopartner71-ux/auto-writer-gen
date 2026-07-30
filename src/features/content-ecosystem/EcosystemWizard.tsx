import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Paperclip, CheckCircle2 } from "lucide-react";
import { Client, getClientPages } from "./types";
import { SourceTypeCard, type ExtractedSource } from "./SourceTypeCard";

interface ReferenceSourceConfig {
  required?: boolean;
  recommended?: boolean;
  min_source_word_count?: number;
  max_source_word_count?: number;
}

interface DocumentType {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  ui_priority: number;
  reference_source_config: ReferenceSourceConfig | null;
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
  // RAG: один источник на тип документа
  const [sourceByType, setSourceByType] = useState<Record<string, ExtractedSource>>({});
  const [modeByType, setModeByType] = useState<Record<string, "none" | "url">>({});
  const [urlDraft, setUrlDraft] = useState<Record<string, string>>({});
  const [extracting, setExtracting] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setClientId(preselectedClientId || "");
    setArticleId("");
    setSelectedTypeIds([]);
    setSourceByType({});
    setModeByType({});
    setUrlDraft({});
  }, [open, preselectedClientId]);

  useEffect(() => {
    if (!open) return;
    void supabase
      .from("document_types")
      .select("id,slug,name,description,ui_priority,reference_source_config")
      .eq("is_active", true)
      .eq("category", "pdf")
      .order("ui_priority", { ascending: false })
      .then(({ data }) => {
        const list = (data || []) as unknown as DocumentType[];
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

  const ragTypes = useMemo(
    () => documentTypes.filter(d =>
      selectedTypeIds.includes(d.id) &&
      (d.reference_source_config?.recommended || d.reference_source_config?.required)
    ),
    [documentTypes, selectedTypeIds],
  );
  const hasSourcesStep = ragTypes.length > 0;
  const totalSteps = hasSourcesStep ? 5 : 4;
  const confirmStep = totalSteps;

  const clientPages = useMemo(
    () => getClientPages(clients.find(c => c.id === clientId)),
    [clients, clientId],
  );

  const requiredTypes = ragTypes.filter(d => d.reference_source_config?.required);
  const connectedCount = ragTypes.filter(d => sourceByType[d.id]).length;
  const missingRequired = requiredTypes.filter(d => !sourceByType[d.id]);
  const sourcesStepBlocked = missingRequired.length > 0;

  const sourcesStepTitle = sourcesStepBlocked
    ? `Источники данных (${missingRequired.length} из ${requiredTypes.length} обязательных не подключен)`
    : connectedCount === ragTypes.length
      ? `Источники данных (${connectedCount} из ${ragTypes.length} подключено)`
      : `Источники данных (${connectedCount} из ${ragTypes.length} подключено, опционально)`;

  const handleExtract = async (typeId: string) => {
    const url = (urlDraft[typeId] || "").trim();
    if (!url) return;
    try { new URL(url); } catch { toast.error("Некорректный URL"); return; }
    setExtracting(typeId);
    try {
      const { data, error } = await supabase.functions.invoke("extract-source-content", {
        body: { url, source_type: "client_page" },
      });
      if (error) throw error;
      if (data?.error) { toast.error(data.error); return; }
      const src: ExtractedSource = {
        url,
        title: data?.title || url,
        content: data?.content || "",
        word_count: Number(data?.word_count || 0),
        fetched_at: new Date().toISOString(),
      };
      if (data?.warning) toast.warning(data.warning);
      setSourceByType(prev => ({ ...prev, [typeId]: src }));
      toast.success(`Источник добавлен: ${src.word_count} слов`);
    } catch (e: any) {
      toast.error(e?.message || "Не удалось извлечь контент");
    } finally {
      setExtracting(null);
    }
  };

  const resetSource = (typeId: string) => {
    setSourceByType(prev => {
      const next = { ...prev };
      delete next[typeId];
      return next;
    });
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
      const { data: formatRows } = await supabase.from("ecosystem_formats").insert(
        chosen.map(d => ({
          ecosystem_id: data.id,
          format_type: d.slug,
          document_type_id: d.id,
          status: "pending",
        }))
      ).select("id, document_type_id");

      // RAG: сохранить извлечённые источники по форматам
      const refRows = (formatRows || []).flatMap((f: any) => {
        const s = sourceByType[f.document_type_id];
        if (!s) return [];
        return [{
          ecosystem_format_id: f.id,
          source_url: s.url,
          source_type: "client_page",
          source_title: s.title,
          source_content: s.content,
          source_fetched_at: s.fetched_at,
          extraction_metadata: { word_count: s.word_count, extractor_version: "1.0" },
        }];
      });
      if (refRows.length) {
        const { error: refErr } = await supabase.from("document_source_references").insert(refRows);
        if (refErr) toast.error("Источники не сохранены: " + refErr.message);
      }

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
          <DialogTitle>Развернуть экосистему · шаг {step}/{totalSteps}</DialogTitle>
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
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    {d.name}
                    {(d.reference_source_config?.recommended || d.reference_source_config?.required) && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-primary"><Paperclip className="h-3.5 w-3.5" /></span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            Этот тип можно улучшить, указав источник - модель будет использовать конкретные данные вместо общих формулировок
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  {d.description && (
                    <div className="text-xs text-muted-foreground">{d.description}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}

        {step === 4 && hasSourcesStep && (
          <div className="space-y-3 max-h-[55vh] overflow-y-auto">
            <p className="text-sm text-muted-foreground">
              Источники данных - модель будет брать факты со страниц клиента вместо общих формулировок. Шаг опционален.
            </p>
            {ragTypes.map(d => (
              <div key={d.id} className="p-3 border rounded space-y-2">
                <div className="text-sm font-medium">{d.name}</div>
                <div className="flex gap-2">
                  <Input
                    placeholder="https://site.ru/catalog/"
                    value={urlDraft[d.id] || ""}
                    onChange={e => setUrlDraft(prev => ({ ...prev, [d.id]: e.target.value }))}
                  />
                  <Button
                    variant="outline"
                    onClick={() => void handleExtract(d.id)}
                    disabled={extracting === d.id || !(urlDraft[d.id] || "").trim()}
                  >
                    {extracting === d.id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Проверить и извлечь
                  </Button>
                </div>
                {(sourcesByType[d.id] || []).map((s, i) => (
                  <div key={i} className="p-2 rounded bg-muted/40 text-xs space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium">{s.title}</div>
                      <button onClick={() => removeSource(d.id, i)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="text-muted-foreground break-all">{s.url} · {s.word_count} слов</div>
                    <div className="text-muted-foreground line-clamp-3">
                      {s.content.split(/\s+/).slice(0, 200).join(" ")}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {step === confirmStep && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">Подтвердите развёртывание:</p>
            <div className="p-3 border rounded space-y-1">
              <div>Клиент: <strong>{clients.find(c => c.id === clientId)?.name}</strong></div>
              <div>Статья: <strong>{articles.find(a => a.id === articleId)?.title || "-"}</strong></div>
              <div>Типов документов: <strong>{selectedTypeIds.length}</strong></div>
              <div>Источников данных: <strong>{Object.values(sourcesByType).reduce((n, arr) => n + arr.length, 0)}</strong></div>
            </div>
            <p className="text-xs text-muted-foreground">Экосистема будет создана; генерация запускается вручную из карточки документа.</p>
          </div>
        )}

        <DialogFooter>
          {step > 1 && <Button variant="outline" onClick={() => setStep(s => s - 1)}>Назад</Button>}
          {step < confirmStep && (
            <Button
              onClick={() => setStep(s => s + 1)}
              disabled={(step === 1 && !clientId) || (step === 2 && !articleId) || (step === 3 && selectedTypeIds.length === 0)}
            >Далее</Button>
          )}
          {step === confirmStep && (
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