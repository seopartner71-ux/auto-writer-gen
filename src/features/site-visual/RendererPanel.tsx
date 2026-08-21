// P18 Visual Renderer - real HTML preview of the whole site (not a wireframe).

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeErrorMessage } from "@/shared/utils/invokeError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Monitor, Play, ShieldCheck, Smartphone, Tablet } from "lucide-react";

type Device = "desktop" | "tablet" | "mobile";
const WIDTH: Record<Device, number> = { desktop: 1280, tablet: 834, mobile: 390 };

interface RenderedPage {
  registry_id?: string;
  url_path: string;
  page_type: string;
  h1: string;
  html: string;
  rendered: string[];
  skipped: string[];
  ready: { ok: boolean; blocked: string[]; warnings: string[] };
}

interface QaState {
  qa: {
    status: string; score: number;
    issues: { code: string; severity: string; detail?: string }[];
    pages: { url_path: string; page_type: string; bytes: number; blocks: number; issues: string[] }[];
  };
  build_gate: { allowed: boolean; blocked: { url_path: string; blocked: string[] }[] };
}

const TYPE_LABEL: Record<string, string> = {
  home: "Главная", hub: "Хаб", category: "Категория", product: "Товар",
  service: "Услуга", article: "Статья", informational: "Информационная", local: "Локальная", system: "Системная",
};

export function RendererPanel({ projectId, ru }: { projectId: string; ru: boolean }) {
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [active, setActive] = useState(0);
  const [device, setDevice] = useState<Device>("desktop");
  const [busy, setBusy] = useState<string | null>(null);
  const [qa, setQa] = useState<QaState | null>(null);

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("visual-renderer", {
      body: { project_id: projectId, action, ...extra },
    });
    if (error) throw new Error(await invokeErrorMessage(error));
    return data as Record<string, unknown>;
  }, [projectId]);

  const loadPreview = useCallback(async () => {
    setBusy("preview");
    try {
      const data = await call("preview_set");
      const list = ((data?.pages as RenderedPage[]) || []);
      setPages(list);
      setActive(0);
      if (!list.length) toast.info(ru ? "Нет страниц в реестре" : "Registry is empty");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [call, ru]);

  useEffect(() => { void loadPreview(); }, [loadPreview]);

  const runQa = useCallback(async () => {
    setBusy("qa");
    try {
      setQa(await call("qa") as unknown as QaState);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [call]);

  const current = pages[active];
  const scale = useMemo(() => Math.min(1, 900 / WIDTH[device]), [device]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={loadPreview} disabled={busy !== null}>
          {busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {ru ? "Собрать превью сайта" : "Render site preview"}
        </Button>
        <Button size="sm" variant="outline" onClick={runQa} disabled={busy !== null}>
          {busy === "qa" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
          Site Design QA
        </Button>
        <div className="ml-auto flex items-center gap-1">
          {(["desktop", "tablet", "mobile"] as Device[]).map((d) => (
            <Button key={d} size="icon" variant={device === d ? "default" : "ghost"} aria-label={d}
              className="h-9 w-9" onClick={() => setDevice(d)}>
              {d === "desktop" ? <Monitor className="h-4 w-4" /> : d === "tablet" ? <Tablet className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
            </Button>
          ))}
        </div>
      </div>

      {pages.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(active)} onValueChange={(v) => setActive(Number(v))}>
            <SelectTrigger className="w-[340px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {pages.map((p, i) => (
                <SelectItem key={p.url_path + i} value={String(i)}>
                  {TYPE_LABEL[p.page_type] || p.page_type} - {p.url_path}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {current && (
            <>
              <Badge variant="outline">{current.rendered.length} {ru ? "блоков" : "blocks"}</Badge>
              <Badge variant={current.ready.ok ? "outline" : "destructive"}>
                {current.ready.ok ? "Visual Ready" : "BLOCK_BUILD"}
              </Badge>
              {current.ready.warnings.map((w) => (
                <Badge key={w} variant="secondary" className="text-xs">{w}</Badge>
              ))}
            </>
          )}
        </div>
      )}

      {current && (
        <div className="overflow-auto rounded-lg border bg-muted/30 p-4">
          <div style={{ width: WIDTH[device] * scale, height: 900 * scale, overflow: "hidden" }}>
            <iframe
              title={current.url_path}
              srcDoc={current.html}
              sandbox="allow-same-origin"
              style={{
                width: WIDTH[device], height: 900, border: 0, background: "#fff",
                transform: `scale(${scale})`, transformOrigin: "top left",
              }}
            />
          </div>
        </div>
      )}

      {qa && (
        <div className="space-y-2 rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <span className="font-medium">Site Design QA</span>
            <Badge variant={qa.qa.status === "PASS" ? "outline" : qa.qa.status === "REVIEW" ? "secondary" : "destructive"}>
              {qa.qa.status} - {qa.qa.score}
            </Badge>
            <Badge variant={qa.build_gate.allowed ? "outline" : "destructive"}>
              {qa.build_gate.allowed ? "Build allowed" : "BLOCK_BUILD"}
            </Badge>
          </div>
          {qa.qa.issues.length === 0 && (
            <p className="text-sm text-muted-foreground">{ru ? "Расхождений не найдено" : "No inconsistencies found"}</p>
          )}
          <ul className="space-y-1 text-sm text-muted-foreground">
            {qa.qa.issues.slice(0, 20).map((i, idx) => (
              <li key={idx}>
                <span className={i.severity === "error" ? "text-destructive" : "text-amber-500"}>{i.code}</span>
                {i.detail ? ` - ${i.detail}` : ""}
              </li>
            ))}
          </ul>
          <div className="grid gap-1 pt-2 text-xs text-muted-foreground">
            {qa.qa.pages.map((p) => (
              <div key={p.url_path} className="flex flex-wrap gap-2">
                <span className="min-w-[220px] truncate">{p.url_path}</span>
                <span>{TYPE_LABEL[p.page_type] || p.page_type}</span>
                <span>{p.blocks} {ru ? "блоков" : "blocks"}</span>
                <span>{Math.round(p.bytes / 1024)} KB</span>
                {p.issues.length > 0 && <span className="text-amber-500">{p.issues.join(", ")}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
