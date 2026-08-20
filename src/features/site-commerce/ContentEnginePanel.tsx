import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Play, RefreshCw, Sparkles } from "lucide-react";

interface RunStats {
  pending?: number; generated?: number; fallbacks?: number; thin?: number;
  expanded?: number; failed?: number; profile_coverage?: number;
  profile_missing?: string[]; registry_used?: boolean;
}

type Mode = "missing" | "failed" | "thin" | "all";

export function ContentEnginePanel({ projectId, ru }: { projectId: string; ru: boolean }) {
  const [running, setRunning] = useState(false);
  const [loop, setLoop] = useState(true);
  const [mode, setMode] = useState<Mode>("missing");
  const [stats, setStats] = useState<RunStats | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [log, setLog] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const tables = ["site_products", "site_clusters", "site_silos"] as const;
    const acc: Record<string, number> = { ready: 0, thin: 0, failed: 0, pending: 0 };
    for (const t of tables) {
      const { data } = await supabase.from(t).select("content_status").eq("project_id", projectId).neq("status", "archived");
      for (const r of data || []) {
        const k = (r as { content_status: string | null }).content_status || "pending";
        acc[k] = (acc[k] || 0) + 1;
      }
    }
    setCounts(acc);
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const runBatch = async () => {
    setRunning(true);
    setLog([]);
    try {
      let guard = 0;
      let pending = 1;
      while (pending > 0 && guard < 12) {
        guard++;
        const { data, error } = await supabase.functions.invoke("generate-commerce-content", {
          body: {
            project_id: projectId,
            limit: 20,
            use_registry: true,
            only_missing: mode === "missing",
            only_failed: mode === "failed",
            include_thin: mode === "thin" || mode === "all",
            force: mode === "all",
          },
        });
        if (error) throw error;
        const s = data as RunStats;
        setStats(s);
        setLog((l) => [
          ...l,
          `${ru ? "Партия" : "Batch"} ${guard}: +${s.generated ?? 0} ${ru ? "готово" : "ready"}, ${s.thin ?? 0} thin, ${s.failed ?? 0} fail, ${s.pending ?? 0} ${ru ? "в очереди" : "queued"}`,
        ]);
        pending = s.pending ?? 0;
        await refresh();
      }

      if (loop) {
        const { data: q, error: qe } = await supabase.functions.invoke("page-quality-engine", {
          body: { project_id: projectId },
        });
        if (qe) throw qe;
        const sum = (q as { summary?: { pass: number; review: number; fail: number } }).summary;
        if (sum) {
          setLog((l) => [...l, `Quality: PASS ${sum.pass} / REVIEW ${sum.review} / FAIL ${sum.fail}`]);
        }
      }
      toast.success(ru ? "Генерация завершена" : "Generation finished");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const MODES: { id: Mode; label: string }[] = [
    { id: "missing", label: ru ? "Без контента" : "Missing" },
    { id: "failed", label: ru ? "Ошибки" : "Failed" },
    { id: "thin", label: ru ? "Тонкие" : "Thin" },
    { id: "all", label: ru ? "Все заново" : "Regenerate all" },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4" />
          {ru ? "Контент по решениям реестра" : "Content from the page registry"}
        </div>
        <p className="text-xs text-muted-foreground">
          {ru
            ? "Генерируются только страницы со статусом approved или review. Тип текста берется из Page Type, требования - из профиля качества."
            : "Only approved or review pages are generated. Copy type comes from the page type, requirements from the quality profile."}
        </p>

        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <Button key={m.id} size="sm" variant={mode === m.id ? "default" : "outline"} onClick={() => setMode(m.id)}>
              {m.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={loop} onCheckedChange={setLoop} />
            {ru ? "Пересчитать качество после генерации" : "Re-run quality after generation"}
          </label>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={refresh} disabled={running}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={runBatch} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              <span className="ml-1">{ru ? "Запустить" : "Run"}</span>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="default">ready {counts.ready || 0}</Badge>
          <Badge variant="secondary">thin {counts.thin || 0}</Badge>
          <Badge variant="destructive">failed {counts.failed || 0}</Badge>
          <Badge variant="outline">pending {counts.pending || 0}</Badge>
          {typeof stats?.profile_coverage === "number" && (
            <Badge variant={stats.profile_coverage >= 70 ? "default" : "secondary"}>
              {ru ? "профиль" : "profile"} {stats.profile_coverage}%
            </Badge>
          )}
        </div>

        {stats && stats.profile_coverage !== undefined && stats.profile_coverage < 50 && (
          <p className="text-xs text-orange-500">
            {ru
              ? "Профиль компании заполнен слабо - коммерческие блоки останутся неполными, пока не добавлены доставка, оплата, гарантия и CTA."
              : "The company profile is sparse - commercial blocks stay incomplete until delivery, payment, warranty and CTA are filled in."}
          </p>
        )}
      </div>

      {log.length > 0 && (
        <div className="rounded-lg border p-4 space-y-1 font-mono text-xs">
          {log.map((l, i) => <div key={i} className="text-muted-foreground">{l}</div>)}
        </div>
      )}
    </div>
  );
}
