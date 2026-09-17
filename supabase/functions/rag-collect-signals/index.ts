// Admin-only: collects verifiable public signals for a list of domains
// (client + competitors) and converts them to the frozen 0/2/4/6/8/10 scale.
// No paid APIs: plain HTTP fetch + RDAP for domain age.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, requireAdminOrStaff } from "../_shared/auth.ts";

interface ReqBody { domains?: string[] }

type Score = 0 | 2 | 4 | 6 | 8 | 10 | "NE";

interface SignalOut {
  key: string;
  label: string;
  score: Score;
  observed: string;
  evidence: string;
}

interface DomainOut {
  domain: string;
  reachable: boolean;
  error?: string;
  collected_at: string;
  signals: SignalOut[];
}

const MAX_DOMAINS = 6;
const FETCH_TIMEOUT = 12_000;

function clean(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .trim()
    .toLowerCase();
}

async function get(url: string): Promise<{ ok: boolean; status: number; body: string; ms: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "RAG-Benchmark-Collector/1.0 (+research)" },
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body, ms: Date.now() - started };
  } catch (_e) {
    return { ok: false, status: 0, body: "", ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      out.push({ __invalid: true });
    }
  }
  return out;
}

function typesOf(blocks: unknown[]): string[] {
  const types: string[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      const o = n as Record<string, unknown>;
      const t = o["@type"];
      if (typeof t === "string") types.push(t);
      if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.push(x));
      if (Array.isArray(o["@graph"])) walk(o["@graph"]);
    }
  };
  blocks.forEach(walk);
  return [...new Set(types)];
}

async function domainAgeDays(domain: string): Promise<number | null> {
  const res = await get(`https://rdap.org/domain/${domain}`);
  if (!res.ok) return null;
  try {
    const data = JSON.parse(res.body);
    const ev = Array.isArray(data?.events) ? data.events : [];
    const reg = ev.find((e: Record<string, string>) => e.eventAction === "registration");
    if (!reg?.eventDate) return null;
    const ms = Date.now() - new Date(reg.eventDate).getTime();
    return Math.max(0, Math.round(ms / 86_400_000));
  } catch {
    return null;
  }
}

async function collect(domain: string): Promise<DomainOut> {
  const collected_at = new Date().toISOString().slice(0, 10);
  const base = `https://${domain}`;
  const home = await get(`${base}/`);

  if (!home.body) {
    return { domain, reachable: false, error: `HTTP ${home.status || "no response"}`, collected_at, signals: [] };
  }

  const html = home.body;
  const lower = html.toLowerCase();
  const signals: SignalOut[] = [];
  const push = (key: string, label: string, score: Score, observed: string, evidence: string) =>
    signals.push({ key, label, score, observed, evidence });

  /* HTTPS availability */
  push(
    "Https_Availability_Score",
    "Доступность сайта по HTTPS",
    home.ok ? 10 : 4,
    `HTTP ${home.status}`,
    `${base}/`,
  );

  /* Structured data */
  const blocks = jsonLdBlocks(html);
  const types = typesOf(blocks);
  const hasOrg = types.some((t) => /Organization|LocalBusiness|Store/i.test(t));
  const hasLocal = types.some((t) => /LocalBusiness|Store/i.test(t));
  const invalid = blocks.some((b) => (b as Record<string, unknown>)?.__invalid);
  const sdScore: Score = blocks.length === 0 ? 0 : invalid ? 4 : hasLocal ? 10 : hasOrg ? 8 : 6;
  push(
    "Structured_Data_Score",
    "Полнота разметки Schema.org",
    sdScore,
    blocks.length === 0 ? "разметка не найдена" : `блоков: ${blocks.length}; типы: ${types.join(", ") || "не определены"}`,
    `${base}/`,
  );

  /* Contact disclosure */
  const hasPhone = /(tel:\+?\d|\+7\s?\(?\d{3})/i.test(html);
  const hasEmail = /mailto:[^"'\s>]+@/i.test(html);
  const hasAddress = /(адрес|г\.\s?[А-ЯЁ]|ул\.\s|проспект|шоссе)/i.test(html);
  const hasLegal = /(ИНН|ОГРН|ООО\s|ИП\s)/.test(html);
  const contactPoints = [hasPhone, hasEmail, hasAddress, hasLegal].filter(Boolean).length;
  push(
    "Contact_Transparency_Score",
    "Прозрачность контактных и юридических данных",
    ([0, 4, 6, 8, 10] as Score[])[contactPoints],
    `телефон:${hasPhone ? "да" : "нет"}; email:${hasEmail ? "да" : "нет"}; адрес:${hasAddress ? "да" : "нет"}; реквизиты:${hasLegal ? "да" : "нет"}`,
    `${base}/`,
  );

  /* Meta completeness */
  const title = /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const desc = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,400})["']/i.exec(html)?.[1]?.trim() ?? "";
  const og = /property=["']og:(title|description|image)["']/i.test(html);
  const metaPoints = [title.length >= 10, desc.length >= 40, og].filter(Boolean).length;
  push(
    "Meta_Completeness_Score",
    "Полнота метаданных страницы",
    ([0, 4, 8, 10] as Score[])[metaPoints],
    `title:${title.length} симв.; description:${desc.length} симв.; og-теги:${og ? "да" : "нет"}`,
    `${base}/`,
  );

  /* Mobile readiness */
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  push(
    "Mobile_Readiness_Score",
    "Готовность к мобильным устройствам",
    viewport ? 10 : 0,
    viewport ? "viewport задан" : "viewport отсутствует",
    `${base}/`,
  );

  /* Response speed: median of three probes, so one network spike cannot set the score. */
  const probes = [home.ms];
  for (let i = 0; i < 2; i++) {
    const extra = await get(`${base}/?rag_probe=${i + 1}`);
    if (extra.body || extra.status > 0) probes.push(extra.ms);
  }
  const sorted = [...probes].sort((a, b) => a - b);
  const ms = sorted[Math.floor(sorted.length / 2)];
  const speed: Score = ms < 400 ? 10 : ms < 800 ? 8 : ms < 1500 ? 6 : ms < 3000 ? 4 : 2;
  push(
    "Response_Speed_Score",
    "Скорость ответа главной страницы",
    speed,
    `медиана ${ms} мс по ${probes.length} замерам (${sorted.join("/")} мс)`,
    `${base}/`,
  );


  /* Internal link depth */
  const links = [...lower.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/g)].map((m) => m[1]);
  const internal = new Set(links.filter((h) => h.startsWith("/") || h.includes(domain)));
  const linkScore: Score = internal.size >= 120 ? 10 : internal.size >= 60 ? 8 : internal.size >= 25 ? 6 : internal.size >= 10 ? 4 : 2;
  push("Site_Structure_Score", "Глубина внутренней структуры сайта", linkScore, `внутренних ссылок: ${internal.size}`, `${base}/`);

  /* Crawlability: robots + sitemap */
  const [robots, sitemap] = await Promise.all([get(`${base}/robots.txt`), get(`${base}/sitemap.xml`)]);
  const robotsOk = robots.ok && /user-agent/i.test(robots.body);
  const sitemapOk = sitemap.ok && /<(urlset|sitemapindex)/i.test(sitemap.body);
  const crawl: Score = robotsOk && sitemapOk ? 10 : sitemapOk ? 8 : robotsOk ? 6 : 0;
  push(
    "Crawlability_Score",
    "Техническая доступность для индексации",
    crawl,
    `robots.txt:${robotsOk ? "да" : "нет"}; sitemap.xml:${sitemapOk ? "да" : "нет"}`,
    `${base}/robots.txt`,
  );

  /* Domain age */
  const age = await domainAgeDays(domain);
  const years = age === null ? null : age / 365;
  const ageScore: Score =
    years === null ? "NE" : years >= 10 ? 10 : years >= 6 ? 8 : years >= 3 ? 6 : years >= 1 ? 4 : 2;
  push(
    "Market_Presence_Score",
    "Возраст домена как признак присутствия на рынке",
    ageScore,
    years === null ? "регистрация не подтверждена (NOT_ESTABLISHED)" : `${years.toFixed(1)} лет`,
    `https://rdap.org/domain/${domain}`,
  );

  return { domain, reachable: true, collected_at, signals };
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const forbidden = await requireAdminOrStaff(auth);
    if (forbidden) return forbidden;

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const domains = [...new Set((body.domains ?? []).map(clean).filter(Boolean))].slice(0, MAX_DOMAINS);
    if (domains.length === 0) return errorResponse("Не передан ни один домен", 400);

    const results = await Promise.all(domains.map(collect));
    return jsonResponse({ collected_at: new Date().toISOString(), domains: results });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "collect failed", 500);
  }
});
