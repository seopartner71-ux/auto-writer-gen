import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Rocket, Globe, FileDown, ExternalLink } from "lucide-react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { invokeErrorMessage } from "@/shared/utils/invokeError";

type Target = "cloudflare" | "vercel" | "github_pages";

const FN: Record<Target, string> = {
  cloudflare: "deploy-cloudflare-direct",
  vercel: "deploy-vercel-direct",
  github_pages: "deploy-github-pages",
};

export function StepDeploy({ projectId, ru, siteName }: { projectId: string; ru: boolean; siteName: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [domain, setDomain] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [domainStatus, setDomainStatus] = useState<string>("");
  const [log, setLog] = useState<string[]>([]);

  const addLog = (m: string) => setLog((prev) => [`${new Date().toLocaleTimeString()} - ${m}`, ...prev].slice(0, 20));

  const load = useCallback(async () => {
    const { data } = await supabase.from("projects")
      .select("domain, custom_domain, custom_domain_status").eq("id", projectId).maybeSingle();
    const p = data as { domain: string | null; custom_domain: string | null; custom_domain_status: string | null } | null;
    setDomain(p?.domain || "");
    setCustomDomain(p?.custom_domain || "");
    setDomainStatus(p?.custom_domain_status || "");
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const [blockedTarget, setBlockedTarget] = useState<Target | null>(null);

  const deploy = async (target: Target, force = false) => {
    setBusy(target);
    addLog(ru ? `Запуск публикации: ${target}` : `Deploy started: ${target}`);
    try {
      await supabase.from("projects").update({ hosting_platform: target } as never).eq("id", projectId);
      const { data, error } = await supabase.functions.invoke(FN[target], {
        body: { project_id: projectId, ...(force ? { force_deploy: true } : {}) },
      });
      if (error) {
        let gate: { blocked?: boolean; qa_report?: { critical?: number } } | null = null;
        try {
          const ctx = (error as unknown as { context?: Response }).context;
          if (ctx && typeof ctx.json === "function") gate = await ctx.clone().json();
        } catch { /* non-json body */ }
        if (gate?.blocked) {
          const critical = gate.qa_report?.critical ?? 0;
          addLog(`QA gate: critical=${critical}`);
          setBlockedTarget(target);
          toast.error(ru
            ? `Публикация заблокирована QA: критических ошибок ${critical}. Исправьте их на шаге QA или нажмите «Опубликовать всё равно».`
            : `Publishing blocked by QA: ${critical} critical issues. Fix them on the QA step or use "Deploy anyway".`);
          return;
        }
        throw new Error(await invokeErrorMessage(error, ru ? "Ошибка публикации" : "Publishing failed"));
      }
      setBlockedTarget(null);
      const res = data as { error?: string; message?: string; url?: string; domain?: string } | null;
      if (res?.error) {
        addLog(`${target}: ${res.message || res.error}`);
        toast.error(res.message || res.error);
        return;
      }
      const url = res?.url || (res?.domain ? `https://${res.domain}` : "");
      if (url) await supabase.from("projects").update({ domain: url } as never).eq("id", projectId);
      addLog(ru ? `Готово: ${url || res?.message || "ok"}` : `Done: ${url || res?.message || "ok"}`);
      toast.success(ru ? "Публикация запущена" : "Deploy triggered");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  };

  const downloadZip = async () => {
    const targetDomain = (customDomain || domain)
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");
    if (!targetDomain || /(^|\.)example\.(com|org|net)$/i.test(targetDomain)) {
      toast.error(ru
        ? "Для ZIP нужен реальный домен: укажите его ниже и нажмите «Сохранить и проверить»"
        : "ZIP requires a real domain: enter it below and click Save and verify");
      return;
    }
    setBusy("zip");
    try {
      const { data, error } = await supabase.functions.invoke("site-qa-check", {
        body: { project_id: projectId, include_files: true, mode: "full_static", domain_override: targetDomain },
      });
      if (error) throw new Error(await invokeErrorMessage(error, ru ? "Не удалось собрать ZIP" : "ZIP build failed"));
      const payload = data as { files?: Record<string, string>; assets?: Record<string, string> };
      if (!payload?.files) throw new Error(ru ? "Сборка не вернула файлы" : "Build returned no files");
      const zip = new JSZip();
      for (const [path, content] of Object.entries(payload.files)) zip.file(path, content);
      for (const [path, b64] of Object.entries(payload.assets || {})) zip.file(path, b64, { base64: true });
      const blob = await zip.generateAsync({ type: "blob" });
      saveAs(blob, `${(siteName || "site").replace(/[^\w-]+/g, "-").toLowerCase()}.zip`);
      toast.success(ru ? "ZIP собран" : "ZIP ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ZIP failed");
    } finally {
      setBusy(null);
    }
  };

  const saveDomain = async () => {
    setBusy("domain");
    try {
      const value = customDomain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
      const { error } = await supabase.from("projects").update({ custom_domain: value || null } as never).eq("id", projectId);
      if (error) throw error;
      if (value) {
        const { data, error: vErr } = await supabase.functions.invoke("verify-custom-domain", { body: { project_id: projectId } });
        if (vErr) throw new Error(await invokeErrorMessage(vErr, ru ? "Не удалось проверить домен" : "Domain check failed"));
        const r = data as { status?: string; verified?: boolean; error?: string };
        setDomainStatus(r?.status || (r?.verified ? "verified" : "pending"));
        toast[r?.verified ? "success" : "info"](r?.verified
          ? (ru ? "Домен подтвержден" : "Domain verified")
          : (r?.error || (ru ? "Домен пока не отвечает - проверьте DNS" : "Domain not resolving yet - check DNS")));
      } else {
        setDomainStatus("");
        toast.success(ru ? "Домен очищен" : "Domain cleared");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Domain check failed");
    } finally {
      setBusy(null);
    }
  };

  const targets: { key: Target; label: string }[] = [
    { key: "cloudflare", label: "Cloudflare Pages" },
    { key: "vercel", label: "Vercel" },
    { key: "github_pages", label: "GitHub Pages" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {targets.map((t) => (
          <Button key={t.key} onClick={() => deploy(t.key)} disabled={!!busy}>
            {busy === t.key ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Rocket className="h-4 w-4 mr-2" />}
            {t.label}
          </Button>
        ))}
        <Button variant="outline" onClick={downloadZip} disabled={!!busy}>
          {busy === "zip" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown className="h-4 w-4 mr-2" />}
          ZIP
        </Button>
        {domain && (
          <a href={domain.startsWith("http") ? domain : `https://${domain}`} target="_blank" rel="noreferrer"
            className="text-xs underline text-muted-foreground inline-flex items-center gap-1">
            <ExternalLink className="h-3 w-3" />{domain}
          </a>
        )}
      </div>

      <div className="rounded border border-border/60 p-3 space-y-2">
        <Label className="text-sm flex items-center gap-2">
          <Globe className="h-4 w-4" />{ru ? "Свой домен" : "Custom domain"}
          {domainStatus && <Badge variant="outline" className={domainStatus === "verified" ? "text-green-500" : ""}>{domainStatus}</Badge>}
        </Label>
        <div className="flex gap-2">
          <Input value={customDomain} onChange={(e) => setCustomDomain(e.target.value)} placeholder="example.com" className="h-9" />
          <Button variant="outline" onClick={saveDomain} disabled={busy === "domain"}>
            {busy === "domain" ? <Loader2 className="h-4 w-4 animate-spin" /> : (ru ? "Сохранить и проверить" : "Save and verify")}
          </Button>
        </div>
      </div>

      {log.length > 0 && (
        <div className="rounded border border-border/60 p-3 max-h-40 overflow-auto space-y-1">
          {log.map((l, i) => <div key={i} className="text-xs text-muted-foreground">{l}</div>)}
        </div>
      )}
    </div>
  );
}