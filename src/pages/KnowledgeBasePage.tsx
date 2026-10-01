import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { ArrowLeft, BookOpen, Download, FilePlus, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useConfirm } from "@/shared/components/ConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import {
  buildKnowledgeBase, defaultDocs, validateKb, firstNumber,
  type KbContacts, type KbDoc, type KbFact, type KbInput, type KbQuery, type KbTerm, type KbPrice,
} from "@/features/knowledge-base/buildKnowledgeBase";
import { parsePriceFile, type PriceImport } from "@/features/knowledge-base/parsePriceFile";

const STEPS = ["Данные клиента", "Тематический план", "Факты", "Архив"];
const today = () => new Date().toISOString().slice(0, 10);

export default function KnowledgeBasePage() {
  const confirm = useConfirm();
  const [step, setStep] = useState(0);
  const [info, setInfo] = useState({
    companyName: "", legalName: "", site: "", city: "", region: "", geographyNote: "",
    description: "", contactsPage: "", owner: "", repoName: "", githubOwner: "microgrin71-sudo", llmsPath: "/llms.txt", license: "CC-BY-4.0" as KbInput["license"],
    yearsOnMarket: "", productsServices: "",
    inn: "", ogrn: "", registeredAt: "", priceSource: "", deliveryRules: "", calculationNotes: "",
  });
  const [priceText, setPriceText] = useState("");
  const [photoText, setPhotoText] = useState("");
  const [fileImport, setFileImport] = useState<{ prices: KbPrice[]; report: PriceImport } | null>(null);
  const [appendText, setAppendText] = useState(false);
  const onPriceFile = async (f: File) => {
    const r = await parsePriceFile(f, info.site);
    setFileImport(r);
    if (r.report.errors.length) toast.error(r.report.errors.join("; "));
    else toast.success(`Прайс загружен: ${r.report.withPrice} позиций с ценой из ${r.report.rowsRead}`);
  };
  const downloadPriceTemplate = () => {
    const slug = (info.repoName || info.companyName || "client").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "client";
    const header = ["название", "цена_от", "единица", "зона", "задачи", "страница", "фото", "категория"];
    const rows = [
      ["Шаблон прайса SEO-Модуль - цены от (ориентир, не оферта). Строки с примером удалите или замените своими позициями."],
      [],
      header,
      ["Щебень гранитный 20-40", 1900, "т", "самовывоз", "дорога; фундамент", "https://example.ru/sheben", "https://example.ru/img/sheben.jpg", "подсказка: пример, удалите строку"],
      ["Песок строительный", 700, "т", "доставка до 30 км", "бетон; стяжка", "https://example.ru/pesok", "", "подсказка: пример, удалите строку"],
      ["Позиция из прайса", "цена от, только число", "т | м3 | шт", "город или зона", "задачи через ;", "страница с сайта клиента", "ссылка с сайта клиента", "категория"],
      ["", "", "", "", "", "", "", ""],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 30 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 24 }, { wch: 30 }, { wch: 30 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Прайс");
    XLSX.writeFile(wb, `shablon-prisa-${slug}.xlsx`);
    toast.success("Шаблон прайса скачан");
  };
  const [bulk, setBulk] = useState("");
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [facts, setFacts] = useState<KbFact[]>([]);
  const [queries, setQueries] = useState<KbQuery[]>([]);
  const [contacts, setContacts] = useState<KbContacts>({ address: "", warehouses: "", phoneSales: "", emailSales: "", phoneSupport: "", emailSupport: "", workHours: "" });
  const [glossary, setGlossary] = useState<KbTerm[]>([]);
  const setC = (k: keyof KbContacts) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setContacts((p) => ({ ...p, [k]: e.target.value }));
  const updTerm = (i: number, k: keyof KbTerm, v: string) => setGlossary((p) => p.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  const [urls, setUrls] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof info) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setInfo((p) => ({ ...p, [k]: e.target.value }));

  const input: KbInput = useMemo(() => ({
    ...info,
    site: info.site.replace(/\/+$/, ""),
    repoName: (info.repoName || `${info.site.replace(/^https?:\/\//, "") || "company"}-technical-knowledge-base`).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "company-kb",
    githubOwner: info.githubOwner || "microgrin71-sudo", llmsPath: info.llmsPath || "/llms.txt",
    priceList: [
      ...(fileImport?.prices || []),
      ...(!fileImport || appendText ? priceText.split(/\n+/).map((l) => l.split("|").map((x) => x.trim())).filter((c) => c[0])
        .map((c) => ({ name: c[0], priceFrom: firstNumber(c[1] || ""), currency: "руб", unit: c[2] || "", zone: c[3] || "", category: "", useCases: c[4] || "", pageUrl: c[5] || "", imageUrl: c[6] || "" })) : []),
    ],
    priceImport: fileImport?.report,
    photoUrls: photoText.split(/\s+/).filter(Boolean),
    docs, facts, queries, contacts, glossary, checkedAt: today(),
  }), [info, docs, facts, queries, contacts, glossary, priceText, photoText, fileImport, appendText]);
  const validation = useMemo(() => validateKb(input), [input]);

  // Parse one pasted block of client data into fields. Never overwrites filled fields.
  const parseBulk = () => {
    const t = bulk.trim();
    if (!t) return;
    const grab = (re: RegExp) => t.match(re)?.[1]?.trim() || "";
    const site = grab(/(https?:\/\/[^\s,]+)/i).replace(/[.,;]+$/, "");
    const email = grab(/[\w.+-]+@[\w-]+\.[\w.]+/);
    const phone = grab(/(\+?\d[\d\s()\-]{7,}\d)/);
    const years = grab(/(\d{1,3})\s*(?:лет|года|год)\s+на\s+рынке/i) || grab(/на\s+рынке\s+(?:с\s+\d{4}\s+года\s*-?\s*)?(\d{1,3})\s*(?:лет|года)/i);
    const hours = grab(/(?:пн|по будням|будни)[^\n,;]*/i);
    const address = grab(/(?:адрес|офис)[:\s]+([^\n]+)/i);
    const lines = t.split(/\n+/).map((s) => s.trim()).filter((s) => s && !/https?:|@|адрес|тел|пн|вт|ср|чт|пт/i.test(s));
    setInfo((p) => ({
      ...p,
      companyName: p.companyName || lines[0] || "",
      site: p.site || site,
      city: p.city || grab(/(?:г\.?\s*|город[:\s]+)([А-Яа-яA-Za-z\- ]+)/)?.trim() || "",
      yearsOnMarket: p.yearsOnMarket || years,
      description: p.description || lines.slice(1).find((s) => s.length > 40) || "",
    }));
    setContacts((p) => ({
      ...p,
      address: p.address || address,
      phoneSales: p.phoneSales || phone,
      emailSales: p.emailSales || email,
      workHours: p.workHours || hours,
    }));
    toast.success("Данные разобраны", { description: "Проверьте поля ниже - пустые заполнены из текста" });
  };

  const goPlan = () => {
    if (!docs.length) setDocs(defaultDocs(info.site || "https://"));
    if (!urls.trim() && info.site) setUrls(info.site);
    setStep(1);
  };

  const [glossLoading, setGlossLoading] = useState(false);
  const genGlossary = async () => {
    setGlossLoading(true);
    try {
      const filled = glossary.filter((t) => t.term.trim());
      const { data, error } = await supabase.functions.invoke("kb-glossary-generate", {
        body: {
          topic: [info.companyName, info.description, info.city].filter(Boolean).join(". "),
          products: info.productsServices + "\n" + priceText.split("\n").map((l) => l.split("|")[0]).join(", "),
          facts: facts.slice(0, 60).map((f) => f.statement).join("; "),
          existing: filled.map((t) => t.term),
          count: Math.max(8, 5 - filled.length),
        },
      });
      if (error || data?.error) {
        let msg = data?.error || error?.message;
        try { const ctx = (error as { context?: Response })?.context; if (ctx) { const j = await ctx.json(); msg = j?.error || msg; } } catch { /* keep */ }
        throw new Error(msg);
      }
      const terms: KbTerm[] = data?.terms || [];
      if (!terms.length) throw new Error("ИИ не предложил новых терминов");
      setGlossary([...filled, ...terms]);
      toast.success(`Добавлено терминов: ${terms.length}`);
    } catch (e) {
      toast.error((e as Error).message || "Не удалось подобрать термины");
    } finally {
      setGlossLoading(false);
    }
  };

  const extract = async () => {
    const list = urls.split(/\s+/).map((u) => u.trim()).filter(Boolean);
    if (!list.length) { toast.error("Добавьте ссылки на страницы сайта"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("kb-fact-extract", { body: { urls: list } });
      if (error || data?.error) {
        let msg = data?.error || error?.message;
        try { const ctx = (error as { context?: Response })?.context; if (ctx) { const j = await ctx.json(); msg = j?.error || msg; } } catch { /* keep */ }
        throw new Error(msg);
      }
      if (!data?.facts?.length) throw new Error("Модель не вернула фактов. Попробуйте меньше страниц за раз.");
      const start = facts.length;
      const docFor = (topic: string) => {
        const find = (p: string) => docs.find((d) => d.slug.startsWith(p))?.slug || "";
        if (["company"].includes(topic)) return find("company/company-profile");
        if (["geography", "contacts"].includes(topic)) return find("company/geography");
        if (topic === "certification") return find("company/cert");
        if (topic === "standard") return docs.find((d) => /standard/.test(d.slug))?.slug || "";
        if (topic === "service") return find("services/");
        if (topic === "parameter") return docs.find((d) => /selection/.test(d.slug))?.slug || "";
        if (topic === "price") return docs.find((d) => /selection/.test(d.slug))?.slug || "";
        if (topic === "product") return docs.find((d) => /what-is/.test(d.slug))?.slug || "";
        return "";
      };
      const incoming: KbFact[] = (data.facts || []).map(({ verbatim, ...f }: Omit<KbFact, "id" | "status" | "doc"> & { verbatim?: boolean }, i: number) => ({
        ...f, id: `F-${String(start + i + 1).padStart(3, "0")}`, status: verbatim ? "confirmed" : "needs_confirmation", doc: docFor(f.topic),
      }));
      setFacts((p) => [...p, ...incoming]);
      const c = data.company || {};
      setInfo((p) => ({
        ...p,
        companyName: p.companyName || c.name || "",
        legalName: p.legalName || c.legal_name || "",
        city: p.city || c.city || "",
        description: p.description || c.description || "",
      }));
      toast.success(`Найдено фактов: ${incoming.length}`, { description: `Подтверждено дословно со страницы: ${incoming.filter((f) => f.status === "confirmed").length}${data.failed?.length ? `. Не прочитано страниц: ${data.failed.length}` : ""}` });
    } catch (e) {
      toast.error("Ошибка сбора фактов", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    const files = buildKnowledgeBase(input);
    const zip = new JSZip();
    const root = zip.folder(input.repoName)!;
    Object.entries(files).forEach(([p, c]) => root.file(p, c));
    saveAs(await zip.generateAsync({ type: "blob" }), `${input.repoName}.zip`);
  };

  const updDoc = (i: number, k: keyof KbDoc, v: string) => setDocs((p) => p.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  const updFact = (i: number, patch: Partial<KbFact>) => setFacts((p) => p.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const updQuery = (i: number, k: keyof KbQuery, v: string) => setQueries((p) => p.map((q, j) => (j === i ? { ...q, [k]: v } : q)));

  // Deterministic auto-linking: query -> best document (by word stems) -> best site page (by facts' sources).
  const stems = (s: string) => new Set(
    s.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/i).filter((w) => w.length >= 4).map((w) => w.slice(0, 5)),
  );
  const overlap = (a: Set<string>, b: Set<string>) => { let n = 0; a.forEach((w) => { if (b.has(w)) n++; }); return n; };
  const HINTS: Array<[RegExp, RegExp]> = [
    [/достав|регион|област|город|адрес|склад|где /i, /geograph|contact/],
    [/цен|стоим|сколько|скидк|оплат/i, /faq|price/],
    [/выбра|выбор|подобр|лучше|нужен|отлича|какой/i, /select|guide|compar/],
    [/что такое|это|бывает|виды/i, /what-is|glossary/],
    [/компани|производ|поставщик|кто /i, /company/],
  ];
  const linkQuery = (text: string): KbQuery => {
    const qs = stems(text);
    let bestDoc = "", bestScore = 0;
    for (const d of docs) {
      const docText = [d.title, d.task, d.directAnswer, d.slug.replace(/[/-]/g, " "),
        ...facts.filter((f) => f.doc === d.slug).map((f) => f.statement)].join(" ");
      let s = overlap(qs, stems(docText)) * 2;
      for (const [q, slug] of HINTS) if (q.test(text) && slug.test(d.slug)) s += 3;
      if (s > bestScore) { bestScore = s; bestDoc = d.slug; }
    }
    const pages = new Map<string, string>();
    for (const f of facts) if (f.source_url) pages.set(f.source_url, (pages.get(f.source_url) || "") + " " + f.statement + " " + f.parameter);
    let page = "", pageScore = 0;
    pages.forEach((t, url) => {
      const s = overlap(qs, stems(t + " " + url.replace(/[/_.-]/g, " ")));
      if (s > pageScore) { pageScore = s; page = url; }
    });
    if (!page) page = docs.find((d) => d.slug === bestDoc)?.sitePage || info.site;
    return { query: text, doc: bestDoc, sitePage: page };
  };
  const [bulkQ, setBulkQ] = useState("");
  const importQueries = () => {
    const existing = new Set(queries.map((q) => q.query.trim().toLowerCase()));
    const lines = bulkQ.split(/\n+/).map((s) => s.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim()).filter(Boolean);
    const fresh = lines.filter((l) => { const k = l.toLowerCase(); if (existing.has(k)) return false; existing.add(k); return true; });
    setQueries((p) => [...p, ...fresh.map(linkQuery)]);
    setBulkQ("");
    toast.success(`Добавлено запросов: ${fresh.length}`, { description: "Документ и страница подобраны автоматически - проверьте" });
  };
  const relinkAll = () => {
    setQueries((p) => p.map((q) => (q.query.trim() ? linkQuery(q.query) : q)));
    toast.success("Связи пересчитаны");
  };

  // Save/restore the whole wizard state (all steps) in the browser.
  const SAVE_KEY = "kb-geo-draft-v1";
  const loaded = useRef(false);
  const [savedAt, setSavedAt] = useState("");
  const snapshot = () => ({ step, info, priceText, photoText, bulk, docs, facts, queries, contacts, glossary, urls, bulkQ, fileImport, appendText });
  const saveNow = (silent = false) => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ...snapshot(), savedAt: new Date().toISOString() }));
      setSavedAt(new Date().toLocaleTimeString());
      if (!silent) toast.success("Сохранено", { description: `Этап ${step + 1}: ${STEPS[step]}` });
    } catch { toast.error("Не удалось сохранить"); }
  };
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        setStep(d.step ?? 0); setInfo((p) => ({ ...p, ...d.info })); setPriceText(d.priceText ?? ""); setPhotoText(d.photoText ?? ""); setFileImport(d.fileImport ?? null); setAppendText(!!d.appendText);
        setBulk(d.bulk ?? ""); setDocs(d.docs ?? []); setFacts(d.facts ?? []); setQueries(d.queries ?? []);
        setContacts((p) => ({ ...p, ...d.contacts })); setGlossary(d.glossary ?? []); setUrls(d.urls ?? ""); setBulkQ(d.bulkQ ?? "");
        if (d.savedAt) setSavedAt(new Date(d.savedAt).toLocaleTimeString());
      }
    } catch { /* ignore */ }
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => saveNow(true), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, info, priceText, photoText, bulk, docs, facts, queries, contacts, glossary, urls, bulkQ, fileImport, appendText]);
  const resetAll = async () => {
    if (!(await confirm({ title: "Начать нового клиента?", description: "Текущие данные будут удалены.", confirmText: "Начать заново", destructive: true }))) return;
    localStorage.removeItem(SAVE_KEY);
    window.location.reload();
  };

  const confirmedCount = facts.filter((f) => f.status === "confirmed").length;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm"><Link to="/admin"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <BookOpen className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">База знаний (GEO)</h1>
          <p className="text-sm text-muted-foreground">Открытая техническая база: только проверяемые факты с источниками, без рейтингов и сравнений</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <Button key={s} size="sm" variant={i === step ? "default" : "outline"} onClick={() => (i === 1 && !docs.length ? goPlan() : setStep(i))}>
            {i + 1}. {s}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {savedAt && <span className="text-xs text-muted-foreground">Автосохранение: {savedAt}</span>}
          <Button size="sm" variant="outline" onClick={() => saveNow()}><Save className="h-4 w-4 mr-1" />Сохранить</Button>
          <Button size="sm" variant="ghost" onClick={resetAll}><FilePlus className="h-4 w-4 mr-1" />Новый клиент</Button>
        </div>
      </div>

      {step === 0 && (
        <Card>
          <CardHeader><CardTitle>Данные клиента</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Вставить данные клиента одним блоком (необязательно)</Label>
              <Textarea rows={4} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="Название, сайт, город, телефон, почта, адрес, режим работы, лет на рынке - любым текстом" />
              <Button className="mt-2" variant="outline" size="sm" onClick={parseBulk} disabled={!bulk.trim()}>Разобрать в поля</Button>
            </div>
            <div><Label>Название компании</Label><Input value={info.companyName} onChange={set("companyName")} placeholder="Завод Гидрокомплект" /></div>
            <div><Label>Полное юр. наименование</Label><Input value={info.legalName} onChange={set("legalName")} placeholder="после подтверждения реквизитов" /></div>
            <div><Label>Официальный сайт</Label><Input value={info.site} onChange={set("site")} placeholder="https://rvd174.ru" /></div>
            <div><Label>Страница контактов</Label><Input value={info.contactsPage} onChange={set("contactsPage")} placeholder="https://.../contacts" /></div>
            <div><Label>Город</Label><Input value={info.city} onChange={set("city")} placeholder="Челябинск" /></div>
            <div><Label>Регион</Label><Input value={info.region} onChange={set("region")} placeholder="Челябинская область" /></div>
            <div className="sm:col-span-2"><Label>География (только если подтверждена)</Label><Input value={info.geographyNote} onChange={set("geographyNote")} placeholder="поставка по России" /></div>
            <div className="sm:col-span-2"><Label>Краткое описание (2-4 предложения, без оценок)</Label><Textarea value={info.description} onChange={set("description")} rows={3} /></div>
            <div><Label>ИНН (только если есть)</Label><Input value={info.inn} onChange={set("inn")} /></div>
            <div><Label>ОГРН (только если есть)</Label><Input value={info.ogrn} onChange={set("ogrn")} /></div>
            <div><Label>Дата регистрации / год основания</Label><Input value={info.registeredAt} onChange={set("registeredAt")} placeholder="2008" /></div>
            <div><Label>Лет на рынке (если нет даты)</Label><Input value={info.yearsOnMarket} onChange={set("yearsOnMarket")} placeholder="только дословно с сайта" /></div>
            <div className="sm:col-span-2"><Label>Продукты и услуги (по одному в строке)</Label><Textarea rows={3} value={info.productsServices} onChange={set("productsServices")} placeholder={"Рукава высокого давления\nИзготовление РВД по чертежам"} /></div>
            <div className="sm:col-span-2 pt-2 border-t border-border text-sm font-medium">Прайс "от" (ориентир, не оферта)</div>
            <div className="sm:col-span-2 space-y-2">
              <Label>Файл прайса (.xlsx, .xls, .csv) - главный источник цен</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input type="file" accept=".xlsx,.xls,.csv" className="max-w-xs" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPriceFile(f); e.target.value = ""; }} />
                {fileImport && <>
                  <Badge variant="secondary">{fileImport.report.filename}: {fileImport.report.withPrice} с ценой из {fileImport.report.rowsRead}, отброшено {fileImport.report.dropped}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => setFileImport(null)}>Убрать файл</Button>
                </>}
              </div>
              {fileImport?.report.errors.map((e) => <div key={e} className="text-xs text-destructive">{e}</div>)}
              <p className="text-xs text-muted-foreground">Колонки: название, цена_от, единица, зона, задачи, страница, фото, категория. Заголовок ищется в первых 5 строках.</p>
              {fileImport && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={appendText} onChange={(e) => setAppendText(e.target.checked)} />Добавить к файлу позиции из текстового поля</label>}
            </div>
            <div className="sm:col-span-2"><Label>Позиции вручную (запасной ввод): по одной в строке, поля через |</Label>
              <Textarea rows={4} className="font-mono text-xs" value={priceText} onChange={(e) => setPriceText(e.target.value)}
                placeholder={"Название | цена от | единица | зона | задачи через ; | страница | фото\nЩебень гранитный 20-40 | 1900 | т | самовывоз | дорога; фундамент | https://site.ru/sheben | https://site.ru/img/sheben.jpg"} /></div>
            <div className="sm:col-span-2"><Label>Страница прайса на сайте</Label><Input value={info.priceSource} onChange={set("priceSource")} placeholder="https://.../price" /></div>
            <div className="sm:col-span-2"><Label>Фото с сайта клиента (URL, по одному в строке; чужие домены отбрасываются)</Label><Textarea rows={2} className="font-mono text-xs" value={photoText} onChange={(e) => setPhotoText(e.target.value)} /></div>
            <div className="sm:col-span-2"><Label>Условия доставки (по одному в строке)</Label><Textarea rows={2} value={info.deliveryRules} onChange={set("deliveryRules")} /></div>
            <div className="sm:col-span-2"><Label>Расчет объема (только подтвержденное клиентом)</Label><Textarea rows={2} value={info.calculationNotes} onChange={set("calculationNotes")} /></div>
            <div className="sm:col-span-2 pt-2 border-t border-border text-sm font-medium">Адреса и контакты (для документа «География и контакты»; пустые поля не попадут в текст)</div>
            <div className="sm:col-span-2"><Label>Адрес головного офиса</Label><Input value={contacts.address} onChange={setC("address")} /></div>
            <div className="sm:col-span-2"><Label>Склады (по одному в строке)</Label><Textarea rows={2} value={contacts.warehouses} onChange={setC("warehouses")} /></div>
            <div><Label>Телефон отдела продаж</Label><Input value={contacts.phoneSales} onChange={setC("phoneSales")} /></div>
            <div><Label>Почта отдела продаж</Label><Input value={contacts.emailSales} onChange={setC("emailSales")} /></div>
            <div><Label>Телефон поддержки</Label><Input value={contacts.phoneSupport} onChange={setC("phoneSupport")} /></div>
            <div><Label>Почта поддержки</Label><Input value={contacts.emailSupport} onChange={setC("emailSupport")} /></div>
            <div className="sm:col-span-2"><Label>Режим работы</Label><Input value={contacts.workHours} onChange={setC("workHours")} placeholder="Пн-Пт 9:00-18:00" /></div>
            <div><Label>Ответственный за факты</Label><Input value={info.owner} onChange={set("owner")} placeholder="технический специалист компании" /></div>
            <div><Label>GitHub-владелец</Label><Input value={info.githubOwner} onChange={set("githubOwner")} placeholder="microgrin71-sudo" /></div>
            <div><Label>Путь llms.txt на сайте</Label><Input value={info.llmsPath} onChange={set("llmsPath")} placeholder="/llms.txt" /></div>
            <div><Label>Имя репозитория</Label><Input value={info.repoName} onChange={set("repoName")} placeholder={input.repoName} /></div>
            <div className="sm:col-span-2 flex justify-end"><Button onClick={goPlan}>Далее</Button></div>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader><CardTitle>Тематический план ({docs.length} документов, по ТЗ 7-10)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {docs.map((d, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-12 items-start border border-border rounded-md p-3">
                <Input className="sm:col-span-3 font-mono text-xs" value={d.slug} onChange={(e) => updDoc(i, "slug", e.target.value)} />
                <Input className="sm:col-span-3" value={d.title} onChange={(e) => updDoc(i, "title", e.target.value)} />
                <Input className="sm:col-span-5" value={d.sitePage} onChange={(e) => updDoc(i, "sitePage", e.target.value)} placeholder="Страница сайта" />
                <Button className="sm:col-span-1" variant="ghost" size="icon" onClick={() => setDocs((p) => p.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                <Input className="sm:col-span-4" value={d.task} onChange={(e) => updDoc(i, "task", e.target.value)} placeholder="Задача документа" />
                <Textarea className="sm:col-span-8" rows={2} value={d.directAnswer} onChange={(e) => updDoc(i, "directAnswer", e.target.value)} placeholder="Прямой ответ (первый абзац)" />
              </div>
            ))}
            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={() => setDocs((p) => [...p, { slug: "section/new-doc", title: "Новый документ", task: "", priority: "P2", sitePage: info.site, directAnswer: "" }])}>
                <Plus className="h-4 w-4 mr-1" />Документ
              </Button>
              <Button onClick={() => setStep(2)}>Далее</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader><CardTitle>Факты ({facts.length}, подтверждено {confirmedCount})</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Страницы сайта для сбора фактов (до 10, по одной в строке)</Label>
              <Textarea rows={4} value={urls} onChange={(e) => setUrls(e.target.value)} className="font-mono text-xs" />
              <Button className="mt-2" onClick={extract} disabled={loading}>
                <Sparkles className="h-4 w-4 mr-1" />{loading ? "Собираю..." : "Собрать факты с сайта"}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">Факт подтверждается автоматически, только если телефон, почта, ИНН или значение дословно найдены на странице-источнике. Остальное - "требует уточнения".</p>
            </div>
            {facts.length > 0 && (
              <div className="overflow-x-auto border border-border rounded-md">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-left">
                      <th className="p-2 font-medium">ID</th>
                      <th className="p-2 font-medium">Тема</th>
                      <th className="p-2 font-medium min-w-[220px]">Утверждение</th>
                      <th className="p-2 font-medium min-w-[120px]">Параметр</th>
                      <th className="p-2 font-medium w-20">Единица</th>
                      <th className="p-2 font-medium w-24">Значение</th>
                      <th className="p-2 font-medium min-w-[120px]">Стандарт</th>
                      <th className="p-2 font-medium min-w-[160px]">Источник</th>
                      <th className="p-2 font-medium">Статус</th>
                      <th className="p-2 font-medium">Документ</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {facts.map((f, i) => (
                      <tr key={f.id} className="border-b border-border last:border-0 align-top">
                        <td className="p-2 font-mono text-muted-foreground whitespace-nowrap">{f.id}</td>
                        <td className="p-2"><Badge variant="outline">{f.topic}</Badge></td>
                        <td className="p-2"><Input value={f.statement} onChange={(e) => updFact(i, { statement: e.target.value })} className="h-8 text-xs" /></td>
                        <td className="p-2"><Input value={f.parameter} onChange={(e) => updFact(i, { parameter: e.target.value })} className="h-8 text-xs" placeholder="-" /></td>
                        <td className="p-2"><Input value={f.unit} onChange={(e) => updFact(i, { unit: e.target.value })} className="h-8 text-xs" placeholder="-" /></td>
                        <td className="p-2"><Input value={f.value} onChange={(e) => updFact(i, { value: e.target.value })} className="h-8 text-xs" placeholder="-" /></td>
                        <td className="p-2"><Input value={f.standard} onChange={(e) => updFact(i, { standard: e.target.value })} className="h-8 text-xs" placeholder="только с документом" /></td>
                        <td className="p-2"><Input value={f.source_url} onChange={(e) => updFact(i, { source_url: e.target.value })} className="h-8 font-mono text-xs" placeholder="URL" /></td>
                        <td className="p-2">
                          <Button size="sm" variant={f.status === "confirmed" ? "default" : "outline"} className="h-8 whitespace-nowrap"
                            onClick={() => updFact(i, { status: f.status === "confirmed" ? "needs_confirmation" : "confirmed" })}>
                            {f.status === "confirmed" ? "Подтвержден" : "Уточнить"}
                          </Button>
                        </td>
                        <td className="p-2">
                          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.doc} onChange={(e) => updFact(i, { doc: e.target.value })}>
                            <option value="">реестр</option>
                            {docs.map((d) => <option key={d.slug} value={d.slug}>{d.slug}</option>)}
                          </select>
                        </td>
                        <td className="p-2">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setFacts((p) => p.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => setFacts((p) => [...p, { id: `F-${String(p.length + 1).padStart(3, "0")}`, topic: "other", statement: "", parameter: "", unit: "", value: "", standard: "", source_url: "", status: "needs_confirmation", doc: "" }])}>
              <Plus className="h-4 w-4 mr-1" />Факт вручную
            </Button>

            <div className="pt-4 border-t border-border space-y-2">
              <Label>Словарь терминов ({glossary.length}, нужно минимум 5)</Label>
              {glossary.map((t, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-12">
                  <Input className="sm:col-span-3" value={t.term} onChange={(e) => updTerm(i, "term", e.target.value)} placeholder="РВД" />
                  <Input className="sm:col-span-5" value={t.definition} onChange={(e) => updTerm(i, "definition", e.target.value)} placeholder="Определение" />
                  <Input className="sm:col-span-3" value={t.context} onChange={(e) => updTerm(i, "context", e.target.value)} placeholder="Где применяется" />
                  <Button className="sm:col-span-1" size="icon" variant="ghost" onClick={() => setGlossary((p) => p.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setGlossary((p) => [...p, { term: "", definition: "", context: "" }])}><Plus className="h-4 w-4 mr-1" />Термин</Button>
                <Button variant="outline" size="sm" disabled={glossLoading} onClick={genGlossary}><Sparkles className="h-4 w-4 mr-1" />{glossLoading ? "Подбираем термины..." : "Подобрать термины ИИ"}</Button>
              </div>
              <p className="text-xs text-muted-foreground">ИИ предлагает термины по тематике, продуктам и фактам. Проверьте определения перед экспортом.</p>
            </div>

            <div className="pt-4 border-t border-border space-y-2">
              <Label>Карта связей: запрос к ИИ -&gt; документ -&gt; страница сайта</Label>
              <Textarea value={bulkQ} onChange={(e) => setBulkQ(e.target.value)} rows={4}
                placeholder={"Вставьте вопросы списком, по одному в строке (можно из Excel или с нумерацией)"} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={importQueries} disabled={!bulkQ.trim()}><Sparkles className="h-4 w-4 mr-1" />Добавить и связать</Button>
                <Button size="sm" variant="outline" onClick={relinkAll} disabled={!queries.length}>Пересчитать связи для всех</Button>
                {queries.length > 0 && <Button size="sm" variant="ghost" onClick={() => setQueries([])}>Очистить</Button>}
              </div>
              {queries.map((q, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-12">
                  <Input className="sm:col-span-5" value={q.query} onChange={(e) => updQuery(i, "query", e.target.value)} placeholder="как подобрать РВД по давлению" />
                  <select className="sm:col-span-3 h-10 rounded-md border border-input bg-background px-2 text-xs" value={q.doc} onChange={(e) => updQuery(i, "doc", e.target.value)}>
                    <option value="">документ</option>
                    {docs.map((d) => <option key={d.slug} value={d.slug}>{d.slug}</option>)}
                  </select>
                  <Input className="sm:col-span-3" value={q.sitePage} onChange={(e) => updQuery(i, "sitePage", e.target.value)} placeholder="страница сайта" />
                  <Button className="sm:col-span-1" size="icon" variant="ghost" onClick={() => setQueries((p) => p.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <div className="flex justify-between">
                <Button variant="outline" size="sm" onClick={() => setQueries((p) => [...p, { query: "", doc: "", sitePage: info.site }])}><Plus className="h-4 w-4 mr-1" />Запрос</Button>
                <Button onClick={() => setStep(3)}>Далее</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader><CardTitle>Архив для GitHub</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm space-y-1">
              <div>Документов: {docs.length}. Фактов: {facts.length} (подтверждено {confirmedCount}). Запросов: {queries.length}.</div>
              {validation.ok
                ? <div className="text-primary">Все проверки пройдены</div>
                : <ul className="list-disc pl-5 text-destructive">{validation.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
            </div>
            <p className="text-xs text-muted-foreground">В архиве: README, llms.txt (и site/llms.txt для размещения на сайте), docs/, data/ (facts, products, source-register, query-map, glossary, faq; при наличии данных - selection-matrix, delivery, technical-parameters), assets/prices.svg, sources/, CHANGELOG, CONTRIBUTING, LICENSE, REPORT. Неподтвержденные факты публикуются с пометкой [требует уточнения].</p>
            <Button onClick={download} disabled={!info.companyName || !info.site}><Download className="h-4 w-4 mr-1" />Скачать ZIP</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
