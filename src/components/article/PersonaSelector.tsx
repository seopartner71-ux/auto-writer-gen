import { useState, useCallback, useEffect } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ShieldAlert, Heart, Cpu, Flame, GraduationCap,
  Plus, User, Loader2, X, Pencil, HeartPulse, Link2, Sun, Newspaper,
  TrendingDown, HardHat, Terminal, BrainCircuit, Wrench, Scale,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/shared/hooks/useI18n";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  ShieldAlert, Heart, Cpu, Flame, GraduationCap, User, HeartPulse, Link2, Sun, Newspaper,
  TrendingDown, HardHat, Terminal, BrainCircuit, Wrench, Scale,
};

interface AuthorProfile {
  id: string;
  name: string;
  type?: string;
  description?: string;
  avatar_icon?: string;
  system_instruction?: string;
  voice_tone?: string;
  niche?: string;
  temperature?: number;
  stop_words?: string[] | null;
  style_analysis?: any;
}

interface PersonaSelectorProps {
  authors: AuthorProfile[];
  selectedId: string;
  onSelect: (id: string) => void;
}

const SYNTAX_PRESETS: { key: string; label: string }[] = [
  { key: "standard", label: "Стандартный" },
  { key: "blogger", label: "Блогер" },
  { key: "practitioner", label: "Практик" },
  { key: "skeptic", label: "Скептик" },
  { key: "provocateur", label: "Провокатор" },
  { key: "academic", label: "Академик" },
];

export function PersonaSelector({ authors, selectedId, onSelect }: PersonaSelectorProps) {
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newInstruction, setNewInstruction] = useState("");
  const [sampleText, setSampleText] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();

  const presets = authors.filter(a => a.type === "preset");
  const customs = authors.filter(a => a.type !== "preset");

  const handleAnalyzeSample = useCallback(async () => {
    if (!sampleText || sampleText.length < 100) {
      toast.error(t("ps.min100"));
      return;
    }
    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-style", {
        body: { sample_text: sampleText },
      });
      if (error) {
        let message = error.message;
        try {
          const details = await (error as { context?: Response }).context?.json();
          if (details?.error) message = details.error;
        } catch {
          // ignore parse errors
        }
        throw new Error(message);
      }
      const analysis = data?.style_analysis;
      const recommendedPrompt = analysis?.recommended_system_prompt;
      if (recommendedPrompt) {
        setNewInstruction(prev => (prev ? `${prev}\n\n${recommendedPrompt}` : recommendedPrompt));
        const details = [
          analysis.formality && `Формальность: ${analysis.formality}`,
          analysis.tone_description && `Тон: ${analysis.tone_description}`,
          analysis.vocabulary_level && `Лексика: ${analysis.vocabulary_level}`,
        ].filter(Boolean).join(" · ");
        toast.success(`✅ Стиль проанализирован!`, {
          description: details || t("ps.styleAdded"),
          duration: 6000,
        });
      } else {
        throw new Error(t("ps.analyzeError"));
      }
    } catch (e: any) {
      toast.error(e.message || t("ps.analyzeError"));
    } finally {
      setIsAnalyzing(false);
    }
  }, [sampleText, t]);

  const handleCreateAuthor = useCallback(async () => {
    if (!newName.trim()) { toast.error(t("ps.enterName")); return; }
    if (!newInstruction.trim()) { toast.error(t("ps.enterInstruction")); return; }
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("author_profiles").insert({
        name: newName.trim(),
        type: "custom",
        system_instruction: newInstruction.trim(),
        user_id: user.id,
        description: newInstruction.trim().slice(0, 100),
        avatar_icon: "User",
      });
      if (error) throw error;

      toast.success(t("ps.authorCreated"));
      setCreateOpen(false);
      setNewName("");
      setNewInstruction("");
      setSampleText("");
      queryClient.invalidateQueries({ queryKey: ["author-profiles-for-writer"] });
    } catch (e: any) {
      toast.error(e.message || t("ps.createError"));
    } finally {
      setIsSaving(false);
    }
  }, [newName, newInstruction, queryClient, t]);

  return (
    <div className="space-y-3">
      <Label className="text-xs text-muted-foreground">{t("ps.authorStyle")}</Label>

      <TooltipProvider delayDuration={300}>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-1.5">
          <PersonaChip
            name={t("ps.noStyle")}
            description={t("ps.defaultCopywriter")}
            icon="User"
            isActive={!selectedId || selectedId === "none"}
            onClick={() => onSelect("none")}
          />

          {presets.map(a => (
            <PersonaChip
              key={a.id}
              name={a.name}
              description={a.description || ""}
              icon={a.avatar_icon || "User"}
              isActive={selectedId === a.id}
              onClick={() => onSelect(a.id)}
              temperature={a.temperature}
            />
          ))}
        </div>

        {(customs.length > 0 || true) && (
          <>
            <div className="flex items-center gap-2 pt-1">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Мои авторы</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-1.5">
              {customs.map(a => (
                <PersonaChip
                  key={a.id}
                  name={a.name}
                  description={a.description || a.voice_tone || ""}
                  icon={a.avatar_icon || "User"}
                  isActive={selectedId === a.id}
                  onClick={() => onSelect(a.id)}
                  isCustom
                  editable
                  author={a}
                  onEdited={(updated) => {
                    queryClient.invalidateQueries({ queryKey: ["author-profiles-for-writer"] });
                  }}
                  onDeleted={() => {
                    if (selectedId === a.id) onSelect("none");
                    queryClient.invalidateQueries({ queryKey: ["author-profiles-for-writer"] });
                  }}
                />
              ))}
              <button
                onClick={() => setCreateOpen(true)}
                className="flex h-[70px] w-full items-center justify-center gap-1 rounded-md border border-dashed border-muted-foreground/30 px-2 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground hover:bg-accent/30"
              >
                <Plus className="h-3 w-3" />
                <span>Создать автора</span>
              </button>
            </div>
          </>
        )}
      </TooltipProvider>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("ps.createStyle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">{t("ps.authorName")}</Label>
              <Input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder={t("ps.authorNamePlaceholder")}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">{t("ps.instruction")}</Label>
              <Textarea
                value={newInstruction}
                onChange={e => setNewInstruction(e.target.value)}
                placeholder={t("ps.instructionPlaceholder")}
                className="mt-1 min-h-[120px] font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">{t("ps.sampleLabel")}</Label>
              <p className="text-[10px] text-muted-foreground mb-1">
                {t("ps.sampleHint")}
              </p>
              <Textarea
                value={sampleText}
                onChange={e => setSampleText(e.target.value)}
                placeholder={t("ps.samplePlaceholder")}
                className="mt-1 min-h-[100px] text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full text-xs"
                disabled={isAnalyzing || sampleText.length < 100}
                onClick={handleAnalyzeSample}
              >
                {isAnalyzing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                {isAnalyzing ? t("ps.analyzing") : t("ps.analyzeBtn")}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleCreateAuthor} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PersonaChip({
  name, description, icon, isActive, onClick, temperature, isCustom,
  editable, author, onEdited, onDeleted,
}: {
  name: string; description: string; icon: string; isActive: boolean;
  onClick: () => void; temperature?: number; isCustom?: boolean;
  editable?: boolean; author?: AuthorProfile;
  onEdited?: (a: AuthorProfile) => void;
  onDeleted?: () => void;
}) {
  const Icon = ICON_MAP[icon] || User;
  const [editOpen, setEditOpen] = useState(false);

  const chip = (
    <button
      onClick={onClick}
      className={`
        group relative flex h-[70px] w-full items-center gap-2 rounded-md border px-2 text-left transition-all
        hover:border-primary/50 hover:bg-accent/30
        ${isActive ? "border-primary bg-primary/5" : "border-border bg-card"}
      `}
      title={description || name}
    >
      <div className={`
        flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors
        ${isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}
      `}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium leading-tight">{name}</div>
        {isCustom && (
          <div className="mt-0.5 text-[10px] text-muted-foreground">custom</div>
        )}
      </div>
      {editable && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); setEditOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setEditOpen(true); } }}
          className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus:opacity-100 cursor-pointer"
          aria-label="Редактировать автора"
        >
          <Pencil className="h-3 w-3" />
        </span>
      )}
    </button>
  );

  return (
    <Popover open={editOpen} onOpenChange={setEditOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{chip}</PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[220px]">
          <p className="text-xs font-semibold mb-1">{name}</p>
          {description && <p className="text-[10px] text-muted-foreground">{description}</p>}
          {temperature && (
            <p className="text-[10px] mt-1 text-muted-foreground">Temperature: {temperature}</p>
          )}
        </TooltipContent>
      </Tooltip>
      {editable && author && (
        <PopoverContent side="bottom" align="start" className="w-[320px] p-0">
          <EditAuthorForm
            author={author}
            onClose={() => setEditOpen(false)}
            onSaved={(a) => { onEdited?.(a); setEditOpen(false); }}
            onDeleted={() => { onDeleted?.(); setEditOpen(false); }}
          />
        </PopoverContent>
      )}
    </Popover>
  );
}

function EditAuthorForm({
  author, onClose, onSaved, onDeleted,
}: {
  author: AuthorProfile;
  onClose: () => void;
  onSaved: (a: AuthorProfile) => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(author.name || "");
  const [voice, setVoice] = useState(author.voice_tone || "");
  const [instruction, setInstruction] = useState(author.system_instruction || "");
  const [stopWords, setStopWords] = useState<string[]>(Array.isArray(author.stop_words) ? author.stop_words : []);
  const [stopInput, setStopInput] = useState("");
  const [syntax, setSyntax] = useState<string>(
    (author.style_analysis && (author.style_analysis as any).syntax_profile) || "standard"
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(author.name || "");
    setVoice(author.voice_tone || "");
    setInstruction(author.system_instruction || "");
    setStopWords(Array.isArray(author.stop_words) ? author.stop_words : []);
    setSyntax((author.style_analysis && (author.style_analysis as any).syntax_profile) || "standard");
  }, [author]);

  const addStop = () => {
    const v = stopInput.trim();
    if (!v) return;
    if (stopWords.includes(v)) { setStopInput(""); return; }
    setStopWords([...stopWords, v]);
    setStopInput("");
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error(t("ps.enterName")); return; }
    setSaving(true);
    try {
      const nextStyle = { ...(author.style_analysis || {}), syntax_profile: syntax };
      const { data, error } = await supabase
        .from("author_profiles")
        .update({
          name: name.trim(),
          voice_tone: voice.trim() || null,
          system_instruction: instruction.trim() || null,
          stop_words: stopWords,
          style_analysis: nextStyle,
        })
        .eq("id", author.id)
        .select()
        .maybeSingle();
      if (error) throw error;
      toast.success("Автор обновлен");
      onSaved((data as any) || author);
    } catch (e: any) {
      toast.error(e?.message || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      const { error } = await supabase.from("author_profiles").delete().eq("id", author.id);
      if (error) throw error;
      toast.success("Автор удален");
      onDeleted();
    } catch (e: any) {
      toast.error(e?.message || "Ошибка удаления");
    }
  };

  return (
    <div className="space-y-2.5 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Редактировать автора</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Название</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-7 text-xs" />
      </div>

      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Тон голоса</Label>
        <Input
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          placeholder="экспертный, технический"
          className="h-7 text-xs"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Стоп-слова</Label>
        <div className="flex flex-wrap gap-1">
          {stopWords.map((w) => (
            <Badge key={w} variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
              {w}
              <button
                onClick={() => setStopWords(stopWords.filter((x) => x !== w))}
                className="hover:text-destructive"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-1">
          <Input
            value={stopInput}
            onChange={(e) => setStopInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addStop(); } }}
            placeholder="+ добавить"
            className="h-7 text-xs"
          />
          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={addStop}>
            +
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Инструкция автора</Label>
        <Textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          className="min-h-[60px] text-xs font-mono"
          rows={3}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Синтаксический профиль</Label>
        <div className="grid grid-cols-2 gap-1">
          {SYNTAX_PRESETS.map((p) => (
            <label
              key={p.key}
              className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-[11px] transition-colors ${
                syntax === p.key ? "border-primary bg-primary/5" : "border-border hover:bg-accent/30"
              }`}
            >
              <input
                type="radio"
                name="syntax_profile"
                value={p.key}
                checked={syntax === p.key}
                onChange={() => setSyntax(p.key)}
                className="h-3 w-3"
              />
              <span>{p.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="mr-1 h-3 w-3" />
          Удалить
        </Button>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={onClose}>
            Отмена
          </Button>
          <Button size="sm" className="h-7 px-2 text-[11px]" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Сохранить
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить автора "{author.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Статьи созданные с этим автором останутся без изменений.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
