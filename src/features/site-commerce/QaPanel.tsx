import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, ShieldCheck, FileDown } from "lucide-react";
import JSZip from "jszip";
import { saveAs } from "file-saver";

interface Issue { level: string; kind: string; page: string; detail?: string }
interface Report { pages: number; errors: number; warnings: number; score: number; ok: boolean; issues: Issue[] }

const KIND_RU: Record<string, string> = {
  missing_title: "Нет title",
  long_title: "Длинный title",
  missing_description: "Нет description",
  long_description: "Длинный description",
  missing_h1: "Нет H1",
  multiple_h1: "Несколько H1",
  missing_canonical: "Нет canonical",
  foreign_canonical: "Чужой canonical",
  img_without_alt: "Картинки без alt",
  broken_internal_link: "Битая внутренняя ссылка",
  duplicate_title: "Дубликат title",
  missing_sitemap: "Нет sitemap.xml",
  missing_robots: "Нет robots.txt",
};

export function QaPanel({ projectId, ru, siteName }: { projectId: string; ru: boolean; siteName: string }) {
  const [busy, setBusy] = useState<"qa" | "zip" | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const run = async (withFiles: boolean) => {
    setBusy(withFiles ? "zip" : "qa");
    try {
      const { data, error } = await supabase.functions.invoke("site-qa-check", {
        body: { project_id: projectId, include_files: withFiles },
      });
      if (error) throw error;
      const rep = (data as any)?.report as Report;
      setReport(rep);
      if (withFiles) {
        const files = (data as any)?.files as Record<string, string>;
        if (!files) throw new Error(ru ? "Сборка не вернула файлы" : "Build returned no files");
        const zip = new JSZip();
        for (const [path, content] of Object.entries(files)) zip.file(path, content);
        const blob = await zip.generateAsync({ type: "blob" });
        saveAs(blob, `${(siteName || "site").replace(/[^\w-]+/g, "-").toLowerCase()}.zip`);
        toast.success(ru ? "ZIP сформирован" : "ZIP ready");
      } else {
        toast.success(ru ? `QA готов: ${rep?.score}/100` : `QA done: ${rep?.score}/100`);
      }
    } catch (e: any) {
      toast.error(e?.message || "QA failed");
    } finally {
      setBusy(null);
    }
  };

  const color = !report ? "" : report.score >= 70 ? "text-green-500" : report.score >= 30 ? "text-yellow-500" : "text-destructive";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => run(false)} disabled={!!busy}>
          {busy === "qa" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
          {ru ? "Проверить сайт" : "Run QA"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => run(true)} disabled={!!busy}>
          {busy === "zip" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown className="h-4 w-4 mr-2" />}
          {ru ? "Экспорт в ZIP" : "Export ZIP"}
        </Button>
      </div>

      {report && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className={color}>Score: {report.score}/100</Badge>
            <Badge variant="outline">{ru ? "Страниц" : "Pages"}: {report.pages}</Badge>
            <Badge variant="outline" className={report.errors ? "text-destructive" : "text-green-500"}>
              {ru ? "Ошибки" : "Errors"}: {report.errors}
            </Badge>
            <Badge variant="outline" className="text-yellow-500">{ru ? "Замечания" : "Warnings"}: {report.warnings}</Badge>
          </div>
          <div className="max-h-64 overflow-auto rounded border border-border/60 text-xs">
            {report.issues.map((i, idx) => (
              <div key={idx} className="flex gap-2 p-2 border-b border-border/40 last:border-0">
                <span className={i.level === "error" ? "text-destructive" : "text-yellow-500"}>
                  {ru ? (KIND_RU[i.kind] || i.kind) : i.kind}
                </span>
                <span className="text-muted-foreground truncate">{i.page}</span>
                {i.detail && <span className="text-muted-foreground/70 truncate">{i.detail}</span>}
              </div>
            ))}
            {!report.issues.length && (
              <div className="p-3 text-green-500">{ru ? "Проблем не найдено" : "No issues found"}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}