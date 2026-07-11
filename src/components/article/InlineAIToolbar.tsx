import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Scissors, StretchHorizontal, Baby, Lightbulb, GraduationCap, RefreshCw } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

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
  articleId?: string | null;
}

const COMMANDS: { id: Command; labelKey: string; Icon: any }[] = [
  { id: "shorter", labelKey: "inline.shorter", Icon: Scissors },
  { id: "longer",  labelKey: "inline.longer",  Icon: StretchHorizontal },
  { id: "simpler", labelKey: "inline.simpler", Icon: Baby },
  { id: "example", labelKey: "inline.example", Icon: Lightbulb },
  { id: "expert",  labelKey: "inline.expert",  Icon: GraduationCap },
  { id: "rewrite", labelKey: "inline.rewrite", Icon: RefreshCw },
];

export function InlineAIToolbar({ textareaRef, content, onReplace, language = "ru", articleId }: Props) {
  const { t } = useI18n();
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
      // Anchor toolbar near the bottom of the textarea selection - we don't
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
      toast.error(t("inline.selectionTooLong"));
      return;
    }
    setRunning(cmd);
    lastCmdRef.current = cmd;
    try {
      const { data, error } = await supabase.functions.invoke("inline-edit", {
        body: { text: sel.text, command: cmd, language, article_id: articleId || null },
      });
      if (error) throw new Error(error.message);
      const rewritten = String(data?.rewritten || "").trim();
      if (!rewritten) throw new Error(t("inline.emptyResponse"));
      setDiffOrig(sel.text);
      setDiffNew(rewritten);
      setDiffRange({ start: sel.start, end: sel.end });
      setDiffOpen(true);
    } catch (e: any) {
      toast.error(e?.message || t("inline.commandFailed"));
    } finally {
      setRunning(null);
    }
  };

  const accept = () => {
    if (!diffRange) return;
    onReplace(diffRange.start, diffRange.end, diffNew);
    setDiffOpen(false);
    setSel(null);
    toast.success(t("inline.textReplaced"));
  };

  const toolbar = sel && !diffOpen ? (
    <div
      className="fixed z-50 flex items-center gap-1 rounded-lg border border-border bg-popover/95 backdrop-blur-md shadow-xl p-1"
      style={{ top: sel.rect.top, left: sel.rect.left }}
      onMouseDown={(e) => e.preventDefault()} // prevent textarea blur on click
    >
      {COMMANDS.map(({ id, labelKey, Icon }) => (
        <Button
          key={id}
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs gap-1"
          disabled={!!running}
          onClick={() => runCommand(id)}
          title={t(labelKey)}
        >
          {running === id
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Icon className="h-3 w-3" />}
          <span className="hidden md:inline">{t(labelKey)}</span>
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
              {t("inline.previewTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("inline.previewDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("inline.original")}
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm whitespace-pre-wrap max-h-80 overflow-auto">
                {diffOrig}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-primary">
                {t("inline.aiVersion")}
              </div>
              <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm whitespace-pre-wrap max-h-80 overflow-auto">
                {diffNew}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDiffOpen(false)}>
              {t("inline.cancel")}
            </Button>
            {lastCmdRef.current && (
              <Button
                variant="secondary"
                disabled={!!running}
                onClick={() => runCommand(lastCmdRef.current!)}
              >
                {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                {t("inline.tryAgain")}
              </Button>
            )}
            <Button onClick={accept}>
              {t("inline.replace")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
