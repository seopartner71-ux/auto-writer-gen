// P17 Visual Engine - "Дизайн" panel: design profile, previews, visual QA.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeErrorMessage } from "@/shared/utils/invokeError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Palette, Play, Save, Sparkles, ShieldCheck, Monitor, Tablet, Smartphone } from "lucide-react";
import { VisualPreview, type PreviewDevice } from "./VisualPreview";
import {
  BLOCK_LABEL, DEFAULT_COLORS, DEFAULT_TYPO, FONTS, INDUSTRY_LABEL, ISSUE_LABEL,
  LAYOUT_LABEL, PAGE_TYPE_LABEL, STYLE_LABEL,
  type DesignProfileRow, type Industry, type LayoutType, type PageVisualConfigRow,
  type VisualPageType, type VisualStyle,
} from "./catalog";

const PREVIEW_TYPES: VisualPageType[] = ["home", "category", "product", "article"];

const STATUS_COLOR: Record<string, string> = {
  PASS: "text-emerald-500",
  REVIEW: "text-amber-500",
  FAIL: "text-red-500",
};

function emptyProfile(): DesignProfileRow {
  return {
    name: "Default",
    industry: "ecommerce",
    style: "minimal",
    color_scheme: { ...DEFAULT_COLORS },
    typography: { ...DEFAULT_TYPO },
    layout_type: "wide",
    components_config: {},
  };
}

export function DesignPanel({ projectId, ru }: { projectId: string; ru: boolean }) {
  const [profile, setProfile] = useState<DesignProfileRow>(emptyProfile());
  const [configs, setConfigs] = useState<PageVisualConfigRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [previewType, setPreviewType] = useState<VisualPageType>("home");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("visual-engine", {
        body: { project_id: projectId, action: "get", limit: 1000 },
      });
      if (error) throw error;
      const p = (data as { profile?: DesignProfileRow | null })?.profile;
      if (p) {
        setProfile({
          ...emptyProfile(),
          ...p,
          color_scheme: { ...DEFAULT_COLORS, ...(p.color_scheme || {}) },
          typography: { ...DEFAULT_TYPO, ...(p.typography || {}) },
          components_config: p.components_config || {},
        });
      }
      setConfigs(((data as { configs?: PageVisualConfigRow[] })?.configs || []));
    } catch (e) {
      toast.error(await invokeErrorMessage(e, "visual engine failed"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke("visual-engine", {
        body: { project_id: projectId, action, ...extra },
      });
      if (error) throw error;
      const s = (data as { summary?: Record<string, number> })?.summary;
      if (s) {
        toast.success(ru
          ? `Страниц: ${s.processed}. PASS ${s.pass}, REVIEW ${s.review}, FAIL ${s.fail}`
          : `Pages: ${s.processed}. PASS ${s.pass}, REVIEW ${s.review}, FAIL ${s.fail}`);
      } else {
        toast.success(ru ? "Готово" : "Done");
      }
      await load();
      return data;
    } catch (e) {
      toast.error(await invokeErrorMessage(e, "visual engine failed"));
      return null;
    } finally {
      setBusy(null);
    }
  }, [projectId, ru, load]);

  const previewBlocks = useMemo(() => {
    const match = configs.find((c) => c.page_type === previewType);
    return match?.blocks;
  }, [configs, previewType]);

  const qa = useMemo(() => {
    const counts = { PASS: 0, REVIEW: 0, FAIL: 0 } as Record<string, number>;
    const issues = new Map<string, number>();
    for (const c of configs) {
      counts[c.visual_status] = (counts[c.visual_status] || 0) + 1;
      for (const i of c.visual_issues || []) issues.set(i.code, (issues.get(i.code) || 0) + 1);
    }
    const avg = configs.length
      ? Math.round(configs.reduce((s, c) => s + (c.visual_score || 0), 0) / configs.length)
      : 0;
    return { counts, avg, issues: [...issues.entries()].sort((a, b) => b[1] - a[1]) };
  }, [configs]);

  const setColor = (key: keyof DesignProfileRow["color_scheme"], value: string) =>
    setProfile((p) => ({ ...p, color_scheme: { ...p.color_scheme, [key]: value } }));

  const saveProfile = () => call("save_profile", { profile });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="flex items-center gap-1.5">
          <Palette className="h-3.5 w-3.5" />Visual Engine
        </Badge>
        <span className="text-xs text-muted-foreground">
          {ru ? "Страниц с дизайном" : "Pages with design"}: {configs.length}
          {configs.length ? ` - ${ru ? "средний балл" : "avg score"} ${qa.avg}` : ""}
        </span>
        <Button size="sm" variant="outline" className="ml-auto" disabled={!!busy}
          onClick={() => call("ai_profile", { industry: profile.industry, style: profile.style })}>
          {busy === "ai_profile" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Sparkles className="h-3.5 w-3.5 mr-2" />}
          {ru ? "Подобрать дизайн ИИ" : "AI design"}
        </Button>
        <Button size="sm" disabled={!!busy} onClick={() => call("apply", { mode: "all" })}>
          {busy === "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Play className="h-3.5 w-3.5 mr-2" />}
          {ru ? "Применить к страницам" : "Apply to pages"}
        </Button>
        <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => call("qa")}>
          <ShieldCheck className="h-3.5 w-3.5 mr-2" />{ru ? "Проверка дизайна" : "Visual QA"}
        </Button>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">{ru ? "Профиль" : "Profile"}</TabsTrigger>
          <TabsTrigger value="preview">{ru ? "Превью" : "Preview"}</TabsTrigger>
          <TabsTrigger value="pages">{ru ? "Страницы" : "Pages"}</TabsTrigger>
          <TabsTrigger value="qa">QA</TabsTrigger>
          <TabsTrigger value="render">{ru ? "HTML-рендер" : "HTML render"}</TabsTrigger>
        </TabsList>

        {/* ---------------- PROFILE ---------------- */}
        <TabsContent value="profile" className="space-y-4 pt-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{ru ? "Отрасль" : "Industry"}</Label>
              <Select value={profile.industry} onValueChange={(v) => setProfile((p) => ({ ...p, industry: v as Industry }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(INDUSTRY_LABEL) as Industry[]).map((k) => (
                    <SelectItem key={k} value={k}>{INDUSTRY_LABEL[k][ru ? "ru" : "en"]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{ru ? "Стиль" : "Style"}</Label>
              <Select value={profile.style} onValueChange={(v) => setProfile((p) => ({ ...p, style: v as VisualStyle }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(STYLE_LABEL) as VisualStyle[]).map((k) => (
                    <SelectItem key={k} value={k}>{STYLE_LABEL[k][ru ? "ru" : "en"]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{ru ? "Макет" : "Layout"}</Label>
              <Select value={profile.layout_type} onValueChange={(v) => setProfile((p) => ({ ...p, layout_type: v as LayoutType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(LAYOUT_LABEL) as LayoutType[]).map((k) => (
                    <SelectItem key={k} value={k}>{LAYOUT_LABEL[k][ru ? "ru" : "en"]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{ru ? "Шрифт заголовков" : "Heading font"}</Label>
              <Select value={profile.typography.heading_font}
                onValueChange={(v) => setProfile((p) => ({ ...p, typography: { ...p.typography, heading_font: v } }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FONTS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{ru ? "Шрифт текста" : "Body font"}</Label>
              <Select value={profile.typography.body_font}
                onValueChange={(v) => setProfile((p) => ({ ...p, typography: { ...p.typography, body_font: v } }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FONTS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{ru ? "Логотип - текст" : "Logo text"}</Label>
              <Input value={profile.components_config?.logo_text || ""}
                onChange={(e) => setProfile((p) => ({ ...p, components_config: { ...p.components_config, logo_text: e.target.value } }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">{ru ? "Логотип - ссылка на файл" : "Logo URL"}</Label>
              <Input value={profile.components_config?.logo_url || ""} placeholder="https://..."
                onChange={(e) => setProfile((p) => ({ ...p, components_config: { ...p.components_config, logo_url: e.target.value } }))} />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={profile.components_config?.sticky_mobile_cta !== false}
                onCheckedChange={(v) => setProfile((p) => ({ ...p, components_config: { ...p.components_config, sticky_mobile_cta: v } }))} />
              <Label className="text-xs">{ru ? "Липкий CTA на мобильных" : "Sticky mobile CTA"}</Label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {(Object.keys(profile.color_scheme) as (keyof DesignProfileRow["color_scheme"])[]).map((k) => (
              <div key={k} className="space-y-1.5">
                <Label className="text-xs capitalize">{k}</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={profile.color_scheme[k]} aria-label={k}
                    onChange={(e) => setColor(k, e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded border bg-transparent" />
                  <Input value={profile.color_scheme[k]} onChange={(e) => setColor(k, e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
            ))}
          </div>

          <Button size="sm" disabled={!!busy} onClick={saveProfile}>
            {busy === "save_profile" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Save className="h-3.5 w-3.5 mr-2" />}
            {ru ? "Сохранить профиль" : "Save profile"}
          </Button>
        </TabsContent>

        {/* ---------------- PREVIEW ---------------- */}
        <TabsContent value="preview" className="space-y-3 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {PREVIEW_TYPES.map((pt) => (
              <Button key={pt} size="sm" variant={previewType === pt ? "default" : "outline"} onClick={() => setPreviewType(pt)}>
                {PAGE_TYPE_LABEL[pt][ru ? "ru" : "en"]}
              </Button>
            ))}
            <div className="ml-auto flex items-center gap-1">
              <Button size="icon" variant={device === "desktop" ? "default" : "ghost"} onClick={() => setDevice("desktop")} aria-label="desktop">
                <Monitor className="h-4 w-4" />
              </Button>
              <Button size="icon" variant={device === "tablet" ? "default" : "ghost"} onClick={() => setDevice("tablet")} aria-label="tablet">
                <Tablet className="h-4 w-4" />
              </Button>
              <Button size="icon" variant={device === "mobile" ? "default" : "ghost"} onClick={() => setDevice("mobile")} aria-label="mobile">
                <Smartphone className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <VisualPreview profile={profile} pageType={previewType} blocks={previewBlocks} device={device} ru={ru} />
          {!previewBlocks && (
            <p className="text-xs text-muted-foreground">
              {ru
                ? "Показан шаблон по умолчанию. Нажмите «Применить к страницам», чтобы построить конфигурации из реестра."
                : "Showing the default template. Run \"Apply to pages\" to build configs from the registry."}
            </p>
          )}
        </TabsContent>

        {/* ---------------- PAGES ---------------- */}
        <TabsContent value="pages" className="pt-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />{ru ? "Загрузка" : "Loading"}
            </div>
          ) : !configs.length ? (
            <p className="text-sm text-muted-foreground">
              {ru ? "Конфигураций пока нет. Примените дизайн к страницам." : "No configs yet. Apply the design to pages."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="p-2 text-left">URL</th>
                    <th className="p-2 text-left">{ru ? "Тип" : "Type"}</th>
                    <th className="p-2 text-left">{ru ? "Шаблон" : "Template"}</th>
                    <th className="p-2 text-left">{ru ? "Блоки" : "Blocks"}</th>
                    <th className="p-2 text-left">{ru ? "Статус" : "Status"}</th>
                  </tr>
                </thead>
                <tbody>
                  {configs.slice(0, 300).map((c) => (
                    <tr key={c.id} className="border-t">
                      <td className="p-2 font-mono">{c.url_path}</td>
                      <td className="p-2">{PAGE_TYPE_LABEL[c.page_type]?.[ru ? "ru" : "en"] || c.page_type}</td>
                      <td className="p-2 text-muted-foreground">{c.template}</td>
                      <td className="p-2">{(c.blocks || []).filter((b) => b.enabled).length}</td>
                      <td className={`p-2 font-medium ${STATUS_COLOR[c.visual_status] || ""}`}>
                        {c.visual_status} - {c.visual_score}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ---------------- QA ---------------- */}
        <TabsContent value="qa" className="space-y-3 pt-4">
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="text-emerald-500">PASS: {qa.counts.PASS || 0}</span>
            <span className="text-amber-500">REVIEW: {qa.counts.REVIEW || 0}</span>
            <span className="text-red-500">FAIL: {qa.counts.FAIL || 0}</span>
            <span className="text-muted-foreground">{ru ? "Средний балл" : "Avg score"}: {qa.avg}</span>
          </div>
          {!qa.issues.length ? (
            <p className="text-sm text-muted-foreground">{ru ? "Замечаний нет" : "No issues"}</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {qa.issues.map(([code, count]) => (
                <li key={code} className="flex items-center gap-2">
                  <Badge variant="outline">{count}</Badge>
                  <span>{ISSUE_LABEL[code]?.[ru ? "ru" : "en"] || code}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            {ru
              ? "Проверяется: hero, CTA, блок доверия, подвал, пустые блоки и готовность к мобильным."
              : "Checked: hero, CTA, trust block, footer, empty blocks and mobile readiness."}
          </p>
          <div className="text-xs text-muted-foreground">
            {ru ? "Библиотека блоков" : "Block library"}: {Object.keys(BLOCK_LABEL).length}
          </div>
        </TabsContent>

        {/* ---------------- HTML RENDER (P18) ---------------- */}
        <TabsContent value="render" className="pt-4">
          <RendererPanel projectId={projectId} ru={ru} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
