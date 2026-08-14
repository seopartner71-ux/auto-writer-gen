import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Globe, Sparkles, Plus, X, Wand2, Download } from "lucide-react";
import { toast } from "sonner";
import { analyzeSite, compilePersona, createPersona, fetchSiteText } from "../services/personaApi";
import { buildStyleFingerprint } from "../utils/styleFingerprint";
import { buildSiteDefaults, hasSiteSignal } from "../utils/siteDefaults";
import { computePersonaHealth } from "../services/personaHealth";
import { compileMasterPrompt } from "../services/personaCompiler";
import { SiteDnaPanel } from "./SiteDnaPanel";
import type { CompileResponse } from "../services/personaApi";
import type { Persona, SiteDnaData, SiteDnaRow } from "../types";

const SLIDERS: { key: string; label: string }[] = [
  { key: "subjectivity", label: "Субъективность" },
  { key: "emotionality", label: "Эмоциональность" },
  { key: "storytelling", label: "Storytelling" },
  { key: "formality", label: "Формальность" },
  { key: "conversationality", label: "Разговорность" },
  { key: "terminology", label: "Профессиональная терминология" },
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (persona: Persona) => void;
  /** Предзаполнение при импорте персоны. */
  prefill?: { name?: string; description?: string; persona_dna?: Record<string, unknown>; style_dna?: Record<string, unknown> } | null;
}

export function PersonaWizard({ open, onOpenChange, onCreated, prefill }: Props) {
  const [step, setStep] = useState(1);
  const [advanced, setAdvanced] = useState(false);

  const [url, setUrl] = useState("");
  const [siteRow, setSiteRow] = useState<SiteDnaRow | null>(null);
  const [siteData, setSiteData] = useState<SiteDnaData>({});
  const [analyzing, setAnalyzing] = useState(false);

  const [description, setDescription] = useState(prefill?.description || "");
  const [name, setName] = useState(prefill?.name || "");
  const [role, setRole] = useState("");
  const [expertise, setExpertise] = useState("");
  const [firstPerson, setFirstPerson] = useState(false);
  const [values, setValues] = useState<Record<string, number>>({});
  const [samples, setSamples] = useState<string[]>([]);
  const [sampleDraft, setSampleDraft] = useState("");
  const [sampleUrl, setSampleUrl] = useState("");
  const [loadingSample, setLoadingSample] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  const [compiling, setCompiling] = useState(false);
  const [result, setResult] = useState<CompileResponse | null>(null);
  const [saving, setSaving] = useState(false);

  const fingerprint = useMemo(() => buildStyleFingerprint(samples), [samples]);

  const masterPreview = useMemo(() => {
    if (!result) return "";
    return compileMasterPrompt({
      name: name || result.suggested_name || "Автор",
      role: role || result.suggested_role,
      personaDna: result.persona_dna,
      styleDna: result.style_dna,
      fingerprint,
    });
  }, [result, name, role, fingerprint]);

  const health = useMemo(() => {
    if (!result) return null;
    return computePersonaHealth({
      persona_dna: result.persona_dna,
      style_dna: result.style_dna,
      style_fingerprint: fingerprint,
      master_prompt: masterPreview,
    });
  }, [result, fingerprint, masterPreview]);

  const reset = () => {
    setStep(1); setUrl(""); setSiteRow(null); setSiteData({});
    setDescription(""); setName(""); setRole(""); setExpertise("");
    setFirstPerson(false); setValues({}); setSamples([]); setSampleDraft("");
    setSampleUrl(""); setPrefilled(false); setResult(null);
  };

  /** Заполняет поля шага 2 данными сайта. force - перезаписать даже заполненное. */
  const applySiteDefaults = (force = false) => {
    if (!hasSiteSignal(siteData)) {
      if (force) toast.error("В данных сайта недостаточно информации");
      return;
    }
    const d = buildSiteDefaults(siteData);
    setDescription(prev => (force || !prev.trim() ? d.description : prev));
    setRole(prev => (force || !prev.trim() ? d.role : prev));
    setExpertise(prev => (force || !prev.trim() ? d.expertise : prev));
    setValues(prev => (force ? d.values : { ...d.values, ...prev }));
    if (force) toast.success("Поля заполнены по данным сайта");
  };

  const goToAuthorStep = () => {
    if (!prefilled) { applySiteDefaults(false); setPrefilled(true); }
    setStep(2);
  };

  const handleLoadSample = async () => {
    const target = (sampleUrl.trim() || siteRow?.url || url.trim());
    if (!target) { toast.error("Укажите адрес страницы"); return; }
    setLoadingSample(true);
    try {
      const text = await fetchSiteText(target.startsWith("http") ? target : `https://${target}`);
      if (text.length < 100) { toast.error("На странице слишком мало текста"); return; }
      setSampleDraft(text.slice(0, 8000));
      toast.success("Текст со страницы загружен - проверьте и добавьте примером");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить текст");
    } finally {
      setLoadingSample(false);
    }
  };

  const handleAnalyze = async (force = false) => {
    if (!url.trim()) { toast.error("Укажите URL сайта"); return; }
    setAnalyzing(true);
    try {
      const row = await analyzeSite(url.trim(), force);
      setSiteRow(row);
      setSiteData((row.data || {}) as SiteDnaData);
      toast.success("Site DNA готова");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось проанализировать сайт");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCompile = async () => {
    if (description.trim().length < 10) { toast.error("Опишите автора подробнее"); return; }
    setCompiling(true);
    try {
      const data = await compilePersona({
        description: description.trim(),
        site_dna: siteData,
        samples,
        style_fingerprint: fingerprint,
        inputs: {
          name: name || undefined,
          role: role || undefined,
          expertise: expertise || undefined,
          first_person: firstPerson,
          ...values,
        },
        language: "ru",
      });
      setResult(data);
      if (!name && data.suggested_name) setName(data.suggested_name);
      if (!role && data.suggested_role) setRole(data.suggested_role);
      setStep(3);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сформировать персону");
    } finally {
      setCompiling(false);
    }
  };

  const handleSave = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const persona = await createPersona({
        name: name || result.suggested_name || "Новый автор",
        role: role || result.suggested_role || null,
        description: description.trim(),
        site_url: siteRow?.url || url.trim() || null,
        site_dna_id: siteRow?.id || null,
        persona_dna: { ...result.persona_dna, confidence: result.confidence, conflicts: result.conflicts, missing_inputs: result.missing_inputs },
        style_dna: result.style_dna,
        style_fingerprint: fingerprint,
        status: "draft",
      });
      toast.success("Персона создана");
      onCreated(persona);
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить персону");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Создание AI-автора</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={step >= 1 ? "text-foreground" : ""}>1. Сайт</span>
          <span>-</span>
          <span className={step >= 2 ? "text-foreground" : ""}>2. Автор</span>
          <span>-</span>
          <span className={step >= 3 ? "text-foreground" : ""}>3. Результат</span>
          <div className="ml-auto flex items-center gap-2">
            <Label className="text-xs">Расширенный режим</Label>
            <Switch checked={advanced} onCheckedChange={setAdvanced} />
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>URL сайта</Label>
              <div className="flex gap-2">
                <Input placeholder="https://example.ru" value={url} onChange={e => setUrl(e.target.value)} />
                <Button onClick={() => handleAnalyze(false)} disabled={analyzing}>
                  {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                  <span className="ml-2">Анализировать сайт</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Автор всегда создаётся в контексте сайта. Анализ кэшируется, повторный запуск - по кнопке.
              </p>
            </div>

            {siteRow && (
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Site DNA</span>
                  <Button variant="ghost" size="sm" onClick={() => handleAnalyze(true)} disabled={analyzing}>
                    Обновить анализ сайта
                  </Button>
                </div>
                <SiteDnaPanel url={siteRow.url} data={siteData} onChange={setSiteData} />
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                Поля заполнены по данным сайта - правьте и дополняйте вручную.
              </p>
              <Button variant="outline" size="sm" onClick={() => applySiteDefaults(true)}>
                <Wand2 className="h-4 w-4 mr-1" />Заполнить из данных сайта
              </Button>
            </div>
            <div className="space-y-2">
              <Label>Опишите автора своими словами</Label>
              <Textarea
                rows={6}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Например: нужен опытный практик, который объясняет сложные темы простым языком. Пишет спокойно, уверенно, иногда использует первое лицо, но не придумывает личный опыт..."
              />
              <p className="text-xs text-muted-foreground">
                Технический промпт писать не нужно - система соберёт его сама.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Имя автора</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Необязательно" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Роль</Label>
                <Input value={role} onChange={e => setRole(e.target.value)} placeholder="Необязательно" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Экспертность</Label>
                <Input value={expertise} onChange={e => setExpertise(e.target.value)} placeholder="Необязательно" />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch checked={firstPerson} onCheckedChange={setFirstPerson} id="fp" />
              <Label htmlFor="fp" className="text-sm">Разрешить первое лицо</Label>
            </div>

            {advanced && (
              <div className="grid gap-4 sm:grid-cols-2">
                {SLIDERS.map(s => (
                  <div key={s.key} className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <Label>{s.label}</Label>
                      <span className="text-muted-foreground">{values[s.key] ?? "авто"}</span>
                    </div>
                    <Slider
                      value={[values[s.key] ?? 50]}
                      min={0} max={100} step={5}
                      onValueChange={([v]) => setValues(prev => ({ ...prev, [s.key]: v }))}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <Label>Примеры текстов автора</Label>
              <div className="flex gap-2">
                <Input
                  value={sampleUrl}
                  onChange={e => setSampleUrl(e.target.value)}
                  placeholder={siteRow?.url ? `${siteRow.url}/blog/...` : "https://example.ru/blog/post"}
                />
                <Button variant="outline" onClick={handleLoadSample} disabled={loadingSample}>
                  {loadingSample ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  <span className="ml-2">Взять текст с сайта</span>
                </Button>
              </div>
              <Textarea
                rows={4}
                value={sampleDraft}
                onChange={e => setSampleDraft(e.target.value)}
                placeholder="Вставьте текст и нажмите «Добавить пример». Чем больше примеров, тем точнее стиль."
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline" size="sm"
                  onClick={() => {
                    if (sampleDraft.trim().length < 100) { toast.error("Пример должен быть не короче 100 символов"); return; }
                    setSamples(p => [...p, sampleDraft.trim()]);
                    setSampleDraft("");
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" />Добавить пример
                </Button>
                {samples.map((s, i) => (
                  <Badge key={i} variant="secondary" className="gap-1">
                    Пример {i + 1}
                    <button onClick={() => setSamples(p => p.filter((_, idx) => idx !== i))}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              {fingerprint && (
                <p className="text-xs text-muted-foreground">
                  Замеры: предложение {fingerprint.avg_sentence_length} слов, абзац {fingerprint.avg_paragraph_length} слов,
                  первое лицо {fingerprint.first_person_frequency} на 1000 слов.
                </p>
              )}
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge variant="secondary">Persona Health {health?.score ?? 0}/100</Badge>
              {result.missing_inputs?.length ? (
                <span className="text-xs text-muted-foreground">Не хватает данных: {result.missing_inputs.join(", ")}</span>
              ) : null}
            </div>

            {health?.hints?.length ? (
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
                {health.hints.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            ) : null}

            {result.conflicts?.length ? (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="text-sm font-medium">Разрешённые противоречия</div>
                {result.conflicts.map((c, i) => (
                  <div key={i} className="text-xs text-muted-foreground">
                    {c.rule_a} / {c.rule_b} - {c.resolution}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Имя автора" />
              <Input value={role} onChange={e => setRole(e.target.value)} placeholder="Роль" />
            </div>

            {advanced ? (
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium mb-1">Persona DNA</div>
                  <pre className="text-[11px] bg-muted rounded-lg p-3 overflow-auto max-h-52">{JSON.stringify(result.persona_dna, null, 2)}</pre>
                </div>
                <div>
                  <div className="text-sm font-medium mb-1">Style DNA</div>
                  <pre className="text-[11px] bg-muted rounded-lg p-3 overflow-auto max-h-40">{JSON.stringify(result.style_dna, null, 2)}</pre>
                </div>
                <div>
                  <div className="text-sm font-medium mb-1">Master Prompt</div>
                  <pre className="text-[11px] bg-muted rounded-lg p-3 overflow-auto max-h-52 whitespace-pre-wrap">{masterPreview}</pre>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Автор готов. Включите расширенный режим, чтобы посмотреть Persona DNA, Style DNA и Master Prompt.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && <Button variant="outline" onClick={() => setStep(s => s - 1)}>Назад</Button>}
          {step === 1 && (
            <Button onClick={() => setStep(2)} disabled={!siteRow}>Далее</Button>
          )}
          {step === 2 && (
            <Button onClick={handleCompile} disabled={compiling}>
              {compiling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Сформировать Persona
            </Button>
          )}
          {step === 3 && (
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Сохранить персону
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}