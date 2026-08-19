import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { QaPanel } from "../QaPanel";

interface Issue { level: string; kind: string; page: string; detail?: string }
interface Report { pages: number; critical: number; warnings: number; score: number; issues?: Issue[] }

export function StepQa({ projectId, ru, siteName }: { projectId: string; ru: boolean; siteName: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [coverage, setCoverage] = useState({ covered: 0, total: 0 });

  const load = useCallback(async () => {
    const [{ data: proj }, keys] = await Promise.all([
      supabase.from("projects").select("last_qa_report").eq("id", projectId).maybeSingle(),
      supabase.from("site_keywords").select("id, site_cluster_id").eq("project_id", projectId).limit(5000),
    ]);
    setReport(((proj as unknown as { last_qa_report: Report | null } | null)?.last_qa_report) || null);
    const rows = (keys.data || []) as { site_cluster_id: string | null }[];
    setCoverage({ covered: rows.filter((r) => r.site_cluster_id).length, total: rows.length });
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const count = (kinds: string[]) =>
    (report?.issues || []).filter((i) => kinds.includes(i.kind)).length;

  const pct = coverage.total ? Math.round((coverage.covered / coverage.total) * 100) : 0;

  const tiles = [
    { label: "Critical", value: report?.critical ?? 0, bad: (report?.critical ?? 0) > 0 },
    { label: "Warning", value: report?.warnings ?? 0, bad: false },
    { label: "Orphan", value: count(["orphan_page", "orphan_product"]), bad: count(["orphan_page", "orphan_product"]) > 0 },
    { label: ru ? "Битые ссылки" : "Broken links", value: count(["broken_internal_link"]), bad: count(["broken_internal_link"]) > 0 },
    { label: "Coverage", value: `${pct}%`, bad: pct < 50 },
    { label: "Schema", value: count(["invalid_schema", "missing_breadcrumb_schema"]), bad: count(["invalid_schema", "missing_breadcrumb_schema"]) > 0 },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.label} className="rounded border border-border/60 p-3">
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className={`text-xl font-semibold mt-1 tabular-nums ${t.bad ? "text-destructive" : ""}`}>{t.value}</div>
          </div>
        ))}
      </div>
      <QaPanel projectId={projectId} ru={ru} siteName={siteName} />
      <p className="text-xs text-muted-foreground">
        {ru
          ? "Метрики берутся из последнего QA-отчета - запустите проверку выше, чтобы обновить их."
          : "Metrics come from the latest QA report - run the check above to refresh."}
      </p>
      <button type="button" className="text-xs underline text-muted-foreground" onClick={() => void load()}>
        {ru ? "Обновить метрики" : "Refresh metrics"}
      </button>
    </div>
  );
}