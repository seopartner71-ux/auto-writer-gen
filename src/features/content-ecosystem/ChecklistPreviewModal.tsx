import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Download, FileText, Loader2, AlertTriangle, RotateCcw, Copy } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { EcosystemFormat } from "./types";
import { Client } from "./types";
import { ChecklistDeployBlock } from "./ChecklistDeployBlock";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  format: EcosystemFormat | null;
  client?: Pick<Client, "id" | "github_username" | "github_token_encrypted"> | null;
}

export function ChecklistPreviewModal({ open, onOpenChange, format, client }: Props) {
  const [tab, setTab] = useState<"pdf" | "md">("pdf");
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    // Keep PDF tab default so partial-status users see the error surface.
    if (format?.pdf_url) setTab("pdf");
    else setTab("pdf");
  }, [format?.pdf_url]);

  if (!format) return null;

  const pdfMissing = !format.pdf_url;
  const isPartial = format.status === "partial" || pdfMissing;

  const handleRetryPdf = async () => {
    if (!format) return;
    setRetrying(true);
    try {
      const { error } = await supabase.functions.invoke("retry-checklist-pdf", {
        body: { ecosystem_format_id: format.id },
      });
      if (error) throw error;
      toast.success("PDF пересобирается, обновим через секунду");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось повторить генерацию PDF");
    } finally {
      setRetrying(false);
    }
  };

  const handleCopyMd = async () => {
    try {
      await navigator.clipboard.writeText(format.content || "");
      toast.success("Markdown скопирован");
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Чек-лист
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="pdf">PDF</TabsTrigger>
              <TabsTrigger value="md">Markdown</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={handleCopyMd}>
                <Copy className="h-4 w-4 mr-2" /> Копировать markdown
              </Button>
              {format.pdf_url ? (
                <Button asChild size="sm" variant="outline">
                  <a href={format.pdf_url} target="_blank" rel="noreferrer" download>
                    <Download className="h-4 w-4 mr-2" /> Скачать PDF
                  </a>
                </Button>
              ) : (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button size="sm" variant="outline" disabled>
                          <Download className="h-4 w-4 mr-2" /> Скачать PDF
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>PDF недоступен</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>

          {format && (
            <ChecklistDeployBlock
              formatId={format.id}
              formatType={format.format_type}
              client={client}
            />
          )}

          <TabsContent value="pdf" className="flex-1 mt-3">
            {format.pdf_url && !isPartial ? (
              <iframe
                src={format.pdf_url}
                title="Чек-лист PDF"
                className="w-full h-full rounded border border-border bg-white"
              />
            ) : isPartial ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-3">
                <AlertTriangle className="h-10 w-10 text-amber-500" />
                <p className="text-sm font-medium">PDF не удалось сгенерировать</p>
                {format.error_reason && (
                  <p className="text-xs text-muted-foreground max-w-md break-words">
                    Причина: {format.error_reason}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Текст чек-листа готов — переключитесь на вкладку Markdown или пересоберите PDF.
                </p>
                <Button size="sm" onClick={handleRetryPdf} disabled={retrying} className="mt-2">
                  {retrying ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4 mr-2" />
                  )}
                  Повторить генерацию PDF
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> PDF готовится...
              </div>
            )}
          </TabsContent>

          <TabsContent value="md" className="flex-1 mt-3 overflow-auto pr-2">
            <article className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown>{format.content || ""}</ReactMarkdown>
            </article>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}