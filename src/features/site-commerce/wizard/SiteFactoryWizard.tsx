import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, Loader2, FolderPlus, Lock, AlertTriangle } from "lucide-react";
import { ImportPanel } from "../ImportPanel";
import { KeywordsPanel } from "../KeywordsPanel";
import { ProductsPanel } from "../ProductsPanel";
import { CatalogPanel } from "../catalog/CatalogPanel";
import { CompanyProfilePanel } from "../CompanyProfilePanel";
import { MediaPanel } from "../MediaPanel";
import { PROFILE_FIELDS, fieldValue, requirementStatus, type ProfileValues } from "../profileSpec";
import { SiloStructurePanel } from "@/components/site-factory/SiloStructurePanel";
import { StepContent } from "./StepContent";
import { StepQa } from "./StepQa";
import { StepPreview } from "./StepPreview";
import { DeploymentCenter } from "./DeploymentCenter";
import { LaunchPanel } from "./LaunchPanel";
import { ReleasesPanel } from "./ReleasesPanel";
import { DesignPanel } from "@/features/site-visual/DesignPanel";
import { PerformancePanel } from "../performance/PerformancePanel";
import { FiltersPanel } from "../filters/FiltersPanel";
import { TemplateChoiceCard, type TemplateChoice } from "@/components/site-factory/wizard/TemplateChoiceCard";


interface ProjectLite {
  id: string; name: string; domain: string; language: string; region: string;
  site_positioning: string | null; url_scheme: string;
  site_template_id: string | null; template_engine: string | null;
}

const LANGUAGES = ["ru", "en", "de", "fr", "es", "pt", "it", "tr", "pl", "uk"];
const REGIONS = ["RU", "US", "GB", "DE", "FR", "ES", "BR", "IT", "TR", "PL", "UA", "KZ"];

export function SiteFactoryWizard({ lang }: { lang: string }) {
  const ru = lang === "ru";
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [step, setStep] = useState(0);
  const [kwKey, setKwKey] = useState(0);
  const [prodKey, setProdKey] = useState(0);
  const [profileReady, setProfileReady] = useState(false);
  const [missingProfile, setMissingProfile] = useState<string[]>([]);
  const [form, setForm] = useState({ name: "", niche: "", region: "RU", language: "ru", domain: "" });
  const [templateChoice, setTemplateChoice] = useState<TemplateChoice>({
    mode: "legacy", templateId: null, templateName: null, templateVersion: null,
  });

  const project = useMemo(() => projects.find((p) => p.id === projectId) || null, [projects, projectId]);

  const STEPS = ru
    ? ["Основные данные", "Профиль компании", "Семантика", "SILO", "Каталог", "Фильтры", "Контент", "Изображения", "QA", "Превью", "Дизайн", "Запуск", "Производительность", "Релизы"]
    : ["Basics", "Company profile", "Semantics", "SILO", "Catalog", "Filters", "Content", "Images", "QA", "Preview", "Design", "Launch", "Performance", "Releases"];


  // Шаг 2 - обязательный шлюз: без обязательных полей профиля дальше не пускаем.
  const PROFILE_STEP = 1;

  const handleProfileStatus = useCallback((ready: boolean, missing: string[]) => {
    setProfileReady(ready);
    setMissingProfile(missing);
  }, []);

  const gotoStep = useCallback((next: number) => {
    if (next > PROFILE_STEP && !profileReady) {
      setStep(PROFILE_STEP);
      toast.error(ru
        ? "Сначала заполните обязательные поля профиля компании"
        : "Fill the required company profile fields first");
      return;
    }
    setStep(next);
  }, [profileReady, ru]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase.from("projects")
      .select("id, name, domain, language, region, site_positioning, url_scheme, site_template_id, template_engine")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    const rows = (data || []) as ProjectLite[];
    setProjects(rows);
    setProjectId((prev) => prev || localStorage.getItem("sf_wizard_project") || rows[0]?.id || "");
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  // Читаем профиль выбранного проекта, чтобы знать статус шлюза на любом шаге.
  useEffect(() => {
    let alive = true;
    if (!projectId) { setProfileReady(false); setMissingProfile([]); return; }
    (async () => {
      const { data } = await supabase.from("projects")
        .select("site_about, site_positioning, company_name, company_phone, company_email, company_address, work_hours, region, founding_year, juridical_inn, clients_count_text, commercial_profile")
        .eq("id", projectId).maybeSingle();
      if (!alive) return;
      const row = (data || {}) as Record<string, unknown>;
      const profile = (row.commercial_profile || {}) as ProfileValues;
      const seeded: ProfileValues = { ...profile };
      for (const f of PROFILE_FIELDS) {
        if (!String(seeded[f.key] ?? "").trim()) {
          const legacy = fieldValue(f, {}, row);
          if (legacy) seeded[f.key] = legacy;
        }
      }
      const st = requirementStatus(seeded, row);
      setProfileReady(st.ready);
      setMissingProfile(st.missingRequired.map((f) => f.label));
    })();
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => {
    if (!project) return;
    localStorage.setItem("sf_wizard_project", project.id);
    setForm({
      name: project.name || "",
      niche: project.site_positioning || "",
      region: project.region || "RU",
      language: project.language || "ru",
      domain: project.domain || "",
    });
  }, [project]);

  // Подтягиваем текущий шаблон проекта при открытии мастера.
  useEffect(() => {
    let alive = true;
    if (!project) return;
    if (project.template_engine !== "template" || !project.site_template_id) {
      setTemplateChoice({ mode: "legacy", templateId: null, templateName: null, templateVersion: null });
      return;
    }
    (async () => {
      const { data } = await supabase.from("site_templates")
        .select("id, name, version").eq("id", project.site_template_id).maybeSingle();
      if (!alive) return;
      const row = data as { id: string; name: string; version: string } | null;
      setTemplateChoice({
        mode: "template",
        templateId: project.site_template_id,
        templateName: row?.name || (ru ? "Загруженный шаблон" : "Uploaded template"),
        templateVersion: row?.version || null,
      });
    })();
    return () => { alive = false; };
  }, [project, ru]);

  const startNew = () => {
    setProjectId("");
    setStep(0);
    setForm({ name: "", niche: "", region: "RU", language: "ru", domain: "" });
    setTemplateChoice({ mode: "legacy", templateId: null, templateName: null, templateVersion: null });
  };

  // Step 1: create or update the project. Commercial pipeline requires url_scheme = silo.
  const saveBasics = async () => {
    if (!user) return;
    if (!form.name.trim()) { toast.error(ru ? "Укажите название" : "Name is required"); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        domain: form.domain.trim(),
        language: form.language,
        region: form.region,
        site_positioning: form.niche.trim() || null,
        url_scheme: "silo",
      };
      let targetId = projectId;
      if (projectId) {
        const { error } = await supabase.from("projects").update(payload as never).eq("id", projectId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("projects")
          .insert({ user_id: user.id, ...payload } as never)
          .select("id").single();
        if (error) throw error;
        targetId = (data as { id: string }).id;
        setProjectId(targetId);
      }

      // Привязка визуального шаблона через существующий Template Import V1.
      const wasTemplate = project?.template_engine === "template" && !!project?.site_template_id;
      if (templateChoice.mode === "template" && templateChoice.templateId) {
        if (project?.site_template_id !== templateChoice.templateId || !wasTemplate) {
          const { error } = await supabase.functions.invoke("site-template-import", {
            body: { action: "select", project_id: targetId, template_id: templateChoice.templateId },
          });
          if (error) throw error;
        }
      } else if (wasTemplate) {
        const { error } = await supabase.functions.invoke("site-template-import", {
          body: { action: "disable", project_id: targetId },
        });
        if (error) throw error;
      }

      await load();
      toast.success(ru ? "Проект сохранен" : "Project saved");
      setStep(PROFILE_STEP);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const body = () => {
    if (step === 0) {
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{ru ? "Название" : "Name"}</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={ru ? "Например: Заклепки Про" : "e.g. Rivets Pro"} />
          </div>
          <div className="space-y-1.5">
            <Label>{ru ? "Ниша" : "Niche"}</Label>
            <Input value={form.niche} onChange={(e) => setForm({ ...form, niche: e.target.value })}
              placeholder={ru ? "Крепеж и заклепочный инструмент" : "Fasteners and rivet tools"} />
          </div>
          <div className="space-y-1.5">
            <Label>{ru ? "Регион" : "Region"}</Label>
            <Select value={form.region} onValueChange={(v) => setForm({ ...form, region: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{REGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{ru ? "Язык" : "Language"}</Label>
            <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{ru ? "Домен (необязательно)" : "Domain (optional)"}</Label>
            <Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="example.com" />
          </div>
          <TemplateChoiceCard ru={ru} value={templateChoice} onChange={setTemplateChoice} />
          <div className="sm:col-span-2">
            <Button onClick={saveBasics} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
              {projectId ? (ru ? "Сохранить и продолжить" : "Save and continue") : (ru ? "Создать проект" : "Create project")}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              {ru
                ? "Проект переводится на SILO-схему URL - это обязательное условие коммерческой Фабрики."
                : "The project switches to the SILO URL scheme, required by the commercial factory."}
            </p>
          </div>
        </div>
      );
    }

    if (!projectId) {
      return <p className="text-sm text-muted-foreground">{ru ? "Сначала создайте проект на шаге 1." : "Create a project in step 1 first."}</p>;
    }

    switch (step) {
      case 1:
        return <CompanyProfilePanel projectId={projectId} ru={ru} onStatusChange={handleProfileStatus} />;
      case 2:
        return (
          <div className="space-y-4">
            <ImportPanel projectId={projectId} kind="keywords" ru={ru} onImported={() => setKwKey((k) => k + 1)} />
            <KeywordsPanel projectId={projectId} ru={ru} refreshKey={kwKey} onStructureBuilt={() => setProdKey((k) => k + 1)} />
          </div>
        );
      case 3:
        return <SiloStructurePanel key={`silo-${prodKey}`} projectId={projectId} lang={lang} />;
      case 4:
        return (
          <div className="space-y-4">
            <CatalogPanel
              projectId={projectId}
              ru={ru}
              onImported={() => setProdKey((k) => k + 1)}
              onContinue={() => gotoStep(3)}
            />
            <ProductsPanel projectId={projectId} ru={ru} refreshKey={prodKey} />
          </div>
        );
      case 5:
        return <FiltersPanel projectId={projectId} ru={ru} />;
      case 6:
        return <StepContent projectId={projectId} ru={ru} />;
      case 7:
        return <MediaPanel projectId={projectId} ru={ru} />;
      case 8:
        return <StepQa projectId={projectId} ru={ru} siteName={project?.name || "site"} />;
      case 9:
        return <StepPreview projectId={projectId} ru={ru} />;
      case 10:
        return <DesignPanel projectId={projectId} ru={ru} />;
      case 11:
        return (
          <div className="space-y-4">
            <LaunchPanel projectId={projectId} ru={ru} onGoToStep={gotoStep} />
            <DeploymentCenter projectId={projectId} ru={ru} siteName={project?.name || "site"} />
          </div>
        );
      case 12:
        return <PerformancePanel projectId={projectId} ru={ru} onGoToStep={gotoStep} />;
      default:
        return <ReleasesPanel projectId={projectId} ru={ru} />;

    }
  };

  if (loading) {
    return <div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{ru ? "Мастер сайта" : "Site wizard"}</CardTitle>
            <Select value={projectId} onValueChange={(v) => { setProjectId(v); setStep(0); }}>
              <SelectTrigger className="h-8 w-64 ml-auto"><SelectValue placeholder={ru ? "Выберите проект" : "Select project"} /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={startNew}>
              <FolderPlus className="h-4 w-4 mr-2" />{ru ? "Новый" : "New"}
            </Button>
            {project && project.url_scheme !== "silo" && (
              <Badge variant="outline" className="text-yellow-500">{ru ? "не SILO" : "not SILO"}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {STEPS.map((s, i) => {
              const locked = i > PROFILE_STEP && !profileReady;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => gotoStep(i)}
                  className={`px-2.5 py-1 rounded text-xs border transition-colors flex items-center gap-1 ${
                    i === step
                      ? "border-primary text-primary"
                      : locked
                        ? "border-border/40 text-muted-foreground/50"
                        : "border-border/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {locked && <Lock className="h-3 w-3" />}
                  {i + 1}. {s}
                </button>
              );
            })}
          </div>
          {!profileReady && projectId && (
            <p className="mt-2 text-xs text-destructive flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {ru
                ? `Шаг «Профиль компании» обязателен. Не заполнено: ${missingProfile.join(", ") || "-"}`
                : `The company profile step is required. Missing: ${missingProfile.join(", ") || "-"}`}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{step + 1}. {STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent>{body()}</CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <ChevronLeft className="h-4 w-4 mr-1" />{ru ? "Назад" : "Back"}
        </Button>
        <Button variant="outline" onClick={() => gotoStep(Math.min(STEPS.length - 1, step + 1))}
          disabled={step === STEPS.length - 1 || !projectId || (step >= PROFILE_STEP && !profileReady)}>
          {ru ? "Далее" : "Next"}<ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}