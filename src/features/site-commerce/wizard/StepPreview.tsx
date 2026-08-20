import { useMemo, useState } from "react";
import { invokeErrorMessage } from "@/shared/utils/invokeError";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, Eye, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export function StepPreview({ projectId, ru }: { projectId: string; ru: boolean }) {
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [current, setCurrent] = useState<string>("");
  const [q, setQ] = useState("");

  const pages = useMemo(() => {
    const list = Object.keys(files || {}).filter((p) => p.endsWith(".html")).sort();
    const s = q.trim().toLowerCase();
    return s ? list.filter((p) => p.toLowerCase().includes(s)) : list;
  }, [files, q]);

  const build = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("site-qa-check", {
        body: { project_id: projectId, include_files: true },
      });
      if (error) throw error;
      const payload = data as { files?: Record<string, string> };
      if (!payload?.files) throw new Error(ru ? "Сборка не вернула файлы" : "Build returned no files");
      setFiles(payload.files);
      const first = Object.keys(payload.files).find((p) => p === "index.html")
        || Object.keys(payload.files).find((p) => p.endsWith(".html"))
        || "";
      setCurrent(first);
      toast.success(ru ? `Собрано страниц: ${Object.keys(payload.files).length}` : `Built files: ${Object.keys(payload.files).length}`);
    } catch (e) {
      toast.error(await invokeErrorMessage(e, "Preview failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={build} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
          {files ? (ru ? "Пересобрать" : "Rebuild") : (ru ? "Собрать превью сайта" : "Build site preview")}
        </Button>
        {files && <Badge variant="secondary">{Object.keys(files).length} {ru ? "файлов" : "files"}</Badge>}
        {files && (
          <Button variant="ghost" size="sm" onClick={build} disabled={busy}>
            <RefreshCw className="h-3.5 w-3.5 mr-2" />{ru ? "Обновить" : "Refresh"}
          </Button>
        )}
      </div>

      {!files && (
        <p className="text-sm text-muted-foreground">
          {ru
            ? "Превью собирается из того же билда, что уходит на публикацию - деплой не запускается."
            : "The preview uses the same bundle as publishing - no deploy is triggered."}
        </p>
      )}

      {files && (
        <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            <Input className="h-8" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={ru ? "Поиск страницы" : "Search page"} />
            <div className="max-h-[520px] overflow-auto rounded border border-border/60">
              {pages.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setCurrent(p)}
                  className={`block w-full text-left px-2 py-1.5 text-xs truncate border-b border-border/40 last:border-0 ${
                    current === p ? "bg-muted font-medium" : ""
                  }`}
                >
                  /{p}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded border border-border/60 overflow-hidden bg-white">
            <iframe
              title={ru ? "Превью сайта" : "Site preview"}
              sandbox=""
              srcDoc={files[current] || ""}
              className="w-full h-[560px]"
            />
          </div>
        </div>
      )}
    </div>
  );
}