import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Check, Loader2, Sparkles, RefreshCw, Save, ChevronRight, ChevronLeft, Brain, Plus, Eye, ImageIcon, BookmarkPlus, FolderOpen, Trash2, Link as LinkIcon, Globe, Pencil, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PAGE_TYPES, TONES, BLOCKS, type PageType, type BlockDef } from "@/features/commercial/constants";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm, usePrompt } from "@/shared/components/ConfirmDialog";

type Step = 1 | 2 | 3 | 4;

interface BlockState extends BlockDef {
  enabled: boolean;
  content?: string;
  status: "pending" | "generating" | "done" | "error";
  wordCount?: number;
  customInstruction?: string;
  customTitle?: string;
  source?: "default" | "ai";
  regenCount?: number;
  editing?: boolean;
  imageBusy?: boolean;
  quality?: {
    retried: boolean;
    antiFake: number;
    factCheck: number;
  };
}
interface StructureAnalysis {
  intent: string;
  entities: string[];
  expectations: string[];
  internal_links: string[];
  seo_notes: string;
  recommended_blocks: Array<{
    type: string;
    title: string;
    h_level: number;
    desc: string;
    words: number;
    elements: string[];
  }>;
}

const STEP_LABELS = ["Тип", "Бриф", "Структура", "Генерация"];

const getFunctionErrorMessage = async (error: unknown, fallback = "Ошибка генерации") => {
  const context = (error as { context?: Response })?.context;
  if (context) {
    try {
      const payload = await context.clone().json();
      if (typeof payload?.error === "string") return payload.error;
      if (typeof payload?.message === "string") return payload.message;
    } catch {
      try {
        const text = await context.clone().text();
        if (text) return text;
      } catch {
        // ignore and use the generic message below
      }
    }
  }
  return error instanceof Error ? error.message : fallback;
};

export default function CommercialPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const queryClient = useQueryClient();
  const plan = (profile?.plan || "basic") as string;
  const isPro = plan === "pro" || plan === "factory";

  const [step, setStep] = useState<Step>(1);
  const [pageType, setPageType] = useState<PageType | null>(null);
  const [brief, setBrief] = useState<Record<string, any>>({ tone: "", narrative_person: "we" });
  const [blocks, setBlocks] = useState<BlockState[]>([]);
  const [genIdx, setGenIdx] = useState<number>(-1);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiResults, setAiResults] = useState<{ kind: "utp" | "benefits"; items: string[] } | null>(null);
  const [savedArticleId, setSavedArticleId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<StructureAnalysis | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; page_type: string; brief: any }>>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingArticle, setSavingArticle] = useState(false);
  const [regenConfirmIdx, setRegenConfirmIdx] = useState<number | null>(null);

  // URL Parser state
  const [parseUrl, setParseUrl] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsedFields, setParsedFields] = useState<Set<string>>(new Set());
  const [parseSummary, setParseSummary] = useState<{
    company?: string | null; city?: string | null; phone?: string | null;
    blocks?: number; h2?: number;
  } | null>(null);

  // History of previously created commercial pages (from articles table).
  const [history, setHistory] = useState<Array<{ id: string; title: string; page_type: string | null; updated_at: string }>>([]);
  const [draftRestored, setDraftRestored] = useState(false);

  const draftKey = profile?.id ? `commercial_draft_v1:${profile.id}` : null;

  const selectedType = PAGE_TYPES.find((t) => t.id === pageType);
  const tones = pageType ? TONES[pageType] : [];

  const markParsed = (keys: string[]) => {
    setParsedFields((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
  };

  const FromSiteBadge = ({ field }: { field: string }) =>
    parsedFields.has(field) ? (
      <Badge variant="secondary" className="ml-2 h-4 px-1.5 text-[10px] bg-accent text-accent-foreground">
        Из сайта
      </Badge>
    ) : null;

  const parsePageUrl = async () => {
    const url = parseUrl.trim();
    if (!url) return toast.error("Введите URL");
    if (!/^https?:\/\//i.test(url)) return toast.error("URL должен начинаться с http:// или https://");
    setParsing(true);
    try {
      const { data, error } = await supabase.functions.invoke("parse-commercial-url", {
        body: { url, page_type: pageType },
      });
      if (error) {
        const msg = await getFunctionErrorMessage(error, "Не удалось проанализировать URL");
        if (/недоступен|fetch/i.test(msg)) toast.warning("Сайт недоступен - заполните бриф вручную");
        else if (/JavaScript|js_only/i.test(msg)) toast.warning("Страница требует JavaScript - данные извлечь не удалось");
        else if (/распознать|unparseable/i.test(msg)) toast.warning("Не удалось распознать структуру страницы");
        else toast.warning(msg);
        return;
      }
      const p: any = data;
      const updates: Record<string, any> = {};
      const markedKeys: string[] = [];
      if (p.niche) { updates.niche = p.niche; markedKeys.push("niche"); }
      if (p.keyword) { updates.keyword = p.keyword; markedKeys.push("keyword"); }
      if (p.city) { updates.city = p.city; markedKeys.push("city"); }
      if (p.company_name) {
        if (pageType === "category") { updates.shop_name = p.company_name; markedKeys.push("shop_name"); }
        else { updates.company = p.company_name; markedKeys.push("company"); }
      }
      if (p.utp) { updates.utp = p.utp; markedKeys.push("utp"); }
      if (Array.isArray(p.benefits) && p.benefits.length) { updates.benefits = p.benefits; markedKeys.push("benefits"); }
      if (Array.isArray(p.services) && p.services.length) {
        updates.services = p.services.join("\n");
        updates.parsed_services = p.services;
        markedKeys.push("services");
      }
      if (p.work_hours) { updates.hours = p.work_hours; updates.parsed_work_hours = p.work_hours; markedKeys.push("hours"); }
      if (p.prices) { updates.has_prices = true; updates.parsed_prices = p.prices; markedKeys.push("has_prices"); }
      if (p.guarantees) { updates.has_guarantees = true; updates.parsed_guarantees = p.guarantees; markedKeys.push("has_guarantees"); }
      if (p.tone && tones.includes(p.tone)) { updates.tone = p.tone; markedKeys.push("tone"); }
      // Hidden grounding fields - passed to AI but not shown as form fields.
      updates.source_url = p.source_url;
      if (p.phone) updates.parsed_phone = p.phone;
      if (p.address) updates.parsed_address = p.address;
      if (Array.isArray(p.existing_h2)) updates.existing_h2 = p.existing_h2;
      if (Array.isArray(p.existing_blocks)) updates.existing_blocks = p.existing_blocks;

      setBrief((b) => ({ ...b, ...updates }));
      markParsed(markedKeys);
      setParseSummary({
        company: p.company_name,
        city: p.city,
        phone: p.phone,
        blocks: (p.existing_blocks || []).length,
        h2: (p.existing_h2 || []).length,
      });
      toast.success("Страница проанализирована");
    } catch (e) {
      toast.warning(e instanceof Error ? e.message : "Не удалось проанализировать URL");
    } finally {
      setParsing(false);
    }
  };

  const initBlocks = (t: PageType) => {
    const list = BLOCKS[t].map<BlockState>((b) => ({
      ...b,
      enabled: (b.conditional ? b.conditional(brief) : true) && (!b.proOnly || isPro),
      status: "pending",
    }));
    setBlocks(list);
  };

  const goNext = () => {
    if (step === 1 && !pageType) return toast.error("Выбери тип страницы");
    if (step === 2) {
      if (!brief.niche || !brief.keyword) return toast.error("Заполни нишу и ключевой запрос");
      initBlocks(pageType!);
    }
    setStep((s) => Math.min(4, s + 1) as Step);
  };

  const selectType = (t: PageType) => {
    const def = PAGE_TYPES.find((p) => p.id === t)!;
    if (def.proOnly && !isPro) {
      toast.error("Этот тип страницы доступен на тарифе PRO");
      return;
    }
    // Смена типа страницы = новая статья: сбрасываем привязку к сохранённой строке,
    // чтобы следующее сохранение шло INSERT, а не UPDATE предыдущей.
    if (pageType && pageType !== t && savedArticleId) {
      setSavedArticleId(null);
    }
    setPageType(t);
    setBrief((b) => ({ ...b, tone: TONES[t][0] }));
  };

  const callAiHelper = async (kind: "utp" | "benefits") => {
    if (!brief.niche) return toast.error("Сначала укажи нишу");
    setAiBusy(kind);
    try {
      const { data, error } = await supabase.functions.invoke("commercial-brief-helper", {
        body: { kind, niche: brief.niche, page_type: pageType, city: brief.city },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error));
      setAiResults({ kind, items: (data as any).items || [] });
    } catch (e: any) {
      toast.error(e?.message || "Ошибка генерации");
    } finally {
      setAiBusy(null);
    }
  };

  const enabledBlocks = blocks.filter((b) => b.enabled);
  const totalWords = enabledBlocks.reduce((s, b) => s + b.words, 0);
  const cost = enabledBlocks.length;

  const runStructureAnalysis = async () => {
    if (!pageType || !brief.keyword) return toast.error("Заполни ключевой запрос");
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("commercial-structure-analyzer", {
        body: {
          page_type: pageType,
          niche: brief.niche,
          keyword: brief.keyword,
          city: brief.city,
          audience: brief.audience,
          utp: brief.utp,
          benefits: brief.benefits,
        },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error));
      setAnalysis(data as StructureAnalysis);
      toast.success("Анализ готов. Можно добавить блоки.");
    } catch (e: any) {
      toast.error(e?.message || "Ошибка анализа");
    } finally {
      setAnalyzing(false);
    }
  };

  const addAiBlock = (rb: StructureAnalysis["recommended_blocks"][number]) => {
    if (blocks.some((b) => b.type === rb.type)) {
      toast.info("Этот блок уже есть в структуре");
      return;
    }
    setBlocks((arr) => [
      ...arr,
      {
        type: rb.type,
        title: rb.title,
        desc: rb.desc,
        words: rb.words,
        enabled: true,
        status: "pending",
        customInstruction: `${rb.desc}${rb.elements?.length ? `\nРекомендуемые элементы: ${rb.elements.join(", ")}.` : ""}`,
        customTitle: rb.title,
        source: "ai",
      },
    ]);
  };

  const replaceWithAiBlocks = () => {
    if (!analysis?.recommended_blocks?.length) return;
    setBlocks(
      analysis.recommended_blocks.map<BlockState>((rb) => ({
        type: rb.type,
        title: rb.title,
        desc: rb.desc,
        words: rb.words,
        enabled: true,
        status: "pending",
        customInstruction: `${rb.desc}${rb.elements?.length ? `\nРекомендуемые элементы: ${rb.elements.join(", ")}.` : ""}`,
        customTitle: rb.title,
        source: "ai",
      })),
    );
    toast.success("Структура заменена на AI-рекомендации");
  };

  const buildAntiDupBrief = (idx: number, sourceBlocks: BlockState[] = blocks) => {
    // Передаем в модель не только заголовки, но и уже готовый текст предыдущих блоков.
    // Это особенно важно для ниш вроде строительства, где выгоды/этапы/УТП легко склеиваются.
    const headingRe = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi;
    const generatedHeadings: string[] = [];
    const generatedSummaries: string[] = [];
    const generatedContentAbove: string[] = [];

    sourceBlocks.forEach((bx, i) => {
      if (i >= idx || !bx.content) return;
      let m: RegExpExecArray | null;
      const re = new RegExp(headingRe.source, headingRe.flags);
      while ((m = re.exec(bx.content)) !== null) {
        const txt = m[1].replace(/<[^>]+>/g, "").trim();
        if (txt) generatedHeadings.push(txt);
      }
      generatedSummaries.push(bx.customTitle || bx.title);
      const plain = bx.content
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (plain) generatedContentAbove.push(`${bx.customTitle || bx.title}: ${plain.slice(0, 1400)}`);
    });

    const parsedH2 = Array.isArray((brief as any).existing_h2) ? (brief as any).existing_h2 : [];
    const parsedBlocks = Array.isArray((brief as any).existing_blocks) ? (brief as any).existing_blocks : [];
    return {
      ...brief,
      narrative_person: brief.narrative_person || "we",
      existing_h2: Array.from(new Set([...parsedH2, ...generatedHeadings])),
      existing_blocks: Array.from(new Set([...parsedBlocks, ...generatedSummaries])),
      generated_content_above: generatedContentAbove.join("\n\n").slice(0, 7000),
    };
  };

  const generateBlock = async (idx: number, sourceBlocks: BlockState[] = blocks) => {
    const b = sourceBlocks[idx] || blocks[idx];
    setBlocks((arr) => arr.map((x, i) => (i === idx ? { ...x, status: "generating" } : x)));
    try {
      const mergedBrief = buildAntiDupBrief(idx, sourceBlocks);

      const { data, error } = await supabase.functions.invoke("generate-commercial-block", {
        body: {
          block_type: b.type,
          page_type: pageType,
          brief: mergedBrief,
          target_words: b.words,
          custom_instruction: b.customInstruction,
          custom_title: b.customTitle,
        },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error));
      const res = data as {
        content: string;
        word_count: number;
        anti_fake_flags?: string[];
        fact_check_flags?: string[];
        retried?: boolean;
      };
      const updatedBlock: BlockState = {
        ...b,
        status: "done",
        content: res.content,
        wordCount: res.word_count,
        regenCount: (b.regenCount || 0) + (b.content ? 1 : 0),
        quality: {
          retried: !!res.retried,
          antiFake: res.anti_fake_flags?.length || 0,
          factCheck: res.fact_check_flags?.length || 0,
        },
      };
      setBlocks((arr) => arr.map((x, i) => (i === idx ? { ...x, ...updatedBlock } : x)));
      return updatedBlock;
    } catch (e: any) {
      toast.error(`Блок "${b.title}": ${e?.message || "ошибка"}`);
      setBlocks((arr) => arr.map((x, i) => (i === idx ? { ...x, status: "error" } : x)));
      return null;
    }
  };

  // Click "Перегенерировать". 1-я бесплатная (regenCount=0 после генерации), дальше - подтверждение списания.
  const handleRegenClick = (idx: number) => {
    const b = blocks[idx];
    if ((b.regenCount || 0) >= 1) {
      setRegenConfirmIdx(idx);
    } else {
      generateBlock(idx);
    }
  };

  // Inline block editing helpers
  const toggleBlockEdit = (idx: number) => {
    setBlocks((arr) => arr.map((x, i) => (i === idx ? { ...x, editing: !x.editing } : x)));
  };
  const updateBlockContent = (idx: number, content: string) => {
    const wc = content.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
    setBlocks((arr) => arr.map((x, i) => (i === idx ? { ...x, content, wordCount: wc } : x)));
  };

  // Per-block image generation: calls generate-image and prepends an <img> into the block.
  const generateBlockImage = async (idx: number) => {
    const b = blocks[idx];
    if (!b.content) return toast.error("Сначала сгенерируйте текст блока");
    setBlocks((arr) => arr.map((x, i) => (i === idx ? { ...x, imageBusy: true } : x)));
    try {
      const topic = `${b.title} ${brief.keyword || brief.niche || ""}`.trim();
      const { data, error } = await supabase.functions.invoke("generate-image", {
        body: {
          mode: "cover",
          topic,
          keyword: brief.keyword || "",
          aspect_ratio: "16:9",
          style: "Реалистичный бизнес",
          count: 1,
          model: "schnell",
        },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error));
      const res = data as { images?: Array<{ url: string; label?: string }> };
      const url = res?.images?.[0]?.url;
      if (!url) throw new Error("Изображение не получено");
      const alt = (b.title || "").replace(/"/g, "&quot;");
      const imgTag = `<img src="${url}" alt="${alt}" loading="lazy" style="width:100%;height:auto;border-radius:8px;margin:0 0 1rem 0;" />\n`;
      setBlocks((arr) =>
        arr.map((x, i) => (i === idx ? { ...x, content: imgTag + (x.content || ""), imageBusy: false } : x)),
      );
      toast.success("Фото добавлено в блок");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось сгенерировать фото");
      setBlocks((arr) => arr.map((x, i) => (i === idx ? { ...x, imageBusy: false } : x)));
    }
  };

  // Brief templates -------------------------------------------------------
  const loadTemplates = async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from("commercial_brief_templates")
      .select("id, name, page_type, brief")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false });
    setTemplates((data as any) || []);
  };

  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSelectedTemplateId(id);
    if (t.page_type !== pageType) {
      setPageType(t.page_type as PageType);
    }
    setBrief({ ...t.brief, tone: t.brief?.tone || TONES[t.page_type as PageType][0], narrative_person: t.brief?.narrative_person || "we" });
    toast.success(`Загружен шаблон "${t.name}"`);
  };

  const saveTemplate = async () => {
    if (!profile?.id || !pageType) return;
    const name = await prompt({ title: "Название шаблона", defaultValue: brief.keyword || "Без названия", placeholder: "Введите название" });
    if (!name || !name.trim()) return;
    setSavingTemplate(true);
    const { error } = await supabase.from("commercial_brief_templates").insert({
      user_id: profile.id,
      name: name.trim(),
      page_type: pageType,
      brief,
    });
    setSavingTemplate(false);
    if (error) return toast.error(error.message);
    toast.success("Шаблон сохранен");
    await loadTemplates();
  };

  const deleteTemplate = async () => {
    if (!selectedTemplateId) return;
    if (!(await confirm({ title: "Удалить шаблон?", destructive: true, confirmText: "Удалить" }))) return;
    await supabase.from("commercial_brief_templates").delete().eq("id", selectedTemplateId);
    setSelectedTemplateId("");
    toast.success("Шаблон удален");
    await loadTemplates();
  };

  // Load templates when user reaches Step 2.
  useEffect(() => {
    if (step === 2 && profile?.id && templates.length === 0) loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, profile?.id]);

  // Restore draft from localStorage on mount.
  useEffect(() => {
    if (!draftKey || draftRestored) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.pageType) setPageType(d.pageType);
        if (d.brief) setBrief({ ...d.brief, narrative_person: d.brief.narrative_person || "we" });
        if (Array.isArray(d.blocks)) setBlocks(d.blocks);
        if (d.step) setStep(d.step);
        if (d.parseSummary) setParseSummary(d.parseSummary);
        if (Array.isArray(d.parsedFields)) setParsedFields(new Set(d.parsedFields));
        if (d.savedArticleId) setSavedArticleId(d.savedArticleId);
        toast.info("Черновик восстановлен");
      }
    } catch {}
    setDraftRestored(true);
  }, [draftKey, draftRestored]);

  // Autosave draft on changes (debounced).
  useEffect(() => {
    if (!draftKey || !draftRestored) return;
    const hasAny = pageType || blocks.length || Object.keys(brief || {}).some((k) => brief[k]);
    const t = setTimeout(() => {
      try {
        if (!hasAny) {
          localStorage.removeItem(draftKey);
          return;
        }
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            pageType, brief, blocks, step, parseSummary,
            parsedFields: Array.from(parsedFields),
            savedArticleId,
            ts: Date.now(),
          }),
        );
      } catch {}
    }, 600);
    return () => clearTimeout(t);
  }, [draftKey, draftRestored, pageType, brief, blocks, step, parseSummary, parsedFields, savedArticleId]);

  // Load history of created commercial pages.
  const loadHistory = async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from("articles")
      .select("id, title, page_type, updated_at")
      .eq("user_id", profile.id)
      .eq("source", "commercial")
      .order("updated_at", { ascending: false })
      .limit(20);
    setHistory((data as any) || []);
  };
  useEffect(() => { loadHistory(); }, [profile?.id]);

  const deleteHistoryItem = async (id: string) => {
    if (!(await confirm({ title: "Удалить страницу?", description: "Запись будет удалена безвозвратно.", destructive: true, confirmText: "Удалить" }))) return;
    const { error } = await supabase.from("articles").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setHistory((prev) => prev.filter((h) => h.id !== id));
    if (savedArticleId === id) setSavedArticleId(null);
    toast.success("Запись удалена");
  };

  const clearAllHistory = async () => {
    if (!profile?.id || history.length === 0) return;
    if (!(await confirm({ title: "Очистить историю?", description: `Будет удалено ${history.length} записей. Это действие нельзя отменить.`, destructive: true, confirmText: "Очистить" }))) return;
    const ids = history.map((h) => h.id);
    const { error } = await supabase.from("articles").delete().in("id", ids);
    if (error) return toast.error(error.message);
    setHistory([]);
    setSavedArticleId(null);
    toast.success("История очищена");
  };

  const resetDraft = async () => {
    if (!(await confirm({ title: "Сбросить черновик?", confirmText: "Сбросить", destructive: true }))) return;
    if (draftKey) localStorage.removeItem(draftKey);
    setPageType(null);
    setBrief({ tone: "", narrative_person: "we" });
    setBlocks([]);
    setStep(1);
    setParseSummary(null);
    setParsedFields(new Set());
    setSavedArticleId(null);
    setAnalysis(null);
    toast.success("Черновик сброшен");
  };

  const startGeneration = async () => {
    setStep(4);
    const workingBlocks = blocks.map((b) => ({ ...b }));
    const indices = workingBlocks.map((b, i) => (b.enabled ? i : -1)).filter((i) => i >= 0);
    let failed = 0;
    for (const i of indices) {
      setGenIdx(i);
      const generated = await generateBlock(i, workingBlocks);
      if (generated) workingBlocks[i] = generated;
      else failed += 1;
    }
    setGenIdx(-1);
    if (failed) {
      toast.error(`Генерация завершена с ошибками: ${failed}`);
    } else {
      toast.success("Генерация завершена");
    }
  };

  const fullHtml = useMemo(
    () => blocks.filter((b) => b.enabled && b.content).map((b) => b.content).join("\n\n"),
    [blocks]
  );

  const saveAsArticle = async () => {
    if (!fullHtml || savingArticle) return;
    setSavingArticle(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const userId = authData.user?.id || profile?.id;
      if (!userId) throw new Error("Не удалось определить пользователя");

      const titleMatch = fullHtml.match(/<h1[^>]*>(.*?)<\/h1>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "") : `${selectedType?.title}: ${brief.keyword}`;
      const payload = {
        user_id: userId,
        title,
        content: fullHtml,
        status: "draft",
        page_type: pageType,
        commercial_brief: { ...brief, narrative_person: brief.narrative_person || "we" },
        keywords: brief.keyword ? [brief.keyword] : [],
        source: "commercial",
        language: "ru",
        updated_at: new Date().toISOString(),
      } as any;

      let articleId = savedArticleId;
      if (articleId) {
        const { data, error } = await supabase
          .from("articles")
          .update(payload)
          .eq("id", articleId)
          .eq("user_id", userId)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        // Если строка не найдена (удалена / принадлежит другому пользователю /
        // устаревший savedArticleId из другой вкладки) — не теряем данные,
        // а создаём новую запись ниже.
        articleId = data?.id || null;
      }

      if (!articleId) {
        const { data, error } = await supabase
          .from("articles")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        articleId = data.id;
      }

      setSavedArticleId(articleId);
      toast.success(savedArticleId ? "Статья обновлена" : "Сохранено в Статьи");
      loadHistory();
      queryClient.invalidateQueries({ queryKey: ["my-articles-list"] });
    } catch (e: any) {
      toast.error(e?.message || "Не удалось сохранить статью");
    } finally {
      setSavingArticle(false);
    }
  };

  return (
    <div className="container max-w-6xl py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Коммерческие страницы</h1>
          {selectedType && <Badge variant="secondary" className="mt-2">{selectedType.title}</Badge>}
        </div>
        <Button variant="outline" size="sm" onClick={resetDraft}>
          Новый черновик
        </Button>
      </div>

      {history.length > 0 && (
        <Card>
          <CardHeader className="py-3 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">История коммерческих страниц</CardTitle>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={clearAllHistory}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Очистить историю
            </Button>
          </CardHeader>
          <CardContent className="py-2">
            <div className="flex flex-col divide-y divide-border/40">
              {history.slice(0, 8).map((h) => (
                <div key={h.id} className="flex items-center justify-between py-2 gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{h.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {h.page_type} · {new Date(h.updated_at).toLocaleString("ru-RU")}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => window.open(`/articles?edit=${h.id}`, "_blank", "noopener,noreferrer")}
                    >
                      Открыть
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      title="Удалить запись"
                      onClick={() => deleteHistoryItem(h.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEP_LABELS.map((label, i) => {
          const n = (i + 1) as Step;
          const active = step === n;
          const done = step > n;
          return (
            <div key={label} className="flex items-center gap-2">
              <button
                onClick={() => done && setStep(n)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition ${
                  active ? "bg-primary/15 text-primary font-medium"
                    : done ? "text-foreground hover:bg-accent cursor-pointer"
                    : "text-muted-foreground"
                }`}
              >
                <span className={`h-5 w-5 rounded-full flex items-center justify-center text-xs ${
                  done ? "bg-primary text-primary-foreground" : active ? "border border-primary" : "border border-muted-foreground/40"
                }`}>
                  {done ? <Check className="h-3 w-3" /> : n}
                </span>
                {label}
              </button>
              {i < 3 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          );
        })}
      </div>

      {/* Step 1 */}
      {step === 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PAGE_TYPES.map((t) => {
            const locked = t.proOnly && !isPro;
            const selected = pageType === t.id;
            const Icon = t.icon;
            return (
              <Card
                key={t.id}
                onClick={() => selectType(t.id)}
                className={`cursor-pointer transition hover:border-primary/50 ${selected ? "border-primary ring-1 ring-primary/30" : ""} ${locked ? "opacity-60" : ""}`}
              >
                <CardContent className="p-5 flex gap-4">
                  <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{t.title}</h3>
                      {locked && <Badge variant="outline" className="text-xs">PRO</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{t.desc}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Step 2 */}
      {step === 2 && pageType && (
        <Card>
          <CardContent className="p-6 space-y-4">
            {/* URL Parser */}
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-2">
                <LinkIcon className="h-4 w-4 text-primary" />
                <Label className="text-sm">Адрес страницы сайта (опционально)</Label>
              </div>
              <div className="flex gap-2">
                <Input
                  value={parseUrl}
                  onChange={(e) => setParseUrl(e.target.value)}
                  placeholder="https://example.com/uslugi/remont-kvartir"
                  disabled={parsing}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); parsePageUrl(); } }}
                />
                <Button onClick={parsePageUrl} disabled={parsing || !parseUrl.trim()}>
                  {parsing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Brain className="h-4 w-4 mr-1" />}
                  Проанализировать
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                AI извлечет данные компании и заполнит бриф автоматически. Существующие H2 и блоки будут учтены, чтобы не дублировать.
              </p>
              {parseSummary && (
                <div className="rounded-md bg-background/60 border border-border p-3 text-xs space-y-1 mt-2">
                  <div className="flex items-center gap-1.5 text-success font-medium">
                    <Check className="h-3.5 w-3.5" /> Страница проанализирована
                  </div>
                  {parseSummary.company && <div>Компания: <span className="text-foreground">{parseSummary.company}</span></div>}
                  {parseSummary.city && <div>Город: <span className="text-foreground">{parseSummary.city}</span></div>}
                  {parseSummary.phone && <div>Телефон: <span className="text-foreground">найден</span></div>}
                  <div>Найдено блоков: <span className="text-foreground">{parseSummary.blocks ?? 0}</span></div>
                  <div>Найдено H2: <span className="text-foreground">{parseSummary.h2 ?? 0}</span></div>
                  <div className="text-muted-foreground pt-1">Проверьте поля брифа и при необходимости отредактируйте.</div>
                </div>
              )}
            </div>

            {/* Templates bar */}
            <div className="flex items-end gap-2 flex-wrap pb-3 border-b">
              <div className="flex-1 min-w-[200px] space-y-1.5">
                <Label className="text-xs text-muted-foreground">Шаблоны брифов</Label>
                <Select value={selectedTemplateId} onValueChange={applyTemplate}>
                  <SelectTrigger>
                    <SelectValue placeholder={templates.length ? "Загрузить шаблон…" : "Шаблонов пока нет"} />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} · {PAGE_TYPES.find((p) => p.id === t.page_type)?.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" size="sm" onClick={saveTemplate} disabled={savingTemplate || !brief.keyword}>
                <BookmarkPlus className="h-3.5 w-3.5 mr-1" /> Сохранить как шаблон
              </Button>
              {selectedTemplateId && (
                <Button variant="ghost" size="sm" onClick={deleteTemplate}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Удалить
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Ниша / тематика *<FromSiteBadge field="niche" /></Label>
                <Input value={brief.niche || ""} onChange={(e) => setBrief({ ...brief, niche: e.target.value })} placeholder="ремонт квартир" />
              </div>
              <div className="space-y-1.5">
                <Label>Главный ключевой запрос *<FromSiteBadge field="keyword" /></Label>
                <Input value={brief.keyword || ""} onChange={(e) => setBrief({ ...brief, keyword: e.target.value })} />
              </div>
              {(pageType === "service" || pageType === "local") && (
                <div className="space-y-1.5">
                  <Label>Название компании<FromSiteBadge field="company" /></Label>
                  <Input value={brief.company || ""} onChange={(e) => setBrief({ ...brief, company: e.target.value })} />
                </div>
              )}
              {pageType === "category" && (
                <div className="space-y-1.5">
                  <Label>Название магазина / бренда<FromSiteBadge field="shop_name" /></Label>
                  <Input value={brief.shop_name || ""} onChange={(e) => setBrief({ ...brief, shop_name: e.target.value })} />
                </div>
              )}
              {pageType === "product" && (
                <>
                  <div className="space-y-1.5">
                    <Label>Название товара</Label>
                    <Input value={brief.product_name || ""} onChange={(e) => setBrief({ ...brief, product_name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Артикул / модель</Label>
                    <Input value={brief.sku || ""} onChange={(e) => setBrief({ ...brief, sku: e.target.value })} />
                  </div>
                </>
              )}
              {(pageType === "service" || pageType === "local") && (
                <div className="space-y-1.5">
                  <Label>Город<FromSiteBadge field="city" /></Label>
                  <Input value={brief.city || ""} onChange={(e) => setBrief({ ...brief, city: e.target.value })} />
                </div>
              )}
              {pageType === "local" && (
                <div className="space-y-1.5">
                  <Label>Район (опц.)</Label>
                  <Input value={brief.district || ""} onChange={(e) => setBrief({ ...brief, district: e.target.value })} />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Тон<FromSiteBadge field="tone" /></Label>
              <div className="flex flex-wrap gap-2">
                {tones.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setBrief({ ...brief, tone: t })}
                    className={`px-3 py-1.5 rounded-md text-sm border transition ${
                      brief.tone === t ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 rounded-md border p-3">
              <Label>Лицо повествования</Label>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "we", label: "Мы" },
                  { id: "i", label: "Я" },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setBrief({ ...brief, narrative_person: option.id })}
                    className={`px-3 py-1.5 rounded-md text-sm border transition ${
                      (brief.narrative_person || "we") === option.id ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {pageType === "service" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between rounded-md border p-3">
                  <Label>Цены на сайте<FromSiteBadge field="has_prices" /></Label>
                  <Switch checked={!!brief.has_prices} onCheckedChange={(v) => setBrief({ ...brief, has_prices: v })} />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <Label>Гарантии<FromSiteBadge field="has_guarantees" /></Label>
                  <Switch checked={!!brief.has_guarantees} onCheckedChange={(v) => setBrief({ ...brief, has_guarantees: v })} />
                </div>
              </div>
            )}

            {pageType === "category" && (
              <>
                <div className="space-y-1.5">
                  <Label>LSI-ключи (опц.)</Label>
                  <Textarea rows={2} value={brief.lsi || ""} onChange={(e) => setBrief({ ...brief, lsi: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Количество товаров (опц.)</Label>
                  <Input type="number" value={brief.items_count || ""} onChange={(e) => setBrief({ ...brief, items_count: e.target.value ? Number(e.target.value) : undefined })} />
                </div>
              </>
            )}

            {pageType === "product" && (
              <>
                <div className="space-y-1.5">
                  <Label>Характеристики (список)</Label>
                  <Textarea rows={4} value={brief.features || ""} onChange={(e) => setBrief({ ...brief, features: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Целевая аудитория</Label>
                  <Input value={brief.audience || ""} onChange={(e) => setBrief({ ...brief, audience: e.target.value })} />
                </div>
              </>
            )}

            {pageType === "local" && (
              <>
                <div className="space-y-1.5">
                  <Label>Список услуг<FromSiteBadge field="services" /></Label>
                  <Textarea rows={3} value={brief.services || ""} onChange={(e) => setBrief({ ...brief, services: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Режим работы (опц.)<FromSiteBadge field="hours" /></Label>
                  <Input value={brief.hours || ""} onChange={(e) => setBrief({ ...brief, hours: e.target.value })} />
                </div>
              </>
            )}

            {pageType !== "product" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>УТП</Label>
                  <Button size="sm" variant="outline" onClick={() => callAiHelper("utp")} disabled={aiBusy === "utp"}>
                    {aiBusy === "utp" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                    Сгенерировать через AI
                  </Button>
                </div>
                <Textarea rows={2} value={brief.utp || ""} onChange={(e) => setBrief({ ...brief, utp: e.target.value })} />
                {aiResults?.kind === "utp" && (
                  <div className="grid gap-2 mt-2">
                    {aiResults.items.map((it, i) => (
                      <button key={i} onClick={() => { setBrief({ ...brief, utp: it }); setAiResults(null); }}
                        className="text-left text-sm px-3 py-2 rounded-md border hover:border-primary hover:bg-accent transition">
                        {it}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {pageType !== "product" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Преимущества</Label>
                  <Button size="sm" variant="outline" onClick={() => callAiHelper("benefits")} disabled={aiBusy === "benefits"}>
                    {aiBusy === "benefits" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                    Сгенерировать через AI
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(brief.benefits || []).map((b: string, i: number) => (
                    <Badge key={i} variant="secondary" className="cursor-pointer"
                      onClick={() => setBrief({ ...brief, benefits: brief.benefits.filter((_: any, j: number) => j !== i) })}>
                      {b} ×
                    </Badge>
                  ))}
                </div>
                {aiResults?.kind === "benefits" && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {aiResults.items.map((it, i) => {
                      const picked = (brief.benefits || []).includes(it);
                      return (
                        <button key={i}
                          onClick={() => {
                            const cur = brief.benefits || [];
                            setBrief({ ...brief, benefits: picked ? cur.filter((x: string) => x !== it) : [...cur, it] });
                          }}
                          className={`text-xs px-2.5 py-1 rounded-full border transition ${
                            picked ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"
                          }`}>
                          {it}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5 pt-2 border-t">
              <Label>Стоп-слова / запреты <span className="text-xs text-muted-foreground font-normal">(опц.)</span></Label>
              <Textarea
                rows={2}
                placeholder="конкурент X, не упоминать доставку в регионы, без слова дешево"
                value={brief.stop_words || ""}
                onChange={(e) => setBrief({ ...brief, stop_words: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Через запятую: бренды, темы, формулировки, которые модель не должна использовать.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4 text-primary" />
                  <span className="font-medium text-sm">SEO-стратег: анализ структуры под запрос</span>
                </div>
                <Button size="sm" variant="outline" onClick={runStructureAnalysis} disabled={analyzing}>
                  {analyzing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                  {analysis ? "Перезапустить анализ" : "Запустить анализ"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Реверс-инжиниринг интента: ИИ моделирует, как поиск интерпретирует запрос, и предлагает блоки.
              </p>

              {analysis && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-3 text-sm">
                  {analysis.intent && (
                    <div><span className="text-muted-foreground">Интент:</span> {analysis.intent}</div>
                  )}
                  {analysis.entities?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-muted-foreground text-xs">Сущности:</span>
                      {analysis.entities.map((e, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{e}</Badge>
                      ))}
                    </div>
                  )}
                  {analysis.expectations?.length > 0 && (
                    <div>
                      <div className="text-muted-foreground text-xs mb-1">Ожидания ИИ от контента:</div>
                      <ul className="text-xs space-y-0.5 list-disc list-inside">
                        {analysis.expectations.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  )}
                  {analysis.recommended_blocks?.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-xs">Рекомендуемые блоки:</span>
                        <Button size="sm" variant="ghost" onClick={replaceWithAiBlocks} className="h-7 text-xs">
                          Заменить все
                        </Button>
                      </div>
                      <div className="grid gap-1.5">
                        {analysis.recommended_blocks.map((rb, i) => {
                          const exists = blocks.some((b) => b.type === rb.type);
                          return (
                            <div key={i} className="flex items-center justify-between gap-2 rounded border bg-background p-2">
                              <div className="min-w-0 flex-1 pr-2">
                                <div className="text-xs font-medium truncate">H{rb.h_level} · {rb.title}</div>
                                <div className="text-xs text-muted-foreground truncate">{rb.desc} · ~{rb.words} сл.</div>
                              </div>
                              <Button size="sm" variant="outline" disabled={exists} onClick={() => addAiBlock(rb)} className="h-7 text-xs shrink-0">
                                <Plus className="h-3 w-3 mr-1" />
                                {exists ? "Добавлен" : "Добавить"}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {analysis.seo_notes && (
                    <div className="text-xs italic text-muted-foreground">{analysis.seo_notes}</div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 space-y-3">
              {blocks.map((b, i) => {
              const locked = b.proOnly && !isPro;
              return (
                <div key={b.type} className={`flex items-center justify-between rounded-md border p-3 ${locked ? "opacity-50" : ""}`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{b.title}</span>
                      {locked && <Badge variant="outline" className="text-xs">PRO</Badge>}
                      {b.source === "ai" && <Badge variant="secondary" className="text-xs">AI</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{b.desc} · ~{b.words} слов</p>
                  </div>
                  <Switch
                    checked={b.enabled}
                    disabled={locked}
                    onCheckedChange={(v) => setBlocks((arr) => arr.map((x, j) => (j === i ? { ...x, enabled: v } : x)))}
                  />
                </div>
              );
              })}
              <div className="flex items-center justify-between pt-3 border-t">
                <div className="text-sm text-muted-foreground">Итого: ~{totalWords} слов</div>
                <div className="text-sm">Стоимость: <span className="font-medium text-primary">{cost} кредитов</span></div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 4 */}
      {step === 4 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            {blocks.filter((b) => b.enabled).map((b) => {
              const idx = blocks.indexOf(b);
              return (
                <Card key={b.type}>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="font-medium text-sm">{b.title}</span>
                        {b.status === "generating" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                        {b.status === "done" && <Check className="h-3 w-3 text-green-500" />}
                        {b.status === "error" && <Badge variant="destructive" className="text-xs">ошибка</Badge>}
                        {b.wordCount && <span className="text-xs text-muted-foreground">{b.wordCount} сл.</span>}
                        {b.status === "done" && b.quality && (
                          <div className="flex items-center gap-1">
                            {b.quality.antiFake === 0 && b.quality.factCheck === 0 ? (
                              <Badge variant="outline" className="text-[10px] h-5 border-green-500/40 text-green-600 dark:text-green-400" title="Фактчек пройден, выдуманных данных не найдено">
                                ✓ Fact-check OK
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] h-5 border-yellow-500/40 text-yellow-600 dark:text-yellow-400" title={`Удалено выдуманных фактов: ${b.quality.antiFake + b.quality.factCheck}`}>
                                ⚠ Очищено: {b.quality.antiFake + b.quality.factCheck}
                              </Badge>
                            )}
                            {b.quality.retried && (
                              <Badge variant="outline" className="text-[10px] h-5 border-blue-500/40 text-blue-600 dark:text-blue-400" title="Текст автоматически переписан для соответствия объёму/плотности ключа">
                                ↻ Рерайт
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                      {b.status !== "generating" && genIdx < 0 && (
                        <div className="flex flex-wrap items-center gap-1 shrink-0">
                          {b.content && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => toggleBlockEdit(idx)} title={b.editing ? "Закрыть" : "Редактировать"}>
                                {b.editing ? <X className="h-3 w-3 mr-1" /> : <Pencil className="h-3 w-3 mr-1" />}
                                {b.editing ? "Готово" : "Править"}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => generateBlockImage(idx)} disabled={b.imageBusy} title="Сгенерировать фото для блока">
                                {b.imageBusy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ImageIcon className="h-3 w-3 mr-1" />}
                                Фото
                              </Button>
                            </>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => handleRegenClick(idx)}>
                            <RefreshCw className="h-3 w-3 mr-1" />
                            {(b.regenCount || 0) >= 1 ? "Перегенерировать (1 кр.)" : "Перегенерировать"}
                          </Button>
                        </div>
                      )}
                    </div>
                    {b.content ? (
                      b.editing ? (
                        <Textarea
                          value={b.content}
                          onChange={(e) => updateBlockContent(idx, e.target.value)}
                          rows={Math.min(24, Math.max(8, Math.ceil(b.content.length / 80)))}
                          className="font-mono text-xs"
                        />
                      ) : (
                        <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(b.content) }} />
                      )
                    ) : b.status === "pending" ? (
                      <p className="text-sm text-muted-foreground">Ожидание...</p>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <div className="space-y-3">
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="text-sm font-medium">Сводка</div>
                <div className="text-xs text-muted-foreground">
                  Готово: {blocks.filter((b) => b.status === "done").length} / {enabledBlocks.length}
                </div>
                <div className="text-xs text-muted-foreground">
                  Всего слов: {blocks.reduce((s, b) => s + (b.wordCount || 0), 0)}
                </div>
              </CardContent>
            </Card>
            <Button variant="outline" className="w-full" disabled={!fullHtml} onClick={() => setShowPreview(true)}>
              <Eye className="h-4 w-4 mr-2" /> Превью всей страницы
            </Button>
            <Button className="w-full" disabled={genIdx >= 0 || !fullHtml || savingArticle} onClick={saveAsArticle}>
              {savingArticle ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {savedArticleId ? "Обновить статью" : "Сохранить как статью"}
            </Button>
            {savedArticleId && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  // Open in a new tab so the heavy AI Writer editor cannot freeze
                  // the commercial flow state, and the user can always come back.
                  window.open(`/articles?edit=${savedArticleId}`, "_blank", "noopener,noreferrer");
                }}
              >
                Открыть в редакторе (новая вкладка)
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full"
              disabled={!brief.keyword}
              onClick={() => {
                const params = new URLSearchParams({
                  mode: "cover",
                  keyword: brief.keyword || "",
                  topic: brief.product_name || brief.niche || brief.keyword || "",
                });
                navigate(`/images?${params.toString()}`);
              }}
            >
              <ImageIcon className="h-4 w-4 mr-2" /> Сгенерировать обложку
            </Button>
          </div>
        </div>
      )}

      {/* Nav buttons */}
      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(1, s - 1) as Step)} disabled={step === 1 || genIdx >= 0}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Назад
        </Button>
        {step < 3 && <Button onClick={goNext}>Далее <ChevronRight className="h-4 w-4 ml-1" /></Button>}
        {step === 3 && (
          <Button onClick={startGeneration} disabled={enabledBlocks.length === 0}>
            <Sparkles className="h-4 w-4 mr-1" /> Сгенерировать ({cost} кр.)
          </Button>
        )}
      </div>

      {/* Preview dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Превью страницы</DialogTitle>
            <DialogDescription>
              Так страница будет выглядеть после сохранения как статьи.
            </DialogDescription>
          </DialogHeader>
          <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(fullHtml) }} />
        </DialogContent>
      </Dialog>

      {/* Regen confirm dialog */}
      <Dialog open={regenConfirmIdx !== null} onOpenChange={(o) => !o && setRegenConfirmIdx(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Перегенерация блока</DialogTitle>
            <DialogDescription>
              Первая перегенерация была бесплатной. Каждая следующая списывает 1 кредит. Продолжить?
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setRegenConfirmIdx(null)}>Отмена</Button>
            <Button
              onClick={() => {
                const i = regenConfirmIdx;
                setRegenConfirmIdx(null);
                if (i !== null) generateBlock(i);
              }}
            >
              Списать 1 кредит и перегенерировать
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
