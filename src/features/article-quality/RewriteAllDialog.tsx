import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface RewriteAllDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  complianceResult: any;
  setComplianceResult: (r: any) => void;
  complianceCheckedLenRef: React.MutableRefObject<number>;
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;
  setStreamPhase: (p: "thinking" | "writing" | null) => void;
  abortRef: React.MutableRefObject<AbortController | null>;
  content: string;
  setContent: (c: string) => void;
  selectedKeywordId: string;
  selectedAuthorId: string;
  outline: any;
  lsiKeywords: string[];
  currentArticleId: string | null;
  title: string;
  snapshotVersion: (a: any) => void;
}

/**
 * Dialog: rewrite the whole article fixing every compliance deviation.
 * Extracted from ArticlesPage as part of Step 5 refactor.
 */
export function RewriteAllDialog(props: RewriteAllDialogProps) {
  const {
    open, onOpenChange, complianceResult, setComplianceResult, complianceCheckedLenRef,
    isStreaming, setIsStreaming, setStreamPhase, abortRef,
    content, setContent, selectedKeywordId, selectedAuthorId, outline, lsiKeywords,
    currentArticleId, title, snapshotVersion,
  } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            Переписать статью с учётом всех отклонений
          </DialogTitle>
          <DialogDescription>
            ИИ получит список найденных нарушений и перепишет проблемные фрагменты, сохранив структуру и объём.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {complianceResult && (
            <div className="max-h-[200px] overflow-y-auto scrollbar-hide space-y-1 text-[11px]">
              {complianceResult.deviations.map((d: any, i: number) => (
                <div key={i} className="p-1.5 rounded border border-border bg-muted/30">
                  <span className="font-medium">{d.category}:</span> {d.rule}
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={isStreaming}>
              Отмена
            </Button>
            <Button
              className="flex-1"
              disabled={isStreaming || !complianceResult || complianceResult.deviations.length === 0 || !selectedKeywordId}
              onClick={async () => {
                if (!complianceResult) return;
                onOpenChange(false);
                const rules = complianceResult.deviations.map((d: any, i: number) =>
                  `${i + 1}. [${d.severity}/${d.category}] ${d.rule}\n   Цитата: «${d.quote}»\n   Что сделать: ${d.suggestion || "переписать в стиле автора"}`
                ).join("\n\n");
                const instruction =
                  `Перепиши статью, ИСПРАВИВ следующие отклонения от инструкции автора. Сохрани структуру, заголовки, объём и факты. Меняй ТОЛЬКО проблемные фрагменты.\n\nОТКЛОНЕНИЯ:\n${rules}`;
                setIsStreaming(true);
                setStreamPhase("thinking");
                const prevContent = content;
                snapshotVersion({
                  articleId: currentArticleId,
                  content: prevContent,
                  title: title || undefined,
                  reason: "rewrite",
                });
                setContent("");
                const controller = new AbortController();
                abortRef.current = controller;
                try {
                  const { data: { session: freshSession }, error: refreshError } = await supabase.auth.refreshSession();
                  const token = freshSession?.access_token;
                  if (refreshError || !token) throw new Error("Not authenticated");
                  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-article`;
                  const resp = await fetch(url, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${token}`,
                      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                    },
                    body: JSON.stringify({
                      keyword_id: selectedKeywordId,
                      author_profile_id: (selectedAuthorId && selectedAuthorId !== "none") ? selectedAuthorId : null,
                      outline,
                      lsi_keywords: lsiKeywords,
                      optimize_instructions: instruction,
                      existing_content: prevContent,
                    }),
                    signal: controller.signal,
                  });
                  if (!resp.ok) {
                    const err = await resp.json().catch(() => ({ error: "Unknown" }));
                    throw new Error(err.error || `HTTP ${resp.status}`);
                  }
                  if (!resp.body) throw new Error("No stream body");
                  const reader = resp.body.getReader();
                  const decoder = new TextDecoder();
                  let buffer = "";
                  let fullContent = "";
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    let ni: number;
                    while ((ni = buffer.indexOf("\n")) !== -1) {
                      let line = buffer.slice(0, ni);
                      buffer = buffer.slice(ni + 1);
                      if (line.endsWith("\r")) line = line.slice(0, -1);
                      if (!line.startsWith("data: ")) continue;
                      const jsonStr = line.slice(6).trim();
                      if (jsonStr === "[DONE]") break;
                      try {
                        const parsed = JSON.parse(jsonStr);
                        const delta = parsed.choices?.[0]?.delta?.content;
                        if (delta) { if (!fullContent) setStreamPhase("writing"); fullContent += delta; setContent(fullContent); }
                      } catch { buffer = line + "\n" + buffer; break; }
                    }
                  }
                  setComplianceResult(null);
                  complianceCheckedLenRef.current = 0;
                  toast.success("Статья переписана. Запустите проверку заново.");
                } catch (e: any) {
                  if (e.name === "AbortError") toast.info("Переписывание остановлено");
                  else { toast.error(e.message); setContent(prevContent); }
                } finally {
                  setIsStreaming(false);
                  setStreamPhase(null);
                  abortRef.current = null;
                }
              }}
            >
              <Wand2 className="h-3 w-3 mr-1" />
              Переписать
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}