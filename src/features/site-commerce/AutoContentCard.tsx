import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Bot, RefreshCw } from "lucide-react";

interface Props {
  projectId: string;
  ru?: boolean;
}

interface AutorunRow {
  status: string;
  enabled: boolean;
  paused_reason: string | null;
  processed_total: number;
  last_error: string | null;
  last_run_at: string | null;
}

const STATUS_LABEL_RU: Record<string, string> = {
  idle: "В очереди",
  running: "Генерирует",
  paused: "Приостановлено",
  done: "Завершено",
};

const STATUS_LABEL_EN: Record<string, string> = {
  idle: "Queued",
  running: "Generating",
  paused: "Paused",
  done: "Finished",
};

export function AutoContentCard({ projectId, ru = true }: Props) {
  const [row, setRow] = useState<AutorunRow | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: autorun }, { count }] = await Promise.all([
      supabase
        .from("commerce_content_autorun")
        .select("status, enabled, paused_reason, processed_total, last_error, last_run_at")
        .eq("project_id", projectId)
        .maybeSingle(),
      supabase
        .from("site_products")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .or("content_status.is.null,content_status.in.(pending,failed)"),
    ]);
    setRow((autorun as AutorunRow) ?? null);
    setPending(Number(count || 0));
  }, [projectId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const toggle = useCallback(async (on: boolean) => {
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error(ru ? "Нужен вход в аккаунт" : "Sign in required");
      const { error } = await supabase
        .from("commerce_content_autorun")
        .upsert({
          project_id: projectId,
          user_id: userId,
          enabled: on,
          status: on ? "idle" : "paused",
          paused_reason: on ? null : "manual",
        }, { onConflict: "project_id" });
      if (error) throw error;
      toast.success(on
        ? (ru ? "Автогенерация включена" : "Auto generation enabled")
        : (ru ? "Автогенерация остановлена" : "Auto generation stopped"));
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [projectId, ru, load]);

  const label = ru ? STATUS_LABEL_RU : STATUS_LABEL_EN;
  const active = !!row?.enabled && row.status !== "paused" && row.status !== "done";

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline" className="flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5" />
          {ru ? "Автогенерация текстов" : "Auto content generation"}
        </Badge>
        {row && <Badge variant={row.status === "paused" ? "destructive" : "secondary"}>{label[row.status] ?? row.status}</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={load} disabled={busy}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {busy
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Switch checked={active} onCheckedChange={toggle} aria-label={ru ? "Автогенерация" : "Auto generation"} />}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {ru
          ? `Товаров без текста: ${pending ?? "-"}. Система сама берет их порциями раз в минуту, пока очередь не опустеет.`
          : `Products without copy: ${pending ?? "-"}. The system picks them up in batches every minute until the queue is empty.`}
      </p>

      {row && row.processed_total > 0 && (
        <p className="text-sm text-muted-foreground">
          {ru ? `Сгенерировано в фоне: ${row.processed_total}` : `Generated in background: ${row.processed_total}`}
        </p>
      )}

      {row?.paused_reason && row.status === "paused" && row.paused_reason !== "manual" && (
        <p className="text-sm text-destructive">
          {ru ? "Остановлено: " : "Stopped: "}{row.paused_reason}
        </p>
      )}
    </div>
  );
}
