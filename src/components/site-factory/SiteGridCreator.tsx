import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Rocket, CheckCircle2, AlertCircle, ExternalLink, Layers, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SitePreviewDialog, SitePreviewSpec } from "./SitePreviewDialog";

type RowStatus = "pending" | "creating" | "deploying" | "done" | "error";

interface SiteSpec {
  topic: string;
  siteName: string;
  region: string;
  services: string;
  audience: string;
  businessType: string;
  homepageStyle: "landing" | "magazine" | "news";
}

interface SiteRow {
  topic: string;
  status: RowStatus;
  name?: string;
  url?: string;
  error?: string;
  projectId?: string;
  template?: string;
  templateName?: string;
}

const STATUS_LABELS: Record<RowStatus, string> = {
  pending: "В очереди",
  creating: "Создание проекта",
  deploying: "Деплой",
  done: "Готов",
  error: "Ошибка",
};

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const emptySpec = (): SiteSpec => ({
  topic: "", siteName: "", region: "", services: "", audience: "", businessType: "продажа",
  homepageStyle: "landing",
});

const BUSINESS_TYPES = [
  { value: "продажа", label: "Продажа товаров" },
  { value: "услуги", label: "Услуги" },
  { value: "информационный", label: "Инфо-сайт / блог" },
  { value: "производство", label: "Производство" },
];

export function SiteGridCreator() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [specs, setSpecs] = useState<SiteSpec[]>([emptySpec()]);
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [running, setRunning] = useState(false);
  const [activeTemplates, setActiveTemplates] = useState<{ template_key: string; name: string }[]>([]);
  const [previewSpec, setPreviewSpec] = useState<SitePreviewSpec | null>(null);
  const [lastReport, setLastReport] = useState<{ duration: string; cost: number; ok: number; err: number } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("pbn_templates")
        .select("template_key, name")
        .eq("is_active", true)
        .order("sort_order");
      setActiveTemplates(data || []);
    })();
  }, []);

  const validSpecs = specs.filter((s) => s.topic.trim().length > 0).slice(0, 20);
  const effectiveCount = validSpecs.length;
  const completed = rows.filter((r) => r.status === "done" || r.status === "error").length;
  const progress = rows.length > 0 ? Math.round((completed / rows.length) * 100) : 0;

  const addSpec = () => setSpecs((prev) => (prev.length >= 20 ? prev : [...prev, emptySpec()]));
  const removeSpec = (idx: number) => setSpecs((prev) => prev.length === 1 ? [emptySpec()] : prev.filter((_, i) => i !== idx));
  const updateSpec = (idx: number, patch: Partial<SiteSpec>) =>
    setSpecs((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const updateRow = (idx: number, patch: Partial<SiteRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const handleStart = async () => {
    await runQueue();
  };

  const handlePreview = () => {
    if (validSpecs.length !== 1) {
      toast({ title: "Превью доступно только для одного сайта", description: "Удалите лишние записи или используйте массовый запуск." });
      return;
    }
    const s = validSpecs[0];
    const tpl = activeTemplates.length > 0 ? activeTemplates[0] : null;
    setPreviewSpec({
      topic: s.topic,
      siteName: s.siteName,
      region: s.region,
      services: s.services,
      audience: s.audience,
      businessType: s.businessType,
      homepageStyle: s.homepageStyle,
      templateName: tpl?.name,
    });
  };

  const runQueue = async () => {
    if (!user) {
      toast({ title: "Не авторизован", variant: "destructive" });
      return;
    }
    if (validSpecs.length === 0) {
      toast({ title: "Добавьте хотя бы одну тематику", variant: "destructive" });
      return;
    }

    const queue: SiteSpec[] = validSpecs;
    const initial: SiteRow[] = queue.map((s) => ({ topic: s.topic, status: "pending" }));
    setRows(initial);
    setRunning(true);
    setLastReport(null);
    const startedAt = Date.now();

    for (let i = 0; i < queue.length; i++) {
      const spec = queue[i];
      const topic = spec.topic.trim();
      const tpl = activeTemplates.length > 0 ? pickRandom(activeTemplates) : null;
      const templateKey = tpl?.template_key;
      const templateName = tpl?.name;

      try {
        // 1. AI-generate brand-style site name
        updateRow(i, { status: "creating", name: "...", template: templateKey, templateName });
        let projectName = spec.siteName.trim() || topic;
        if (!spec.siteName.trim()) {
          try {
            const niceTopic = spec.region ? `${topic} в ${spec.region}` : topic;
            const { data: nameData } = await supabase.functions.invoke("generate-site-name", {
              body: { topic: niceTopic, language: "ru" },
            });
            if (nameData?.name) projectName = String(nameData.name);
          } catch { /* fallback to raw topic */ }
        }
        updateRow(i, { name: projectName });

        // 2. Create project row
        const { data: created, error: createErr } = await supabase
          .from("projects")
          .insert({
            user_id: user.id,
            name: projectName,
            domain: "",
            language: "ru",
            region: spec.region || "RU",
            hosting_platform: "cloudflare",
            site_name: projectName,
            site_about: spec.services
              ? `${topic} - ${spec.services}${spec.region ? ` в ${spec.region}` : ""}`
              : `${topic}${spec.region ? ` в ${spec.region}` : ""}`,
            homepage_style: spec.homepageStyle,
          })
          .select("id")
          .single();
        if (createErr || !created) throw new Error(createErr?.message || "Не удалось создать проект");

        const projectId = created.id;
        updateRow(i, { projectId });

        // 3. Generate site profile (company, authors, about, business pages)
        try {
          await supabase.functions.invoke("generate-site-content", {
            body: { project_id: projectId, topic },
          });
        } catch (e) {
          console.warn("[SiteGridCreator] generate-site-content failed, continuing", e);
        }

        // 4. Seed 3 starter articles so the site is not empty
        try {
          await supabase.functions.invoke("seed-starter-articles", {
            body: { project_id: projectId, topic, count: 3 },
          });
        } catch (e) {
          console.warn("[SiteGridCreator] seed-starter-articles failed, continuing", e);
        }

        // 5. Direct Upload deploy (no GitHub, no Astro)
        updateRow(i, { status: "deploying" });
        const { data: cfData, error: cfErr } = await supabase.functions.invoke("deploy-cloudflare-direct", {
          body: {
            project_id: projectId,
            template_key: templateKey,
            site_name: projectName,
            site_about: spec.services
              ? `${topic} - ${spec.services}${spec.region ? ` в ${spec.region}` : ""}`
              : `${topic}${spec.region ? ` в ${spec.region}` : ""}`,
            topic,
            region: spec.region || undefined,
            services: spec.services || undefined,
            audience: spec.audience || undefined,
            business_type: spec.businessType || undefined,
          },
        });
        if (cfErr) throw new Error(cfErr.message);
        if (cfData?.error) throw new Error(cfData.error + (cfData.message ? `: ${cfData.message}` : ""));

        updateRow(i, { status: "done", url: cfData?.url || null });
      } catch (err: any) {
        updateRow(i, { status: "error", error: err?.message || String(err) });
      }
    }

    setRunning(false);
    const okCount = rows.filter((r) => r.status === "done").length;
    const errCount = rows.filter((r) => r.status === "error").length;
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    const duration = mins > 0 ? `${mins}м ${secs}с` : `${secs}с`;
    const estCost = okCount * 0.05;
    setLastReport({ duration, cost: estCost, ok: okCount, err: errCount });
    toast({ title: "Сетка создана", description: `Готово: ${okCount}/${queue.length} за ${duration}` });
  };

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          Создать сетку сайтов
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Массовое создание PBN-сетки. Для каждого сайта укажите тематику, регион, ключевые услуги и аудиторию - AI сгенерирует контент строго под эту нишу. До 20 сайтов за раз.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Сайты для создания (до 20)</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addSpec}
              disabled={running || specs.length >= 20}
              className="h-7 gap-1 text-xs"
            >
              <Plus className="h-3 w-3" />
              Добавить сайт
            </Button>
          </div>

          <div className="space-y-3">
            {specs.map((spec, idx) => (
              <div
                key={idx}
                className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Сайт #{idx + 1}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSpec(idx)}
                    disabled={running}
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    aria-label="Удалить"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-[10px] text-muted-foreground">
                      Название сайта / компании <span className="opacity-60">(необязательно - сгенерируем сами)</span>
                    </Label>
                    <Input
                      placeholder="ООО АгроТехника / DachaPro"
                      value={spec.siteName}
                      onChange={(e) => updateSpec(idx, { siteName: e.target.value })}
                      disabled={running}
                      className="h-8 text-xs"
                      maxLength={80}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Тематика / ниша *</Label>
                    <Input
                      placeholder="Минитракторы для дачи"
                      value={spec.topic}
                      onChange={(e) => updateSpec(idx, { topic: e.target.value })}
                      disabled={running}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Регион</Label>
                    <Input
                      placeholder="Москва, Подмосковье"
                      value={spec.region}
                      onChange={(e) => updateSpec(idx, { region: e.target.value })}
                      disabled={running}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-[10px] text-muted-foreground">
                      Ключевые услуги/товары (через запятую)
                    </Label>
                    <Input
                      placeholder="минитрактор, культиватор, навесное оборудование"
                      value={spec.services}
                      onChange={(e) => updateSpec(idx, { services: e.target.value })}
                      disabled={running}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Целевая аудитория</Label>
                    <Input
                      placeholder="дачники, фермеры, ЛПХ"
                      value={spec.audience}
                      onChange={(e) => updateSpec(idx, { audience: e.target.value })}
                      disabled={running}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Тип бизнеса</Label>
                    <select
                      value={spec.businessType}
                      onChange={(e) => updateSpec(idx, { businessType: e.target.value })}
                      disabled={running}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50"
                    >
                      {BUSINESS_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-[10px] text-muted-foreground">Стиль главной страницы</Label>
                    <select
                      value={spec.homepageStyle}
                      onChange={(e) => updateSpec(idx, { homepageStyle: e.target.value as "landing" | "magazine" | "news" })}
                      disabled={running}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50"
                    >
                      <option value="landing">Лендинг (с формой заявки) - по умолчанию</option>
                      <option value="magazine">Журнал (контент-первый, без формы)</option>
                      <option value="news">Новостной портал (плотная сетка новостей)</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Будет создано: <span className="font-semibold text-foreground">{effectiveCount}</span> сайтов
          </div>
          <Button onClick={handleStart} disabled={running || effectiveCount === 0} className="gap-2">
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
                    <th className="text-left px-3 py-2 font-medium">Шаблон</th>
                    <th className="text-left px-3 py-2 font-medium">Статус</th>
                    <th className="text-left px-3 py-2 font-medium">URL</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={idx} className="border-t border-border">
                      <td className="px-3 py-2 truncate max-w-[140px]">{r.topic}</td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[160px]">{r.name || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.templateName || r.template || "—"}</td>
                      <td className="px-3 py-2">
                        <Badge variant={
                          r.status === "done" ? "default" :
                          r.status === "error" ? "destructive" :
                          r.status === "pending" ? "secondary" : "outline"
                        } className="gap-1 text-[10px]">
                          {r.status === "done" && <CheckCircle2 className="h-3 w-3" />}
                          {r.status === "error" && <AlertCircle className="h-3 w-3" />}
                          {(r.status === "creating" || r.status === "deploying") && <Loader2 className="h-3 w-3 animate-spin" />}
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