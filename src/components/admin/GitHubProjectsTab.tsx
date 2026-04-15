import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Github, Save, Eye, EyeOff, Loader2, CheckCircle, AlertCircle } from "lucide-react";

interface ProjectGH {
  id: string;
  name: string;
  domain: string;
  github_repo: string | null;
  github_token: string | null;
}

type RepoStatus = "idle" | "checking" | "empty" | "initializing" | "ready" | "error";

export function GitHubProjectsTab() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<ProjectGH[]>([]);
  const [editing, setEditing] = useState<Record<string, { repo: string; token: string }>>({});
  const [showToken, setShowToken] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [repoStatus, setRepoStatus] = useState<Record<string, RepoStatus>>({});
  const [repoError, setRepoError] = useState<Record<string, string>>({});

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    const { data } = await supabase.from("projects").select("id, name, domain, github_repo, github_token");
    if (data) {
      setProjects(data as ProjectGH[]);
      const ed: Record<string, { repo: string; token: string }> = {};
      data.forEach((p: any) => {
        ed[p.id] = { repo: p.github_repo || "", token: p.github_token || "" };
      });
      setEditing(ed);
    }
  };

  const checkAndInitRepo = async (projectId: string) => {
    setRepoStatus((prev) => ({ ...prev, [projectId]: "checking" }));
    setRepoError((prev) => ({ ...prev, [projectId]: "" }));

    try {
      // 1. Check repo status
      const { data: checkData, error: checkErr } = await supabase.functions.invoke("bootstrap-astro", {
        body: { project_id: projectId, action: "check" },
      });

      if (checkErr) throw new Error(checkErr.message);

      if (checkData?.status === "ready") {
        setRepoStatus((prev) => ({ ...prev, [projectId]: "ready" }));
        toast({ title: "Репозиторий уже инициализирован", description: "Сайт готов к работе" });
        return;
      }

      if (checkData?.status === "empty") {
        // 2. Auto-initialize
        setRepoStatus((prev) => ({ ...prev, [projectId]: "initializing" }));
        toast({ title: "Пустой репозиторий обнаружен", description: "Загружаем шаблон Astro..." });

        const { data: initData, error: initErr } = await supabase.functions.invoke("bootstrap-astro", {
          body: { project_id: projectId, action: "initialize" },
        });

        if (initErr) throw new Error(initErr.message);

        if (initData?.success) {
          setRepoStatus((prev) => ({ ...prev, [projectId]: "ready" }));
          toast({ title: "Сайт инициализирован! 🎉", description: "Шаблон Astro загружен в репозиторий. Vercel задеплоит сайт автоматически." });
        } else {
          const failedFiles = initData?.results?.filter((r: any) => r.status !== "ok") || [];
          const errMsg = failedFiles.map((f: any) => `${f.file}: ${f.status}`).join("; ");
          setRepoStatus((prev) => ({ ...prev, [projectId]: "error" }));
          setRepoError((prev) => ({ ...prev, [projectId]: errMsg || "Неизвестная ошибка при загрузке файлов" }));
          toast({ title: "Ошибка инициализации", description: errMsg, variant: "destructive" });
        }
      } else {
        setRepoStatus((prev) => ({ ...prev, [projectId]: "error" }));
        setRepoError((prev) => ({ ...prev, [projectId]: checkData?.message || "Не удалось проверить репозиторий" }));
      }
    } catch (err: any) {
      console.error("[checkAndInitRepo]", err);
      setRepoStatus((prev) => ({ ...prev, [projectId]: "error" }));
      setRepoError((prev) => ({ ...prev, [projectId]: err?.message || String(err) }));
      toast({ title: "Ошибка", description: err?.message, variant: "destructive" });
    }
  };

  const handleSave = async (projectId: string) => {
    const vals = editing[projectId];
    if (!vals) return;
    setSaving(projectId);
    const { error } = await supabase
      .from("projects")
      .update({ github_repo: vals.repo || null, github_token: vals.token || null })
      .eq("id", projectId);
    setSaving(null);
    if (error) {
      toast({ title: "Ошибка сохранения", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Настройки GitHub сохранены" });
      await loadProjects();

      // Auto-trigger repo check & init if both fields are filled
      if (vals.repo && vals.token) {
        checkAndInitRepo(projectId);
      }
    }
  };

  const getStatusBadge = (projectId: string) => {
    const status = repoStatus[projectId];
    if (!status || status === "idle") return null;

    switch (status) {
      case "checking":
        return (
          <Badge variant="secondary" className="text-xs gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Проверка репозитория...
          </Badge>
        );
      case "empty":
        return (
          <Badge variant="secondary" className="text-xs gap-1 bg-yellow-500/20 text-yellow-400">
            <AlertCircle className="h-3 w-3" /> Пустой репозиторий
          </Badge>
        );
      case "initializing":
        return (
          <Badge variant="secondary" className="text-xs gap-1 bg-primary/20 text-primary animate-pulse">
            <Loader2 className="h-3 w-3 animate-spin" /> Инициализация...
          </Badge>
        );
      case "ready":
        return (
          <Badge variant="secondary" className="text-xs gap-1 bg-green-500/20 text-green-400">
            <CheckCircle className="h-3 w-3" /> Готов к работе
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive" className="text-xs gap-1">
            <AlertCircle className="h-3 w-3" /> Ошибка
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Github className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">GitHub Publishing Settings</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Настройте GitHub Token и Repository для каждого проекта. При сохранении система автоматически проверит и инициализирует репозиторий шаблоном Astro.
      </p>

      {projects.length === 0 && <p className="text-sm text-muted-foreground">Проектов не найдено.</p>}

      {projects.map((project) => (
        <Card key={project.id}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {project.name}
              {project.domain && (
                <span className="text-xs text-muted-foreground font-normal">({project.domain})</span>
              )}
              {getStatusBadge(project.id)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Repository (owner/repo)</label>
              <Input
                value={editing[project.id]?.repo || ""}
                onChange={(e) =>
                  setEditing((prev) => ({
                    ...prev,
                    [project.id]: { ...prev[project.id], repo: e.target.value },
                  }))
                }
                placeholder="username/my-blog"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">GitHub Token</label>
              <div className="flex gap-2">
                <Input
                  type={showToken[project.id] ? "text" : "password"}
                  value={editing[project.id]?.token || ""}
                  onChange={(e) =>
                    setEditing((prev) => ({
                      ...prev,
                      [project.id]: { ...prev[project.id], token: e.target.value },
                    }))
                  }
                  placeholder="ghp_..."
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setShowToken((prev) => ({ ...prev, [project.id]: !prev[project.id] }))}
                >
                  {showToken[project.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {repoStatus[project.id] === "error" && repoError[project.id] && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                {repoError[project.id]}
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={() => handleSave(project.id)} disabled={saving === project.id || repoStatus[project.id] === "initializing"} size="sm">
                <Save className="h-4 w-4 mr-1" />
                {saving === project.id ? "Сохранение..." : "Сохранить"}
              </Button>
              {project.github_repo && project.github_token && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => checkAndInitRepo(project.id)}
                  disabled={repoStatus[project.id] === "checking" || repoStatus[project.id] === "initializing"}
                >
                  {repoStatus[project.id] === "checking" || repoStatus[project.id] === "initializing" ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : null}
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
