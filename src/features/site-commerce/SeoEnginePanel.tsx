import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, Search, Play, RefreshCw, AlertTriangle } from "lucide-react";
import { useGenerationJob } from "./queue/useGenerationJob";
import { QueueJobCard } from "./queue/QueueJobCard";

interface SeoRow {
  id: string;
  registry_id: string;
  url_path: string;
  page_type: string;
  title: string | null;
  meta_description: string | null;
  h1: string | null;
  canonical: string | null;
  robots: string | null;
  schema_type: string | null;
  faq: { q: string; a: string }[] | null;
  seo_status: "PASS" | "REVIEW" | "FAIL";
  seo_issues: { code: string; severity: string; detail?: string }[] | null;
}

const STATUS_COLOR: Record<string, string> = {
  PASS: "text-emerald-500",
  REVIEW: "text-amber-500",
  FAIL: "text-red-500",
};

export function SeoEnginePanel({ projectId, ru }: { projectId: string; ru: boolean }) {
  const [rows, setRows] = useState<SeoRow[]>([]);
  const [registryTotal, setRegistryTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "PASS" | "REVIEW" | "FAIL">("all");
  const [selected, setSelected] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [seoRes, regRes] = await Promise.all([
        supabase.from("page_seo").select("*").eq("project_id", projectId).order("url_path"),
        supabase.from("page_registry").select("id", { count: "exact", head: true })
          .eq("project_id", projectId).in("status", ["approved", "review"]),
      ]);
      if (seoRes.error) throw seoRes.error;
      setRows((seoRes.data || []) as unknown as SeoRow[]);
      setRegistryTotal(regRes.count || 0);
    } catch (e) {
      toast.error(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const queue = useGenerationJob(projectId, "seo", () => { void load(); });

  const run = useCallback(async (mode: "missing" | "all" | "only_fail" | "selected") => {
    setRunning(mode);
    try {
      const res = await queue.start({ mode, registry_ids: mode === "selected" ? selected : undefined });
      if (res) {
        toast.success(ru
          ? "Задача запущена - генерация идет в фоне"
          : "Job started - generation runs in the background");
        setSelected([]);
      }
    } finally {
      setRunning(null);
    }
  }, [queue, selected, ru]);


  const stats = useMemo(() => {
    const has = (r: SeoRow, code: string) => (r.seo_issues || []).some((i) => i.code === code);
    return {
      ready: rows.filter((r) => r.seo_status === "PASS").length,
      missingMeta: rows.filter((r) => has(r, "description_missing") || has(r, "title_missing") || has(r, "description_length")).length,
      duplicateTitle: rows.filter((r) => has(r, "duplicate_title")).length,
      missingSchema: rows.filter((r) => !r.schema_type || has(r, "schema_missing")).length,
      faqReady: rows.filter((r) => (r.faq || []).length > 0 && !has(r, "faq_count")).length,
      notGenerated: Math.max(0, registryTotal - rows.length),
    };
  }, [rows, registryTotal]);

  const filtered = useMemo(
    () => rows.filter((r) => filter === "all" || r.seo_status === filter),
    [rows, filter],
  );

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="flex items-center gap-1.5">
          <Search className="h-3.5 w-3.5" />SEO Engine
        </Badge>
        <span className="text-xs text-muted-foreground">
          {ru ? "Страниц в реестре" : "Registry pages"}: {registryTotal}
        </span>
        <Button size="sm" className="ml-auto" disabled={!!running || queue.active} onClick={() => run("missing")}>
          {running === "missing" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Play className="h-3.5 w-3.5 mr-2" />}
          {ru ? "Сгенерировать SEO" : "Generate SEO"}
        </Button>
        <Button size="sm" variant="outline" disabled={!!running || queue.active} onClick={() => run("only_fail")}>
          <AlertTriangle className="h-3.5 w-3.5 mr-2" />{ru ? "Только FAIL" : "Only FAIL"}
        </Button>
        <Button size="sm" variant="ghost" disabled={!!running || queue.active || !selected.length} onClick={() => run("selected")}>
          <RefreshCw className="h-3.5 w-3.5 mr-2" />
          {ru ? `Перегенерировать (${selected.length})` : `Regenerate (${selected.length})`}
        </Button>
      </div>

      <QueueJobCard
        job={queue.job}
        resumable={queue.resumable}
        speed={queue.speed}
        ru={ru}
        busy={queue.busy}
        title={ru ? "Генерация SEO-метаданных" : "SEO metadata generation"}
        onPause={queue.pause}
        onResume={queue.resume}
        onCancel={queue.cancel}
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        {[
          { label: "SEO Ready", value: stats.ready, cls: STATUS_COLOR.PASS },
          { label: ru ? "Нет мета" : "Missing Meta", value: stats.missingMeta, cls: STATUS_COLOR.REVIEW },
          { label: ru ? "Дубли Title" : "Duplicate Title", value: stats.duplicateTitle, cls: STATUS_COLOR.FAIL },
          { label: ru ? "Нет Schema" : "Missing Schema", value: stats.missingSchema, cls: STATUS_COLOR.FAIL },
          { label: "FAQ Ready", value: stats.faqReady, cls: STATUS_COLOR.PASS },
        ].map((c) => (
          <div key={c.label} className="rounded border border-border/60 p-3">
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className={`text-lg font-semibold ${c.cls}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "PASS", "REVIEW", "FAIL"] as const).map((s) => (
          <Button key={s} size="sm" variant={filter === s ? "secondary" : "ghost"} onClick={() => setFilter(s)}>
            {s === "all" ? (ru ? "Все" : "All") : s}
          </Button>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="overflow-x-auto rounded border border-border/60">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="w-8 p-2" />
              <th className="p-2 text-left">URL</th>
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-left">Title</th>
              <th className="p-2 text-left">Schema</th>
              <th className="p-2 text-left">FAQ</th>
              <th className="p-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-border/40 align-top">
                <td className="p-2">
                  <Checkbox
                    checked={selected.includes(r.registry_id)}
                    onCheckedChange={() => toggle(r.registry_id)}
                  />
                </td>
                <td className="p-2 font-mono">{r.url_path}</td>
                <td className="p-2">{r.page_type}</td>
                <td className="p-2 max-w-[320px]">
                  <div>{r.title}</div>
                  <div className="text-muted-foreground">{r.title?.length ?? 0} {ru ? "симв." : "chars"}</div>
                  {!!(r.seo_issues || []).length && (
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {(r.seo_issues || []).map((i) => i.code + (i.detail ? ` (${i.detail})` : "")).join(", ")}
                    </div>
                  )}
                </td>
                <td className="p-2">{r.schema_type}</td>
                <td className="p-2">{(r.faq || []).length}</td>
                <td className={`p-2 font-semibold ${STATUS_COLOR[r.seo_status] || ""}`}>{r.seo_status}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-muted-foreground">
                  {ru ? "SEO-пакеты еще не сгенерированы" : "No SEO packages yet"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {stats.notGenerated > 0 && (
        <div className="text-xs text-muted-foreground">
          {ru
            ? `Без SEO-пакета: ${stats.notGenerated} страниц реестра`
            : `Without SEO package: ${stats.notGenerated} registry pages`}
        </div>
      )}
    </div>
  );
}
