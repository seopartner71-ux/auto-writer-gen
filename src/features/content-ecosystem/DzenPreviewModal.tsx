import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Newspaper, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EcosystemFormat } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  format: EcosystemFormat | null;
  articleKeyword?: string | null;
}

function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function DzenPreviewModal({ open, onOpenChange, format, articleKeyword }: Props) {
  const [tab, setTab] = useState<"html" | "md" | "text">("html");
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    if (open) setTab("html");
  }, [open, format?.id]);

  const plain = useMemo(() => stripMarkdown(format?.content || ""), [format?.content]);

  if (!format) return null;

  const logCopy = (variant: "html" | "markdown" | "plain") => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (!uid) return;
      supabase.from("activation_events").insert({
        user_id: uid,
        event_name: "format_content_copied",
        session_id: "app",
        metadata: { format_type: "dzen", variant, ecosystem_id: format.ecosystem_id },
      }).then(() => {}, () => {});
    });
  };

  const copy = async (value: string, variant: "html" | "markdown" | "plain") => {
    try {
      await navigator.clipboard.writeText(value || "");
      toast.success("Скопировано. Вставьте в редактор Дзена");
      logCopy(variant);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const { error: uErr } = await supabase
        .from("ecosystem_formats")
        .update({ status: "pending", progress: 0, error_reason: null, content: null, content_html: null })
        .eq("id", format.id);
      if (uErr) throw uErr;
      const { error } = await supabase.functions.invoke("generate-dzen", {
        body: { ecosystem_id: format.ecosystem_id, format_id: format.id },
      });
      if (error) throw error;
      toast.success("Запустили перегенерацию");
      const { data } = await supabase.auth.getUser();
      if (data.user?.id) {
        supabase.from("activation_events").insert({
          user_id: data.user.id,
          event_name: "format_regenerated",
          session_id: "app",
          metadata: { format_type: "dzen", ecosystem_id: format.ecosystem_id },
        }).then(() => {}, () => {});
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Не удалось перезапустить генерацию");
    } finally {
      setRegenerating(false);
    }
  };

  const modelLabel = format.model_used?.includes("opus")
    ? "Сгенерирован на Claude Opus 4"
    : "Сгенерирован на Claude Haiku 4.5";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Newspaper className="h-5 w-5 text-primary" />
            Статья для Яндекс.Дзен{articleKeyword ? `: ${articleKeyword}` : ""}
          </DialogTitle>
          <div className="pt-1">
            <Badge variant="outline" className="text-[10px] font-normal">{modelLabel}</Badge>
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="self-start">
            <TabsTrigger value="html">HTML</TabsTrigger>
            <TabsTrigger value="md">Markdown</TabsTrigger>
            <TabsTrigger value="text">Plain text</TabsTrigger>
          </TabsList>

          <TabsContent value="html" className="flex-1 mt-3 overflow-auto pr-2">
            <div className="mx-auto max-w-[640px] py-4">
              <article
                className="prose prose-lg max-w-none dark:prose-invert prose-headings:font-semibold prose-h1:text-3xl prose-h2:text-xl prose-p:leading-relaxed"
                dangerouslySetInnerHTML={{ __html: format.content_html || "" }}
              />
            </div>
          </TabsContent>

          <TabsContent value="md" className="flex-1 mt-3 overflow-auto pr-2">
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed bg-muted/40 rounded p-4">
              {format.content || ""}
            </pre>
          </TabsContent>

          <TabsContent value="text" className="flex-1 mt-3 overflow-auto pr-2">
            <pre className="whitespace-pre-wrap text-sm leading-relaxed">
              {plain}
            </pre>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between gap-2 pt-3 border-t">
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" onClick={() => copy(format.content_html || "", "html")}>
              <Copy className="h-4 w-4 mr-2" /> Копировать HTML
            </Button>
            <Button size="sm" variant="outline" onClick={() => copy(format.content || "", "markdown")}>
              <Copy className="h-4 w-4 mr-2" /> Копировать Markdown
            </Button>
            <Button size="sm" variant="outline" onClick={() => copy(plain, "plain")}>
              <Copy className="h-4 w-4 mr-2" /> Копировать текст
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={regenerate} disabled={regenerating}>
            {regenerating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            Перегенерировать
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}