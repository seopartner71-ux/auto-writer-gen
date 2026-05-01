import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, Search, ChevronDown, ExternalLink, CheckCircle2, Loader2, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Row = {
  id?: string;
  domain: string;
  score: number;
  tf: number;
  cf: number;
  bl: number;
  age_years: number;
  archive_first_date: string | null;
  archive_last_date?: string | null;
  archive_has_snapshots: boolean;
  google_indexed: boolean;
  google_results_count?: number;
  spam_listed: boolean;
  status?: string;
  assigned_project_id?: string | null;
  raw_csv_data?: Record<string, unknown>;
};

type CsvRow = {
  domain: string;
  tf: number;
  cf: number;
  bl: number;
  age_years: number;
  raw: Record<string, unknown>;
};

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const splitLine = (line: string) => {
    // simple CSV split: handle quoted fields
    const out: string[] = [];
    let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if ((ch === "," || ch === ";" || ch === "\t") && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim().replace(/^"|"$/g, ""));
  };
  const headers = splitLine(lines[0]).map(h => h.toLowerCase());
  const idx = (names: string[]) => {
    for (const n of names) {
      const i = headers.findIndex(h => h === n || h.replace(/[\s_-]/g, "") === n.replace(/[\s_-]/g, ""));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iDomain = idx(["domain", "domainname"]);
  const iTF = idx(["majestictf", "tf", "trustflow"]);
  const iCF = idx(["majesticcf", "cf", "citationflow"]);
  const iBL = idx(["bl", "backlinks", "majesticbacklinks"]);
  const iAge = idx(["domainage", "age", "domainpop"]);
  const iReg = idx(["registered", "firstregistered"]);

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const domain = (iDomain >= 0 ? cells[iDomain] : cells[0]) || "";
    if (!domain) continue;
    let age_years = 0;
    if (iAge >= 0 && cells[iAge]) {
      const n = parseInt(cells[iAge].replace(/[^\d]/g, ""), 10);
      if (!isNaN(n)) age_years = n;
    } else if (iReg >= 0 && cells[iReg]) {
      const m = cells[iReg].match(/(\d{4})/);
      if (m) age_years = Math.max(0, new Date().getFullYear() - parseInt(m[1], 10));
    }
    const raw: Record<string, unknown> = {};
    headers.forEach((h, k) => { raw[h] = cells[k]; });
    rows.push({
      domain,
      tf: iTF >= 0 ? parseInt(cells[iTF], 10) || 0 : 0,
      cf: iCF >= 0 ? parseInt(cells[iCF], 10) || 0 : 0,
      bl: iBL >= 0 ? parseInt(cells[iBL], 10) || 0 : 0,
      age_years,
      raw,
    });
  }
  return rows;
}

const SPAM_KEYWORDS = ["casino", "kazino", "porn", "xxx", "viagra", "cialis", "pharm", "rx", "bet", "poker", "slot"];

function scoreColor(s: number) {
  if (s >= 80) return "text-success";
  if (s >= 60) return "text-yellow-400";
  if (s >= 40) return "text-orange-400";
  return "text-destructive";
}
function scoreLabel(s: number) {
  if (s >= 80) return "Отличный";
  if (s >= 60) return "Хороший";
  if (s >= 40) return "Средний";
  return "Плохой";
}

export default function DomainHunterPage() {
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [minTF, setMinTF] = useState(10);
  const [minCF, setMinCF] = useState(10);
  const [minBL, setMinBL] = useState(5);
  const [maxBL, setMaxBL] = useState(1000);
  const [zone, setZone] = useState<"all" | ".ru" | ".com">("all");
  const [excludeBad, setExcludeBad] = useState(true);
  const [results, setResults] = useState<Row[]>([]);
  const [history, setHistory] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [assignFor, setAssignFor] = useState<Row | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; domain: string | null; custom_domain: string | null }>>([]);

  useEffect(() => {
    void loadHistory();
    void loadProjects();
  }, []);

  async function loadHistory() {
    const { data } = await supabase
      .from("domain_checks")
      .select("*")
      .order("checked_at", { ascending: false })
      .limit(100);
    if (data) setHistory(data as unknown as Row[]);
  }

  async function loadProjects() {
    const { data } = await supabase
      .from("projects")
      .select("id, name, domain, custom_domain")
      .order("created_at", { ascending: false });
    if (data) setProjects(data as any);
  }

  function onFile(file: File) {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const rows = parseCsv(text);
      setCsvRows(rows);
      toast.success(`Загружено доменов: ${rows.length}`);
    };
    reader.readAsText(file);
  }

  const filtered = useMemo(() => {
    return csvRows.filter(r => {
      if (r.tf < minTF) return false;
      if (r.cf < minCF) return false;
      if (r.bl < minBL || r.bl > maxBL) return false;
      if (zone !== "all" && !r.domain.toLowerCase().endsWith(zone)) return false;
      if (excludeBad) {
        const d = r.domain.toLowerCase();
        if (SPAM_KEYWORDS.some(k => d.includes(k))) return false;
      }
      return true;
    });
  }, [csvRows, minTF, minCF, minBL, maxBL, zone, excludeBad]);

  async function runCheck() {
    if (!filtered.length) { toast.error("Нет доменов после фильтрации"); return; }
    setRunning(true);
    setResults([]);
    setProgress({ done: 0, total: filtered.length });

    try {
      const chunkSize = 10;
      const acc: Row[] = [];
      for (let i = 0; i < filtered.length; i += chunkSize) {
        const slice = filtered.slice(i, i + chunkSize);
        const { data, error } = await supabase.functions.invoke("check-aged-domain", {
          body: { domains: slice },
        });
        if (error) {
          toast.error(`Ошибка проверки: ${error.message}`);
          break;
        }
        const got: Row[] = (data?.results || []) as Row[];
        acc.push(...got);
        setResults([...acc].sort((a, b) => b.score - a.score));
        setProgress({ done: Math.min(i + chunkSize, filtered.length), total: filtered.length });
      }
      toast.success("Проверка завершена");
      void loadHistory();
    } finally {
      setRunning(false);
    }
  }

  async function assignDomain(projectId: string) {
    if (!assignFor) return;
    const { error } = await supabase
      .from("projects")
      .update({ custom_domain: assignFor.domain })
      .eq("id", projectId);
    if (error) { toast.error(error.message); return; }
    if (assignFor.id) {
      await supabase.from("domain_checks")
        .update({ status: "selected", assigned_project_id: projectId })
        .eq("id", assignFor.id);
    }
    toast.success(`Домен ${assignFor.domain} назначен на проект`);
    setAssignFor(null);
    void loadHistory();
    void loadProjects();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Search className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Поиск aged доменов</h1>
          <p className="text-sm text-muted-foreground">Загрузи CSV с ExpiredDomains.net и получи топ доменов под PBN</p>
        </div>
      </div>

      <Collapsible>
        <Card>
          <CollapsibleTrigger className="w-full">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" /> Как получить CSV (инструкция)
              </CardTitle>
              <ChevronDown className="h-4 w-4" />
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>1. Зайди на expireddomains.net и зарегистрируйся (бесплатно).</p>
              <p>2. Перейди в Deleted Domains -&gt; .ru или .com.</p>
              <p>3. Выставь фильтры: Min Majestic TF: 10, Min BL: 5, Listed: No.</p>
              <p>4. Нажми Export CSV.</p>
              <p>5. Загрузи файл сюда.</p>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Card>
        <CardHeader><CardTitle className="text-base">Загрузка CSV</CardTitle></CardHeader>
        <CardContent>
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-8 cursor-pointer hover:bg-muted/30 transition">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm">{fileName || "Перетащи CSV или кликни для выбора"}</span>
            {csvRows.length > 0 && (
              <span className="text-xs text-muted-foreground">Распознано {csvRows.length} доменов</span>
            )}
            <input type="file" accept=".csv,text/csv" className="hidden"
              onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Фильтры</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div><Label>Min TF</Label><Input type="number" value={minTF} onChange={e => setMinTF(+e.target.value)} /></div>
          <div><Label>Min CF</Label><Input type="number" value={minCF} onChange={e => setMinCF(+e.target.value)} /></div>
          <div><Label>Min BL</Label><Input type="number" value={minBL} onChange={e => setMinBL(+e.target.value)} /></div>
          <div><Label>Max BL</Label><Input type="number" value={maxBL} onChange={e => setMaxBL(+e.target.value)} /></div>
          <div>
            <Label>Зона</Label>
            <Select value={zone} onValueChange={v => setZone(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value=".ru">.ru</SelectItem>
                <SelectItem value=".com">.com</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Checkbox id="ex" checked={excludeBad} onCheckedChange={v => setExcludeBad(!!v)} />
            <Label htmlFor="ex" className="text-xs">Исключить казино/фарма/адалт</Label>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={runCheck} disabled={running || !filtered.length}>
          {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
          Проверить домены ({filtered.length})
        </Button>
        {running && (
          <div className="flex-1 max-w-md">
            <Progress value={(progress.done / Math.max(progress.total, 1)) * 100} />
            <p className="text-xs text-muted-foreground mt-1">Проверено {progress.done} из {progress.total}</p>
          </div>
        )}
      </div>

      {(results.length > 0 || history.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{results.length > 0 ? "Результаты" : "История проверок"}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Домен</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>TF/CF</TableHead>
                  <TableHead>BL</TableHead>
                  <TableHead>Возраст</TableHead>
                  <TableHead>Archive</TableHead>
                  <TableHead>Google</TableHead>
                  <TableHead>Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(results.length ? results : history).map(r => (
                  <TableRow key={(r.id || r.domain) + r.score}>
                    <TableCell className="font-mono text-xs">{r.domain}</TableCell>
                    <TableCell>
                      <span className={`font-bold ${scoreColor(r.score)}`}>{r.score}</span>
                      <span className="text-xs text-muted-foreground ml-1">{scoreLabel(r.score)}</span>
                    </TableCell>
                    <TableCell className="text-xs">{r.tf}/{r.cf}</TableCell>
                    <TableCell className="text-xs">{r.bl}</TableCell>
                    <TableCell className="text-xs">{r.age_years} л.</TableCell>
                    <TableCell>
                      {r.archive_has_snapshots
                        ? <Badge variant="secondary" className="text-xs">{r.archive_first_date?.slice(0,4) || "✓"}</Badge>
                        : <Badge variant="outline" className="text-xs">нет</Badge>}
                    </TableCell>
                    <TableCell>
                      {r.google_indexed
                        ? <Badge className="text-xs bg-success/20 text-success">в индексе</Badge>
                        : <Badge variant="outline" className="text-xs">нет</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" asChild title="Archive">
                          <a href={`https://web.archive.org/web/*/${r.domain}`} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" /></a>
                        </Button>
                        <Button size="sm" variant="ghost" asChild title="Majestic">
                          <a href={`https://majestic.com/reports/site-explorer?q=${r.domain}`} target="_blank" rel="noreferrer">M</a>
                        </Button>
                        <Button size="sm" variant="ghost" asChild title="Reg.ru">
                          <a href={`https://www.reg.ru/domain/new/check_browse?dname=${r.domain}`} target="_blank" rel="noreferrer">R</a>
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setAssignFor(r)}>
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Выбрать
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!assignFor} onOpenChange={o => !o && setAssignFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Назначить {assignFor?.domain} на проект</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-auto">
            {projects.filter(p => !p.custom_domain).length === 0 && (
              <p className="text-sm text-muted-foreground">Нет проектов без назначенного домена.</p>
            )}
            {projects.filter(p => !p.custom_domain).map(p => (
              <Button key={p.id} variant="outline" className="w-full justify-between" onClick={() => assignDomain(p.id)}>
                <span>{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.domain || "—"}</span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}