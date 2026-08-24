import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Upload, CheckCircle2, AlertTriangle, LayoutTemplate, Eye, RotateCw, FileCode2 } from "lucide-react";
import { invokeErrorMessage } from "@/shared/utils/invokeError";

const FN = "site-template-import";
const PAGE_TYPES = ["home", "category", "product", "hub", "article"] as const;
type PageType = typeof PAGE_TYPES[number];

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

const NONE = "__none__";

/**
 * Точка загрузки HTML-шаблона в шаге "1. Основные данные".
 * Два способа: ZIP (с маппингом файлов на типы страниц) и постраничная загрузка.
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
  const [source, setSource] = useState<"zip" | "pages">("zip");
  const [zipHtml, setZipHtml] = useState<string[] | null>(null);
  const [zipCss, setZipCss] = useState<string[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [cssPath, setCssPath] = useState<string>("");
  const [pageFiles, setPageFiles] = useState<Partial<Record<PageType, File>>>({});
  const [cssFile, setCssFile] = useState<File | null>(null);
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

  const applyResult = (res: Record<string, unknown>, fallbackName: string) => {
    setWarnings((res.warnings as string[]) || []);
    if (res.ok === false) {
      const list = (res.errors as string[]) || [];
      setErrors(list.length ? list : [ru ? "Шаблон не прошел валидацию" : "Template validation failed"]);
      setFailed(true);
      toast.error(ru ? "Шаблон не прошел валидацию" : "Template validation failed");
      return false;
    }
    const tpl = (res.template || {}) as Record<string, unknown>;
    onChange({
      mode: "template",
      templateId: String(tpl.id),
      templateName: String(tpl.name || fallbackName),
      templateVersion: tpl.version ? String(tpl.version) : null,
    });
    setProgress(100);
    setStage(ru ? "Готово" : "Done");
    toast.success(ru ? "Шаблон проверен и установлен" : "Template validated and installed");
    return true;
  };

  /** Шаг 1 для ZIP: посмотреть, какие html/css есть внутри. */
  const inspect = async (target: File) => {
    setBusy("inspect"); setErrors([]); setWarnings([]); setPreviews({}); setFailed(false);
    setZipHtml(null); setMap({}); setCssPath("");
    try {
      const { data, error } = await supabase.functions.invoke(`${FN}?action=inspect_zip`, {
        body: target,
        headers: { "Content-Type": "application/zip" },
      });
      if (error) throw new Error(await invokeErrorMessage(error, ru ? "Ошибка чтения архива" : "Archive read failed"));
      const res = (data || {}) as Record<string, any>;
      if (res.ok === false) { setErrors(res.errors || []); setFailed(true); return; }
      if (res.has_manifest) {
        // Строгий контракт: ставим сразу.
        await installZip(target, null);
        return;
      }
      const html: string[] = res.html || [];
      if (!html.length) {
        setErrors([ru ? "В архиве нет HTML-файлов" : "No HTML files in the archive"]);
        setFailed(true);
        return;
      }
      const guessHome = html.find((h) => /(^|\/)index\.html?$/i.test(h)) || html[0];
      setZipHtml(html);
      setZipCss(res.css || []);
      setMap({ home: guessHome });
      toast.message(ru ? "Назначьте файлы типам страниц" : "Map files to page types");
    } catch (e) {
      setErrors([(e as Error).message]);
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const installZip = async (target: File, mapping: Record<string, string> | null) => {
    setBusy("install"); setErrors([]); setFailed(false);
    try {
      const qs = new URLSearchParams({ action: "install", name: target.name.replace(/\.zip$/i, "") });
      if (mapping) qs.set("map", JSON.stringify(mapping));
      if (cssPath) qs.set("css_path", cssPath);
      const { data, error } = await supabase.functions.invoke(`${FN}?${qs.toString()}`, {
        body: target,
        headers: { "Content-Type": "application/zip" },
      });
      if (error) throw new Error(await invokeErrorMessage(error, ru ? "Ошибка загрузки" : "Upload failed"));
      if (applyResult((data || {}) as Record<string, unknown>, target.name)) {
        setFile(null); setZipHtml(null); setMap({});
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch (e) {
      setErrors([(e as Error).message]);
      setFailed(true);
      toast.error(ru ? "Ошибка обработки шаблона" : "Template processing failed");
    } finally {
      setBusy(null);
    }
  };

  const startZip = async () => {
    if (!file) { toast.error(ru ? "Выберите файл template.zip" : "Pick template.zip"); return; }
    if (!/\.zip$/i.test(file.name)) {
      setErrors([ru ? "Ожидается файл .zip" : "A .zip file is expected"]); setFailed(true); return;
    }
    if (zipHtml) { await installZip(file, map); return; }
    await inspect(file);
  };

  /** Постраничная загрузка: читаем html/css в браузере и шлем JSON. */
  const installPages = async () => {
    if (!pageFiles.home) {
      setErrors([ru ? "Нужен минимум файл главной страницы" : "Home page file is required"]);
      setFailed(true);
      return;
    }
    setBusy("install"); setErrors([]); setWarnings([]); setFailed(false);
    try {
      const pages: Record<string, string> = {};
      for (const t of PAGE_TYPES) {
        const f = pageFiles[t];
        if (f) pages[t] = await f.text();
      }
      const css = cssFile ? await cssFile.text() : "";
      const { data, error } = await supabase.functions.invoke(FN, {
        body: { action: "install_pages", pages, css, name: pageFiles.home.name.replace(/\.html?$/i, "") },
      });
      if (error) throw new Error(await invokeErrorMessage(error, ru ? "Ошибка загрузки" : "Upload failed"));
      if (applyResult((data || {}) as Record<string, unknown>, pageFiles.home.name)) {
        setPageFiles({}); setCssFile(null);
      }
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

  const pageLabel: Record<PageType, string> = {
    home: ru ? "Главная" : "Home",
    category: ru ? "Категория" : "Category",
    product: ru ? "Товар" : "Product",
    hub: ru ? "Хаб" : "Hub",
    article: ru ? "Статья" : "Article",
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
            <div className="space-y-3">
              <Tabs value={source} onValueChange={(v) => { setSource(v as "zip" | "pages"); setErrors([]); setFailed(false); }}>
                <TabsList>
                  <TabsTrigger value="zip">ZIP</TabsTrigger>
                  <TabsTrigger value="pages">{ru ? "По страницам" : "Page by page"}</TabsTrigger>
                </TabsList>

                <TabsContent value="zip" className="space-y-2 pt-2">
                  <Input
                    ref={fileRef} type="file" accept=".zip"
                    onChange={(e) => {
                      setFile(e.target.files?.[0] || null);
                      setFailed(false); setErrors([]); setZipHtml(null); setMap({});
                    }}
                  />

                  {zipHtml && (
                    <div className="space-y-2 rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">
                        {ru
                          ? "template.json не найден - назначьте файлы типам страниц. Незаполненные типы возьмут разметку главной."
                          : "No template.json - map files to page types. Missing types reuse the home layout."}
                      </p>
                      {PAGE_TYPES.map((t) => (
                        <div key={t} className="grid grid-cols-[110px_1fr] items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {pageLabel[t]}{t === "home" ? " *" : ""}
                          </span>
                          <Select
                            value={map[t] || NONE}
                            onValueChange={(v) => setMap((m) => {
                              const next = { ...m };
                              if (v === NONE) delete next[t]; else next[t] = v;
                              return next;
                            })}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder={ru ? "Не выбрано" : "Not selected"} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>{ru ? "Не выбрано" : "Not selected"}</SelectItem>
                              {zipHtml.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                      {zipCss.length > 0 && (
                        <div className="grid grid-cols-[110px_1fr] items-center gap-2">
                          <span className="text-xs text-muted-foreground">CSS</span>
                          <Select value={cssPath || NONE} onValueChange={(v) => setCssPath(v === NONE ? "" : v)}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder={ru ? "Все CSS архива" : "All CSS from archive"} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>{ru ? "Все CSS архива" : "All CSS from archive"}</SelectItem>
                              {zipCss.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" disabled={!file || !!busy} onClick={() => void startZip()}>
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                      {zipHtml
                        ? (ru ? "Установить шаблон" : "Install template")
                        : (ru ? "Загрузить ZIP" : "Upload ZIP")}
                    </Button>
                    {failed && !busy && (
                      <Button type="button" size="sm" variant="outline" disabled={!file} onClick={() => void startZip()}>
                        <RotateCw className="mr-2 h-4 w-4" />
                        {ru ? "Повторить загрузку" : "Retry upload"}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {ru
                      ? "Подойдет обычный ZIP с готовым HTML/CSS-шаблоном. Скрипты и внешние подключения вырезаются автоматически."
                      : "Any ZIP with a ready HTML/CSS template works. Scripts and external includes are stripped automatically."}
                  </p>
                </TabsContent>

                <TabsContent value="pages" className="space-y-2 pt-2">
                  {PAGE_TYPES.map((t) => (
                    <div key={t} className="grid gap-1 sm:grid-cols-[110px_1fr] sm:items-center">
                      <span className="text-xs text-muted-foreground">
                        {pageLabel[t]}{t === "home" ? " *" : ""}
                      </span>
                      <Input
                        type="file" accept=".html,.htm" className="h-8 text-xs"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          setPageFiles((p) => ({ ...p, [t]: f || undefined }));
                          setFailed(false); setErrors([]);
                        }}
                      />
                    </div>
                  ))}
                  <div className="grid gap-1 sm:grid-cols-[110px_1fr] sm:items-center">
                    <span className="text-xs text-muted-foreground">CSS</span>
                    <Input
                      type="file" accept=".css" className="h-8 text-xs"
                      onChange={(e) => setCssFile(e.target.files?.[0] || null)}
                    />
                  </div>
                  <Button type="button" size="sm" disabled={!pageFiles.home || !!busy} onClick={() => void installPages()}>
                    {busy === "install" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCode2 className="mr-2 h-4 w-4" />}
                    {ru ? "Установить шаблон" : "Install template"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {ru
                      ? "Загрузите HTML-страницы по одной. Обязательна только главная - остальные типы возьмут ее разметку."
                      : "Upload HTML pages one by one. Only home is required - other types reuse its layout."}
                  </p>
                </TabsContent>
              </Tabs>

              {busy === "install" && (
                <div className="space-y-1">
                  <Progress value={progress} className="h-1.5" />
                  <p className="text-xs text-muted-foreground">{stage} - {progress}%</p>
                </div>
              )}
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
