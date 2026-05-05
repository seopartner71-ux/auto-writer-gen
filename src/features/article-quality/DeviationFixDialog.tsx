import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Wand2, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ActiveDeviation { idx: number; quote: string }

interface DeviationFixDialogProps {
  activeDeviation: ActiveDeviation | null;
  onClose: () => void;
  complianceResult: any;
  content: string;
  setContent: (c: string) => void;
  selectedAuthorId: string;
}

/**
 * Dialog to fix a single author-compliance deviation by rewriting the
 * sentence/paragraph or deleting the offending fragment. Extracted from
 * ArticlesPage as part of Step 5 refactor — behaviour identical.
 */
export function DeviationFixDialog({
  activeDeviation, onClose, complianceResult, content, setContent, selectedAuthorId,
}: DeviationFixDialogProps) {
  const [isRewritingFragment, setIsRewritingFragment] = useState(false);

  const handleClose = (open: boolean) => {
    if (!open) { onClose(); setIsRewritingFragment(false); }
  };

  return (
    <Dialog open={!!activeDeviation} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        {activeDeviation && complianceResult?.deviations[activeDeviation.idx] && (() => {
          const dev = complianceResult.deviations[activeDeviation.idx];
          const escRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const findFragmentRange = (scope: "sentence" | "paragraph"): { match: string; before: string; after: string } | null => {
            const orig = activeDeviation.quote.trim();
            if (!orig) return null;
            let idx = content.indexOf(orig);
            let matched = orig;
            if (idx === -1) {
              const re = new RegExp(escRegex(orig).replace(/\s+/g, "\\s+"), "i");
              const m = re.exec(content);
              if (!m) return null;
              idx = m.index;
              matched = m[0];
            }
            const end = idx + matched.length;
            if (scope === "paragraph") {
              const before = content.slice(0, idx);
              const after = content.slice(end);
              const startMatches = [
                before.lastIndexOf("\n\n"),
                before.lastIndexOf("</p>"),
                before.lastIndexOf("</h1>"),
                before.lastIndexOf("</h2>"),
                before.lastIndexOf("</h3>"),
                before.lastIndexOf("</li>"),
                before.lastIndexOf("</ul>"),
                before.lastIndexOf("</ol>"),
                before.lastIndexOf("<p>"),
              ];
              let startCut = Math.max(...startMatches);
              if (startCut < 0) startCut = 0;
              else {
                const slice = before.slice(startCut);
                startCut += slice.search(/\S/) >= 0 ? slice.indexOf(slice.trim()[0]) : 0;
              }
              const endMatches = [
                after.indexOf("\n\n"),
                after.indexOf("</p>"),
                after.indexOf("<h1"),
                after.indexOf("<h2"),
                after.indexOf("<h3"),
                after.indexOf("<p>"),
                after.indexOf("<ul"),
                after.indexOf("<ol"),
              ].filter(n => n >= 0);
              let endCut = endMatches.length ? Math.min(...endMatches) : after.length;
              const closingP = after.indexOf("</p>");
              if (closingP >= 0 && closingP === endCut) endCut += "</p>".length;
              return {
                match: content.slice(startCut, end + endCut),
                before: content.slice(0, startCut),
                after: content.slice(end + endCut),
              };
            }
            const sentStart = (() => {
              const slice = content.slice(0, idx);
              const m = slice.match(/[.!?…]["»)\s]*\s+(?=\S[^.!?…]*$)/);
              if (!m) return 0;
              return slice.length - (slice.length - (m.index || 0)) + m[0].length;
            })();
            const sentEnd = (() => {
              const slice = content.slice(end);
              const m = slice.match(/[^.!?…]*[.!?…]+["»)]?/);
              return end + (m ? m[0].length : slice.length);
            })();
            return {
              match: content.slice(sentStart, sentEnd),
              before: content.slice(0, sentStart),
              after: content.slice(sentEnd),
            };
          };

          const handleRewrite = async (scope: "sentence" | "paragraph") => {
            const range = findFragmentRange(scope);
            if (!range) { toast.error("Не удалось найти фрагмент в тексте"); return; }
            setIsRewritingFragment(true);
            try {
              const { data: { session } } = await supabase.auth.getSession();
              const token = session?.access_token;
              if (!token) throw new Error("Not authenticated");
              const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rewrite-fragment`;
              const resp = await fetch(url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                  apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                },
                body: JSON.stringify({
                  fragment: range.match,
                  scope,
                  author_profile_id: selectedAuthorId,
                  violations: (complianceResult?.deviations || []).map((d: any) => ({
                    category: d.category, rule: d.rule, suggestion: d.suggestion,
                  })),
                  context_before: range.before,
                  context_after: range.after,
                }),
              });
              const data = await resp.json();
              if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
              const rewritten = (data.rewritten || "").toString().trim();
              if (!rewritten) throw new Error("Пустой ответ");
              setContent(range.before + rewritten + range.after);
              toast.success(scope === "paragraph" ? "Абзац переписан с учётом требований автора" : "Предложение переписано с учётом требований автора");
              onClose();
            } catch (e: any) {
              toast.error(e.message || "Ошибка переписывания");
            } finally {
              setIsRewritingFragment(false);
            }
          };

          return (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-warning" />
                  Правка отклонения
                </DialogTitle>
                <DialogDescription>
                  <span className="font-medium text-foreground">{dev.category}</span> · {dev.rule}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-[11px] text-muted-foreground">Цитата из статьи</Label>
                  <div className="mt-1 p-2 rounded-md bg-muted/50 border border-border text-xs italic">
                    «{activeDeviation.quote}»
                  </div>
                </div>
                {dev.suggestion && (
                  <div className="text-[11px] text-muted-foreground">
                    Подсказка ИИ: <span className="text-foreground">{dev.suggestion}</span>
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground">
                  ИИ перепишет фрагмент строго по инструкции автора, исправив все найденные нарушения. Факты сохранятся.
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="default"
                    className="w-full"
                    disabled={isRewritingFragment || !selectedAuthorId || selectedAuthorId === "none"}
                    onClick={() => handleRewrite("sentence")}
                  >
                    {isRewritingFragment ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}
                    Переписать предложение
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={isRewritingFragment || !selectedAuthorId || selectedAuthorId === "none"}
                    onClick={() => handleRewrite("paragraph")}
                  >
                    {isRewritingFragment ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}
                    Переписать абзац
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  className="w-full text-destructive hover:text-destructive"
                  disabled={isRewritingFragment}
                  onClick={() => {
                    const orig = activeDeviation.quote.trim();
                    if (!orig) return;
                    if (content.includes(orig)) {
                      setContent(content.replace(orig, ""));
                      toast.success("Фрагмент удален из текста");
                      onClose();
                    } else {
                      const re = new RegExp(escRegex(orig).replace(/\s+/g, "\\s+"), "i");
                      if (re.test(content)) {
                        setContent(content.replace(re, ""));
                        toast.success("Фрагмент удален из текста");
                        onClose();
                      } else {
                        toast.error("Не удалось найти фрагмент");
                      }
                    }
                  }}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Удалить фрагмент из текста
                </Button>
                <Button variant="ghost" className="w-full" onClick={onClose}>
                  Отмена
                </Button>
              </div>
            </>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}