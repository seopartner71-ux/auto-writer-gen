import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Upload, CheckCircle2, AlertTriangle, LayoutTemplate, Eye, RotateCw } from "lucide-react";
import { invokeErrorMessage } from "@/shared/utils/invokeError";



const FN = "site-template-import";
const PAGE_TYPES = ["home", "category", "product", "hub", "article"] as const;

export interface TemplateChoice {
  mode: "legacy" | "template";
  templateId: string | null;
  templateName: string | null;
  templateVersion: string | null;
}

interface Props {
  ru: boolean;
  value: TemplateChoice;
  onChange: (v: TemplateChoice) => void;
}

/**
 * Точка загрузки HTML-шаблона в шаге "1. Основные данные".
 * Использует существующий Template Import V1 (edge function site-template-import).
 */
export function TemplateChoiceCard({ ru, value, onChange }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string>("");
  const [failed, setFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const installed = value.mode === "template" && !!value.templateId;

  // Индикатор прогресса: имитируем этапы, пока edge function обрабатывает ZIP.
  useEffect(() => {
    if (busy !== "install") return;
    setProgress(8);
    const t = setInterval(() => {
      setProgress((p) => {
        const next = p + Math.max(1, Math.round((92 - p) / 12));
        const v = Math.min(next, 92);
        setStage(
          v < 30 ? (ru ? "Загрузка архива" : "Uploading archive")
            : v < 60 ? (ru ? "Проверка структуры" : "Validating structure")
              : (ru ? "Установка шаблона" : "Installing template"),
        );
        return v;
      });
    }, 260);
    return () => clearInterval(t);
  }, [busy, ru]);

  const install = async (src?: File | null) => {
    const target = src ?? file;
    if (!target) { toast.error(ru ? "Выберите файл template.zip" : "Pick template.zip"); return; }
    if (!/\.zip$/i.test(target.name)) {
      setErrors([ru ? "Ожидается файл .zip" : "A .zip file is expected"]); setFailed(true); return;
    }
    setBusy("install"); setErrors([]); setWarnings([]); setPreviews({}); setFailed(false);
    try {
      // Raw binary upload: multipart parsing is unreliable through the
      // functions gateway, the ZIP goes as the request body itself.
      const { data, error } = await supabase.functions.invoke(`${FN}?action=install`, {
        body: target,
        headers: { "Content-Type": "application/zip" },
      });
      if (error) throw new Error(await invokeErrorMessage(error, ru ? "Ошибка загрузки" : "Upload failed"));
      const res = (data || {}) as Record<string, any>;
      setWarnings(res.warnings || []);
      if (res.ok === false) {
        setErrors(res.errors?.length ? res.errors : [ru ? "Шаблон не прошел валидацию" : "Template validation failed"]);
        setFailed(true);
        toast.error(ru ? "Шаблон не прошел валидацию" : "Template validation failed");
        return;
      }
      const tpl = res.template || {};
      onChange({
        mode: "template",
        templateId: String(tpl.id),
        templateName: String(tpl.name || target.name),
        templateVersion: tpl.version ? String(tpl.version) : null,
      });
      setProgress(100);
      setStage(ru ? "Готово" : "Done");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      toast.success(ru ? "Шаблон проверен и установлен" : "Template validated and installed");
    } catch (e) {
      setErrors([(e as Error).message]);
      setFailed(true);
      toast.error(ru ? "Ошибка обработки шаблона" : "Template processing failed");
    } finally {
      setBusy(null);
    }
  };



  const preview = async () => {
    if (!value.templateId) return;
    setBusy("preview");
    const { data, error } = await supabase.functions.invoke(FN, {
      body: { action: "preview", template_id: value.templateId },
    });
    setBusy(null);
    const res = (data || {}) as Record<string, any>;
    if (error || res.ok === false) { toast.error(ru ? "Превью недоступно" : "Preview failed"); return; }
    setPreviews(res.previews || {});
  };

  return (
    <div className="sm:col-span-2 space-y-3 rounded-md border p-4">
      <div className="flex items-center gap-2">
        <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
        <Label className="text-sm">{ru ? "Визуальный шаблон" : "Visual template"}</Label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={value.mode === "legacy" ? "default" : "outline"}
          onClick={() => onChange({ mode: "legacy", templateId: null, templateName: null, templateVersion: null })}
        >
          {ru ? "Использовать стандартный шаблон" : "Use standard template"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={value.mode === "template" ? "default" : "outline"}
          onClick={() => onChange({ ...value, mode: "template" })}
        >
          {ru ? "Загрузить HTML-шаблон" : "Upload HTML template"}
        </Button>
      </div>

      {value.mode === "template" && (
        <div className="space-y-3">
          {installed ? (
            <div className="space-y-2 rounded-md border border-primary/40 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span className="font-medium">{value.templateName}</span>
                {value.templateVersion && <Badge variant="outline">v{value.templateVersion}</Badge>}
              </div>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                <li>{ru ? "Шаблон проверен" : "Template validated"}</li>
                <li>{ru ? "5 типов страниц поддерживаются" : "5 page types supported"}</li>
                <li>Home / Category / Product / Hub / Article</li>
              </ul>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={preview}>
                  {busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                  {ru ? "Предпросмотр" : "Preview"}
                </Button>
                <Button
                  type="button" size="sm" variant="ghost"
                  onClick={() => { setPreviews({}); onChange({ mode: "template", templateId: null, templateName: null, templateVersion: null }); }}
                >
                  {ru ? "Заменить шаблон" : "Replace template"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Input ref={fileRef} type="file" accept=".zip" onChange={(e) => { setFile(e.target.files?.[0] || null); setFailed(false); setErrors([]); }} />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={!file || !!busy} onClick={() => void install()}>
                  {busy === "install" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  {ru ? "Загрузить ZIP" : "Upload ZIP"}
                </Button>
                {failed && !busy && (
                  <Button type="button" size="sm" variant="outline" disabled={!file} onClick={() => void install()}>
                    <RotateCw className="mr-2 h-4 w-4" />
                    {ru ? "Повторить загрузку" : "Retry upload"}
                  </Button>
                )}
              </div>
              {busy === "install" && (
                <div className="space-y-1">
                  <Progress value={progress} className="h-1.5" />
                  <p className="text-xs text-muted-foreground">{stage} - {progress}%</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {ru
                  ? "Загрузите ZIP с HTML/CSS-шаблоном сайта. Фабрика автоматически проверит структуру и подключит шаблон к генерируемому сайту."
                  : "Upload a ZIP with the HTML/CSS site template. The factory validates its structure and connects it to the generated site."}
              </p>
            </div>

          )}

          {errors.length > 0 && (
            <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              {errors.map((e, i) => (
                <li key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{e}</li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <ul className="space-y-1 rounded-md border p-3 text-xs text-muted-foreground">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}

          {Object.keys(previews).length > 0 && (
            <Tabs defaultValue={PAGE_TYPES.find((t) => previews[t]) || "home"}>
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
                    className="h-[520px] w-full rounded-md border bg-background"
                  />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>
      )}
    </div>
  );
}
