import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/shared/api/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { UserPen, Plus, Trash2, Sparkles, Loader2, ChevronDown, ChevronUp, Save, FileText, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { StyleAnalysisCard } from "@/components/persona/StyleAnalysisCard";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";

interface AuthorProfile {
  id: string;
  user_id: string;
  name: string;
  niche: string | null;
  voice_tone: string | null;
  style_examples: string | null;
  stop_words: string[] | null;
  system_prompt_override: string | null;
  style_analysis: Record<string, unknown> | null;
  created_at: string;
}

const TONE_OPTIONS = [
  { value: "expert", label: "Экспертный" },
  { value: "friendly", label: "Дружелюбный" },
  { value: "formal", label: "Формальный" },
  { value: "casual", label: "Неформальный" },
  { value: "persuasive", label: "Убедительный" },
  { value: "educational", label: "Образовательный" },
];

export default function AuthorProfilesPage() {
  const queryClient = useQueryClient();
  const { limits } = usePlanLimits();
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [voiceTone, setVoiceTone] = useState("");
  const [sampleText, setSampleText] = useState("");

  const { data: authors = [], isLoading } = useQuery({
    queryKey: ["author-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("author_profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AuthorProfile[];
    },
  });

  const createAuthor = useMutation({
    mutationFn: async () => {
      if (limits.maxAuthorProfiles !== -1 && authors.length >= limits.maxAuthorProfiles) {
        throw new Error(`Лимит профилей: ${limits.maxAuthorProfiles}. Обновите тариф для создания новых.`);
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("author_profiles").insert({
        user_id: user.id,
        name: name.trim(),
        niche: niche.trim() || null,
        voice_tone: voiceTone || null,
        style_examples: sampleText.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["author-profiles"] });
      setCreateOpen(false);
      resetForm();
      toast.success("Автор создан");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteAuthor = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("author_profiles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["author-profiles"] });
      toast.success("Автор удалён");
    },
    onError: (e) => toast.error(e.message),
  });

  const analyzeStyle = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const { data, error } = await supabase.functions.invoke("analyze-style", {
        body: { sample_text: text },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);

      // Save analysis to profile
      const { error: updateError } = await supabase
        .from("author_profiles")
        .update({
          style_analysis: data.style_analysis,
          system_prompt_override: data.style_analysis.recommended_system_prompt || null,
          stop_words: data.style_analysis.stop_words || null,
        })
        .eq("id", id);
      if (updateError) throw updateError;

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["author-profiles"] });
      toast.success(`Стиль проанализирован (модель: ${data.model_used})`);
    },
    onError: (e) => toast.error(e.message),
  });

  const resetForm = () => {
    setName("");
    setNiche("");
    setVoiceTone("");
    setSampleText("");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserPen className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Persona Engine</h1>
            <p className="text-sm text-muted-foreground">
              Управление стилями авторов для генерации контента
            </p>
          </div>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Новый автор
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Создать профиль автора</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Имя автора *</Label>
                <Input
                  placeholder="Например: Техно-Эксперт"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Ниша</Label>
                <Input
                  placeholder="Например: SaaS, финтех, здоровье"
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Tone of Voice</Label>
                <Select value={voiceTone} onValueChange={setVoiceTone}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите тон" />
                  </SelectTrigger>
                  <SelectContent>
                    {TONE_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Текст-образец (опционально)</Label>
                <Textarea
                  placeholder="Вставьте пример текста автора для будущего анализа стиля..."
                  rows={5}
                  value={sampleText}
                  onChange={(e) => setSampleText(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Вы сможете проанализировать стиль после создания профиля.
                </p>
              </div>
              <Button
                className="w-full"
                disabled={!name.trim() || createAuthor.isPending}
                onClick={() => createAuthor.mutate()}
              >
                {createAuthor.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Создать
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {authors.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <UserPen className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground mb-2">Нет профилей авторов</p>
            <p className="text-xs text-muted-foreground mb-4">
              Создайте первый профиль, чтобы обучить ИИ вашему стилю
            </p>
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Создать автора
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {authors.map((author) => (
            <AuthorCard
              key={author.id}
              author={author}
              expanded={expandedId === author.id}
              onToggle={() => setExpandedId(expandedId === author.id ? null : author.id)}
              onDelete={() => deleteAuthor.mutate(author.id)}
              onAnalyze={(text) => analyzeStyle.mutate({ id: author.id, text })}
              isAnalyzing={analyzeStyle.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface AuthorCardProps {
  author: AuthorProfile;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onAnalyze: (text: string) => void;
  isAnalyzing: boolean;
}

function AuthorCard({ author, expanded, onToggle, onDelete, onAnalyze, isAnalyzing }: AuthorCardProps) {
  const queryClient = useQueryClient();
  const [analyzeText, setAnalyzeText] = useState(author.style_examples || "");
  const [referenceText, setReferenceText] = useState(author.style_examples || "");
  const [refDirty, setRefDirty] = useState(false);

  const saveReference = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("author_profiles")
        .update({ style_examples: referenceText.trim() || null })
        .eq("id", author.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["author-profiles"] });
      setRefDirty(false);
      toast.success("Эталонный текст сохранён");
    },
    onError: (e) => toast.error(e.message),
  });

  const toneLabel = TONE_OPTIONS.find((t) => t.value === author.voice_tone)?.label || author.voice_tone;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
              {author.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <CardTitle className="text-base">{author.name}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                {author.niche && (
                  <Badge variant="secondary" className="text-xs">
                    {author.niche}
                  </Badge>
                )}
                {toneLabel && (
                  <Badge variant="outline" className="text-xs">
                    {toneLabel}
                  </Badge>
                )}
                {author.style_analysis && (
                  <Badge className="text-xs bg-primary/20 text-primary border-0">
                    <Sparkles className="h-3 w-3 mr-1" />
                    Стиль проанализирован
                  </Badge>
                )}
                {author.style_examples && (
                  <Badge className="text-xs bg-success/20 text-success border-0">
                    <FileText className="h-3 w-3 mr-1" />
                    Эталонный текст
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={onToggle}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 pt-0">
          {/* Reference Text — the core style sample */}
          <div className="space-y-3 rounded-lg bg-primary/5 border border-primary/20 p-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <Label className="text-sm font-semibold">Эталонный текст автора</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Вставьте текст, написанный этим автором. ИИ будет копировать этот стиль при генерации статей.
              Чем больше текста — тем точнее стиль.
            </p>
            <Textarea
              placeholder="Вставьте сюда текст автора (статья, пост, эссе)... Минимум 200 символов для качественного результата."
              rows={10}
              value={referenceText}
              onChange={(e) => {
                setReferenceText(e.target.value);
                setRefDirty(true);
              }}
              className="bg-background font-mono text-sm leading-relaxed"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {referenceText.length} символов
                {referenceText.length > 0 && referenceText.length < 200 && (
                  <span className="text-warning ml-1">(рекомендуется ≥200)</span>
                )}
                {referenceText.length >= 200 && (
                  <span className="text-success ml-1">✓ достаточно для анализа</span>
                )}
              </p>
              <div className="flex gap-2">
                {refDirty && (
                  <Button
                    size="sm"
                    onClick={() => saveReference.mutate()}
                    disabled={saveReference.isPending}
                  >
                    {saveReference.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-1" />
                    )}
                    Сохранить текст
                  </Button>
                )}
                {!refDirty && referenceText.length > 0 && (
                  <span className="flex items-center text-xs text-success gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Сохранено
                  </span>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* Style Analysis Section */}
          <div className="space-y-3 rounded-lg bg-muted/50 p-4">
            <Label className="text-sm font-medium">Анализ стиля</Label>
            <p className="text-xs text-muted-foreground">
              Проанализируйте эталонный текст, чтобы извлечь параметры стиля автоматически.
            </p>
            <Textarea
              placeholder="Вставьте текст-образец автора (минимум 50 символов)..."
              rows={6}
              value={analyzeText}
              onChange={(e) => setAnalyzeText(e.target.value)}
              className="bg-background"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {analyzeText.length} символов {analyzeText.length < 50 && analyzeText.length > 0 ? "(минимум 50)" : ""}
              </p>
              <Button
                size="sm"
                disabled={analyzeText.trim().length < 50 || isAnalyzing}
                onClick={() => onAnalyze(analyzeText)}
              >
                {isAnalyzing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Analyze Style
              </Button>
            </div>
          </div>

          {/* Results */}
          {author.style_analysis && (
            <StyleAnalysisCard analysis={author.style_analysis as Record<string, unknown>} />
          )}

          {/* System Prompt Override */}
          {author.system_prompt_override && (
            <div className="space-y-2 rounded-lg bg-muted/50 p-4">
              <Label className="text-sm font-medium">System Prompt (сгенерирован ИИ)</Label>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap font-mono bg-background rounded-md p-3">
                {author.system_prompt_override}
              </p>
            </div>
          )}

          {/* Stop Words */}
          {author.stop_words && author.stop_words.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Стоп-слова</Label>
              <div className="flex flex-wrap gap-1.5">
                {author.stop_words.map((word, i) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    {word}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

