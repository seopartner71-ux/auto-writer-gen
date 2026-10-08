import { useState } from "react";
import JSZip from "jszip";
import { Github, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Kind = "kb" | "rag";

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("archive-github", { body });
  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) {
      try { msg = (await error.context.json())?.error || msg; } catch { /* noop */ }
    }
    throw new Error(msg);
  }
  return data as { repoUrl: string; url?: string; deleted?: number };
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Flattens a zip (dropping a single shared root folder) into path -> base64. */
export async function zipToFiles(blob: Blob): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(blob);
  const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name);
  const roots = new Set(names.map((n) => n.split("/")[0]));
  const strip = roots.size === 1 && names.every((n) => n.includes("/"));
  const out: Record<string, string> = {};
  for (const n of names) {
    const bytes = await zip.files[n].async("uint8array");
    out[strip ? n.split("/").slice(1).join("/") : n] = toB64(bytes);
  }
  return out;
}

export function textFilesToB64(files: Record<string, string>): Record<string, string> {
  const enc = new TextEncoder();
  return Object.fromEntries(Object.entries(files).map(([p, c]) => [p, toB64(enc.encode(c))]));
}

interface Props {
  kind: Kind;
  client: string;
  getFiles: () => Promise<Record<string, string>>;
  disabled?: boolean;
}

export function GithubArchiveButtons({ kind, client, getFiles, disabled }: Props) {
  const [busy, setBusy] = useState<"up" | "del" | null>(null);

  const upload = async () => {
    setBusy("up");
    try {
      const files = await getFiles();
      const r = await call({ action: "upload", kind, client, files });
      toast.success("Архив выгружен в GitHub", {
        description: `Файлов: ${Object.keys(files).length}`,
        action: r.url ? { label: "Открыть", onClick: () => window.open(r.url, "_blank") } : undefined,
      });
    } catch (e) {
      toast.error("Не удалось выгрузить в GitHub", { description: (e as Error).message });
    } finally { setBusy(null); }
  };

  const remove = async () => {
    if (!window.confirm(`Удалить архив клиента "${client}" из GitHub?`)) return;
    setBusy("del");
    try {
      const r = await call({ action: "delete", kind, client });
      toast.success(r.deleted ? "Архив удален из GitHub" : "В GitHub архива этого клиента нет", {
        description: r.deleted ? `Удалено файлов: ${r.deleted}` : undefined,
      });
    } catch (e) {
      toast.error("Не удалось удалить из GitHub", { description: (e as Error).message });
    } finally { setBusy(null); }
  };

  const off = disabled || !client.trim() || !!busy;
  return (
    <>
      <Button type="button" variant="outline" onClick={upload} disabled={off}>
        {busy === "up" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Github className="h-4 w-4 mr-1" />}
        Выгрузить в GitHub
      </Button>
      <Button type="button" variant="ghost" onClick={remove} disabled={off} title="Удалить архив клиента из GitHub">
        {busy === "del" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </Button>
    </>
  );
}
