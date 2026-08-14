import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, FlaskConical, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Persona, PersonaEvaluation, PersonaVersion, VoiceDna } from "../types";
import {
  addStyleExample, createPersonaVersion, deleteStyleExample, evaluatePersona,
  listEvaluations, listStyleExamples, listVersions, testPersona, updatePersona,
} from "../services/personaApi";
import { computePersonaHealth, personaQualityGate } from "../services/personaHealth";
import { exportJson, exportReport, downloadText } from "../services/personaIO";

const VOICE_KEYS: { key: keyof VoiceDna; label: string }[] = [
  { key: "formality", label: "Формальность" },
  { key: "warmth", label: "Теплота" },
  { key: "energy", label: "Энергия" },
  { key: "authority", label: "Авторитетность" },
  { key: "emotionality", label: "Эмоциональность" },
  { key: "directness", label: "Прямота" },
  { key: "subjectivity", label: "Субъективность" },
  { key: "conversationality", label: "Разговорность" },
];

const SCORE_LABELS: Record<string, string> = {
  identity_match: "Identity", voice_match: "Voice", style_match: "Style",
  vocabulary_match: "Vocabulary", narrative_match: "Narrative", expertise_match: "Expertise",
  subjectivity_match: "Subjectivity", storytelling_match: "Storytelling",
  anti_ai_compliance: "Anti-AI", fact_compliance: "Факты", seo_compliance: "SEO", geo_compliance: "GEO",
};

interface Props {
  persona: Persona | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
  initialTab?: string;
}

export function PersonaDetailDialog({ persona, open, onOpenChange, onChanged, initialTab }: Props) {
  const [local, setLocal] = useState<Persona | null>(persona);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<PersonaVersion[]>([]);
  const [evaluations, setEvaluations] = useState<PersonaEvaluation[]>([]);
  const [examples, setExamples] = useState<{ id: string; kind: string; content: string; reason: string | null }[]>([]);

  const [task, setTask] = useState("Напиши начало статьи о выборе мини-трактора.");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [evaluation, setEvaluation] = useState<PersonaEvaluation | null>(null);

  const [exampleDraft, setExampleDraft] = useState("");
  const [exampleReason, setExampleReason] = useState("");
  const [exampleKind, setExampleKind] = useState<"positive" | "negative">("positive");

  useEffect(() => { setLocal(persona); setOutput(""); setEvaluation(null); }, [persona]);

  useEffect(() => {
    if (!persona || !open) return;
    listVersions(persona.id).then(setVersions).catch(() => undefined);
    listEvaluations(persona.id).then(setEvaluations).catch(() => undefined);
    listStyleExamples(persona.id).then(setExamples).catch(() => undefined);
  }, [persona, open]);

  const health = useMemo(() => (local ? computePersonaHealth(local) : null), [local]);
  const gate = useMemo(() => (local ? personaQualityGate(local) : null), [local]);

  if (!local) return null;

  const setVoice = (key: keyof VoiceDna, value: number) => {
    setLocal(prev => prev ? {
      ...prev,
      persona_dna: { ...prev.persona_dna, voice: { ...(prev.persona_dna.voice || {}), [key]: value } },
    } : prev);
  };

  const handleSave = async (patch?: Partial<Persona>, changeLog?: string) => {
    setSaving(true);
    try {
      const updated = await updatePersona(local.id, {
        name: local.name, role: local.role, description: local.description,
        persona_dna: local.persona_dna, style_dna: local.style_dna, status: local.status,
        ...patch,
      }, changeLog);
      setLocal(updated);
      onChanged();
      toast.success("Сохранено. Master Prompt пересобран.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (status: Persona["status"]) => {
    if (status === "active") {
      const check = personaQualityGate(local);
      if (!check.passed) {
        toast.error("Персона требует доработки", { description: check.problems.join(" ") });
        return;
      }
    }
    setLocal(prev => prev ? { ...prev, status } : prev);
    await handleSave({ status }, `Смена статуса: ${status}`);
  };

  const handleTest = async () => {
    setRunning(true);
    setEvaluation(null);
    try {
      const text = await testPersona(local.id, task);
      setOutput(text);
      const evalRes = await evaluatePersona({ persona_id: local.id, text, task });
      setEvaluation(evalRes);
      listEvaluations(local.id).then(setEvaluations).catch(() => undefined);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Тест не выполнен");
    } finally {
      setRunning(false);
    }
  };

  const applySuggestion = async (s: { field: string; suggested: string }) => {
    const path = s.field.split(".");
    const dna: Record<string, unknown> = JSON.parse(JSON.stringify(local.persona_dna || {}));
    let node: Record<string, unknown> = dna;
    for (let i = 0; i < path.length - 1; i++) {
      if (typeof node[path[i]] !== "object" || node[path[i]] === null) node[path[i]] = {};
      node = node[path[i]] as Record<string, unknown>;
    }
    const num = Number(s.suggested);
    node[path[path.length - 1]] = Number.isFinite(num) && s.suggested.trim() !== "" ? num : s.suggested;
    setLocal(prev => prev ? { ...prev, persona_dna: dna } : prev);
    await handleSave({ persona_dna: dna }, `Улучшение персоны: ${s.field}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {local.name}
            <Badge variant="secondary">v{local.version}</Badge>
            <Badge variant="outline">Health {health?.score ?? 0}</Badge>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue={initialTab || "overview"}>
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="overview">Обзор</TabsTrigger>
            <TabsTrigger value="advanced">Расширенный</TabsTrigger>
            <TabsTrigger value="testlab">Test Lab</TabsTrigger>
            <TabsTrigger value="examples">Примеры стиля</TabsTrigger>
            <TabsTrigger value="versions">Версии</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Имя</Label>
                <Input value={local.name} onChange={e => setLocal({ ...local, name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Роль</Label>
                <Input value={local.role || ""} onChange={e => setLocal({ ...local, role: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Описание автора</Label>
              <Textarea rows={4} value={local.description || ""} onChange={e => setLocal({ ...local, description: e.target.value })} />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Voice DNA</Label>
              {VOICE_KEYS.map(v => (
                <div key={String(v.key)} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>{v.label}</span>
                    <span className="text-muted-foreground">{(local.persona_dna.voice?.[v.key] as number) ?? "-"}</span>
                  </div>
                  <Slider
                    value={[(local.persona_dna.voice?.[v.key] as number) ?? 50]}
                    min={0} max={100} step={5}
                    onValueChange={([val]) => setVoice(v.key, val)}
                  />
                </div>
              ))}
            </div>

            {health?.hints?.length ? (
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
                {health.hints.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            ) : null}

            {gate && !gate.passed && (
              <div className="text-xs text-destructive">Персона требует доработки: {gate.problems.join(" ")}</div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => handleSave()} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Сохранить
              </Button>
              <Select value={local.status} onValueChange={v => handleStatus(v as Persona["status"])}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Черновик</SelectItem>
                  <SelectItem value="testing">Тестирование</SelectItem>
                  <SelectItem value="active">Активна</SelectItem>
                  <SelectItem value="archived">Архив</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => downloadText(`${local.name}.json`, exportJson(local))}>
                <Download className="h-4 w-4 mr-2" />JSON
              </Button>
              <Button variant="outline" onClick={() => downloadText(`${local.name}-master-prompt.txt`, local.master_prompt || "")}>
                <Download className="h-4 w-4 mr-2" />Master Prompt
              </Button>
              <Button variant="outline" onClick={() => downloadText(`${local.name}-report.txt`, exportReport(local))}>
                <Download className="h-4 w-4 mr-2" />Отчёт
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4 pt-4">
            {health && (
              <div className="space-y-2">
                {health.components.map(c => (
                  <div key={c.key} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span>{c.label}</span><span className="text-muted-foreground">{c.score}</span>
                    </div>
                    <Progress value={c.score} className="h-1.5" />
                  </div>
                ))}
              </div>
            )}
            <div>
              <div className="text-sm font-medium mb-1">Persona DNA</div>
              <pre className="text-[11px] bg-muted rounded-lg p-3 overflow-auto max-h-64">{JSON.stringify(local.persona_dna, null, 2)}</pre>
            </div>
            <div>
              <div className="text-sm font-medium mb-1">Style DNA</div>
              <pre className="text-[11px] bg-muted rounded-lg p-3 overflow-auto max-h-48">{JSON.stringify(local.style_dna, null, 2)}</pre>
            </div>
            {local.style_fingerprint && (
              <div>
                <div className="text-sm font-medium mb-1">Style Fingerprint</div>
                <pre className="text-[11px] bg-muted rounded-lg p-3 overflow-auto max-h-40">{JSON.stringify(local.style_fingerprint, null, 2)}</pre>
              </div>
            )}
            <div>
              <div className="text-sm font-medium mb-1">Master Prompt (производный объект)</div>
              <pre className="text-[11px] bg-muted rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap">{local.master_prompt}</pre>
            </div>
          </TabsContent>

          <TabsContent value="testlab" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label className="text-xs">Задача для автора</Label>
              <Textarea rows={3} value={task} onChange={e => setTask(e.target.value)} />
              <Button onClick={handleTest} disabled={running}>
                {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FlaskConical className="h-4 w-4 mr-2" />}
                Запустить тест
              </Button>
            </div>

            {output && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border p-3 text-sm whitespace-pre-wrap max-h-96 overflow-auto">{output}</div>
                <div className="space-y-3">
                  {evaluation ? (
                    <>
                      <div className="text-lg font-medium">Persona Match {evaluation.total_score}/100</div>
                      <div className="space-y-1">
                        {Object.entries(evaluation.scores || {}).map(([k, v]) => (
                          <div key={k} className="flex justify-between text-xs">
                            <span>{SCORE_LABELS[k] || k}</span>
                            <span className="text-muted-foreground">{v}</span>
                          </div>
                        ))}
                      </div>
                      {evaluation.deviations?.length ? (
                        <div className="space-y-1">
                          <div className="text-sm font-medium">Найденные отклонения</div>
                          {evaluation.deviations.map((d, i) => (
                            <div key={i} className="text-xs text-muted-foreground">
                              {d.area}: {d.observed} (ожидалось: {d.expected})
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {evaluation.suggestions?.length ? (
                        <div className="space-y-2">
                          <div className="text-sm font-medium">Улучшить Persona</div>
                          {evaluation.suggestions.map((s, i) => (
                            <div key={i} className="rounded border p-2 space-y-1">
                              <div className="text-xs">{s.field}: {s.current} -&gt; {s.suggested}</div>
                              <div className="text-[11px] text-muted-foreground">{s.reason}</div>
                              <Button size="sm" variant="outline" onClick={() => applySuggestion(s)}>Применить</Button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">Оценка выполняется...</div>
                  )}
                </div>
              </div>
            )}

            {evaluations.length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-medium">История оценок</div>
                {evaluations.map(e => (
                  <div key={e.id} className="flex justify-between text-xs text-muted-foreground">
                    <span className="truncate max-w-[70%]">{e.task || "без задачи"}</span>
                    <span>{e.total_score}/100</span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="examples" className="space-y-4 pt-4">
            <div className="space-y-2">
              <div className="flex gap-2">
                <Select value={exampleKind} onValueChange={v => setExampleKind(v as "positive" | "negative")}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="positive">Эталонный текст</SelectItem>
                    <SelectItem value="negative">Неудачный текст</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Почему текст такой (для неудачных)"
                  value={exampleReason}
                  onChange={e => setExampleReason(e.target.value)}
                />
              </div>
              <Textarea rows={4} value={exampleDraft} onChange={e => setExampleDraft(e.target.value)} placeholder="Вставьте текст" />
              <Button
                variant="outline"
                onClick={async () => {
                  if (exampleDraft.trim().length < 100) { toast.error("Текст должен быть не короче 100 символов"); return; }
                  await addStyleExample(local.id, exampleDraft.trim(), exampleKind, exampleReason.trim() || undefined);
                  setExampleDraft(""); setExampleReason("");
                  setExamples(await listStyleExamples(local.id));
                  toast.success("Пример добавлен");
                }}
              >
                Добавить
              </Button>
            </div>
            <div className="space-y-2">
              {examples.map(ex => (
                <div key={ex.id} className="rounded border p-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge variant={ex.kind === "negative" ? "destructive" : "secondary"}>
                      {ex.kind === "negative" ? "Неудачный" : "Эталонный"}
                    </Badge>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      onClick={async () => { await deleteStyleExample(ex.id); setExamples(await listStyleExamples(local.id)); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {ex.reason && <div className="text-xs text-muted-foreground">{ex.reason}</div>}
                  <div className="text-xs line-clamp-3">{ex.content}</div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="versions" className="space-y-3 pt-4">
            <Button
              variant="outline"
              onClick={async () => {
                const updated = await createPersonaVersion(local.id, "Новая версия", false);
                setLocal(updated);
                setVersions(await listVersions(local.id));
                onChanged();
                toast.success(`Создана версия ${updated.version}`);
              }}
            >
              Создать версию
            </Button>
            {versions.map(v => (
              <div key={v.id} className="rounded border p-2 text-xs">
                <div className="flex justify-between">
                  <span>v{v.version}</span>
                  <span className="text-muted-foreground">{new Date(v.created_at).toLocaleString("ru-RU")}</span>
                </div>
                {v.change_log && <div className="text-muted-foreground">{v.change_log}</div>}
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}