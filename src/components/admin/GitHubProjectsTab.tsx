import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Github, Save, Eye, EyeOff, Loader2, CheckCircle, AlertCircle, Plus, Trash2, Cloud, Key, HelpCircle } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ProjectGH {
  id: string;
  name: string;
  domain: string;
  github_repo: string | null;
  github_token: string | null;
  hosting_platform: string | null;
}

type RepoStatus = "idle" | "checking" | "empty" | "initializing" | "ready" | "error";

const HOSTING_KEYS = [
  { provider: "cloudflare_account_id", label: "Cloudflare Account ID", placeholder: "ваш Account ID из Cloudflare Dashboard", secret: false },
  { provider: "cloudflare_api_token", label: "Cloudflare API Token", placeholder: "токен с правами Cloudflare Pages: Edit", secret: true },
];

export function GitHubProjectsTab() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<ProjectGH[]>([]);
  const [editing, setEditing] = useState<Record<string, { repo: string; token: string }>>({});
  const [showToken, setShowToken] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [repoStatus, setRepoStatus] = useState<Record<string, RepoStatus>>({});
  const [repoError, setRepoError] = useState<Record<string, string>>({});
  const [showNewForm, setShowNewForm] = useState(false);
  const [newProject, setNewProject] = useState({ name: "", domain: "", repo: "", token: "", hostingPlatform: "cloudflare" });
  const [creating, setCreating] = useState(false);

  // Hosting keys state
  const [hostingKeys, setHostingKeys] = useState<Record<string, string>>({});
  const [hostingKeysOriginal, setHostingKeysOriginal] = useState<Record<string, string>>({});
  const [showHostingKey, setShowHostingKey] = useState<Record<string, boolean>>({});
  const [savingHosting, setSavingHosting] = useState(false);

  useEffect(() => {
    loadProjects();
    loadHostingKeys();
  }, []);

  const loadProjects = async () => {
    const { data } = await supabase.from("projects").select("id, name, domain, github_repo, github_token, hosting_platform");
    if (data) {
      setProjects(data as ProjectGH[]);
      const ed: Record<string, { repo: string; token: string }> = {};
      data.forEach((p: any) => {
        ed[p.id] = { repo: p.github_repo || "", token: p.github_token || "" };
      });
      setEditing(ed);
    }
  };

  const loadHostingKeys = async () => {
    const providers = HOSTING_KEYS.map((k) => k.provider);
    const { data } = await supabase.from("api_keys").select("provider, api_key").in("provider", providers);
    const map: Record<string, string> = {};
    (data || []).forEach((row: any) => {
      map[row.provider] = row.api_key;
    });
    setHostingKeys({ ...map });
    setHostingKeysOriginal({ ...map });
  };

  const handleSaveHostingKeys = async () => {
    setSavingHosting(true);
    try {
      for (const keyDef of HOSTING_KEYS) {
        const val = (hostingKeys[keyDef.provider] || "").trim();
        const orig = hostingKeysOriginal[keyDef.provider] || "";

        if (val === orig) continue; // no change

        if (!val && orig) {
          // delete
          await supabase.from("api_keys").delete().eq("provider", keyDef.provider);
        } else if (val && !orig) {
          // insert
          await supabase.from("api_keys").insert({ provider: keyDef.provider, api_key: val, label: keyDef.label });
        } else if (val && orig && val !== orig) {
          // update
          await supabase.from("api_keys").update({ api_key: val }).eq("provider", keyDef.provider);
        }
      }
      toast({ title: "Ключи хостинга сохранены" });
      await loadHostingKeys();
    } catch (err: any) {
      toast({ title: "Ошибка сохранения", description: err?.message, variant: "destructive" });
    } finally {
      setSavingHosting(false);
    }
  };

  const handleCreateProject = async () => {
    if (!newProject.name.trim()) {
      toast({ title: "Введите название проекта", variant: "destructive" });
      return;
    }
    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ title: "Не авторизован", variant: "destructive" });
      setCreating(false);
      return;
    }
    const { error } = await supabase.from("projects").insert({
      name: newProject.name.trim(),
      domain: newProject.domain.trim() || newProject.name.trim().toLowerCase().replace(/\s+/g, "-"),
      github_repo: newProject.repo.trim() || null,
      github_token: newProject.token.trim() || null,
      hosting_platform: newProject.hostingPlatform,
      user_id: user.id,
    });
    setCreating(false);
    if (error) {
      toast({ title: "Ошибка создания", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Проект создан" });
      setNewProject({ name: "", domain: "", repo: "", token: "", hostingPlatform: "cloudflare" });
      setShowNewForm(false);
      await loadProjects();
    }
  };

  const handleDeleteProject = async (projectId: string, projectName: string) => {
    if (!confirm(`Удалить проект "${projectName}"? Это действие необратимо.`)) return;
    const { error } = await supabase.from("projects").delete().eq("id", projectId);
    if (error) {
      toast({ title: "Ошибка удаления", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Проект удален" });
      await loadProjects();
    }
  };

  const checkAndInitRepo = async (projectId: string) => {
    setRepoStatus((prev) => ({ ...prev, [projectId]: "checking" }));
    setRepoError((prev) => ({ ...prev, [projectId]: "" }));
    try {
      const { data: checkData, error: checkErr } = await supabase.functions.invoke("bootstrap-astro", {
        body: { project_id: projectId, action: "check" },
      });
      if (checkErr) throw new Error(checkErr.message);
      if (checkData?.status === "ready") {
        setRepoStatus((prev) => ({ ...prev, [projectId]: "ready" }));
        toast({ title: "Репозиторий уже инициализирован", description: "Сайт готов к работе" });
        return;
      }
      if (checkData?.status === "empty" || checkData?.status === "missing") {
        setRepoStatus((prev) => ({ ...prev, [projectId]: "initializing" }));
        toast({
          title: checkData.status === "missing" ? "Репозиторий не найден" : "Пустой репозиторий обнаружен",
          description: checkData.status === "missing" ? "Создаем репозиторий и загружаем шаблон Astro..." : "Загружаем шаблон Astro...",
        });
        const { data: initData, error: initErr } = await supabase.functions.invoke("bootstrap-astro", {
          body: { project_id: projectId, action: "initialize" },
        });
        if (initErr) throw new Error(initErr.message);
        if (initData?.success) {
          setRepoStatus((prev) => ({ ...prev, [projectId]: "ready" }));
          toast({ title: "Сайт инициализирован!", description: "Шаблон Astro загружен. Деплой запустится автоматически." });
        } else {
          const failedFiles = initData?.results?.filter((r: any) => r.status !== "ok") || [];
          const errMsg = failedFiles.map((f: any) => `${f.file}: ${f.status}`).join("; ");
          setRepoStatus((prev) => ({ ...prev, [projectId]: "error" }));
          setRepoError((prev) => ({ ...prev, [projectId]: errMsg || "Неизвестная ошибка" }));
          toast({ title: "Ошибка инициализации", description: errMsg, variant: "destructive" });
        }
      } else {
        setRepoStatus((prev) => ({ ...prev, [projectId]: "error" }));
        setRepoError((prev) => ({
          ...prev,
          [projectId]: checkData?.message || `Не удалось проверить (status: ${checkData?.status || "unknown"}). Проверьте формат owner/repo и права токена (scope: repo).`,
        }));
      }
    } catch (err: any) {
      setRepoStatus((prev) => ({ ...prev, [projectId]: "error" }));
      setRepoError((prev) => ({ ...prev, [projectId]: err?.message || String(err) }));
      toast({ title: "Ошибка", description: err?.message, variant: "destructive" });
    }
  };

  const handleSave = async (projectId: string) => {
    const vals = editing[projectId];
    if (!vals) return;
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;

    setSaving(projectId);
    const { error } = await supabase
      .from("projects")
      .update({
        github_repo: vals.repo || null,
        github_token: vals.token || null,
        hosting_platform: project.hosting_platform || "cloudflare",
      })
      .eq("id", projectId);
    setSaving(null);
    if (error) {
      toast({ title: "Ошибка сохранения", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Настройки GitHub сохранены" });
      await loadProjects();
      if (vals.repo && vals.token) {
        checkAndInitRepo(projectId);
      }
    }
  };

  const getStatusBadge = (projectId: string) => {
    const status = repoStatus[projectId];
    if (!status || status === "idle") return null;
    const map: Record<string, { cls: string; icon: React.ReactNode; text: string }> = {
      checking: { cls: "", icon: <Loader2 className="h-3 w-3 animate-spin" />, text: "Проверка..." },
      empty: { cls: "bg-yellow-500/20 text-yellow-400", icon: <AlertCircle className="h-3 w-3" />, text: "Пустой" },
      initializing: { cls: "bg-primary/20 text-primary animate-pulse", icon: <Loader2 className="h-3 w-3 animate-spin" />, text: "Инициализация..." },
      ready: { cls: "bg-green-500/20 text-green-400", icon: <CheckCircle className="h-3 w-3" />, text: "Готов" },
      error: { cls: "", icon: <AlertCircle className="h-3 w-3" />, text: "Ошибка" },
    };
    const s = map[status];
    if (!s) return null;
    return (
      <Badge variant={status === "error" ? "destructive" : "secondary"} className={`text-xs gap-1 ${s.cls}`}>
        {s.icon} {s.text}
      </Badge>
    );
  };

  const hostingKeysChanged = HOSTING_KEYS.some(
    (k) => (hostingKeys[k.provider] || "").trim() !== (hostingKeysOriginal[k.provider] || "")
  );

  return (
    <div className="space-y-6">
      {/* ── Hosting API Keys ── */}
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            Ключи хостинг-платформ
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            API-ключи для автоматического деплоя сайтов. Используются при публикации через Фабрику сайтов.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4">
            {/* Cloudflare section */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Cloud className="h-4 w-4 text-orange-400" />
                Cloudflare Pages
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-6">
                {HOSTING_KEYS.filter((k) => k.provider.startsWith("cloudflare")).map((keyDef) => (
                  <div key={keyDef.provider}>
                    <label className="text-xs text-muted-foreground mb-1 block">{keyDef.label}</label>
                    <div className="flex gap-1">
                      <Input
                        type={keyDef.secret && !showHostingKey[keyDef.provider] ? "password" : "text"}
                        value={hostingKeys[keyDef.provider] || ""}
                        onChange={(e) => setHostingKeys((prev) => ({ ...prev, [keyDef.provider]: e.target.value }))}
                        placeholder={keyDef.placeholder}
                        className="text-sm"
                      />
                      {keyDef.secret && (
                        <Button size="icon" variant="ghost" className="shrink-0" onClick={() => setShowHostingKey((prev) => ({ ...prev, [keyDef.provider]: !prev[keyDef.provider] }))}>
                          {showHostingKey[keyDef.provider] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Vercel section */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <svg className="h-4 w-4" viewBox="0 0 76 65" fill="currentColor"><path d="M37.5274 0L75.0548 65H0L37.5274 0Z"/></svg>
                Vercel
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-6">
                {HOSTING_KEYS.filter((k) => k.provider.startsWith("vercel")).map((keyDef) => (
                  <div key={keyDef.provider}>
                    <label className="text-xs text-muted-foreground mb-1 block">{keyDef.label}</label>
                    <div className="flex gap-1">
                      <Input
                        type={keyDef.secret && !showHostingKey[keyDef.provider] ? "password" : "text"}
                        value={hostingKeys[keyDef.provider] || ""}
                        onChange={(e) => setHostingKeys((prev) => ({ ...prev, [keyDef.provider]: e.target.value }))}
                        placeholder={keyDef.placeholder}
                        className="text-sm"
                      />
                      {keyDef.secret && (
                        <Button size="icon" variant="ghost" className="shrink-0" onClick={() => setShowHostingKey((prev) => ({ ...prev, [keyDef.provider]: !prev[keyDef.provider] }))}>
                          {showHostingKey[keyDef.provider] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Netlify section */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <svg className="h-4 w-4" viewBox="0 0 256 256" fill="currentColor"><path d="M128 0L256 128L128 256L0 128L128 0Z"/></svg>
                Netlify
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-6">
                {HOSTING_KEYS.filter((k) => k.provider.startsWith("netlify")).map((keyDef) => (
                  <div key={keyDef.provider}>
                    <label className="text-xs text-muted-foreground mb-1 block">{keyDef.label}</label>
                    <div className="flex gap-1">
                      <Input
                        type={keyDef.secret && !showHostingKey[keyDef.provider] ? "password" : "text"}
                        value={hostingKeys[keyDef.provider] || ""}
                        onChange={(e) => setHostingKeys((prev) => ({ ...prev, [keyDef.provider]: e.target.value }))}
                        placeholder={keyDef.placeholder}
                        className="text-sm"
                      />
                      {keyDef.secret && (
                        <Button size="icon" variant="ghost" className="shrink-0" onClick={() => setShowHostingKey((prev) => ({ ...prev, [keyDef.provider]: !prev[keyDef.provider] }))}>
                          {showHostingKey[keyDef.provider] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Button onClick={handleSaveHostingKeys} disabled={savingHosting || !hostingKeysChanged} size="sm">
            {savingHosting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            Сохранить ключи хостинга
          </Button>
        </CardContent>
      </Card>

      {/* ── GitHub Projects ── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Github className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">GitHub Publishing Settings</h2>
        </div>
        <Button size="sm" onClick={() => setShowNewForm(!showNewForm)}>
          <Plus className="h-4 w-4 mr-1" />
          Добавить проект
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Настройте GitHub Token и Repository для каждого проекта. При сохранении система автоматически проверит и инициализирует репозиторий шаблоном Astro.
      </p>

      <Accordion type="single" collapsible className="mb-4 rounded-lg border border-primary/20 bg-primary/5 px-3">
        <AccordionItem value="help" className="border-0">
          <AccordionTrigger className="text-sm font-medium hover:no-underline py-3">
            <span className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-primary" />
              Как настроить GitHub - памятка
            </span>
          </AccordionTrigger>
          <AccordionContent className="text-sm space-y-3 pt-1 pb-4">
            <div>
              <p className="font-semibold mb-1">1. Узнайте свой логин (owner) на GitHub</p>
              <p className="text-muted-foreground">Откройте github.com, кликните на свой аватар справа сверху - в выпадающем меню сверху будет ваш логин (например <code className="px-1 rounded bg-muted">microgrin71-sudo</code>). Это и есть owner.</p>
            </div>
            <div>
              <p className="font-semibold mb-1">2. Заполните поле Repository в формате owner/repo</p>
              <p className="text-muted-foreground">Примеры: <code className="px-1 rounded bg-muted">microgrin71-sudo/my-seo</code>, <code className="px-1 rounded bg-muted">microgrin71-sudo/auto-blog</code>.<br/>Если такого репозитория еще нет - система создаст его сама при нажатии "Проверить репозиторий".</p>
            </div>
            <div>
              <p className="font-semibold mb-1">3. Создайте GitHub Token</p>
              <ol className="list-decimal list-inside text-muted-foreground space-y-0.5 ml-1">
                <li>Перейдите: <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer" className="text-primary underline">github.com/settings/tokens/new</a></li>
                <li>Note: например "SEO-Module"</li>
                <li>Expiration: 1 год (или No expiration)</li>
                <li>Отметьте scope: <code className="px-1 rounded bg-muted">repo</code> (весь блок целиком) и <code className="px-1 rounded bg-muted">workflow</code></li>
                <li>Нажмите "Generate token" внизу страницы</li>
                <li>Скопируйте токен (начинается с <code className="px-1 rounded bg-muted">ghp_...</code>) и вставьте в поле GitHub Token. Токен показывается только один раз!</li>
              </ol>
            </div>
            <div>
              <p className="font-semibold mb-1">4. Сохранить и Проверить репозиторий</p>
              <p className="text-muted-foreground">Нажмите "Сохранить", затем "Проверить репозиторий". Если репозитория нет - он создастся автоматически и в него загрузится шаблон Astro.</p>
            </div>
            <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs">
              <p className="font-semibold text-yellow-500 mb-1">Частые ошибки</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                <li>Указан неверный owner (логин с GitHub отличается от того, что вы вводите)</li>
                <li>У токена не отмечен scope <code className="px-1 rounded bg-muted">repo</code></li>
                <li>Токен истек - создайте новый</li>
                <li>Repository указан без слеша - правильно <code className="px-1 rounded bg-muted">owner/repo</code>, не просто <code className="px-1 rounded bg-muted">repo</code></li>
              </ul>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {showNewForm && (
        <Card className="border-primary/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Новый проект</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Название проекта *</label>
                <Input value={newProject.name} onChange={(e) => setNewProject((p) => ({ ...p, name: e.target.value }))} placeholder="Мой блог" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Домен</label>
                <Input value={newProject.domain} onChange={(e) => setNewProject((p) => ({ ...p, domain: e.target.value }))} placeholder="my-blog.com" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Repository (owner/repo)</label>
                <Input value={newProject.repo} onChange={(e) => setNewProject((p) => ({ ...p, repo: e.target.value }))} placeholder="username/my-blog" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">GitHub Token</label>
                <Input type="password" value={newProject.token} onChange={(e) => setNewProject((p) => ({ ...p, token: e.target.value }))} placeholder="ghp_..." />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Платформа хостинга по умолчанию</label>
              <Select value={newProject.hostingPlatform} onValueChange={(value) => setNewProject((p) => ({ ...p, hostingPlatform: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vercel">Vercel</SelectItem>
                  <SelectItem value="cloudflare">Cloudflare Pages</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreateProject} disabled={creating} size="sm">
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                Создать
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowNewForm(false)}>Отмена</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {projects.length === 0 && !showNewForm && <p className="text-sm text-muted-foreground">Проектов не найдено.</p>}

      {projects.map((project) => (
        <Card key={project.id}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {project.name}
              {project.domain && <span className="text-xs text-muted-foreground font-normal">({project.domain})</span>}
              {getStatusBadge(project.id)}
              <Button variant="ghost" size="icon" className="ml-auto h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteProject(project.id, project.name)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Платформа хостинга по умолчанию</label>
              <Select
                value={project.hosting_platform || "vercel"}
                onValueChange={(value) => setProjects((prev) => prev.map((p) => p.id === project.id ? { ...p, hosting_platform: value } : p))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vercel">Vercel</SelectItem>
                  <SelectItem value="cloudflare">Cloudflare Pages</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Repository (owner/repo)</label>
              <Input
                value={editing[project.id]?.repo || ""}
                onChange={(e) => setEditing((prev) => ({ ...prev, [project.id]: { ...prev[project.id], repo: e.target.value } }))}
                placeholder="username/my-blog"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">GitHub Token</label>
              <div className="flex gap-2">
                <Input
                  type={showToken[project.id] ? "text" : "password"}
                  value={editing[project.id]?.token || ""}
                  onChange={(e) => setEditing((prev) => ({ ...prev, [project.id]: { ...prev[project.id], token: e.target.value } }))}
                  placeholder="ghp_..."
                />
                <Button size="icon" variant="ghost" onClick={() => setShowToken((prev) => ({ ...prev, [project.id]: !prev[project.id] }))}>
                  {showToken[project.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {repoStatus[project.id] === "error" && repoError[project.id] && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">{repoError[project.id]}</div>
            )}
            <div className="flex gap-2">
              <Button onClick={() => handleSave(project.id)} disabled={saving === project.id || repoStatus[project.id] === "initializing"} size="sm">
                <Save className="h-4 w-4 mr-1" />
                {saving === project.id ? "Сохранение..." : "Сохранить"}
              </Button>
              {project.github_repo && project.github_token && (
                <Button variant="outline" size="sm" onClick={() => checkAndInitRepo(project.id)} disabled={repoStatus[project.id] === "checking" || repoStatus[project.id] === "initializing"}>
                  {(repoStatus[project.id] === "checking" || repoStatus[project.id] === "initializing") && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                  Проверить репозиторий
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
