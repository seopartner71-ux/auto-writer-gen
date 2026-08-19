import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Upload, Loader2, FileSpreadsheet, CheckCircle2 } from "lucide-react";
import {
  readRows, mapKeywords, mapProducts, slugifyRu,
  type ImportKind, type KeywordRow, type ProductRow, type ParseResult,
} from "./parseImport";

interface Props { projectId: string; kind: ImportKind; onImported: () => void; ru: boolean }

export function ImportPanel({ projectId, kind, onImported, ru }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState("");
  const [preview, setPreview] = useState<ParseResult<KeywordRow | ProductRow> | null>(null);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const { rows, format } = await readRows(file);
      const result = kind === "keywords" ? mapKeywords(rows, format) : mapProducts(rows, format);
      setFilename(file.name);
      setPreview(result as ParseResult<KeywordRow | ProductRow>);
      if (!result.rowsOk) toast.error(ru ? "Не удалось распознать строки" : "No rows recognized");
    } catch (e: any) {
      toast.error(e?.message || "Parse error");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const chunkSize = 300;
      const rows = preview.rows as any[];
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const payload = kind === "keywords"
          ? chunk.map((r: KeywordRow) => ({ project_id: projectId, ...r }))
          : chunk.map((r: ProductRow, idx: number) => ({
              project_id: projectId,
              external_id: r.external_id,
              sku: r.sku,
              name: r.name,
              slug: slugifyRu(r.name) || `item-${i + idx + 1}`,
              price: r.price,
              currency: r.currency,
              brand: r.brand,
              availability: r.availability,
              description: r.description,
              characteristics: r.characteristics,
              images: r.images,
              source_url: r.source_url,
              kind: "product",
              position: i + idx,
            }));
        const { error } = await supabase.from(kind === "keywords" ? "site_keywords" : "site_products").insert(payload as any);
        if (error) throw error;
      }
      await supabase.from("site_imports").insert({
        project_id: projectId,
        kind,
        filename,
        format: preview.format,
        rows_total: preview.rowsTotal,
        rows_ok: preview.rowsOk,
        rows_dupe: preview.rowsDupe,
        rows_error: preview.rowsError,
        preview: preview.rows.slice(0, 5) as any,
        status: "done",
      } as any);
      toast.success(ru ? `Импортировано: ${preview.rowsOk}` : `Imported: ${preview.rowsOk}`);
      setPreview(null);
      setFilename("");
      onImported();
    } catch (e: any) {
      toast.error(e?.message || "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls,.xml,.yml"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }}
        />
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
          {ru ? "Выбрать файл" : "Choose file"}
        </Button>
        <span className="text-xs text-muted-foreground">CSV / XLSX / XML (YML)</span>
        {filename && <Badge variant="secondary" className="gap-1"><FileSpreadsheet className="h-3 w-3" />{filename}</Badge>}
      </div>

      {preview && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">{ru ? "Строк" : "Rows"}: {preview.rowsTotal}</Badge>
              <Badge variant="outline" className="text-green-500">{ru ? "Валидных" : "Valid"}: {preview.rowsOk}</Badge>
              <Badge variant="outline">{ru ? "Дубли" : "Dupes"}: {preview.rowsDupe}</Badge>
              <Badge variant="outline" className={preview.rowsError ? "text-destructive" : ""}>
                {ru ? "Ошибки" : "Errors"}: {preview.rowsError}
              </Badge>
            </div>
            <div className="max-h-52 overflow-auto rounded border border-border/60">
              <table className="w-full text-xs">
                <tbody>
                  {preview.rows.slice(0, 12).map((r: any, i) => (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      <td className="p-2 align-top">{r.keyword || r.name}</td>
                      <td className="p-2 align-top text-muted-foreground whitespace-nowrap">
                        {kind === "keywords" ? (r.frequency ?? "-") : (r.price ?? "-")}
                      </td>
                      <td className="p-2 align-top text-muted-foreground truncate max-w-[220px]">
                        {kind === "keywords" ? (r.cluster_hint || r.intent || "") : (r.brand || r.category_hint || "")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={commit} disabled={busy || !preview.rowsOk}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                {ru ? "Импортировать" : "Import"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPreview(null)} disabled={busy}>
                {ru ? "Отмена" : "Cancel"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}