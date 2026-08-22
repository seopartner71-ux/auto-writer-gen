// P21 - Release Manager: publication history of the site. Every successful
// deploy writes a row into site_releases (version, build hash, pages, url).
// The panel is read-only over that table plus two actions of the existing
// deployment-engine: set_current and archive_release.

import { useCallback, useEffect, useState } from "react";
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { invokeErrorMessage } from "@/shared/utils/invokeError";
import { Archive, Check, Download, ExternalLink, Loader2, RefreshCw, Rocket } from "lucide-react";

interface Release {
  id: string;
  version: string;
  build_hash: string | null;
  provider: string | null;
  pages: number;
  published_url: string | null;
  status: "draft" | "published" | "archived";
  is_current: boolean;
  created_at: string;
}

const PROVIDER: Record<string, string> = {
  cloudflare: "Cloudflare",
  vercel: "Vercel",
  github_pages: "GitHub Pages",
  build: "Build",
};

const STATUS: Record<string, { ru: string; en: string; cls: string }> = {
  published: { ru: "Опубликован", en: "Published", cls: "text-emerald-500 border-emerald-500/40" },
  draft: { ru: "Черновик", en: "Draft", cls: "text-muted-foreground" },
  archived: { ru: "В архиве", en: "Archived", cls: "text-muted-foreground" },
};

export function ReleasesPanel({ projectId, ru }: { projectId: string; ru: boolean }) {
  const [rows, setRows] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase.from("site_releases")
      .select("id, version, build_hash, provider, pages, published_url, status, is_current, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) toast.error(error.message);
    setRows((data || []) as unknown as Release[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const act = async (release: Release, action: "set_current" | "archive_release") => {
    setBusy(release.id + action);
    try {
      const { data, error } = await supabase.functions.invoke("deployment-engine", {
        body: { project_id: projectId, action, release_id: release.id },
      });
      if (error) throw new Error(await invokeErrorMessage(error, ru ? "Не удалось обновить релиз" : "Release update failed"));
      if ((data as { success?: boolean })?.success === false) throw new Error("Release update failed");
      toast.success(action === "set_current"
        ? (ru ? `${release.version} - текущий релиз` : `${release.version} is now current`)
        : (ru ? "Релиз архивирован" : "Release archived"));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  };

  const downloadZip = async (release: Release) => {
    setBusy(release.id + "zip");
    try {
      const { data, error } = await supabase.functions.invoke("deploy-cloudflare-direct", {
        body: { project_id: projectId, dry_run: true },
      });
      if (error) throw new Error(await invokeErrorMessage(error, ru ? "Не удалось собрать ZIP" : "ZIP build failed"));
      const payload = data as { files?: Record<string, string>; assets?: Record<string, string> };
      if (!payload?.files) throw new Error(ru ? "Сборка не вернула файлы" : "Build returned no files");
      const zip = new JSZip();
      for (const [path, content] of Object.entries(payload.files)) zip.file(path, content);
      for (const [path, b64] of Object.entries(payload.assets || {})) zip.file(path, b64, { base64: true });
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `site-${release.version}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ZIP failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="flex items-center gap-1.5">
          <Rocket className="h-3.5 w-3.5" />{ru ? "Релизы" : "Releases"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {ru
            ? "Каждая успешная публикация создает новую версию сайта"
            : "Every successful publication creates a new site version"}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {!rows.length && !loading && (
        <div className="rounded border border-border/60 p-6 text-center text-sm text-muted-foreground">
          {ru ? "Релизов пока нет - опубликуйте сайт на шаге «Запуск»" : "No releases yet - publish the site on the Launch step"}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((r) => {
          const st = STATUS[r.status] || STATUS.draft;
          return (
            <div key={r.id} className="rounded border border-border/60 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{r.version}</span>
                {r.is_current && (
                  <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/40">
                    {ru ? "Текущий" : "Current"}
                  </Badge>
                )}
                <Badge variant="outline" className={`text-[10px] ${st.cls}`}>{ru ? st.ru : st.en}</Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString(ru ? "ru-RU" : "en-GB")}
                </span>
              </div>

              <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                <span>{r.pages} {ru ? "страниц" : "pages"}</span>
                <span>{PROVIDER[r.provider || ""] || r.provider || "-"}</span>
                {r.build_hash && <span className="font-mono">#{r.build_hash}</span>}
              </div>

              {r.published_url && (
                <div className="text-xs font-mono truncate text-muted-foreground">{r.published_url}</div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {r.published_url && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={r.published_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3.5 w-3.5 mr-1" />{ru ? "Открыть" : "Open"}
                    </a>
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => void downloadZip(r)} disabled={!!busy}>
                  {busy === r.id + "zip"
                    ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    : <Download className="h-3.5 w-3.5 mr-1" />}
                  ZIP
                </Button>
                {!r.is_current && r.published_url && (
                  <Button size="sm" variant="ghost" onClick={() => void act(r, "set_current")} disabled={!!busy}>
                    {busy === r.id + "set_current"
                      ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      : <Check className="h-3.5 w-3.5 mr-1" />}
                    {ru ? "Сделать текущим" : "Make current"}
                  </Button>
                )}
                {r.status !== "archived" && !r.is_current && (
                  <Button size="sm" variant="ghost" onClick={() => void act(r, "archive_release")} disabled={!!busy}>
                    <Archive className="h-3.5 w-3.5 mr-1" />{ru ? "В архив" : "Archive"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
