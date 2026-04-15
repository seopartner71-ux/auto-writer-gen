import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Github, Save, Eye, EyeOff } from "lucide-react";

interface ProjectGH {
  id: string;
  name: string;
  domain: string;
  github_repo: string | null;
  github_token: string | null;
}

export function GitHubProjectsTab() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<ProjectGH[]>([]);
  const [editing, setEditing] = useState<Record<string, { repo: string; token: string }>>({});
  const [showToken, setShowToken] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);

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
      toast({ title: "Error saving", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Saved" });
      loadProjects();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Github className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">GitHub Publishing Settings</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Configure GitHub Token and Repository for each project to enable publishing via Site Factory.
      </p>

      {projects.length === 0 && <p className="text-sm text-muted-foreground">No projects found.</p>}

      {projects.map((project) => (
        <Card key={project.id}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {project.name}
              {project.domain && (
                <span className="text-xs text-muted-foreground font-normal">({project.domain})</span>
              )}
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
            <Button onClick={() => handleSave(project.id)} disabled={saving === project.id} size="sm">
              <Save className="h-4 w-4 mr-1" />
              {saving === project.id ? "Saving..." : "Save"}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
