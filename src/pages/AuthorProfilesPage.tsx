import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/shared/hooks/useI18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { UserPen, Plus, Trash2, Sparkles, Loader2, ChevronDown, ChevronUp, Save, FileText, CheckCircle2, RotateCcw, Link2 } from "lucide-react";
import { toast } from "sonner";
import { StyleAnalysisCard } from "@/components/persona/StyleAnalysisCard";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";

const MIRALINKS_DEFAULTS = {
  voice_tone: "expert",
  system_instruction: `Ты — SEO-копирайтер для биржи Miralinks. Строгие правила:
1. Тон: информационный, экспертный, без агрессивных продаж.
2. Структура: обязательно H1, H2-H3, маркированные списки.
3. Размещение ссылок: равномерно по тексту. ЗАПРЕЩЕНО в первом и последнем абзацах.
4. Минимальный объём: 2500 знаков.
5. Изображения: 2-3 шт. с alt-тегами на основе LSI-ключей.`,
  temperature: 0.7,
  niche: "Miralinks / Линкбилдинг",
  description: "Профиль для биржи Miralinks с жёсткими правилами модерации",
};

const GOGETLINKS_DEFAULTS = {
  voice_tone: "expert",
  system_instruction: `Ты — SEO-копирайтер для биржи GoGetLinks. Строгие правила:
1. Тон: информационный, экспертный, естественный язык.
2. Структура: обязательно H1, H2-H3, маркированные списки.
3. Контекстные ссылки: естественно вписаны в текст. ЗАПРЕЩЕНО в первом и последнем абзацах.
4. Минимальный объём: 300 слов (2000+ знаков).
5. Уникальность: текст должен быть полностью уникальным.
6. Изображения: 1-3 шт. с alt-тегами.
7. Анкоры: естественные, без спамных коммерческих фраз.`,
  temperature: 0.7,
  niche: "GoGetLinks / Линкбилдинг",
  description: "Профиль для биржи GoGetLinks с правилами контекстных ссылок",
};

interface AuthorProfile {
  id: string; user_id: string | null; name: string; niche: string | null; voice_tone: string | null;
  style_examples: string | null; stop_words: string[] | null; system_prompt_override: string | null;
  style_analysis: Record<string, unknown> | null; created_at: string; type?: string; description?: string;
  avatar_icon?: string; system_instruction?: string; temperature?: number;
  is_miralinks_profile?: boolean; is_gogetlinks_profile?: boolean;
}

export default function AuthorProfilesPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { limits } = usePlanLimits();
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [voiceTone, setVoiceTone] = useState("");
  const [sampleText, setSampleText] = useState("");

  const TONE_OPTIONS = [
    { value: "expert", label: t("persona.toneExpert") },
    { value: "friendly", label: t("persona.toneFriendly") },
    { value: "formal", label: t("persona.toneFormal") },
    { value: "casual", label: t("persona.toneCasual") },
    { value: "persuasive", label: t("persona.tonePersuasive") },
    { value: "educational", label: t("persona.toneEducational") },
  ];

  const { data: authors = [], isLoading } = useQuery({
    queryKey: ["author-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("author_profiles").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as AuthorProfile[];
    },
  });

  const createAuthor = useMutation({
    mutationFn: async () => {
      if (limits.maxAuthorProfiles !== -1 && authors.length >= limits.maxAuthorProfiles) {
        throw new Error(`${t("authorPage.profileLimit")}: ${limits.maxAuthorProfiles}. ${t("authorPage.upgradePlan")}`);
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("author_profiles").insert({ user_id: user.id, name: name.trim(), niche: niche.trim() || null, voice_tone: voiceTone || null, style_examples: sampleText.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["author-profiles"] }); setCreateOpen(false); resetForm(); toast.success(t("persona.authorCreated")); },
    onError: (e) => toast.error(e.message),
  });

  const deleteAuthor = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("author_profiles").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["author-profiles"] }); toast.success(t("persona.authorDeleted")); },
    onError: (e) => toast.error(e.message),
  });

  const analyzeStyle = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const { data, error } = await supabase.functions.invoke("analyze-style", { body: { sample_text: text } });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      const { error: updateError } = await supabase.from("author_profiles").update({ style_analysis: data.style_analysis, system_prompt_override: data.style_analysis.recommended_system_prompt || null, stop_words: data.style_analysis.stop_words || null }).eq("id", id);
      if (updateError) throw updateError;
      return data;
    },
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ["author-profiles"] }); toast.success(`${t("persona.styleAnalyzed")} (${data.model_used})`); },
    onError: (e) => toast.error(e.message),
  });

   const resetForm = () => { setName(""); setNiche(""); setVoiceTone(""); setSampleText(""); };

  const [resettingId, setResettingId] = useState<string | null>(null);
  const resetMiralinks = useMutation({
    mutationFn: async (id: string) => {
      setResettingId(id);
      const { error } = await supabase.from("author_profiles").update({
        voice_tone: MIRALINKS_DEFAULTS.voice_tone,
        system_instruction: MIRALINKS_DEFAULTS.system_instruction,
        temperature: MIRALINKS_DEFAULTS.temperature,
        niche: MIRALINKS_DEFAULTS.niche,
        description: MIRALINKS_DEFAULTS.description,
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["author-profiles"] }); toast.success("Профиль Miralinks сброшен к эталонным настройкам"); setResettingId(null); },
    onError: (e) => { toast.error(e.message); setResettingId(null); },
  });

  const resetGoGetLinks = useMutation({
    mutationFn: async (id: string) => {
      setResettingId(id);
      const { error } = await supabase.from("author_profiles").update({
        voice_tone: GOGETLINKS_DEFAULTS.voice_tone,
        system_instruction: GOGETLINKS_DEFAULTS.system_instruction,
        temperature: GOGETLINKS_DEFAULTS.temperature,
        niche: GOGETLINKS_DEFAULTS.niche,
        description: GOGETLINKS_DEFAULTS.description,
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["author-profiles"] }); toast.success("Профиль GoGetLinks сброшен к эталонным настройкам"); setResettingId(null); },
    onError: (e) => { toast.error(e.message); setResettingId(null); },
  });

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <UserPen className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">{t("persona.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("persona.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!authors.some(a => a.is_miralinks_profile) && limits.hasMiralinks && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) { toast.error("Not authenticated"); return; }
              const { error } = await supabase.from("author_profiles").insert({
                user_id: user.id, name: "Miralinks Expert", type: "custom",
                is_miralinks_profile: true, is_gogetlinks_profile: false,
                ...MIRALINKS_DEFAULTS,
              });
              if (error) { toast.error(error.message); return; }
              queryClient.invalidateQueries({ queryKey: ["author-profiles"] });
              toast.success("Профиль Miralinks Expert создан");
            }}>
              <Link2 className="h-3.5 w-3.5" />Miralinks Expert
            </Button>
          )}
          {!authors.some(a => a.is_gogetlinks_profile) && limits.hasGoGetLinks && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) { toast.error("Not authenticated"); return; }
              const { error } = await supabase.from("author_profiles").insert({
                user_id: user.id, name: "GoGetLinks Expert", type: "custom",
                is_gogetlinks_profile: true, is_miralinks_profile: false,
                ...GOGETLINKS_DEFAULTS,
              });
              if (error) { toast.error(error.message); return; }
              queryClient.invalidateQueries({ queryKey: ["author-profiles"] });
              toast.success("Профиль GoGetLinks Expert создан");
            }}>
              <Link2 className="h-3.5 w-3.5" />GoGetLinks Expert
            </Button>
          )}
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />{t("persona.newAuthor")}</Button>
            </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{t("persona.createProfile")}</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>{t("persona.authorName")}</Label>
                <Input placeholder={t("persona.authorNamePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t("persona.niche")}</Label>
                <Input placeholder={t("persona.nichePlaceholder")} value={niche} onChange={(e) => setNiche(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t("persona.toneOfVoice")}</Label>
                <Select value={voiceTone} onValueChange={setVoiceTone}>
                  <SelectTrigger><SelectValue placeholder={t("persona.selectTone")} /></SelectTrigger>
                  <SelectContent>{TONE_OPTIONS.map((tt) => (<SelectItem key={tt.value} value={tt.value}>{tt.label}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("persona.sampleText")}</Label>
                <Textarea placeholder={t("persona.samplePlaceholder")} rows={5} value={sampleText} onChange={(e) => setSampleText(e.target.value)} />
                <p className="text-xs text-muted-foreground">{t("persona.canAnalyzeLater")}</p>
              </div>
              <Button className="w-full" disabled={!name.trim() || createAuthor.isPending} onClick={() => createAuthor.mutate()}>
                {createAuthor.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}{t("common.create")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {authors.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <UserPen className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground mb-2">{t("persona.noProfiles")}</p>
            <p className="text-xs text-muted-foreground mb-4">{t("persona.createFirst")}</p>
            <Button variant="outline" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-2" />{t("persona.createAuthor")}</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {authors.map((author) => (
            <AuthorCard key={author.id} author={author} expanded={expandedId === author.id} onToggle={() => setExpandedId(expandedId === author.id ? null : author.id)}
              onDelete={() => deleteAuthor.mutate(author.id)} onAnalyze={(text) => analyzeStyle.mutate({ id: author.id, text })} isAnalyzing={analyzeStyle.isPending} t={t} toneOptions={TONE_OPTIONS}
              onResetMiralinks={author.is_miralinks_profile ? () => resetMiralinks.mutate(author.id) : undefined}
              onResetGoGetLinks={author.is_gogetlinks_profile ? () => resetGoGetLinks.mutate(author.id) : undefined}
              isResetting={resettingId === author.id} />
          ))}
        </div>
      )}
    </div>
  );
}

interface AuthorCardProps {
  author: AuthorProfile; expanded: boolean; onToggle: () => void; onDelete: () => void;
  onAnalyze: (text: string) => void; isAnalyzing: boolean; t: (k: string) => string;
  toneOptions: { value: string; label: string }[];
  onResetMiralinks?: () => void; onResetGoGetLinks?: () => void; isResetting?: boolean;
}

function AuthorCard({ author, expanded, onToggle, onDelete, onAnalyze, isAnalyzing, t, toneOptions, onResetMiralinks, onResetGoGetLinks, isResetting }: AuthorCardProps) {
  const queryClient = useQueryClient();
  const [analyzeText, setAnalyzeText] = useState(author.style_examples || "");
  const [referenceText, setReferenceText] = useState(author.style_examples || "");
  const [refDirty, setRefDirty] = useState(false);
  const [editInstruction, setEditInstruction] = useState(author.system_instruction || "");
  const [instructionDirty, setInstructionDirty] = useState(false);

  const saveReference = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("author_profiles").update({ style_examples: referenceText.trim() || null }).eq("id", author.id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["author-profiles"] }); setRefDirty(false); toast.success(t("authorPage.refSaved")); },
    onError: (e) => toast.error(e.message),
  });

  const saveInstruction = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("author_profiles").update({ system_instruction: editInstruction.trim() || null }).eq("id", author.id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["author-profiles"] }); setInstructionDirty(false); toast.success("Промпт сохранён"); },
    onError: (e) => toast.error(e.message),
  });

  const handleResetInstruction = () => {
    const defaults = author.is_gogetlinks_profile ? GOGETLINKS_DEFAULTS : MIRALINKS_DEFAULTS;
    setEditInstruction(defaults.system_instruction);
    setInstructionDirty(true);
  };

  const toneLabel = toneOptions.find((tt) => tt.value === author.voice_tone)?.label || author.voice_tone;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">{author.name.slice(0, 2).toUpperCase()}</div>
            <div>
              <CardTitle className="text-base">{author.name}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                {author.type === "preset" && <Badge className="text-xs bg-primary/20 text-primary border-0">{t("authorPage.builtIn")}</Badge>}
                {author.description && author.type === "preset" && <Badge variant="outline" className="text-xs">{author.description}</Badge>}
                {author.niche && <Badge variant="secondary" className="text-xs">{author.niche}</Badge>}
                {toneLabel && author.type !== "preset" && <Badge variant="outline" className="text-xs">{toneLabel}</Badge>}
                {author.style_analysis && <Badge className="text-xs bg-primary/20 text-primary border-0"><Sparkles className="h-3 w-3 mr-1" />{t("authorPage.styleAnalyzed")}</Badge>}
                {author.style_examples && <Badge className="text-xs bg-success/20 text-success border-0"><FileText className="h-3 w-3 mr-1" />{t("authorPage.referenceText")}</Badge>}
                {author.is_miralinks_profile && <Badge className="text-xs bg-primary/20 text-primary border-0"><Link2 className="h-3 w-3 mr-1" />Miralinks Expert</Badge>}
                {author.is_gogetlinks_profile && <Badge className="text-xs bg-primary/20 text-primary border-0"><Link2 className="h-3 w-3 mr-1" />GoGetLinks Expert</Badge>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {onResetMiralinks && (
              <Button variant="ghost" size="sm" className="text-xs gap-1 text-muted-foreground hover:text-primary" onClick={() => { onResetMiralinks(); handleResetInstruction(); }} disabled={isResetting}>
                {isResetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                Сброс
              </Button>
            )}
            {onResetGoGetLinks && (
              <Button variant="ghost" size="sm" className="text-xs gap-1 text-muted-foreground hover:text-primary" onClick={() => { onResetGoGetLinks(); handleResetInstruction(); }} disabled={isResetting}>
                {isResetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                Сброс
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={onToggle}>{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
            {author.type !== "preset" && <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 pt-0">
          {/* Editable system instruction for Miralinks/GoGetLinks profiles */}
          {(author.is_miralinks_profile || author.is_gogetlinks_profile) ? (
            <div className="space-y-2 rounded-lg bg-primary/5 border border-primary/20 p-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">{t("authorPage.stylePrompt")}</Label>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="text-xs gap-1 h-7" onClick={handleResetInstruction}>
                    <RotateCcw className="h-3 w-3" />
                    По умолчанию
                  </Button>
                </div>
              </div>
              <Textarea
                value={editInstruction}
                onChange={(e) => { setEditInstruction(e.target.value); setInstructionDirty(true); }}
                rows={8}
                className="bg-background font-mono text-sm leading-relaxed"
                placeholder="Системный промпт для генерации..."
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{editInstruction.length} зн.</p>
                <div className="flex gap-2">
                  {instructionDirty && (
                    <Button size="sm" onClick={() => saveInstruction.mutate()} disabled={saveInstruction.isPending}>
                      {saveInstruction.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                      Сохранить
                    </Button>
                  )}
                  {!instructionDirty && <span className="flex items-center text-xs text-success gap-1"><CheckCircle2 className="h-3 w-3" />Сохранено</span>}
                </div>
              </div>
              {author.temperature && <p className="text-xs text-muted-foreground">Temperature: {Number(author.temperature)}</p>}
            </div>
          ) : author.system_instruction ? (
            <div className="space-y-2 rounded-lg bg-primary/5 border border-primary/20 p-4">
              <Label className="text-sm font-semibold">{t("authorPage.stylePrompt")}</Label>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap font-mono bg-background rounded-md p-3">{author.system_instruction}</p>
              {author.temperature && <p className="text-xs text-muted-foreground">Temperature: {Number(author.temperature)}</p>}
            </div>
          ) : null}

          {author.type !== "preset" && (
            <div className="space-y-3 rounded-lg bg-primary/5 border border-primary/20 p-4">
              <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /><Label className="text-sm font-semibold">{t("authorPage.refAuthorText")}</Label></div>
              <p className="text-xs text-muted-foreground">{t("authorPage.refDesc")}</p>
              <Textarea placeholder={t("authorPage.refPlaceholder")} rows={10} value={referenceText} onChange={(e) => { setReferenceText(e.target.value); setRefDirty(true); }} className="bg-background font-mono text-sm leading-relaxed" />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {referenceText.length} {t("authorPage.chars")}
                  {referenceText.length > 0 && referenceText.length < 200 && <span className="text-warning ml-1">{t("authorPage.recommended200")}</span>}
                  {referenceText.length >= 200 && <span className="text-success ml-1">{t("authorPage.enoughForAnalysis")}</span>}
                </p>
                <div className="flex gap-2">
                  {refDirty && (
                    <Button size="sm" onClick={() => saveReference.mutate()} disabled={saveReference.isPending}>
                      {saveReference.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}{t("authorPage.saveText")}
                    </Button>
                  )}
                  {!refDirty && referenceText.length > 0 && <span className="flex items-center text-xs text-success gap-1"><CheckCircle2 className="h-3 w-3" />{t("authorPage.saved")}</span>}
                </div>
              </div>
            </div>
          )}

          {author.type !== "preset" && (
            <>
              <Separator />
              <div className="space-y-3 rounded-lg bg-muted/50 p-4">
                <Label className="text-sm font-medium">{t("authorPage.styleAnalysis")}</Label>
                <p className="text-xs text-muted-foreground">{t("authorPage.analyzeDesc")}</p>
                <Textarea placeholder={t("authorPage.analyzePlaceholder")} rows={6} value={analyzeText} onChange={(e) => setAnalyzeText(e.target.value)} className="bg-background" />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{analyzeText.length} {t("authorPage.chars")} {analyzeText.length < 50 && analyzeText.length > 0 ? t("authorPage.min50") : ""}</p>
                  <Button size="sm" disabled={analyzeText.trim().length < 50 || isAnalyzing} onClick={() => onAnalyze(analyzeText)}>
                    {isAnalyzing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}{t("persona.analyzeStyle")}
                  </Button>
                </div>
              </div>
              {author.style_analysis && <StyleAnalysisCard analysis={author.style_analysis as Record<string, unknown>} />}
            </>
          )}

          {author.system_prompt_override && (
            <div className="space-y-2 rounded-lg bg-muted/50 p-4">
              <Label className="text-sm font-medium">{t("authorPage.systemPromptGenerated")}</Label>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap font-mono bg-background rounded-md p-3">{author.system_prompt_override}</p>
            </div>
          )}

          {author.stop_words && author.stop_words.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("authorPage.stopWords")}</Label>
              <div className="flex flex-wrap gap-1.5">{author.stop_words.map((word, i) => (<Badge key={i} variant="outline" className="text-xs">{word}</Badge>))}</div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
