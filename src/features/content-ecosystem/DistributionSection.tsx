import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Github, Loader2, HelpCircle, CheckCircle2, XCircle } from "lucide-react";
import { Client } from "./types";

interface Props {
  client: Client | null;
  onSaved: (patch: Partial<Client>) => void;
}

export function DistributionSection({ client, onSaved }: Props) {
  const [username, setUsername] = useState("");
  const [repo, setRepo] = useState("docs");
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [howtoOpen, setHowtoOpen] = useState(false);

  useEffect(() => {
    setUsername(client?.github_username || "");
    setRepo(client?.github_repo || "docs");
    setHasToken(!!client?.github_token_encrypted);
    setToken("");
    setTestResult(null);
  }, [client?.id, client?.github_username, client?.github_repo, client?.github_token_encrypted]);

  const pagesUrl = username && repo ? `https://${username}.github.io/${repo}` : "";

  const handleTest = async () => {
    const t = token.trim();
    if (!t) { toast.error("Введите токен для проверки"); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json" },
      });
      const data = await res.json().catch(() => ({}));
      const ok = res.ok && !!data?.login;
      setTestResult({
        ok,
        msg: ok ? `Успех: подключено к ${data.login}` : `Ошибка: ${data?.message || res.status}`,
      });
      if (client) {
        try {
          await supabase.from("activation_events").insert({
            user_id: client.user_id,
            event_name: "github_connection_tested",
            session_id: "app",
            metadata: { client_id: client.id, success: ok },
          });
        } catch { /* noop */ }
      }
    } catch (e: any) {
      setTestResult({ ok: false, msg: `Сеть недоступна: ${e?.message || "ошибка"}` });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!client) { toast.error("Сохраните клиента, затем настройте GitHub"); return; }
    const u = username.trim();
    const r = (repo || "docs").trim();
    if (!u) { toast.error("Введите GitHub username"); return; }
    setSaving(true);
    try {
      const patch: any = {
        github_username: u,
        github_repo: r,
        github_pages_url: `https://${u}.github.io/${r}`,
      };
      const { error: upErr } = await supabase.from("clients").update(patch).eq("id", client.id);
      if (upErr) throw upErr;
      if (token.trim()) {
        const { error: tokErr } = await supabase.rpc("set_client_github_token", {
          p_client_id: client.id,
          p_token: token.trim(),
        });
        if (tokErr) throw tokErr;
        setHasToken(true);
        setToken("");
      }
      onSaved(patch);
      toast.success("Настройки GitHub сохранены");
      try {
        await supabase.from("activation_events").insert({
          user_id: client.user_id,
          event_name: "github_credentials_saved",
          session_id: "app",
          metadata: { client_id: client.id },
        });
      } catch { /* noop */ }
    } catch (e: any) {
      toast.error(e?.message || "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="text-base flex items-center gap-2">
            <Github className="h-4 w-4" /> Дистрибуция - GitHub Pages
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            Настройте GitHub-аккаунт для автоматической публикации PDF-документов клиента.
            Каждый документ будет опубликован по адресу вида{" "}
            <code className="text-[11px]">github_username.github.io/docs/название-документа/</code>
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => setHowtoOpen(true)}>
          <HelpCircle className="h-4 w-4 mr-1" /> Как настроить?
        </Button>
      </div>

      {!client && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Сначала сохраните клиента, затем настройте GitHub в этой секции.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">GitHub Username</Label>
          <Input
            placeholder="kupit-minitraktor-docs"
            value={username}
            onChange={(e) => setUsername(e.target.value.trim())}
            disabled={!client}
          />
        </div>
        <div>
          <Label className="text-xs">Repository</Label>
          <Input
            placeholder="docs"
            value={repo}
            onChange={(e) => setRepo(e.target.value.trim())}
            disabled={!client}
          />
        </div>
      </div>

      <div>
        <Label className="text-xs flex items-center gap-2">
          Personal Access Token
          {hasToken && !token && (
            <Badge variant="outline" className="text-[10px]">Сохранён</Badge>
          )}
        </Label>
        <Input
          type="password"
          placeholder={hasToken ? "••••••••  (введите, чтобы заменить)" : "ghp_..."}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={!client}
        />
      </div>

      {pagesUrl && (
        <p className="text-[11px] text-muted-foreground">
          Публикации будут доступны по адресу{" "}
          <a href={pagesUrl} target="_blank" rel="noreferrer" className="underline">{pagesUrl}</a>
        </p>
      )}

      {testResult && (
        <div className={`flex items-center gap-2 text-xs ${testResult.ok ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
          {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {testResult.msg}
        </div>
      )}

      <div className="flex items-center gap-2 justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleTest}
          disabled={!token.trim() || testing}
        >
          {testing && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
          Проверить подключение
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={!client || saving || !username.trim()}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
          Сохранить GitHub
        </Button>
      </div>

      <Dialog open={howtoOpen} onOpenChange={setHowtoOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Как создать GitHub-аккаунт и получить токен</DialogTitle>
          </DialogHeader>
          <ol className="text-sm space-y-3 list-decimal pl-5">
            <li>
              Зарегистрируйтесь на{" "}
              <a href="https://github.com/signup" target="_blank" rel="noreferrer" className="underline">github.com</a>
              {" "}или войдите в свой аккаунт. Рекомендуем использовать отдельный аккаунт под клиента,
              например <code>kupit-minitraktor-docs</code>.
            </li>
            <li>
              Создайте новый публичный репозиторий с именем <code>docs</code>{" "}
              (<a href="https://github.com/new" target="_blank" rel="noreferrer" className="underline">github.com/new</a>).
              Обязательно поставьте галочку «Initialize with README» — тогда сразу появится ветка <code>main</code>.
            </li>
            <li>
              В настройках репозитория включите GitHub Pages:
              Settings → Pages → Source: <b>Deploy from a branch</b>, Branch: <b>main / (root)</b>.
            </li>
            <li>
              Создайте Fine-grained Personal Access Token:
              Settings → Developer settings → Personal access tokens → Fine-grained → «Generate new token».
              Дайте права <b>Contents: Read and write</b> и <b>Pages: Read and write</b> для репозитория <code>docs</code>.
            </li>
            <li>
              Скопируйте токен (он показывается один раз) и вставьте в поле «Personal Access Token» выше,
              затем нажмите «Проверить подключение» и «Сохранить GitHub».
            </li>
          </ol>
        </DialogContent>
      </Dialog>
    </div>
  );
}