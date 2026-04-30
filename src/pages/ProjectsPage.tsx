import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";
import { PlanGate } from "@/shared/components/PlanGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Globe, Link2, FolderOpen, Loader2, FileText, CheckCircle2, Eye, Zap, Sparkles, RefreshCw
} from "lucide-react";

interface Project {
  id: string;
  user_id: string;
  name: string;
  domain: string;
  language: string;
  region: string;
  auto_interlinking: boolean;
  ai_model?: string;
  created_at: string;
  updated_at: string;
}

const LANGUAGES = [
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "it", label: "Italiano" },
  { value: "tr", label: "Türkçe" },
  { value: "pl", label: "Polski" },
  { value: "uk", label: "Українська" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "zh", label: "中文" },
  { value: "ar", label: "العربية" },
];

const REGIONS = [
  "RU", "US", "GB", "DE", "FR", "ES", "BR", "IN", "JP", "IT",
  "TR", "PL", "UA", "KZ", "AZ", "GE", "UZ", "TH", "ID", "VN",
  "AE", "SA", "AU", "CA", "NL", "KR", "CO", "MX", "AR",
];

const defaultForm = {
  name: "",
  domain: "",
  language: "ru",
  region: "RU",
  auto_interlinking: true,
  ai_model: "gemini-flash" as "gemini-flash" | "claude-sonnet",
};

export default function ProjectsPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { limits, plan } = usePlanLimits();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isFactory = plan === "pro"; // FACTORY = pro tier

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    () => localStorage.getItem("active_project_id")
  );
  const [viewingProjectId, setViewingProjectId] = useState<string | null>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Project[];
    },
    enabled: !!user,
  });

  // Count articles per project
  const { data: articleCounts = {} } = useQuery({
    queryKey: ["project-article-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("project_id")
        .not("project_id", "is", null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((a: any) => {
        counts[a.project_id] = (counts[a.project_id] || 0) + 1;
      });
      return counts;
    },
    enabled: !!user,
  });

  // Articles for the project being viewed
  const { data: projectArticles = [], isLoading: articlesLoading } = useQuery({
    queryKey: ["project-articles", viewingProjectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, status, created_at, keywords")
        .eq("project_id", viewingProjectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!viewingProjectId,
  });

  const handleSetActive = (id: string) => {
    const newId = activeProjectId === id ? null : id;
    setActiveProjectId(newId);
    if (newId) {
      localStorage.setItem("active_project_id", newId);
      toast.success(t("projects.activated"));
    } else {
      localStorage.removeItem("active_project_id");
      toast.info(t("projects.deactivated"));
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");
      if (!form.name.trim()) throw new Error("Name is required");

      if (editingId) {
        const { error } = await supabase
          .from("projects")
          .update({
            name: form.name.trim(),
            domain: form.domain.trim(),
            language: form.language,
            region: form.region,
            auto_interlinking: form.auto_interlinking,
            ai_model: form.ai_model,
          })
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("projects").insert({
          user_id: user.id,
          name: form.name.trim(),
          domain: form.domain.trim(),
          language: form.language,
          region: form.region,
          auto_interlinking: form.auto_interlinking,
          ai_model: form.ai_model,
        }).select("id").single();
        if (error) throw error;
        // Auto-activate new project
        if (data?.id) {
          localStorage.setItem("active_project_id", data.id);
          setActiveProjectId(data.id);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDialogOpen(false);
      setEditingId(null);
      setForm(defaultForm);
      toast.success(editingId ? t("projects.updated") : t("projects.created"));
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("delete-cloudflare-site", {
        body: { project_id: id },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(t("projects.deleted"));
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openEdit = (p: Project) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      domain: p.domain,
      language: p.language,
      region: p.region,
      auto_interlinking: p.auto_interlinking,
      ai_model: (p.ai_model as any) || "gemini-flash",
    });
    setDialogOpen(true);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(defaultForm);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("projects.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("projects.subtitle")}</p>
        </div>
        <PlanGate allowed={isFactory} featureName={t("projects.title")} requiredPlan="FACTORY">
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" /> {t("projects.create")}
          </Button>
        </PlanGate>
      </div>

      <PlanGate allowed={isFactory} featureName={t("projects.title")} requiredPlan="FACTORY">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : projects.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-3">
              <FolderOpen className="h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">{t("projects.empty")}</p>
              <Button onClick={openCreate} variant="outline" className="gap-2">
                <Plus className="h-4 w-4" /> {t("projects.createFirst")}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => {
              const isActive = activeProjectId === p.id;
              return (
              <Card key={p.id} className={`group transition-colors ${isActive ? "border-primary ring-1 ring-primary/30" : "hover:border-primary/40"}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base truncate">{p.name}</CardTitle>
                        {isActive && (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0 gap-1 shrink-0">
                            <Zap className="h-2.5 w-2.5" /> {t("projects.active")}
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="flex items-center gap-1.5 text-xs">
                        <Globe className="h-3 w-3 shrink-0" />
                        <span className="truncate">{p.domain || "—"}</span>
                      </CardDescription>
                    </div>
                    <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="text-xs">{p.language.toUpperCase()}</Badge>
                    <Badge variant="outline" className="text-xs">{p.region}</Badge>
                    {p.auto_interlinking && (
                      <Badge variant="default" className="text-xs gap-1">
                        <Link2 className="h-3 w-3" /> {t("projects.interlinking")}
                      </Badge>
                    )}
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <FileText className="h-3.5 w-3.5" />
                      <span>{articleCounts[p.id] || 0} {t("projects.articlesCount")}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs h-8 gap-1.5"
                      onClick={() => setViewingProjectId(viewingProjectId === p.id ? null : p.id)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {t("projects.viewArticles")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 text-xs h-8 gap-1.5 text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(t("projects.confirmDelete"))) {
                          deleteMutation.mutate(p.id);
                          if (activeProjectId === p.id) {
                            localStorage.removeItem("active_project_id");
                            setActiveProjectId(null);
                          }
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t("projects.delete")}
                    </Button>
                  </div>

                  {/* Inline articles list */}
                  {viewingProjectId === p.id && (
                    <div className="mt-2 space-y-2 border-t border-border pt-3">
                      {articlesLoading ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : projectArticles.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-3">{t("projects.noArticles")}</p>
                      ) : (
                        <div className="space-y-1.5 max-h-60 overflow-y-auto">
                          {projectArticles.map((a: any) => (
                            <div
                              key={a.id}
                              className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50 hover:bg-muted cursor-pointer transition-colors"
                              onClick={() => navigate(`/articles?edit=${a.id}`)}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium truncate text-foreground">
                                  {a.title || t("projects.untitled")}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {new Date(a.created_at).toLocaleDateString()}
                                </p>
                              </div>
                              <Badge variant={a.status === "completed" ? "default" : "secondary"} className="text-[10px] shrink-0">
                                {a.status || "draft"}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}
      </PlanGate>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? t("projects.edit") : t("projects.createNew")}</DialogTitle>
            <DialogDescription>{t("projects.dialogDesc")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>{t("projects.name")}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t("projects.namePlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("projects.domain")}</Label>
              <Input
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
                placeholder="example.com"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("projects.language")}</Label>
                <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t("projects.region")}</Label>
                <Select value={form.region} onValueChange={(v) => setForm({ ...form, region: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">{t("projects.autoInterlinking")}</Label>
                <p className="text-xs text-muted-foreground">{t("projects.autoInterlinkingDesc")}</p>
              </div>
              <Switch
                checked={form.auto_interlinking}
                onCheckedChange={(v) => setForm({ ...form, auto_interlinking: v })}
              />
            </div>

            <div className="space-y-2 rounded-lg border border-border p-3">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Модель генерации текстов
              </Label>
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, ai_model: "gemini-flash" })}
                  className={`text-left rounded-md border px-3 py-2 transition-colors ${
                    form.ai_model === "gemini-flash"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Gemini 2.5 Flash</span>
                    {form.ai_model === "gemini-flash" && (
                      <Badge variant="default" className="text-[10px] px-1.5 py-0">Выбрано</Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Быстро - дешево - ~$0.05 / сайт
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, ai_model: "claude-sonnet" })}
                  className={`text-left rounded-md border px-3 py-2 transition-colors ${
                    form.ai_model === "claude-sonnet"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium flex items-center gap-1">
                      Claude Sonnet 4
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Рекомендуем</Badge>
                    </span>
                    {form.ai_model === "claude-sonnet" && (
                      <Badge variant="default" className="text-[10px] px-1.5 py-0">Выбрано</Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Качество - SEO-оптимизация - ~$0.40 / сайт
                  </p>
                </button>
              </div>
            </div>

            <Button
              className="w-full"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.name.trim()}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {editingId ? t("common.save") : t("common.create")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
