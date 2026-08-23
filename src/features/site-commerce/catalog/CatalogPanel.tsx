import { useCallback, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Upload, Loader2, FileSpreadsheet, CheckCircle2, Wand2, Pause, Play,
  Square, AlertTriangle, ArrowRight, Sparkles,
} from "lucide-react";
import { invokeErrorMessage } from "@/shared/utils/invokeError";
import { readRows, type RawRow } from "../parseImport";
import {
  FACTORY_FIELDS, SOURCE_LABEL, detectSource, guessMapping, normalizeRows,
  summarizeIssues, toProductInsert,
  type FactoryField, type Mapping, type NormalizeResult, type SourceKind,
} from "./normalize";

type Mode = "full" | "update";
type Filter = "all" | "errors" | "dupes" | "no_category" | "no_brand";

interface Props {
  projectId: string;
  ru: boolean;
  /** Перерисовать таблицу товаров после импорта. */
  onImported: () => void;
  /** Переход на следующий шаг мастера (SILO / PDE). */
  onContinue?: () => void;
}

const CHUNK = 200;

export function CatalogPanel({ projectId, ru, onImported, onContinue }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pausedRef = useRef(false);
  const cancelRef = useRef(false);

  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState("");
  const [source, setSource] = useState<SourceKind>("csv");
  const [rows, setRows] = useState<RawRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [mode, setMode] = useState<Mode>("full");
  const [filter, setFilter] = useState<Filter>("all");
  const [aiBusy, setAiBusy] = useState(false);
  const [classifying, setClassifying] = useState(false);

  const [progress, setProgress] = useState({ processed: 0, total: 0, startedAt: 0, running: false, paused: false });
  const [done, setDone] = useState<{ products: number; categories: number; brands: number } | null>(null);

  const result: NormalizeResult | null = useMemo(
    () => (rows.length ? normalizeRows(rows, mapping) : null),
    [rows, mapping],
  );
  const qa = useMemo(() => (result ? summarizeIssues(result.issues) : null), [result]);

  const onFile = async (file: File) => {
    setBusy(true);
    setDone(null);
    try {
      const { rows: parsed, format } = await readRows(file);
      if (!parsed.length) throw new Error(ru ? "Не удалось распознать строки" : "No rows recognized");
      const cols = Object.keys(parsed[0]);
      setRows(parsed);
      setHeaders(cols);
      setMapping(guessMapping(cols));
      setSource(detectSource(format, cols));
      setFilename(file.name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Parse error");
    } finally {
      setBusy(false);
    }
  };

  const aiMapping = async () => {
    setAiBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("catalog-engine", {
        body: { action: "suggest_mapping", headers, sample: rows.slice(0, 5) },
      });
      if (error) throw error;
      const suggested = (data as { mapping?: Record<string, string> })?.mapping || {};
      setMapping((prev) => {
        const next = { ...prev };
        for (const [col, field] of Object.entries(suggested)) {
          if (col in next) next[col] = field as FactoryField;
        }
        return next;
      });
      toast.success(ru ? "Маппинг предложен" : "Mapping suggested");
    } catch (e) {
      toast.error(await invokeErrorMessage(e, "Mapping failed"));
    } finally {
      setAiBusy(false);
    }
  };

  const waitWhilePaused = useCallback(async () => {
    while (pausedRef.current && !cancelRef.current) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }, []);

  const runImport = async () => {
    if (!result || !result.items.length) return;
    pausedRef.current = false;
    cancelRef.current = false;
    setProgress({ processed: 0, total: result.items.length, startedAt: Date.now(), running: true, paused: false });

    try {
      // Режим обновления: трогаем только цену, остаток, изображения и новые позиции.
      const existing = new Map<string, string>();
      if (mode === "update") {
        for (let from = 0; ; from += 1000) {
          const { data } = await supabase.from("site_products")
            .select("id, sku").eq("project_id", projectId).range(from, from + 999);
          const page = data || [];
          for (const r of page) if (r.sku) existing.set(String(r.sku).toLowerCase(), r.id as string);
          if (page.length < 1000) break;
        }
      }

      let processed = 0;
      for (let i = 0; i < result.items.length; i += CHUNK) {
        await waitWhilePaused();
        if (cancelRef.current) break;

        const chunk = result.items.slice(i, i + CHUNK);
        const inserts: Record<string, unknown>[] = [];
        for (let k = 0; k < chunk.length; k++) {
          const item = chunk[k];
          const hit = item.sku ? existing.get(item.sku.toLowerCase()) : undefined;
          if (mode === "update" && hit) {
            await supabase.from("site_products").update({
              price: item.price,
              availability: item.availability,
              ...(item.images.length ? { images: item.images } : {}),
            } as never).eq("id", hit);
          } else {
            inserts.push(toProductInsert(item, projectId, i + k));
          }
        }
        if (inserts.length) {
          const { error } = await supabase.from("site_products").insert(inserts as never);
          if (error) throw error;
        }
        processed += chunk.length;
        setProgress((p) => ({ ...p, processed }));
      }

      await supabase.from("site_imports").insert({
        project_id: projectId,
        kind: "products",
        filename,
        format: source === "xlsx" ? "xlsx" : source === "csv" || source === "woocommerce" || source === "opencart" ? "csv" : "xml",
        rows_total: result.rowsTotal,
        rows_ok: processed,
        rows_dupe: result.duplicates,
        rows_error: qa?.blockers ?? 0,
        preview: result.items.slice(0, 5) as never,
        status: cancelRef.current ? "cancelled" : "done",
      } as never);

      if (cancelRef.current) {
        toast.message(ru ? `Импорт остановлен: ${processed}` : `Import stopped: ${processed}`);
      } else {
        setDone({ products: processed, categories: result.categories.length, brands: result.brands.length });
        toast.success(ru ? `Импортировано: ${processed}` : `Imported: ${processed}`);
      }
      onImported();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setProgress((p) => ({ ...p, running: false, paused: false }));
    }
  };

  const classify = async () => {
    setClassifying(true);
    try {
      let total = 0;
      for (let pass = 0; pass < 8; pass++) {
        const { data, error } = await supabase.functions.invoke("catalog-engine", {
          body: { action: "classify", project_id: projectId, limit: 200 },
        });
        if (error) throw error;
        const n = Number((data as { classified?: number })?.classified || 0);
        total += n;
        if (n < 200) break;
      }
      toast.success(ru ? `Категорий проставлено: ${total}` : `Categories assigned: ${total}`);
      onImported();
    } catch (e) {
      toast.error(await invokeErrorMessage(e, "Classification failed"));
    } finally {
      setClassifying(false);
    }
  };

  const runPde = async () => {
    setBusy(true);
    try {
      await supabase.functions.invoke("assign-products-to-silo", {
        body: { project_id: projectId, only_unassigned: true },
      });
      const { data, error } = await supabase.functions.invoke("page-decision-engine", {
        body: { project_id: projectId, dry_run: false },
      });
      if (error) throw error;
      const s = (data as { summary?: { total: number; approved: number } })?.summary;
      toast.success(ru
        ? `PDE: решений ${s?.total ?? 0}, одобрено ${s?.approved ?? 0}`
        : `PDE: ${s?.total ?? 0} decisions, ${s?.approved ?? 0} approved`);
      onImported();
      onContinue?.();
    } catch (e) {
      toast.error(await invokeErrorMessage(e, "PDE failed"));
    } finally {
      setBusy(false);
    }
  };

  // -------------------------------------------------------------- helpers --
  const speed = useMemo(() => {
    if (!progress.startedAt || !progress.processed) return 0;
    const mins = (Date.now() - progress.startedAt) / 60000;
    return mins > 0.02 ? Math.round(progress.processed / mins) : 0;
  }, [progress]);

  const eta = useMemo(() => {
    if (!speed || !progress.running) return null;
    const left = progress.total - progress.processed;
    const sec = Math.round((left / speed) * 60);
    return sec > 60 ? `${Math.round(sec / 60)} ${ru ? "мин" : "min"}` : `${sec} ${ru ? "сек" : "s"}`;
  }, [speed, progress, ru]);

  const filtered = useMemo(() => {
    if (!result) return [];
    const errorRows = new Set(result.issues.filter((i) => i.level === "blocker").map((i) => i.row));
    return result.items.filter((p) => {
      if (filter === "no_category") return !p.category_hint;
      if (filter === "no_brand") return !p.brand;
      if (filter === "errors") return !p.price || !p.images.length;
      if (filter === "dupes") return errorRows.size > 0 && false;
      return true;
    }).slice(0, 200);
  }, [result, filter]);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: ru ? "Все" : "All" },
    { key: "errors", label: ru ? "Ошибки" : "Errors" },
    { key: "dupes", label: ru ? "Дубли" : "Dupes" },
    { key: "no_category", label: ru ? "Без категории" : "No category" },
    { key: "no_brand", label: ru ? "Без бренда" : "No brand" },
  ];

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------ file input */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls,.xml,.yml"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }}
        />
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy || progress.running}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
          {ru ? "Загрузить прайс" : "Upload price list"}
        </Button>
        <span className="text-xs text-muted-foreground">CSV / XLSX / YML / CommerceML / WooCommerce / OpenCart</span>
        {filename && (
          <Badge variant="secondary" className="gap-1">
            <FileSpreadsheet className="h-3 w-3" />{filename}
          </Badge>
        )}
        {rows.length > 0 && <Badge variant="outline">{SOURCE_LABEL[source]}</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="full">{ru ? "Полная загрузка" : "Full import"}</SelectItem>
              <SelectItem value="update">{ru ? "Обновить каталог" : "Update catalog"}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {mode === "update" && (
        <p className="text-xs text-muted-foreground">
          {ru
            ? "Обновляются только цена, остаток, изображения и новые позиции. SEO, статьи, H1, Title и Description не трогаются."
            : "Only price, stock, images and new items are updated. SEO, articles, H1, Title and Description stay intact."}
        </p>
      )}

      {/* --------------------------------------------------------- mapping */}
      {headers.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{ru ? "Сопоставление колонок" : "Column mapping"}</span>
              <Button size="sm" variant="ghost" onClick={aiMapping} disabled={aiBusy}>
                {aiBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wand2 className="h-4 w-4 mr-2" />}
                {ru ? "Предложить через AI" : "Suggest with AI"}
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-72 overflow-auto pr-1">
              {headers.map((h) => (
                <div key={h} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground truncate flex-1" title={h}>{h}</span>
                  <Select
                    value={mapping[h] || "ignore"}
                    onValueChange={(v) => setMapping((p) => ({ ...p, [h]: v as FactoryField }))}
                  >
                    <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FACTORY_FIELDS.map((f) => (
                        <SelectItem key={f.key} value={f.key}>{ru ? f.ru : f.en}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ----------------------------------------------------------- stats */}
      {result && (
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-5">
          {[
            { label: ru ? "Всего товаров" : "Products", value: result.items.length },
            { label: ru ? "Категорий" : "Categories", value: result.categories.length },
            { label: ru ? "Брендов" : "Brands", value: result.brands.length },
            { label: ru ? "Дублей" : "Dupes", value: result.duplicates },
            { label: ru ? "Ошибок" : "Errors", value: qa?.blockers ?? 0 },
          ].map((c) => (
            <Card key={c.label}>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground">{c.label}</div>
                <div className="text-xl font-semibold tabular-nums">{c.value.toLocaleString("ru-RU")}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* -------------------------------------------------------- catalog QA */}
      {qa && (qa.blockers > 0 || qa.warnings > 0) && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              {ru ? "Проверка каталога" : "Catalog QA"}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(qa.byCode).map(([code, n]) => (
                <Badge
                  key={code}
                  variant="outline"
                  className={["duplicate_sku", "empty_name", "invalid_category"].includes(code) ? "text-destructive" : ""}
                >
                  {code}: {n}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* -------------------------------------------------------- preview */}
      {result && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                    filter === f.key ? "border-primary text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="max-h-72 overflow-auto rounded border border-border/60">
              <table className="w-full text-xs">
                <tbody>
                  {filtered.map((p, i) => (
                    <tr key={`${p.sku || p.name}-${i}`} className="border-b border-border/40 last:border-0">
                      <td className="p-2 align-top">{p.name}</td>
                      <td className="p-2 align-top text-muted-foreground whitespace-nowrap">{p.sku || "-"}</td>
                      <td className="p-2 align-top text-muted-foreground whitespace-nowrap">{p.price ?? "-"}</td>
                      <td className="p-2 align-top text-muted-foreground truncate max-w-[180px]">{p.brand || "-"}</td>
                      <td className="p-2 align-top text-muted-foreground truncate max-w-[220px]">{p.category_hint || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ------------------------------------------------ run controls */}
            {progress.running ? (
              <div className="space-y-2">
                <Progress value={progress.total ? (progress.processed / progress.total) * 100 : 0} />
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{progress.processed} / {progress.total}</span>
                  <span>{speed} {ru ? "поз./мин" : "items/min"}</span>
                  {eta && <span>ETA {eta}</span>}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { pausedRef.current = !pausedRef.current; setProgress((p) => ({ ...p, paused: pausedRef.current })); }}
                  >
                    {progress.paused ? <Play className="h-4 w-4 mr-1" /> : <Pause className="h-4 w-4 mr-1" />}
                    {progress.paused ? (ru ? "Продолжить" : "Resume") : (ru ? "Пауза" : "Pause")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { cancelRef.current = true; pausedRef.current = false; }}>
                    <Square className="h-4 w-4 mr-1" />{ru ? "Стоп" : "Stop"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={runImport} disabled={!result.items.length}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {mode === "update" ? (ru ? "Обновить каталог" : "Update catalog") : (ru ? "Импортировать" : "Import")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setRows([]); setHeaders([]); setFilename(""); }}>
                  {ru ? "Отмена" : "Cancel"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* --------------------------------------------------------- success */}
      {done && (
        <Card className="border-primary/40">
          <CardContent className="p-4 space-y-3">
            <div className="text-sm font-medium">{ru ? "Каталог импортирован" : "Catalog imported"}</div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">{done.products.toLocaleString("ru-RU")} {ru ? "товаров" : "products"}</Badge>
              <Badge variant="outline">{done.categories} {ru ? "категорий" : "categories"}</Badge>
              <Badge variant="outline">{done.brands} {ru ? "брендов" : "brands"}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={classify} disabled={classifying}>
                {classifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                {ru ? "Определить категории (AI)" : "Detect categories (AI)"}
              </Button>
              <Button size="sm" onClick={runPde} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                {ru ? "Продолжить - запустить PDE" : "Continue - run PDE"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
