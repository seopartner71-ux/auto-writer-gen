import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeErrorMessage } from "@/shared/utils/invokeError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Play, RefreshCw, AlertTriangle, UserCog } from "lucide-react";

interface PageRow {
  registry_id: string;
  url_path: string;
  page_type: string;
  status: "PASS" | "REVIEW" | "FAIL";
  score: number;
  missing_blocks: string[];
  missing_factors: string[];
}

interface Groups {
  TRUST: { score: number };
  CONTACT: { score: number };
  PURCHASE: { score: number };
  CONVERSION: { score: number };
}

interface Summary {
  commercial_pages: number;
  pass: number;
  review: number;
  fail: number;
  page_coverage: number;
  commercial_coverage: number;
  trust_score: number;
  conversion_score: number;
  groups: Groups;
}

const STATUS_COLOR: Record<string, string> = {
  PASS: "text-emerald-500",
  REVIEW: "text-amber-500",
  FAIL: "text-red-500",
};

export function CommercialFactorsPanel({
  projectId, ru, onOpenProfile,
}: { projectId: string; ru: boolean; onOpenProfile?: () => void }) {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "PASS" | "REVIEW" | "FAIL">("all");
  const [selected, setSelected] = useState<string[]>([]);

  const call = useCallback(async (mode: string) => {
    const { data, error } = await supabase.functions.invoke("commercial-engine", {
      body: { project_id: projectId, mode, registry_ids: selected, limit: 25 },
    });
    if (error) throw error;
    const d = data as { summary?: Summary; pages?: PageRow[]; results?: unknown[] };
    if (d.summary) setSummary(d.summary);
    if (d.pages) setPages(d.pages);
    return d;
  }, [projectId, selected]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await call("analyze");
    } catch (e) {
      toast.error(await invokeErrorMessage(e, "commercial engine failed"));
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  const run = useCallback(async (mode: "missing" | "all" | "only_fail" | "selected") => {
    setRunning(mode);
    try {
      const d = await call(mode);
      const s = d.summary;
      toast.success(ru
        ? `Готово: PASS ${s?.pass ?? 0}, REVIEW ${s?.review ?? 0}, FAIL ${s?.fail ?? 0}`
        : `Done: PASS ${s?.pass ?? 0}, REVIEW ${s?.review ?? 0}, FAIL ${s?.fail ?? 0}`);
      setSelected([]);
      await call("analyze");
    } catch (e) {
      toast.error(await invokeErrorMessage(e, "commercial engine failed"));
    } finally {
      setRunning(null);
    }
  }, [call, ru]);

  const filtered = useMemo(
    () => pages.filter((p) => filter === "all" || p.status === filter),
    [pages, filter],
  );

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const coverage = [
    { label: "TRUST", value: summary?.groups?.TRUST?.score ?? 0 },
    { label: "CONTACT", value: summary?.groups?.CONTACT?.score ?? 0 },
    { label: ru ? "ПОКУПКА" : "PURCHASE", value: summary?.groups?.PURCHASE?.score ?? 0 },
    { label: "CTA", value: summary?.groups?.CONVERSION?.score ?? 0 },
    { label: ru ? "СТРАНИЦЫ" : "PAGES", value: summary?.page_coverage ?? 0 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" />Trust and Conversion
        </Badge>
        <span className="text-xs text-muted-foreground">
          {ru ? "Коммерческих страниц" : "Commercial pages"}: {summary?.commercial_pages ?? 0}
        </span>
        {onOpenProfile && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={onOpenProfile}>
            <UserCog className="h-3.5 w-3.5 mr-2" />{ru ? "Заполнить профиль" : "Fill profile"}
          </Button>
        )}
        <Button size="sm" className={onOpenProfile ? "" : "ml-auto"} disabled={!!running} onClick={() => void run("missing")}>
          {running === "missing" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Play className="h-3.5 w-3.5 mr-2" />}
          {ru ? "Только отсутствующие" : "Only missing"}
        </Button>
        <Button size="sm" variant="outline" disabled={!!running} onClick={() => void run("only_fail")}>
          <AlertTriangle className="h-3.5 w-3.5 mr-2" />{ru ? "Генерировать блоки (FAIL)" : "Generate blocks (FAIL)"}
        </Button>
        <Button size="sm" variant="ghost" disabled={!!running || !selected.length} onClick={() => void run("selected")}>
          <RefreshCw className="h-3.5 w-3.5 mr-2" />
          {ru ? `Перегенерировать (${selected.length})` : `Regenerate (${selected.length})`}
        </Button>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        {coverage.map((c) => (
          <div key={c.label} className="rounded border border-border/60 p-3 space-y-2">
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className={`text-lg font-semibold ${c.value >= 70 ? "text-emerald-500" : c.value >= 30 ? "text-amber-500" : "text-red-500"}`}>
              {c.value}%
            </div>
            <Progress value={c.value} className="h-1" />
          </div>
        ))}
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 text-xs">
        <div className="rounded border border-border/60 p-3">
          <div className="text-muted-foreground">commercial_coverage</div>
          <div className="text-lg font-semibold">{summary?.commercial_coverage ?? 0}</div>
        </div>
        <div className="rounded border border-border/60 p-3">
          <div className="text-muted-foreground">trust_score</div>
          <div className="text-lg font-semibold">{summary?.trust_score ?? 0}</div>
        </div>
        <div className="rounded border border-border/60 p-3">
          <div className="text-muted-foreground">conversion_score</div>
          <div className="text-lg font-semibold">{summary?.conversion_score ?? 0}</div>
        </div>
        <div className="rounded border border-border/60 p-3">
          <div className="text-muted-foreground">PASS / REVIEW / FAIL</div>
          <div className="text-lg font-semibold">
            <span className={STATUS_COLOR.PASS}>{summary?.pass ?? 0}</span>
            {" / "}
            <span className={STATUS_COLOR.REVIEW}>{summary?.review ?? 0}</span>
            {" / "}
            <span className={STATUS_COLOR.FAIL}>{summary?.fail ?? 0}</span>
          </div>
        </div>
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
              <th className="p-2 text-left">{ru ? "Страница" : "Page"}</th>
              <th className="p-2 text-left">{ru ? "Тип" : "Type"}</th>
              <th className="p-2 text-left">{ru ? "Недостающие факторы" : "Missing factors"}</th>
              <th className="p-2 text-left">Score</th>
              <th className="p-2 text-left">{ru ? "Статус" : "Status"}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.registry_id} className="border-t border-border/40 align-top">
                <td className="p-2">
                  <Checkbox checked={selected.includes(p.registry_id)} onCheckedChange={() => toggle(p.registry_id)} />
                </td>
                <td className="p-2 font-mono">{p.url_path}</td>
                <td className="p-2">{p.page_type}</td>
                <td className="p-2 max-w-[360px] text-muted-foreground">
                  {[...p.missing_blocks, ...p.missing_factors].join(", ") || (ru ? "нет" : "none")}
                </td>
                <td className="p-2">{p.score}</td>
                <td className={`p-2 font-semibold ${STATUS_COLOR[p.status] || ""}`}>{p.status}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-muted-foreground">
                  {ru ? "Коммерческие блоки еще не рассчитаны" : "No commercial data yet"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
