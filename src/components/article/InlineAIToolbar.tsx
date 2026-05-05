import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Scissors, StretchHorizontal, Baby, Lightbulb, GraduationCap, RefreshCw } from "lucide-react";

type Command = "shorter" | "longer" | "simpler" | "example" | "expert" | "rewrite";

interface Selection {
  start: number;
  end: number;
  text: string;
  rect: DOMRect;
}

interface Props {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  content: string;
  onReplace: (start: number, end: number, replacement: string) => void;
  language?: "ru" | "en";
}

const COMMANDS: { id: Command; ru: string; en: string; Icon: any }[] = [
  { id: "shorter", ru: "Короче",     en: "Shorter", Icon: Scissors },
  { id: "longer",  ru: "Длиннее",    en: "Longer",  Icon: StretchHorizontal },
  { id: "simpler", ru: "Проще",      en: "Simpler", Icon: Baby },
  { id: "example", ru: "Пример",     en: "Example", Icon: Lightbulb },
  { id: "expert",  ru: "Экспертнее", en: "Expert",  Icon: GraduationCap },
  { id: "rewrite", ru: "Перепиши",   en: "Rewrite", Icon: RefreshCw },
];

export function InlineAIToolbar({ textareaRef, content, onReplace, language = "ru" }: Props) {
  const [sel, setSel] = useState<Selection | null>(null);
  const [running, setRunning] = useState<Command | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffOrig, setDiffOrig] = useState("");
  const [diffNew, setDiffNew] = useState("");
  const [diffRange, setDiffRange] = useState<{ start: number; end: number } | null>(null);
  const lastCmdRef = useRef<Command | null>(null);

  // Track selection inside the textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const update = () => {
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;
      if (end - start < 5) { setSel(null); return; }
      const text = ta.value.slice(start, end);
      // Anchor toolbar near the bottom of the textarea selection — we don't
      // have per-character coordinates in a textarea, so use the textarea
      // viewport position with an offset.
      const taRect = ta.getBoundingClientRect();
      // Clamp toolbar inside viewport so it's always visible while editing
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const desiredTop = Math.max(72, Math.min(taRect.top + 12, vh - 60));
      const desiredLeft = Math.max(12, Math.min(taRect.left + 24, vw - 340));
      const rect = new DOMRect(desiredLeft, desiredTop, 320, 40);
      setSel({ start, end, text, rect });
    };
    const onSelChange = () => {
      if (document.activeElement === ta) update();
    };
    const onScroll = () => { if (document.activeElement === ta) update(); };
    ta.addEventListener("mouseup", update);
    ta.addEventListener("keyup", update);
    ta.addEventListener("select", update);
    ta.addEventListener("blur", () => setTimeout(() => setSel(null), 200));
    document.addEventListener("selectionchange", onSelChange);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      ta.removeEventListener("mouseup", update);
      ta.removeEventListener("keyup", update);
      ta.removeEventListener("select", update);
      document.removeEventListener("selectionchange", onSelChange);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [textareaRef]);

  const runCommand = async (cmd: Command) => {
    if (!sel || running) return;
    if (sel.text.length > 6000) {
      toast.error(language === "en" ? "Selection too long (max 6000 chars)" : "Слишком длинный фрагмент (макс 6000 символов)");
      return;
    }
    setRunning(cmd);
    lastCmdRef.current = cmd;
    try {
      const { data, error } = await supabase.functions.invoke("inline-edit", {
        body: { text: sel.text, command: cmd, language },
      });
      if (error) throw new Error(error.message);
      const rewritten = String(data?.rewritten || "").trim();
      if (!rewritten) throw new Error(language === "en" ? "Empty response" : "Пустой ответ");
      setDiffOrig(sel.text);
      setDiffNew(rewritten);
      setDiffRange({ start: sel.start, end: sel.end });
      setDiffOpen(true);
    } catch (e: any) {
      toast.error(e?.message || (language === "en" ? "AI command failed" : "Не удалось выполнить команду"));
    } finally {
      setRunning(null);
    }
  };

  const accept = () => {
    if (!diffRange) return;
    onReplace(diffRange.start, diffRange.end, diffNew);
    setDiffOpen(false);
    setSel(null);
    toast.success(language === "en" ? "Text replaced" : "Текст заменен");
  };

  const toolbar = sel && !diffOpen ? (
    <div
      className="fixed z-50 flex items-center gap-1 rounded-lg border border-border bg-popover/95 backdrop-blur-md shadow-xl p-1"
      style={{ top: sel.rect.top, left: sel.rect.left }}
      onMouseDown={(e) => e.preventDefault()} // prevent textarea blur on click
    >
      {COMMANDS.map(({ id, ru, en, Icon }) => (
        <Button
          key={id}
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs gap-1"
          disabled={!!running}
          onClick={() => runCommand(id)}
          title={language === "en" ? en : ru}
        >
          {running === id
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Icon className="h-3 w-3" />}
          <span className="hidden md:inline">{language === "en" ? en : ru}</span>
        </Button>
      ))}
    </div>
  ) : null;

  return (
    <>
      {toolbar && createPortal(toolbar, document.body)}
      <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {language === "en" ? "AI rewrite preview" : "Предпросмотр правки"}
            </DialogTitle>
            <DialogDescription>
              {language === "en"
                ? "Compare the original and the AI version, then accept or cancel."
                : "Сравните оригинал и версию ИИ, затем примите или отмените."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {language === "en" ? "Original" : "Оригинал"}
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm whitespace-pre-wrap max-h-80 overflow-auto">
                {diffOrig}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-primary">
                {language === "en" ? "AI version" : "Версия ИИ"}
              </div>
              <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm whitespace-pre-wrap max-h-80 overflow-auto">
                {diffNew}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDiffOpen(false)}>
              {language === "en" ? "Cancel" : "Отмена"}
            </Button>
            {lastCmdRef.current && (
              <Button
                variant="secondary"
                disabled={!!running}
                onClick={() => runCommand(lastCmdRef.current!)}
              >
                {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                {language === "en" ? "Try again" : "Ещё раз"}
              </Button>
            )}
            <Button onClick={accept}>
              {language === "en" ? "Replace" : "Заменить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
