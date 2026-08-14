import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Search, Upload, GitCompare } from "lucide-react";
import { toast } from "sonner";
import { SEOManager } from "@/components/SEOManager";
import { PersonaCard } from "../components/PersonaCard";
import { PersonaWizard } from "../components/PersonaWizard";
import { PersonaDetailDialog } from "../components/PersonaDetailDialog";
import { PersonaAbTestDialog } from "../components/PersonaAbTestDialog";
import { archivePersona, createPersona, createPersonaVersion, duplicatePersona, listPersonas } from "../services/personaApi";
import { parseImport } from "../services/personaIO";
import type { Persona } from "../types";

export default function PersonaEnginePage() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");

  const [wizardOpen, setWizardOpen] = useState(false);
  const [abOpen, setAbOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importRaw, setImportRaw] = useState("");

  const [selected, setSelected] = useState<Persona | null>(null);
  const [detailTab, setDetailTab] = useState("overview");
  const [detailOpen, setDetailOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPersonas(await listPersonas());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить персон");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => personas.filter(p => {
    const okStatus = status === "all" ? true : p.status === status;
    const q = query.trim().toLowerCase();
    const okQuery = !q || [p.name, p.role, p.site_url, p.description].some(v => (v || "").toLowerCase().includes(q));
    return okStatus && okQuery;
  }), [personas, status, query]);

  const openDetail = (persona: Persona, tab = "overview") => {
    setSelected(persona);
    setDetailTab(tab);
    setDetailOpen(true);
  };

  const handleImport = async () => {
    try {
      const parsed = parseImport(importRaw);
      const persona = await createPersona({
        name: parsed.name,
        role: parsed.role,
        description: parsed.description,
        persona_dna: parsed.persona_dna,
        style_dna: parsed.style_dna,
        status: "draft",
        change_log: "Импорт персоны",
      });
      setImportOpen(false);
      setImportRaw("");
      await load();
      if (parsed.problems.length) {
        toast.warning("Импортировано с замечаниями", { description: parsed.problems.join(" ") });
      } else {
        toast.success("Персона импортирована");
      }
      openDetail(persona);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось импортировать");
    }
  };

  return (
    <div className="space-y-6">
      <SEOManager
        title="Persona Engine - управление AI-авторами"
        description="Создание цифровых авторов с собственным стилем, экспертностью и правилами письма для генерации контента."
      />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Persona Engine</h1>
          <p className="text-sm text-muted-foreground">
            Цифровые авторы с характером: стиль, экспертность и правила письма в одном месте.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setAbOpen(true)}>
            <GitCompare className="h-4 w-4 mr-2" />Сравнить персон
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />Импорт
          </Button>
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />Создать автора
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Поиск по имени, роли или сайту" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="draft">Черновик</SelectItem>
            <SelectItem value="testing">Тестирование</SelectItem>
            <SelectItem value="active">Активна</SelectItem>
            <SelectItem value="archived">Архив</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />Загрузка персон
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            Пока нет ни одного автора. Начните с анализа сайта - система соберёт персону сама.
          </p>
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />Создать автора
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map(p => (
            <PersonaCard
              key={p.id}
              persona={p}
              onOpen={() => openDetail(p)}
              onEdit={() => openDetail(p)}
              onTest={() => openDetail(p, "testlab")}
              onDuplicate={async () => {
                try {
                  await duplicatePersona(p, `${p.name} (копия)`);
                  await load();
                  toast.success("Дубликат создан");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Не удалось скопировать");
                }
              }}
              onNewVersion={async () => {
                try {
                  const updated = await createPersonaVersion(p.id, "Новая версия");
                  await load();
                  toast.success(`Создана версия ${updated.version}`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Не удалось создать версию");
                }
              }}
              onArchive={async () => {
                try {
                  await archivePersona(p.id);
                  await load();
                  toast.success("Персона в архиве");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Не удалось архивировать");
                }
              }}
            />
          ))}
        </div>
      )}

      <PersonaWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={async persona => { await load(); openDetail(persona); }}
      />

      <PersonaDetailDialog
        persona={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onChanged={load}
        initialTab={detailTab}
      />

      <PersonaAbTestDialog open={abOpen} onOpenChange={setAbOpen} personas={personas} />

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Импорт персоны</DialogTitle></DialogHeader>
          <Textarea
            rows={12}
            value={importRaw}
            onChange={e => setImportRaw(e.target.value)}
            placeholder="Вставьте JSON персоны или готовый Master Prompt"
          />
          <DialogFooter>
            <Button onClick={handleImport}>Импортировать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}