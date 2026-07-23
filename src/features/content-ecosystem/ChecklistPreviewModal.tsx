import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Download, FileText, Loader2 } from "lucide-react";
import { EcosystemFormat } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  format: EcosystemFormat | null;
}

export function ChecklistPreviewModal({ open, onOpenChange, format }: Props) {
  const [tab, setTab] = useState<"pdf" | "md">("pdf");
  useEffect(() => {
    if (!format?.pdf_url) setTab("md");
  }, [format?.pdf_url]);

  if (!format) return null;

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
              <TabsTrigger value="pdf" disabled={!format.pdf_url}>PDF</TabsTrigger>
              <TabsTrigger value="md">Markdown</TabsTrigger>
            </TabsList>
            {format.pdf_url && (
              <Button asChild size="sm" variant="outline">
                <a href={format.pdf_url} target="_blank" rel="noreferrer" download>
                  <Download className="h-4 w-4 mr-2" /> Скачать PDF
                </a>
              </Button>
            )}
          </div>

          <TabsContent value="pdf" className="flex-1 mt-3">
            {format.pdf_url ? (
              <iframe
                src={format.pdf_url}
                title="Чек-лист PDF"
                className="w-full h-full rounded border border-border bg-white"
              />
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