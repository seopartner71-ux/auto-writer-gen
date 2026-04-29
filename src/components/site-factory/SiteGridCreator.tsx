import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Rocket, CheckCircle2, AlertCircle, ExternalLink, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type RowStatus = "pending" | "creating" | "bootstrapping" | "deploying" | "done" | "error";

interface SiteRow {
  topic: string;
  status: RowStatus;
  name?: string;
  url?: string;
  error?: string;
  projectId?: string;
}

const STATUS_LABELS: Record<RowStatus, string> = {
  pending: "В очереди",
  creating: "Создание проекта",
  bootstrapping: "Загрузка шаблона",
  deploying: "Деплой",
  done: "Готов",
  error: "Ошибка",
};

export function SiteGridCreator() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [count, setCount] = useState(3);
  const [topicsRaw, setTopicsRaw] = useState("");
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [running, setRunning] = useState(false);

  const parsedTopics = topicsRaw.split("\n").map((s) => s.trim()).filter(Boolean);
  const effectiveCount = Math.min(count, 20);
  const completed = rows.filter((r) => r.status === "done" || r.status === "error").length;
  const progress = rows.length > 0 ? Math.round((completed / rows.length) * 100) : 0;

  const updateRow = (idx: number, patch: Partial<SiteRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const handleStart = async () => {
    if (!user) {
      toast({ title: "Не авторизован", variant: "destructive" });
      return;
    }
    if (parsedTopics.length === 0) {
      toast({ title: "Введите хотя бы одну тематику", variant: "destructive" });
      return;
    }

    // Pre-flight: find a project with valid GitHub token+owner ONCE for the whole batch
    const { data: tokenProjects } = await supabase
      .from("projects")
      .select("github_token, github_repo")
      .eq("user_id", user.id)
      .not("github_token", "is", null)
      .order("updated_at", { ascending: false })
      .limit(10);

    let inheritedToken: string | null = null;
    let ghOwner: string | null = null;
    for (const p of tokenProjects || []) {
      if (!p.github_token) continue;
      try {
        const meRes = await fetch("https://api.github.com/user", {
          headers: { Authorization: `token ${p.github_token}`, Accept: "application/vnd.github.v3+json" },
        });
        if (meRes.ok) {
          const me = await meRes.json();
          if (me?.login) {
            inheritedToken = p.github_token;
            ghOwner = me.login;
            break;
          }
        }
      } catch { /* try next */ }
    }
    // Fallback: parse owner from existing github_repo
    if (inheritedToken && !ghOwner) {
      const firstWithRepo = (tokenProjects || []).find((p) => p.github_repo?.includes("/"));
      if (firstWithRepo?.github_repo) ghOwner = firstWithRepo.github_repo.split("/")[0];
    }

    if (!inheritedToken || !ghOwner) {
      toast({
        title: "GitHub Token не найден",
        description: "Откройте любой проект в Фабрике сайтов и сохраните GitHub Personal Access Token (scope: repo). После этого повторите запуск сетки.",
        variant: "destructive",
      });
      return;
    }

    // Build queue: take first N topics; if topics < count, repeat last topic
    const queue: string[] = [];
    for (let i = 0; i < effectiveCount; i++) {
      queue.push(parsedTopics[i] ?? parsedTopics[parsedTopics.length - 1]);
    }

    const initial: SiteRow[] = queue.map((topic) => ({ topic, status: "pending" }));
    setRows(initial);
    setRunning(true);

    for (let i = 0; i < queue.length; i++) {
      const topic = queue[i];

      try {
        // 1. AI-generate brand-style site name
        updateRow(i, { status: "creating", name: "..." });
        let projectName = topic;
        try {
          const { data: nameData } = await supabase.functions.invoke("generate-site-name", {
            body: { topic, language: "ru" },
          });
          if (nameData?.name) projectName = String(nameData.name);
        } catch { /* fallback to raw topic */ }
        updateRow(i, { name: projectName });

        // 2. Create project row
        const { data: created, error: createErr } = await supabase
          .from("projects")
          .insert({
            user_id: user.id,
            name: projectName,
            domain: "",
            language: "ru",
            region: "RU",
            hosting_platform: "cloudflare",
            site_name: projectName,
            site_about: `Блог про ${topic}`,
          })
          .select("id")
          .single();
        if (createErr || !created) throw new Error(createErr?.message || "Не удалось создать проект");

        const projectId = created.id;
        updateRow(i, { projectId });

        // 3. Inherit github token + assign unique repo name
        const repoName = `pbn-site-${projectId.slice(0, 8)}`;
        const githubRepo = `${ghOwner}/${repoName}`;
        await supabase.from("projects").update({
          github_repo: githubRepo,
          github_token: inheritedToken,
        }).eq("id", projectId);

        // 4. Bootstrap astro (creates repo if needed)
        updateRow(i, { status: "bootstrapping" });
        const { data: bootData, error: bootErr } = await supabase.functions.invoke("bootstrap-astro", {
          body: {
            project_id: projectId,
            action: "initialize",
            site_name: projectName,
            site_about: `Блог про ${topic}`,
            language: "ru",
            primary_color: "#6366f1",
            font_pair: "inter",
          },
        });
        if (bootErr) throw new Error(bootErr.message);
        if (!bootData?.success) throw new Error(bootData?.message || "bootstrap-astro failed");

        // 5. Deploy to Cloudflare
        updateRow(i, { status: "deploying" });
        const { data: cfData, error: cfErr } = await supabase.functions.invoke("deploy-cloudflare", {
          body: { project_id: projectId },
        });
        if (cfErr) throw new Error(cfErr.message);
        if (cfData?.error && cfData.error !== "name_conflict") throw new Error(cfData.error);

        updateRow(i, { status: "done", url: cfData?.url || null });
      } catch (err: any) {
        updateRow(i, { status: "error", error: err?.message || String(err) });
      }
    }

    setRunning(false);
    toast({ title: "Сетка создана", description: `Готово: ${rows.filter(r => r.status === "done").length}/${queue.length}` });
  };

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          Создать сетку сайтов
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Массовое создание PBN-сетки на Cloudflare Pages. Названия генерируются AI; GitHub Token берется из существующих проектов автоматически.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Количество сайтов (1-20)</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
              disabled={running}
            />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label className="text-xs">Тематики (по одной на строку)</Label>
            <Textarea
              rows={3}
              placeholder={"Кофейные машины\nГорные велосипеды\nКриптовалюты"}
              value={topicsRaw}
              onChange={(e) => setTopicsRaw(e.target.value)}
              disabled={running}
              className="text-sm resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Будет создано: <span className="font-semibold text-foreground">{effectiveCount}</span> сайтов
            {parsedTopics.length > 0 && parsedTopics.length < effectiveCount && (
              <span className="text-yellow-400"> (последняя тематика повторится)</span>
            )}
          </div>
          <Button onClick={handleStart} disabled={running || parsedTopics.length === 0} className="gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            {running ? "Создание..." : "Запустить"}
          </Button>
        </div>

        {rows.length > 0 && (
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Прогресс</span>
                <span className="font-medium">{completed}/{rows.length}</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Тематика</th>
                    <th className="text-left px-3 py-2 font-medium">Название</th>
                    <th className="text-left px-3 py-2 font-medium">Статус</th>
                    <th className="text-left px-3 py-2 font-medium">URL</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={idx} className="border-t border-border">
                      <td className="px-3 py-2 truncate max-w-[140px]">{r.topic}</td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[160px]">{r.name || "—"}</td>
                      <td className="px-3 py-2">
                        <Badge variant={
                          r.status === "done" ? "default" :
                          r.status === "error" ? "destructive" :
                          r.status === "pending" ? "secondary" : "outline"
                        } className="gap-1 text-[10px]">
                          {r.status === "done" && <CheckCircle2 className="h-3 w-3" />}
                          {r.status === "error" && <AlertCircle className="h-3 w-3" />}
                          {(r.status === "creating" || r.status === "bootstrapping" || r.status === "deploying") && <Loader2 className="h-3 w-3 animate-spin" />}
                          {STATUS_LABELS[r.status]}
                        </Badge>
                        {r.error && (
                          <div className="mt-1 text-[10px] text-destructive break-words">{r.error}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" />
                            <span className="truncate max-w-[160px]">{r.url.replace(/^https?:\/\//, "")}</span>
                          </a>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}