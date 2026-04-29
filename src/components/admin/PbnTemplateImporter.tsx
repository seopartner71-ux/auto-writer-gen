import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Upload, FileCode, Link2, FileArchive, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Mapping = Record<string, string | null>;

interface AnalysisResult {
  analysis: {
    selectors: Record<string, { selector: string | null; sample: string }>;
    postsBlock: any;
    accentColor: string | null;
    headingFont: string | null;
    bodyFont: string | null;
    hasFooter: boolean;
    hasSidebar: boolean;
  };
  raw_html: string;
  raw_css: string;
}

const FIELD_LABELS: Record<string, string> = {
  site_name: "Название сайта",
  site_description: "Описание / слоган",
  site_about: "Блок О компании",
  contacts_content: "Контакты",
  privacy_content: "Политика конф.",
  author_name: "Имя автора",
  year: "Год копирайта (футер)",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function PbnTemplateImporter({ open, onOpenChange, onImported }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);

  // Step 1 inputs
  const [tab, setTab] = useState<"zip" | "html-file" | "html-code" | "url">("html-code");
  const [htmlCode, setHtmlCode] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);

  // Step 2 — analysis result + editable mapping
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [postsBlock, setPostsBlock] = useState<any>(null);

  // Step 3 — meta
  const [name, setName] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [description, setDescription] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [outHtml, setOutHtml] = useState("");
  const [outCss, setOutCss] = useState("");

  const reset = () => {
    setStep(1); setHtmlCode(""); setUrl(""); setFile(null);
    setResult(null); setMapping({}); setPostsBlock(null);
    setName(""); setTemplateKey(""); setDescription("");
    setPreviewHtml(""); setOutHtml(""); setOutCss("");
  };

  const callConverter = async (init: RequestInit, query = ""): Promise<any> => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("Нет сессии");
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const r = await fetch(`https://${projectId}.functions.supabase.co/html-template-converter${query}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
    return json;
  };

  const analyze = async () => {
    setLoading(true);
    try {
      let res: AnalysisResult;
      if (tab === "url") {
        if (!/^https?:\/\//.test(url)) throw new Error("Введите валидный URL");
        res = await callConverter({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "url", url }),
        });
      } else if (tab === "html-code") {
        if (htmlCode.length < 50) throw new Error("Вставьте HTML");
        res = await callConverter({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "html", html: htmlCode }),
        });
      } else {
        if (!file) throw new Error("Выберите файл");
        const fd = new FormData();
        fd.append("kind", tab === "zip" ? "zip" : "html");
        fd.append("file", file);
        res = await callConverter({ method: "POST", body: fd });
      }
      setResult(res);
      const m: Mapping = {};
      for (const [k, v] of Object.entries(res.analysis.selectors)) m[k] = v.selector;
      setMapping(m);
      setPostsBlock(res.analysis.postsBlock);
      setStep(2);
    } catch (e: any) {
      toast({ title: "Ошибка анализа", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const buildPreview = async () => {
    if (!result) return;
    setLoading(true);
    try {
      const out = await callConverter(
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            html: result.raw_html,
            css: result.raw_css,
            mapping,
            postsBlock,
          }),
        },
        "?action=apply"
      );
      setOutHtml(out.html_structure);
      setOutCss(out.css_styles);
      // Render preview with sample data
      const sample = renderSample(out.html_structure, out.css_styles);
      setPreviewHtml(sample);
      setStep(3);
    } catch (e: any) {
      toast({ title: "Ошибка генерации", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!name || !templateKey) {
      toast({ title: "Заполните название и ключ", variant: "destructive" });
      return;
    }
    setLoading(true);
    const fontPair: [string, string] = [
      result?.analysis.headingFont || "Inter",
      result?.analysis.bodyFont || "Inter",
    ];
    const { error } = await supabase.from("pbn_templates").insert({
      template_key: templateKey,
      name,
      description: description || null,
      html_structure: outHtml,
      css_styles: outCss,
      font_pairs: [fontPair],
      is_active: true,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Ошибка сохранения", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Шаблон импортирован" });
    reset();
    onOpenChange(false);
    onImported();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Импорт шаблона - шаг {step} из 3
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3">
            <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
              <TabsList className="grid grid-cols-4">
                <TabsTrigger value="html-code"><FileCode className="h-4 w-4 mr-1" />HTML код</TabsTrigger>
                <TabsTrigger value="html-file"><Upload className="h-4 w-4 mr-1" />HTML файл</TabsTrigger>
                <TabsTrigger value="zip"><FileArchive className="h-4 w-4 mr-1" />ZIP архив</TabsTrigger>
                <TabsTrigger value="url"><Link2 className="h-4 w-4 mr-1" />URL сайта</TabsTrigger>
              </TabsList>
              <TabsContent value="html-code" className="pt-3">
                <Label className="text-xs">Вставьте HTML целиком</Label>
                <Textarea rows={14} className="font-mono text-xs" value={htmlCode} onChange={(e) => setHtmlCode(e.target.value)} placeholder="<!DOCTYPE html>..." />
              </TabsContent>
              <TabsContent value="html-file" className="pt-3">
                <Input type="file" accept=".html,.htm" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </TabsContent>
              <TabsContent value="zip" className="pt-3">
                <Input type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                <p className="text-xs text-muted-foreground mt-2">CSS из архива будет встроен. Картинки останутся ссылками - используйте только абсолютные URL.</p>
              </TabsContent>
              <TabsContent value="url" className="pt-3">
                <Label className="text-xs">URL страницы для парсинга</Label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
              </TabsContent>
            </Tabs>
          </div>
        )}

        {step === 2 && result && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-2 rounded border bg-muted/30">
                <div className="text-muted-foreground">Акцентный цвет</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="inline-block w-4 h-4 rounded border" style={{ background: result.analysis.accentColor || "#0ea5e9" }} />
                  <code>{result.analysis.accentColor || "не найден"}</code>
                </div>
              </div>
              <div className="p-2 rounded border bg-muted/30">
                <div className="text-muted-foreground">Шрифты</div>
                <div className="mt-1">H: {result.analysis.headingFont || "—"} / B: {result.analysis.bodyFont || "—"}</div>
              </div>
              <div className="p-2 rounded border bg-muted/30">
                <div className="text-muted-foreground">Структура</div>
                <div className="mt-1">
                  Footer: {result.analysis.hasFooter ? "да" : "нет"}, Sidebar: {result.analysis.hasSidebar ? "да" : "нет"}
                </div>
              </div>
            </div>

            <div className="border rounded">
              <div className="px-3 py-2 border-b text-xs font-medium bg-muted/50">Селекторы для замены на плейсхолдеры</div>
              <div className="divide-y">
                {Object.keys(FIELD_LABELS).map((key) => {
                  const info = result.analysis.selectors[key];
                  return (
                    <div key={key} className="grid grid-cols-12 gap-2 p-2 items-center text-xs">
                      <div className="col-span-3">
                        <div className="font-medium">{FIELD_LABELS[key]}</div>
                        <code className="text-[10px] text-muted-foreground">{`{{${key}}}`}</code>
                      </div>
                      <div className="col-span-4">
                        <Input
                          className="h-8 font-mono text-xs"
                          value={mapping[key] || ""}
                          onChange={(e) => setMapping({ ...mapping, [key]: e.target.value || null })}
                          placeholder="CSS селектор"
                        />
                      </div>
                      <div className="col-span-5 text-muted-foreground truncate" title={info?.sample}>
                        {info?.sample || <span className="italic">не найдено</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {postsBlock && (
              <div className="border rounded">
                <div className="px-3 py-2 border-b text-xs font-medium bg-muted/50">Блок статей</div>
                <div className="p-2 text-xs space-y-1">
                  <div>Контейнер: <code>{postsBlock.container}</code></div>
                  <div>Элементы: <code>{postsBlock.itemSelector}</code> ({postsBlock.sample?.length || 0} найдено)</div>
                  <div className="text-muted-foreground">Заголовки: {(postsBlock.sample || []).join(" | ")}</div>
                  <p className="text-[11px] text-muted-foreground pt-1">
                    Контейнер будет заменен на цикл <code>{`{{#posts}}...{{/posts}}`}</code>
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Ключ (латиница)</Label>
                <Input value={templateKey} onChange={(e) => setTemplateKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="my-imported" />
              </div>
              <div>
                <Label className="text-xs">Название</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Описание</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Превью с тестовыми данными</Label>
              <div className="aspect-[16/10] border rounded overflow-hidden bg-white">
                <iframe srcDoc={previewHtml} className="w-full h-full" sandbox="" title="preview" />
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && <Button variant="ghost" onClick={() => setStep((step - 1) as 1 | 2)} disabled={loading}>Назад</Button>}
          <div className="flex-1" />
          {step === 1 && (
            <Button onClick={analyze} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Анализировать
            </Button>
          )}
          {step === 2 && (
            <Button onClick={buildPreview} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Сгенерировать шаблон
            </Button>
          )}
          {step === 3 && (
            <Button onClick={save} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Сохранить шаблон
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function renderSample(html: string, css: string): string {
  const accent = "#0ea5e9";
  const samplePosts = [
    { title: "Пример статьи 1", url: "/posts/1.html", excerpt: "Краткий анонс первой статьи для демонстрации шаблона.", date: "2025-04-12" },
    { title: "Пример статьи 2", url: "/posts/2.html", excerpt: "Анонс второй демонстрационной статьи.", date: "2025-04-08" },
    { title: "Пример статьи 3", url: "/posts/3.html", excerpt: "Третий пример контента карточки поста.", date: "2025-04-01" },
  ];
  const vars: Record<string, string> = {
    site_name: "Демо-Сайт",
    site_description: "Превью импортированного шаблона",
    site_about: "<p>Это демо-страница «О сайте».</p>",
    contacts_content: "<p>hello@example.com</p>",
    privacy_content: "<p>Демо политики.</p>",
    accent_color: accent,
    accent,
    year: String(new Date().getFullYear()),
    author_name: "Редакция",
    footer_link_url: "#",
    footer_link_text: "Партнер",
  };
  const looped = html.replace(/\{\{#posts\}\}([\s\S]*?)\{\{\/posts\}\}/g, (_m, body) =>
    samplePosts.map((p) => body
      .replace(/\{\{title\}\}/g, p.title)
      .replace(/\{\{url\}\}/g, p.url)
      .replace(/\{\{excerpt\}\}/g, p.excerpt)
      .replace(/\{\{date\}\}/g, p.date)
    ).join("")
  );
  let out = looped.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? "");
  out = out.replace(/<link[^>]+href=["']\/style\.css["'][^>]*>/g, `<style>${css}</style>`);
  return out;
}