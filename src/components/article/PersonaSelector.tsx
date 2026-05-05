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

function PersonaCard({
  name, description, icon, isActive, onClick, temperature, isCustom,
}: {
  name: string; description: string; icon: string; isActive: boolean;
  onClick: () => void; temperature?: number; isCustom?: boolean;
}) {
  const Icon = ICON_MAP[icon] || User;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={`
            flex min-h-[112px] w-full flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-center transition-all
            hover:border-primary/50 hover:bg-accent/50
            ${isActive ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card"}
          `}
        >
          <div className={`
            flex items-center justify-center h-9 w-9 rounded-full transition-colors
            ${isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}
          `}>
            <Icon className="h-4 w-4" />
          </div>
          <span className="text-[11px] font-medium leading-tight line-clamp-2">{name}</span>
          {isActive && <Check className="h-3 w-3 text-primary" />}
          {isCustom && <Badge variant="outline" className="text-[8px] px-1 py-0">custom</Badge>}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[220px]">
        <p className="text-xs font-semibold mb-1">{name}</p>
        <p className="text-[10px] text-muted-foreground">{description}</p>
        {temperature && (
          <p className="text-[10px] mt-1 text-muted-foreground">Temperature: {temperature}</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
