// P19 - Deployment Center: readiness dashboard, build, release and history
// on top of the existing build/QA/visual engines.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Loader2, Hammer, Rocket, History, Search, ExternalLink } from "lucide-react";
import { invokeErrorMessage } from "@/shared/utils/invokeError";
import { StepDeploy } from "./StepDeploy";

interface Check { key: string; ok: boolean; value: string; reason_ru?: string; reason_en?: string }
interface Readiness {
  checks: Check[];
  can_deploy: boolean;
  blockers_ru: string[];
  blockers_en: string[];
  visual_score: number;
  qa_critical: number;
  pages: number;
}
interface DeploymentRow {
  id: string; provider: string; status: string; url: string | null; domain: string | null;
  pages_count: number | null; error: string | null; created_at: string; deployed_at: string | null;
}

const LABEL_RU: Record<string, string> = {
  registry: "Реестр страниц",
  content: "Контент готов",
  seo: "SEO готов",
  visual: "Дизайн готов",
  qa: "QA пройден",
};
const LABEL_EN: Record<string, string> = {
  registry: "Page registry",
  content: "Content ready",
  seo: "SEO ready",
  visual: "Visual ready",
  qa: "QA passed",
};

const STATUS_COLOR: Record<string, string> = {
  success: "text-emerald-500",
  ready: "text-emerald-500",
  failed: "text-red-500",
  deploying: "text-amber-500",
  building: "text-amber-500",
};

export function DeploymentCenter({ projectId, ru, siteName }: { projectId: string; ru: boolean; siteName: string }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [rows, setRows] = useState<DeploymentRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [productionUrl, setProductionUrl] = useState<string>("");

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("deployment-engine", {
      body: { project_id: projectId, action, ...extra },
    });
    if (error) throw new Error(await invokeErrorMessage(error, ru ? "Ошибка Deployment Engine" : "Deployment Engine failed"));
    return data as Record<string, unknown>;
  }, [projectId, ru]);

  const load = useCallback(async () => {
    try {
      const [r, h] = await Promise.all([call("readiness"), call("history")]);
      setReadiness((r?.readiness as Readiness) || null);
      setRows((h?.deployments as DeploymentRow[]) || []);
    } catch {
      setReadiness(null);
    }
  }, [call]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from("projects")
        .select("production_url, deployment_url, published_at").eq("id", projectId).maybeSingle();
      if (!alive) return;
      const p = (data || {}) as Record<string, string | null>;
      setProductionUrl(p.production_url || p.deployment_url || "");
    })();
    return () => { alive = false; };
  }, [projectId, rows.length]);

  const sendToIndex = async () => {
    setBusy("index");
    try {
      const res = await call("index");
      const results = (res?.results as { provider: string; status: string }[]) || [];
      toast.success((ru ? "Отправлено на индексацию: " : "Sent for indexing: ")
        + (results.map((r) => `${r.provider}=${r.status}`).join(", ") || "ok"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Indexing failed");
    } finally { setBusy(null); }
  };

  const build = async () => {
    setBusy("build");
    try {
      const res = await call("build");
      setReadiness((res?.readiness as Readiness) || readiness);
      toast.success(ru ? "Сборка выполнена" : "Build complete");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Build failed");
      await load();
    } finally { setBusy(null); }
  };

  const deploy = async (provider: string, force = false) => {
    setBusy(provider);
    try {
      const res = await call("deploy", { provider, ...(force ? { force: true } : {}) });
      if (res?.blocked) {
        const rd = res.readiness as Readiness;
        setReadiness(rd);
        toast.error((ru ? "Деплой заблокирован: " : "Deploy blocked: ")
          + (ru ? rd.blockers_ru : rd.blockers_en).join("; "));
        return;
      }
      toast.success(ru ? "Сайт опубликован" : "Site deployed");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deploy failed");
      await load();
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded border border-border/60 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{ru ? "Готовность к публикации" : "Release readiness"}</span>
          {readiness && (
            <Badge variant="outline" className={readiness.can_deploy ? "text-emerald-500" : "text-red-500"}>
              {readiness.can_deploy ? (ru ? "Готово" : "Ready") : (ru ? "Заблокировано" : "Blocked")}
            </Badge>
          )}
        </div>
        {!readiness && <div className="text-xs text-muted-foreground">{ru ? "Загрузка..." : "Loading..."}</div>}
        {readiness?.checks.map((c) => (
          <div key={c.key} className="flex items-center gap-2 text-sm">
            {c.ok
              ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              : <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
            <span>{ru ? LABEL_RU[c.key] : LABEL_EN[c.key]}</span>
            <span className="text-xs text-muted-foreground">{c.value}</span>
            {!c.ok && <span className="text-xs text-red-500">- {ru ? c.reason_ru : c.reason_en}</span>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={build} disabled={!!busy}>
          {busy === "build" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Hammer className="h-4 w-4 mr-2" />}
          {ru ? "Собрать сайт" : "Build site"}
        </Button>
        <Button
          onClick={() => deploy(rows.find((d) => d.status === "success" || d.status === "ready")?.provider || "cloudflare")}
          disabled={!!busy || (readiness ? !readiness.can_deploy : false)}
        >
          {busy === "main" || (busy && busy !== "build" && busy !== "index") ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Rocket className="h-4 w-4 mr-2" />}
          {ru ? "Запустить деплой" : "Launch deploy"}
        </Button>
        {(["cloudflare", "vercel", "github_pages"] as const).map((p) => (
          <Button key={p} variant="outline" onClick={() => deploy(p)} disabled={!!busy}>
            {busy === p ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Rocket className="h-4 w-4 mr-2" />}
            {ru ? "Опубликовать: " : "Deploy: "}{p === "github_pages" ? "GitHub Pages" : p === "vercel" ? "Vercel" : "Cloudflare"}
          </Button>
        ))}
        <Button variant="outline" onClick={sendToIndex} disabled={!!busy || !productionUrl}>
          {busy === "index" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
          {ru ? "Отправить на индексацию" : "Send for indexing"}
        </Button>
        {readiness && !readiness.can_deploy && (
          <Button variant="destructive" disabled={!!busy} onClick={() => deploy("cloudflare", true)}>
            {ru ? "Опубликовать всё равно" : "Deploy anyway"}
          </Button>
        )}
      </div>

      {productionUrl && (
        <a href={productionUrl.startsWith("http") ? productionUrl : `https://${productionUrl}`}
          target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs underline text-muted-foreground">
          <ExternalLink className="h-3 w-3" />{ru ? "Опубликованный сайт: " : "Production URL: "}{productionUrl}
        </a>
      )}

      {rows.length > 0 && (
        <div className="rounded border border-border/60 p-3 space-y-1.5">
          <div className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4" />{ru ? "История публикаций" : "Release history"}
          </div>
          {rows.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{new Date(d.created_at).toLocaleString()}</span>
              <span>{d.provider}</span>
              <span className={STATUS_COLOR[d.status] || ""}>{d.status}</span>
              {d.pages_count != null && <span>{d.pages_count} {ru ? "стр." : "pages"}</span>}
              {d.url && <a className="underline" href={d.url} target="_blank" rel="noreferrer">{d.url}</a>}
              {d.error && <span className="text-red-500">{d.error.slice(0, 140)}</span>}
            </div>
          ))}
        </div>
      )}

      <StepDeploy projectId={projectId} ru={ru} siteName={siteName} />
    </div>
  );
}
