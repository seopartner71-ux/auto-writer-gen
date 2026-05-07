import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sparkles, Loader2, RotateCcw, Wand2 } from "lucide-react";
import { toast } from "sonner";

interface AuthorRow {
  id: string;
  name: string;
  niche: string | null;
  system_instruction: string | null;
  system_instruction_backup: string | null;
  prompt_improved_at: string | null;
}

export function AuthorPromptImproverTab() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [preview, setPreview] = useState<{
    authorId: string; name: string; original: string; improved: string; backupPresent: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: authors = [], isLoading } = useQuery({
    queryKey: ["admin-author-prompts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("author_profiles")
        .select("id, name, niche, system_instruction, system_instruction_backup, prompt_improved_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AuthorRow[];
    },
  });

  async function generatePreview(a: AuthorRow): Promise<boolean> {
    if (!a.system_instruction || a.system_instruction.trim().length < 10) {
      toast.error(`У "${a.name}" нет системного промпта для улучшения`);
      return false;
    }
    setBusyId(a.id);
    try {
      const { data, error } = await supabase.functions.invoke("improve-author-prompt", {
        body: { author_id: a.id },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setPreview({
        authorId: a.id,
        name: a.name,
        original: data.original,
        improved: data.improved,
        backupPresent: !!data.backup_present,
      });
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка улучшения");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function saveImproved(authorId: string, original: string, improved: string, backupPresent: boolean) {
    setSaving(true);
    try {
      const update: Record<string, unknown> = {
        system_instruction: improved,
        prompt_improved_at: new Date().toISOString(),
      };
      if (!backupPresent) update.system_instruction_backup = original;
      const { error } = await supabase.from("author_profiles").update(update).eq("id", authorId);
      if (error) throw error;
      toast.success("Промпт сохранен");
      setPreview(null);
      qc.invalidateQueries({ queryKey: ["admin-author-prompts"] });
      qc.invalidateQueries({ queryKey: ["author-profiles"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  async function restoreBackup(a: AuthorRow) {
    if (!a.system_instruction_backup) return;
    if (!confirm(`Восстановить оригинальный промпт автора "${a.name}"?`)) return;
    const { error } = await supabase
      .from("author_profiles")
      .update({ system_instruction: a.system_instruction_backup, prompt_improved_at: null })
      .eq("id", a.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Оригинал восстановлен");
    qc.invalidateQueries({ queryKey: ["admin-author-prompts"] });
    qc.invalidateQueries({ queryKey: ["author-profiles"] });
  }

  async function improveAll() {
    const target = authors.filter(a => (a.system_instruction || "").trim().length >= 10);
    if (!target.length) { toast.error("Нет авторов с промптом"); return; }
    if (!confirm(`Улучшить и автоматически сохранить промпты у ${target.length} авторов? Оригиналы будут забэкаплены.`)) return;
    setBulkRunning(true);
    let ok = 0, fail = 0;
    for (const a of target) {
      try {
        const { data, error } = await supabase.functions.invoke("improve-author-prompt", {
          body: { author_id: a.id },
        });
        if (error || data?.error) { fail++; continue; }
        const update: Record<string, unknown> = {
          system_instruction: data.improved,
          prompt_improved_at: new Date().toISOString(),
        };
        if (!data.backup_present) update.system_instruction_backup = data.original;
        const { error: uErr } = await supabase.from("author_profiles").update(update).eq("id", a.id);
        if (uErr) { fail++; continue; }
        ok++;
      } catch { fail++; }
    }
    setBulkRunning(false);
    toast.success(`Готово. Улучшено: ${ok}, ошибок: ${fail}`);
    qc.invalidateQueries({ queryKey: ["admin-author-prompts"] });
    qc.invalidateQueries({ queryKey: ["author-profiles"] });
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-primary" /> Улучшение промптов авторов
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Расширяет короткий промпт до подробного через Claude Opus 4. Оригинал сохраняется в backup.
            </p>
          </div>
          <Button
            size="sm"
            onClick={improveAll}
            disabled={bulkRunning || authors.length === 0}
            className="gap-1.5"
          >
            {bulkRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Улучшить всех авторов
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {authors.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Нет авторов</p>
          ) : (
            authors.map((a) => {
              const len = (a.system_instruction || "").length;
              const improved = !!a.prompt_improved_at;
              return (
                <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-md border border-border bg-muted/30">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{a.name}</span>
                      {a.niche && <span className="text-xs text-muted-foreground truncate">- {a.niche}</span>}
                      {improved && (
                        <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
                          улучшен
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground">{len} симв.</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {a.system_instruction_backup && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5"
                        onClick={() => restoreBackup(a)}
                        disabled={bulkRunning}
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Откатить
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => generatePreview(a)}
                      disabled={busyId === a.id || bulkRunning}
                    >
                      {busyId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      Улучшить
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Сравнение промптов: {preview?.name}</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-hidden">
              <div className="flex flex-col min-h-0">
                <div className="text-xs font-semibold text-muted-foreground mb-2">
                  Оригинал ({preview.original.length} симв.)
                </div>
                <div className="flex-1 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                  {preview.original}
                </div>
              </div>
              <div className="flex flex-col min-h-0">
                <div className="text-xs font-semibold text-primary mb-2 flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> Улучшенный ({preview.improved.length} симв.)
                </div>
                <div className="flex-1 overflow-auto rounded-md border border-primary/30 bg-primary/[0.04] p-3 text-xs whitespace-pre-wrap">
                  {preview.improved}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPreview(null)} disabled={saving}>Отменить</Button>
            <Button
              onClick={() => preview && saveImproved(preview.authorId, preview.original, preview.improved, preview.backupPresent)}
              disabled={saving}
              className="gap-1.5"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
