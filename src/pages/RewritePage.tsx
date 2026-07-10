import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Wand2, ShieldCheck, AlertTriangle, CheckCircle2, ArrowRight, Copy, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { diffWordsWithSpace } from "diff";

type Lang = "ru" | "en";
type StepKey = "input" | "audit" | "improve";

type QualityFlag = { code: string; title: string; excerpt?: string; hint?: string; auto: boolean };

const MAX_CHARS = 50_000;

function detectLang(text: string): Lang {
  const cyr = (text.match(/[а-яА-ЯёЁ]/g) || []).length;
  const lat = (text.match(/[a-zA-Z]/g) || []).length;
  return cyr > lat ? "ru" : "en";
}

function computeCost(chars: number): number {
  return Math.max(5, Math.ceil(chars / 1500));
}

// Very small heuristic pre-scan. Real judgement happens on server (quality-check auto).
function localPreScan(content: string, keyword: string, lang: Lang): QualityFlag[] {
  const flags: QualityFlag[] = [];
  const plain = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const chars = plain.length;

  // 1) Cliché / boilerplate
  const cliches = lang === "ru"
    ? ["в современном мире", "ни для кого не секрет", "следует отметить", "стоит сказать", "является", "осуществляет", "в рамках", "на сегодняшний день"]
    : ["in today's world", "it is worth noting", "needless to say", "as we all know"];
  for (const c of cliches) {
    if (new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(plain)) {
      flags.push({ code: "cliche", title: lang === "ru" ? "Клише / канцелярит" : "Cliché / boilerplate", excerpt: `«${c}»`, auto: true });
      break;
    }
  }

  // 2) Fake quotes / attribution without source
  const fakePatterns = lang === "ru"
    ? [/практика показывает/i, /по мнению экспертов/i, /специалисты отмечают/i, /по данным опросов/i]
    : [/experts say/i, /according to specialists/i, /studies show/i];
  for (const re of fakePatterns) {
    const m = re.exec(plain);
    if (m) {
      flags.push({ code: "fake_quote", title: lang === "ru" ? "Фейковая цитата / атрибуция без источника" : "Unattributed claim", excerpt: `«${m[0]}»`, hint: lang === "ru" ? "Требует вашей правки: удалите или подставьте реальный источник" : "Requires your edit: remove or provide a real source", auto: false });
      break;
    }
  }

  // 3) Sentence fragments: sentence ends on a preposition/conjunction
  const fragRe = lang === "ru"
    ? /\b(потому что|но|если|хотя|так как|чтобы|несмотря на|в|на|под|над|при|для|из|к|от|до)\.\s/gi
    : /\b(because|but|if|although|so that|while|when)\.\s/gi;
  const fragMatch = fragRe.exec(plain);
  if (fragMatch) {
    flags.push({ code: "dangling", title: lang === "ru" ? "Обрубленное предложение" : "Truncated sentence", excerpt: `«…${fragMatch[0].trim()}»`, auto: true });
  }

  // 4) Keyword density
  if (keyword) {
    const kw = keyword.trim().toLowerCase();
    if (kw.length >= 3) {
      const words = plain.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = words.filter((w) => w.includes(kw.split(" ")[0])).length;
      const density = words.length ? hits / words.length : 0;
      if (density > 0.035) {
        flags.push({ code: "kw_density", title: lang === "ru" ? "Переспам ключа" : "Keyword over-density", excerpt: `${(density * 100).toFixed(1)}% — рекомендуется 0.5-2%`, auto: true });
      } else if (density < 0.002 && chars > 1500) {
        flags.push({ code: "kw_low", title: lang === "ru" ? "Ключ почти не встречается" : "Keyword too rare", excerpt: `${(density * 100).toFixed(2)}%`, auto: true });
      }
    }
  }

  // 5) Missing H1 (structural, user must fix)
  const hasH1 = /<h1[\s>]/i.test(content) || /^#\s/m.test(content);
  if (!hasH1) {
    flags.push({ code: "no_h1", title: lang === "ru" ? "Отсутствует H1" : "Missing H1", auto: false, hint: lang === "ru" ? "Добавьте главный заголовок H1 — машина не выбирает тему за автора" : "Add a top-level H1 — this is a structural author choice" });
  }

  // 6) Structure warning: too few or too many H2
  const h2Count = (content.match(/<h2[\s>]/gi) || []).length + (content.match(/^##\s/gm) || []).length;
  if (chars > 3000 && h2Count < 2) {
    flags.push({ code: "structure_thin", title: lang === "ru" ? "Слишком мало подзаголовков H2" : "Too few H2 sections", auto: false, hint: lang === "ru" ? "Разбейте текст на смысловые блоки" : "Split the text into sections" });
  }

  return flags;
}

export default function RewritePage() {
  const { user } = useAuth();
  const { language } = useI18n();
  const isRu = language !== "en";
  const [step, setStep] = useState<StepKey>("input");

  // Step 1 — input
  const [content, setContent] = useState("");
  const [keyword, setKeyword] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [lang, setLang] = useState<Lang>("ru");
  const [langAuto, setLangAuto] = useState(true);

  // Step 2 — audit
  const [flags, setFlags] = useState<QualityFlag[] | null>(null);
  const [auditing, setAuditing] = useState(false);

  // Step 3 — improve
  const [articleId, setArticleId] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState("");
  const [improvedContent, setImprovedContent] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [cycleStatus, setCycleStatus] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const [rejectedParagraphs, setRejectedParagraphs] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!langAuto || !content) return;
    const auto = detectLang(content);
    if (auto !== lang) setLang(auto);
  }, [content, langAuto]); // eslint-disable-line react-hooks/exhaustive-deps

  const chars = content.length;
  const cost = computeCost(Math.max(chars, 1));

  const autoFlags = useMemo(() => (flags || []).filter((f) => f.auto), [flags]);
  const manualFlags = useMemo(() => (flags || []).filter((f) => !f.auto), [flags]);
  const verdict = useMemo(() => {
    if (!flags) return null;
    if (manualFlags.some((f) => f.code === "no_h1")) return "needs_structure";
    if (flags.length === 0) return "ready";
    return "needs_work";
  }, [flags, manualFlags]);

  const handleAudit = async () => {
    if (!content.trim() || content.length < 200) {
      toast.error(isRu ? "Вставьте текст (минимум 200 знаков)" : "Paste at least 200 characters");
      return;
    }
    if (!keyword.trim()) {
      toast.error(isRu ? "Укажите главный ключ" : "Enter the main keyword");
      return;
    }
    if (chars > MAX_CHARS) {
      toast.error(isRu ? `Максимум ${MAX_CHARS} знаков` : `Max ${MAX_CHARS} characters`);
      return;
    }
    setAuditing(true);
    try {
      const local = localPreScan(content, keyword, lang);
      setFlags(local);
      setStep("audit");
    } finally {
      setAuditing(false);
    }
  };

  const handleImprove = async () => {
    if (!user) { toast.error(isRu ? "Требуется вход" : "Please sign in"); return; }
    setStarting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("no session");
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rewrite-start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          content,
          language: lang,
          main_keyword: keyword.trim(),
          source_url: sourceUrl.trim() || undefined,
        }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast.error(payload?.error || `HTTP ${resp.status}`);
        return;
      }
      setArticleId(payload.article_id);
      setOriginalContent(content);
      setImprovedContent(null);
      setCycleStatus("running");
      setStep("improve");
      toast.success(isRu
        ? (payload.bypassed ? "Запущено (админ-режим)" : `Списано ${payload.cost} кр`)
        : (payload.bypassed ? "Started (admin)" : `Charged ${payload.cost} credits`));
    } catch (e: any) {
      toast.error(e?.message || "start_failed");
    } finally {
      setStarting(false);
    }
  };

  // Poll article progress until cycle ends
  useEffect(() => {
    if (step !== "improve" || !articleId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const { data } = await supabase
          .from("articles")
          .select("content, quality_details, quality_status")
          .eq("id", articleId)
          .maybeSingle();
        if (stopped || !data) return;
        const qd: any = data.quality_details || {};
        const cp = qd.cycle_progress || {};
        const status = cp.status || data.quality_status || null;
        setCycleStatus(status);
        if (status === "done" || status === "error" || status === "stopped") {
          setImprovedContent(data.content || "");
          if (pollRef.current) window.clearInterval(pollRef.current);
          const rewriteMeta = qd.rewrite || {};
          if (rewriteMeta.refunded) {
            toast.warning(isRu
              ? `Кредиты возвращены (${rewriteMeta.refund_reason || "сбой"})`
              : `Credits refunded (${rewriteMeta.refund_reason || "failure"})`);
          } else if (status === "done") {
            toast.success(isRu ? "Готово" : "Done");
          }
        }
      } catch (_) { /* silent */ }
    };
    tick();
    pollRef.current = window.setInterval(tick, 4000);
    return () => {
      stopped = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [step, articleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const paragraphDiff = useMemo(() => {
    if (!improvedContent) return [];
    const stripTags = (s: string) => s.replace(/<[^>]+>/g, "\n").replace(/\n{3,}/g, "\n\n");
    const oldP = stripTags(originalContent).split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    const newP = stripTags(improvedContent).split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    const n = Math.max(oldP.length, newP.length);
    return Array.from({ length: n }).map((_, i) => ({
      before: oldP[i] || "",
      after: newP[i] || "",
      changed: (oldP[i] || "") !== (newP[i] || ""),
    }));
  }, [originalContent, improvedContent]);

  const acceptedContent = useMemo(() => {
    return paragraphDiff.map((p, i) => rejectedParagraphs.has(i) ? p.before : p.after).filter(Boolean).join("\n\n");
  }, [paragraphDiff, rejectedParagraphs]);

  const toggleParagraph = (i: number) => {
    setRejectedParagraphs((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i); else n.add(i);
      return n;
    });
  };

  const copyResult = async () => {
    await navigator.clipboard.writeText(acceptedContent);
    toast.success(isRu ? "Скопировано" : "Copied");
  };

  const downloadDocx = async () => {
    // Minimal .docx via docx package
    const { Document, Packer, Paragraph, TextRun } = await import("docx");
    const paras = acceptedContent.split(/\n\s*\n/).map((p) =>
      new Paragraph({ children: [new TextRun(p.replace(/<[^>]+>/g, ""))] })
    );
    const doc = new Document({ sections: [{ children: paras }] });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rewrite-${(keyword || "article").slice(0, 40).replace(/\W+/g, "-")}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl md:text-3xl font-semibold flex items-center gap-2">
          <Wand2 className="h-6 w-6 text-primary" />
          {isRu ? "Рерайт чужой статьи" : "Rewrite an existing article"}
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          {isRu
            ? "Бесплатный аудит + консервативный рерайт: чиним клише, канцелярит и AI-подписи, не трогаем ваши факты и структуру."
            : "Free audit + conservative rewrite: we fix clichés, boilerplate and AI fingerprints — your facts and structure stay intact."}
        </p>
      </header>

      {/* Stepper */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {(["input", "audit", "improve"] as StepKey[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`h-6 w-6 rounded-full grid place-items-center text-[10px] font-semibold ${step === s ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{i + 1}</div>
            <span className={step === s ? "text-foreground" : ""}>
              {s === "input" ? (isRu ? "Вход" : "Input") : s === "audit" ? (isRu ? "Аудит" : "Audit") : (isRu ? "Исправление" : "Improve")}
            </span>
            {i < 2 && <ArrowRight className="h-3 w-3 opacity-40" />}
          </div>
        ))}
      </div>

      {/* STEP 1 */}
      {step === "input" && (
        <Card className="p-4 md:p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{isRu ? "Главный ключ" : "Main keyword"} *</label>
              <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={isRu ? "например: газовые котлы" : "e.g. best CRM for agencies"} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{isRu ? "URL страницы (опционально)" : "Source URL (optional)"}</label>
              <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">{isRu ? "Текст статьи" : "Article text"}</label>
              <span className={`text-xs ${chars > MAX_CHARS ? "text-red-500" : "text-muted-foreground"}`}>
                {chars.toLocaleString()} / {MAX_CHARS.toLocaleString()}
              </span>
            </div>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={isRu ? "Вставьте HTML, Markdown или обычный текст" : "Paste HTML, Markdown or plain text"}
              className="min-h-[240px] font-mono text-xs"
            />
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{isRu ? "Язык:" : "Language:"}</span>
              <div className="flex gap-1">
                {(["ru", "en"] as Lang[]).map((l) => (
                  <Button key={l} type="button" size="sm" variant={lang === l ? "default" : "outline"} onClick={() => { setLang(l); setLangAuto(false); }}>
                    {l.toUpperCase()}
                  </Button>
                ))}
              </div>
              {langAuto && <Badge variant="secondary" className="text-[10px]">{isRu ? "автоопределение" : "auto"}</Badge>}
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleAudit} disabled={auditing || !content || !keyword}>
              {auditing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
              {isRu ? "Проверить бесплатно" : "Audit for free"}
            </Button>
          </div>
        </Card>
      )}

      {/* STEP 2 */}
      {step === "audit" && (
        <div className="space-y-4">
          <Card className="p-4 md:p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                {verdict === "ready" && <Badge className="bg-emerald-500/20 text-emerald-500">{isRu ? "Готово к публикации" : "Ready to publish"}</Badge>}
                {verdict === "needs_work" && <Badge className="bg-amber-500/20 text-amber-500">{isRu ? "Требует доработки" : "Needs work"}</Badge>}
                {verdict === "needs_structure" && <Badge className="bg-red-500/20 text-red-500">{isRu ? "Требует переписывания структуры" : "Needs structural rewrite"}</Badge>}
                <span className="text-xs text-muted-foreground">{isRu ? "Аудит бесплатный" : "Audit is free"}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setStep("input")}>{isRu ? "Изменить текст" : "Edit input"}</Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  {isRu ? "Исправим автоматически" : "We fix automatically"}
                </div>
                {autoFlags.length === 0 ? (
                  <div className="text-xs text-muted-foreground">{isRu ? "Ничего критичного не найдено" : "Nothing critical found"}</div>
                ) : (
                  <ul className="space-y-2 text-xs">
                    {autoFlags.map((f, i) => (
                      <li key={i} className="rounded border border-border/50 p-2">
                        <div className="font-medium">{f.title}</div>
                        {f.excerpt && <div className="text-muted-foreground italic">{f.excerpt}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  {isRu ? "Требует вашей правки" : "Needs your edit"}
                </div>
                {manualFlags.length === 0 ? (
                  <div className="text-xs text-muted-foreground">{isRu ? "Ручных правок не требуется" : "No manual edits required"}</div>
                ) : (
                  <ul className="space-y-2 text-xs">
                    {manualFlags.map((f, i) => (
                      <li key={i} className="rounded border border-amber-500/30 p-2">
                        <div className="font-medium">{f.title}</div>
                        {f.excerpt && <div className="text-muted-foreground italic">{f.excerpt}</div>}
                        {f.hint && <div className="text-muted-foreground mt-1">{f.hint}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              {isRu
                ? "Пункты справа машина не берётся исправлять — только вы можете добавить H1 или проставить реальный источник."
                : "Items on the right require your call — only you can add an H1 or attach a real source."}
            </p>

            <div className="flex items-center justify-between pt-2 border-t border-border/40">
              <div className="text-sm">
                <span className="text-muted-foreground">{isRu ? "Стоимость исправления:" : "Cost to fix:"}</span>{" "}
                <span className="font-semibold">{cost}</span>{" "}
                <span className="text-muted-foreground">{isRu ? "кр" : "cr"}</span>
                <div className="text-[11px] text-muted-foreground">
                  {isRu ? `~${Math.round(chars / 100) / 10}k знаков` : `~${Math.round(chars / 100) / 10}k chars`}
                </div>
              </div>
              <Button onClick={handleImprove} disabled={starting}>
                {starting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                {isRu ? `Исправить за ${cost} кр` : `Fix for ${cost} credits`}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* STEP 3 */}
      {step === "improve" && (
        <div className="space-y-4">
          <Card className="p-4 md:p-6 space-y-3">
            <div className="flex items-center gap-3">
              {cycleStatus !== "done" && cycleStatus !== "error" && cycleStatus !== "stopped" ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <div>
                    <div className="font-medium">{isRu ? "Улучшаем текст…" : "Improving…"}</div>
                    <div className="text-xs text-muted-foreground">
                      {isRu
                        ? "Пайплайн работает на сервере, можно закрыть страницу — результат сохранится."
                        : "The pipeline runs on the server — you can close this tab safely."}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  <div>
                    <div className="font-medium">
                      {cycleStatus === "error" ? (isRu ? "Цикл упал — кредиты возвращены" : "Cycle failed — credits refunded")
                        : cycleStatus === "stopped" ? (isRu ? "Остановлено" : "Stopped")
                        : (isRu ? "Готово. Просмотрите изменения ниже." : "Done. Review the diff below.")}
                    </div>
                    {articleId && (
                      <div className="text-xs text-muted-foreground">
                        {isRu ? "ID статьи:" : "Article id:"} {articleId}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </Card>

          {improvedContent && (
            <Card className="p-4 md:p-6 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="text-sm font-medium flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  {isRu ? "Поабзацное сравнение" : "Paragraph-by-paragraph diff"}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={copyResult}>
                    <Copy className="h-4 w-4 mr-2" />{isRu ? "Копировать" : "Copy"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={downloadDocx}>
                    <Download className="h-4 w-4 mr-2" />DOCX
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                {paragraphDiff.map((p, i) => {
                  const rejected = rejectedParagraphs.has(i);
                  if (!p.changed) {
                    return (
                      <div key={i} className="text-sm text-muted-foreground border-l-2 border-border/40 pl-3">
                        {p.after || p.before}
                      </div>
                    );
                  }
                  const parts = diffWordsWithSpace(p.before, p.after);
                  return (
                    <div key={i} className={`rounded border p-3 space-y-2 text-sm ${rejected ? "border-red-500/40 opacity-60" : "border-emerald-500/30"}`}>
                      <div className="whitespace-pre-wrap leading-relaxed">
                        {parts.map((part, j) => {
                          if (part.added) return <span key={j} className="bg-emerald-500/20 text-emerald-500 rounded px-0.5">{part.value}</span>;
                          if (part.removed) return <span key={j} className="bg-red-500/20 text-red-500 line-through rounded px-0.5">{part.value}</span>;
                          return <span key={j}>{part.value}</span>;
                        })}
                      </div>
                      <div className="flex justify-end">
                        <Button size="sm" variant={rejected ? "default" : "ghost"} onClick={() => toggleParagraph(i)}>
                          {rejected ? (isRu ? "Вернуть предложенный" : "Take suggestion") : (isRu ? "Оставить оригинал" : "Keep original")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}