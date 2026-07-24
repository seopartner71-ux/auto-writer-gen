import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Github, Upload, Loader2, ExternalLink, CheckCircle2, AlertTriangle, RotateCcw } from "lucide-react";
import { Client, FormatDeployment } from "./types";

interface Props {
  formatId: string;
  formatType: string;
  client: Pick<Client, "id" | "github_username" | "github_token_encrypted"> | null | undefined;
}

export function ChecklistDeployBlock({ formatId, formatType, client }: Props) {
  const [dep, setDep] = useState<FormatDeployment | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("format_deployments")
      .select("*")
      .eq("ecosystem_format_id", formatId)
      .eq("platform", "github_pages")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setDep((data as FormatDeployment) || null);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    load();
    const channel = supabase
      .channel(`format-deployments-${formatId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "format_deployments", filter: `ecosystem_format_id=eq.${formatId}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatId]);

  // Post-deploy countdown so users know GitHub Pages needs 30-60s to serve.
  useEffect(() => {
    if (dep?.status !== "deployed" || !dep.deployed_at) { setCountdown(null); return; }
    const start = new Date(dep.deployed_at).getTime();
    const tick = () => {
      const left = 60 - Math.floor((Date.now() - start) / 1000);
      setCountdown(left > 0 ? left : null);
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [dep?.status, dep?.deployed_at]);

  const configured = !!client?.github_username && !!client?.github_token_encrypted;

  const startDeploy = async () => {
    setStarting(true);
    try {
      // Analytics: started
      try {
        await supabase.from("activation_events").insert({
          user_id: (await supabase.auth.getUser()).data.user?.id || null,
          event_name: "format_deployment_started",
          session_id: "app",
          metadata: { format_type: formatType, platform: "github_pages", client_id: client?.id },
        });
      } catch { /* noop */ }
      const { error } = await supabase.functions.invoke("deploy-to-github-pages", {
        body: { ecosystem_format_id: formatId },
      });
      if (error) {
        // Try to extract server body message
        let details = error.message;
        try {
          const ctx: any = (error as any).context;
          if (ctx?.text) details = await ctx.text();
        } catch { /* noop */ }
        throw new Error(details || error.message);
      }
      toast.success("Публикация запущена");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Не удалось запустить публикацию");
    } finally {
      setStarting(false);
    }
  };

  if (loading) return null;

  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Github className="h-4 w-4" /> Дистрибуция - GitHub Pages
      </div>

      {!configured && (
        <p className="text-xs text-muted-foreground">
          GitHub не настроен для этого клиента. Откройте карточку клиента и заполните секцию «Дистрибуция».
        </p>
      )}

      {configured && !dep && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Опубликуйте чек-лист как страницу на GitHub Pages.</p>
          <Button size="sm" onClick={startDeploy} disabled={starting}>
            {starting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            Опубликовать
          </Button>
        </div>
      )}

      {dep?.status === "deploying" && (
        <div className="flex items-center gap-2 text-xs">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>Публикация... GitHub Pages деплой занимает 30-60 секунд.</span>
        </div>
      )}

      {dep?.status === "deployed" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            <span>Опубликовано</span>
            {countdown !== null && (
              <span className="text-muted-foreground">
                (URL станет доступным через {countdown} сек)
              </span>
            )}
          </div>
          {dep.published_url && (
            <a
              href={dep.published_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline break-all flex items-center gap-1"
            >
              {dep.published_url} <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <Button size="sm" variant="outline" onClick={startDeploy} disabled={starting}>
            {starting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
            Опубликовать заново
          </Button>
        </div>
      )}

      {dep?.status === "failed" && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <div>
              <p>Не удалось опубликовать</p>
              {dep.error_reason && <p className="opacity-80 mt-0.5 break-words">{dep.error_reason}</p>}
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={startDeploy} disabled={starting}>
            {starting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
            Повторить
          </Button>
        </div>
      )}
    </div>
  );
}