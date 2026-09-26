import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { ArrowLeft, BookOpen, Download, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  buildKnowledgeBase, defaultDocs, validateKb,
  type KbContacts, type KbDoc, type KbFact, type KbInput, type KbQuery, type KbTerm,
} from "@/features/knowledge-base/buildKnowledgeBase";

const STEPS = ["Данные клиента", "Тематический план", "Факты", "Архив"];
const today = () => new Date().toISOString().slice(0, 10);

export default function KnowledgeBasePage() {
  const [step, setStep] = useState(0);
  const [info, setInfo] = useState({
    companyName: "", legalName: "", site: "", city: "", region: "", geographyNote: "",
    description: "", contactsPage: "", owner: "", repoName: "", license: "CC-BY-4.0" as KbInput["license"],
    yearsOnMarket: "", productsServices: "",
  });
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
    repoName: info.repoName || `${(info.site.replace(/^https?:\/\//, "").replace(/\W+/g, "-") || "company")}-technical-knowledge-base`,
    docs, facts, queries, contacts, glossary, checkedAt: today(),
  }), [info, docs, facts, queries, contacts, glossary]);
  const validation = useMemo(() => validateKb(input), [input]);

  const goPlan = () => {
    if (!docs.length) setDocs(defaultDocs(info.site || "https://"));
    if (!urls.trim() && info.site) setUrls(info.site);
    setStep(1);
  };

  const extract = async () => {
    const list = urls.split(/\s+/).map((u) => u.trim()).filter(Boolean);
    if (!list.length) return toast({ title: "Добавьте ссылки на страницы сайта", variant: "destructive" });
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("kb-fact-extract", { body: { urls: list } });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      const start = facts.length;
      const docFor = (topic: string) => {
        const find = (p: string) => docs.find((d) => d.slug.startsWith(p))?.slug || "";
        if (["company"].includes(topic)) return find("company/company-profile");
        if (["geography", "contacts"].includes(topic)) return find("company/geography");
        if (topic === "certification") return find("company/cert");
        if (topic === "standard") return docs.find((d) => /standard/.test(d.slug))?.slug || "";
        if (topic === "service") return find("services/");
        if (topic === "parameter") return docs.find((d) => /selection/.test(d.slug))?.slug || "";
        if (topic === "product") return docs.find((d) => /what-is/.test(d.slug))?.slug || "";
        return "";
      };
      const incoming: KbFact[] = (data.facts || []).map((f: Omit<KbFact, "id" | "status" | "doc">, i: number) => ({
        ...f, id: `F-${String(start + i + 1).padStart(3, "0")}`, status: "needs_confirmation", doc: docFor(f.topic),
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
      toast({ title: `Найдено фактов: ${incoming.length}`, description: data.failed?.length ? `Не прочитано страниц: ${data.failed.length}` : "Все факты помечены как требующие уточнения" });
    } catch (e) {
      toast({ title: "Ошибка сбора фактов", description: (e as Error).message, variant: "destructive" });
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
      </div>

      {step === 0 && (
        <Card>
          <CardHeader><CardTitle>Данные клиента</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div><Label>Название компании</Label><Input value={info.companyName} onChange={set("companyName")} placeholder="Завод Гидрокомплект" /></div>
            <div><Label>Полное юр. наименование</Label><Input value={info.legalName} onChange={set("legalName")} placeholder="после подтверждения реквизитов" /></div>
            <div><Label>Официальный сайт</Label><Input value={info.site} onChange={set("site")} placeholder="https://rvd174.ru" /></div>
            <div><Label>Страница контактов</Label><Input value={info.contactsPage} onChange={set("contactsPage")} placeholder="https://.../contacts" /></div>
            <div><Label>Город</Label><Input value={info.city} onChange={set("city")} placeholder="Челябинск" /></div>
            <div><Label>Регион</Label><Input value={info.region} onChange={set("region")} placeholder="Челябинская область" /></div>
            <div className="sm:col-span-2"><Label>География (только если подтверждена)</Label><Input value={info.geographyNote} onChange={set("geographyNote")} placeholder="поставка по России" /></div>
            <div className="sm:col-span-2"><Label>Краткое описание (2-4 предложения, без оценок)</Label><Textarea value={info.description} onChange={set("description")} rows={3} /></div>
            <div className="sm:col-span-2 pt-2 border-t border-border text-sm font-medium">Адреса и контакты (для документа «География и контакты»; пустые поля не попадут в текст)</div>
            <div className="sm:col-span-2"><Label>Адрес головного офиса</Label><Input value={contacts.address} onChange={setC("address")} /></div>
            <div className="sm:col-span-2"><Label>Склады (по одному в строке)</Label><Textarea rows={2} value={contacts.warehouses} onChange={setC("warehouses")} /></div>
            <div><Label>Телефон отдела продаж</Label><Input value={contacts.phoneSales} onChange={setC("phoneSales")} /></div>
            <div><Label>Почта отдела продаж</Label><Input value={contacts.emailSales} onChange={setC("emailSales")} /></div>
            <div><Label>Телефон поддержки</Label><Input value={contacts.phoneSupport} onChange={setC("phoneSupport")} /></div>
            <div><Label>Почта поддержки</Label><Input value={contacts.emailSupport} onChange={setC("emailSupport")} /></div>
            <div className="sm:col-span-2"><Label>Режим работы</Label><Input value={contacts.workHours} onChange={setC("workHours")} placeholder="Пн-Пт 9:00-18:00" /></div>
            <div><Label>Ответственный за факты</Label><Input value={info.owner} onChange={set("owner")} placeholder="технический специалист компании" /></div>
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
              <p className="text-xs text-muted-foreground mt-1">Все собранные факты получают статус "требует уточнения". Подтверждайте только то, что проверено у компании или по документу.</p>
            </div>
            {facts.map((f, i) => (
              <div key={f.id} className="border border-border rounded-md p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-muted-foreground">{f.id}</span>
                  <Badge variant="outline">{f.topic}</Badge>
                  <Button size="sm" variant={f.status === "confirmed" ? "default" : "outline"}
                    onClick={() => updFact(i, { status: f.status === "confirmed" ? "needs_confirmation" : "confirmed" })}>
                    {f.status === "confirmed" ? "Подтвержден" : "Требует уточнения"}
                  </Button>
                  <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.doc} onChange={(e) => updFact(i, { doc: e.target.value })}>
                    <option value="">только реестр</option>
                    {docs.map((d) => <option key={d.slug} value={d.slug}>{d.slug}</option>)}
                  </select>
                  <Button size="icon" variant="ghost" className="ml-auto" onClick={() => setFacts((p) => p.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <Input value={f.statement} onChange={(e) => updFact(i, { statement: e.target.value })} />
                <div className="grid gap-2 sm:grid-cols-4">
                  <Input value={f.parameter} onChange={(e) => updFact(i, { parameter: e.target.value })} placeholder="Параметр" />
                  <Input value={f.value} onChange={(e) => updFact(i, { value: e.target.value })} placeholder="Значение" />
                  <Input value={f.unit} onChange={(e) => updFact(i, { unit: e.target.value })} placeholder="Единица" />
                  <Input value={f.standard} onChange={(e) => updFact(i, { standard: e.target.value })} placeholder="Стандарт (только если есть документ)" />
                </div>
                <Input value={f.source_url} onChange={(e) => updFact(i, { source_url: e.target.value })} className="font-mono text-xs" placeholder="URL источника" />
              </div>
            ))}
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
              <Button variant="outline" size="sm" onClick={() => setGlossary((p) => [...p, { term: "", definition: "", context: "" }])}><Plus className="h-4 w-4 mr-1" />Термин</Button>
            </div>

            <div className="pt-4 border-t border-border space-y-2">
              <Label>Карта связей: запрос к ИИ -&gt; документ -&gt; страница сайта</Label>
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
            <p className="text-xs text-muted-foreground">В архиве: README, llms.txt (и site/llms.txt для размещения на сайте), docs/, data/ (facts, source-register, query-map, glossary, faq, technical-parameters), sources/, CHANGELOG, CONTRIBUTING, LICENSE, REPORT. Неподтвержденные факты публикуются с пометкой [требует уточнения].</p>
            <Button onClick={download} disabled={!info.companyName || !info.site}><Download className="h-4 w-4 mr-1" />Скачать ZIP</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
