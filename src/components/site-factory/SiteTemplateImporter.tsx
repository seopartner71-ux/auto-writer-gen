import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Upload, Trash2, CheckCircle2, AlertTriangle } from "lucide-react";

type PageType = "home" | "category" | "product" | "hub" | "article";
const PAGE_TYPES: PageType[] = ["home", "category", "product", "hub", "article"];

interface SiteTemplate {
  id: string;
  slug: string;
  name: string;
  version: string;
  engine: string;
  description: string | null;
  status: string;
  pages: Record<string, string>;
  created_at: string;
}

interface Props {
  projectId?: string;
  currentTemplateId?: string | null;
  templateEngine?: string | null;
  onChanged?: () => void;
}

const FN = "site-template-import";

export function SiteTemplateImporter({
  projectId,
  currentTemplateId,
  templateEngine,
  onChanged,
}: Props) {
  const [templates, setTemplates] = useState<SiteTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [slug, setSlug] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke(FN, { body: { action: "list" } });
    setLoading(false);
    if (error) { toast.error("Не удалось загрузить список шаблонов"); return; }
    setTemplates(((data as any)?.templates || []) as SiteTemplate[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sendZip = async (action: "validate" | "preview_zip" | "install") => {
    if (!file) { toast.error("Выберите файл template.zip"); return; }
    setBusy(action);
    setErrors([]); setWarnings([]);
    try {
      const fd = new FormData();
      fd.append("action", action);
      fd.append("file", file);
      if (slug.trim()) fd.append("slug", slug.trim());
      const { data, error } = await supabase.functions.invoke(FN, { body: fd });
      const res = (data || {}) as any;
      if (error && !res?.errors) throw new Error(error.message);
      setWarnings(res.warnings || []);
      if (res.ok === false) {
        setErrors(res.errors || ["Шаблон не прошел валидацию"]);
        toast.error("Шаблон не прошел валидацию");
        return;
      }
      if (action === "validate") {
        toast.success(`Шаблон корректен: ${res.manifest?.name} v${res.manifest?.version}`);
      } else if (action === "preview_zip") {
        setPreviews(res.previews || {});
        toast.success("Превью построено на тестовых данных");
      } else {
        toast.success("Шаблон установлен");
        setFile(null); setSlug("");
        if (fileRef.current) fileRef.current.value = "";
        await load();
        onChanged?.();
      }
    } catch (e) {
      setErrors([(e as Error).message]);
      toast.error("Ошибка обработки шаблона");
    } finally {
      setBusy(null);
    }
  };

  const call = async (body: Record<string, unknown>, okMsg: string) => {
    setBusy(String(body.action));
    const { data, error } = await supabase.functions.invoke(FN, { body });
    setBusy(null);
    if (error || (data as any)?.ok === false) { toast.error("Не удалось выполнить действие"); return null; }
    toast.success(okMsg);
    return data as any;
  };

  const previewInstalled = async (id: string) => {
    const res = await call({ action: "preview", template_id: id }, "Превью готово");
    if (res?.previews) setPreviews(res.previews);
  };

  const selectForProject = async (id: string) => {
    if (!projectId) { toast.error("Проект не выбран"); return; }
    await call({ action: "select", project_id: projectId, template_id: id }, "Шаблон подключен к проекту");
    onChanged?.();
  };

  const useLegacy = async () => {
    if (!projectId) return;
    await call({ action: "disable", project_id: projectId }, "Проект переведен на legacy-рендер");
    onChanged?.();
  };

  const remove = async (id: string) => {
    await call({ action: "delete", template_id: id }, "Шаблон удален");
    await load();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Импорт шаблона (template.zip)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-zip">Архив шаблона</Label>
              <Input
                id="tpl-zip" ref={fileRef} type="file" accept=".zip"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-slug">Slug (необязательно)</Label>
              <Input
                id="tpl-slug" value={slug} placeholder="my-template"
                onChange={(e) => setSlug(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!file || !!busy} onClick={() => sendZip("validate")}>
              {busy === "validate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Проверить
            </Button>
            <Button variant="outline" disabled={!file || !!busy} onClick={() => sendZip("preview_zip")}>
              {busy === "preview_zip" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Превью
            </Button>
            <Button disabled={!file || !!busy} onClick={() => sendZip("install")}>
              {busy === "install"
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Upload className="mr-2 h-4 w-4" />}
              Установить
            </Button>
          </div>

          {errors.length > 0 && (
            <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {errors.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{e}
                </li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <ul className="space-y-1 rounded-md border p-3 text-sm text-muted-foreground">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </CardContent>
      </Card>

      {Object.keys(previews).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Превью на тестовых данных</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue={Object.keys(previews)[0]}>
              <TabsList>
                {PAGE_TYPES.filter((t) => previews[t]).map((t) => (
                  <TabsTrigger key={t} value={t}>{t}</TabsTrigger>
                ))}
              </TabsList>
              {PAGE_TYPES.filter((t) => previews[t]).map((t) => (
                <TabsContent key={t} value={t}>
                  <iframe
                    title={`preview-${t}`}
                    sandbox=""
                    srcDoc={previews[t]}
                    className="h-[600px] w-full rounded-md border bg-background"
                  />
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Мои шаблоны</CardTitle>
          {projectId && (
            <Button variant="ghost" size="sm" onClick={useLegacy}>
              Вернуть legacy
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
          {!loading && templates.length === 0 && (
            <p className="text-sm text-muted-foreground">Пока нет установленных шаблонов.</p>
          )}
          {templates.map((t) => {
            const active = currentTemplateId === t.id && templateEngine === "template";
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{t.name}</span>
                    <Badge variant="outline">v{t.version}</Badge>
                    {active && (
                      <Badge className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Активен
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.slug} - страницы: {Object.keys(t.pages || {}).join(", ") || "-"}
                  </p>
                </div>
                <Button variant="outline" size="sm" disabled={!!busy} onClick={() => previewInstalled(t.id)}>
                  Превью
                </Button>
                {projectId && (
                  <Button size="sm" disabled={!!busy || active} onClick={() => selectForProject(t.id)}>
                    Выбрать
                  </Button>
                )}
                <Button variant="ghost" size="icon" disabled={!!busy} onClick={() => remove(t.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
