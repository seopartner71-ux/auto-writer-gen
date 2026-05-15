// Deno port of src/shared/utils/contentValidator.ts (regex-only).
// Used in server-side generation pipelines (bulk-generate, process-queue)
// where the client-side validator can't run. Pure functions, no I/O.

export interface ValidationIssue {
  type: "fake_expert" | "pseudo_stat" | "fake_company";
  original: string;
  replacement: string;
}
export interface ValidationResult {
  status: "clean" | "fixed";
  issues: ValidationIssue[];
  fixedContent: string;
}

const RU_EXPERT_NAME = /(?:по (?:словам|мнению|данным|оценкам|наблюдениям)|как (?:отмечает|считает|утверждает|говорит|заявляет|подчеркивает|поясняет)|(?:эксперт|специалист|профессор|доктор|к\.м\.н\.|к\.т\.н\.|д\.м\.н\.|академик|руководитель|директор|глава|основатель|CEO|CTO)\s+)?([А-ЯЁ][а-яё]+\s+(?:[А-ЯЁ][а-яё]+\s+)?[А-ЯЁ][а-яё]+)(?:\s*,\s*(?:эксперт|специалист|руководитель|директор|основатель|профессор|доктор|к\.м\.н\.|к\.т\.н\.|д\.м\.н\.|глава|CEO|CTO|ведущий|старший|главный)[^.;"\n]*)?/g;
const EN_EXPERT_NAME = /(?:according to|says|notes|explains|states|argues|believes|(?:Dr\.|Prof\.|Professor|Mr\.|Mrs\.|Ms\.)\s+)?([A-Z][a-z]{2,}\s+(?:[A-Z]\.?\s+)?[A-Z][a-z]{2,})(?:\s*,\s*(?:expert|specialist|professor|doctor|CEO|CTO|founder|director|head|chief|senior|lead|managing)[^.;"\n]*)?/g;
const PSEUDO_STAT_PATTERNS: RegExp[] = [
  /(\d{2,3}(?:[.,]\d{1,2})?%)\s+(?:случаев|пользователей|людей|компаний|респондентов|клиентов|покупателей|экспертов|опрошенных|владельцев|потребителей|заказчиков)/gi,
  /(?:исследовани[еяю]\s+(?:показал[оиа]|выявил[оиа]|подтвердил[оиа]|установил[оиа]))/gi,
  /по данным (?:компании|агентства|организации|центра|института)\s+(?:«[^»]+»|"[^"]+"|[А-ЯA-Z][а-яa-z]+(?:\s+[А-ЯA-Z][а-яa-z]+)*)/gi,
  /(\d{2,3}(?:\.\d{1,2})?%)\s+of\s+(?:users|people|companies|respondents|customers|consumers|businesses)/gi,
  /(?:a\s+)?(?:recent\s+)?(?:study|research|survey|report)\s+(?:shows?|found|reveals?|suggests?|indicates?|confirms?)/gi,
];
const FAKE_ORG_PATTERNS: RegExp[] = [
  /(?:компания|агентство|институт|центр|лаборатория|фонд|ассоциация|бюро)\s+(?:«[^»]+»|"[^"]+")/gi,
  /(?:согласно|по данным)\s+(?:[А-ЯA-Z][а-яa-z]+(?:\s+[А-ЯA-Z][а-яa-z]+){0,2}\s+(?:University|Institute|Lab|Center|Research|Foundation|Agency|Corporation|Inc\.|Ltd\.|GmbH|Corp\.))/gi,
];
const SAFE = new Set([
  "Google","Yandex","Яндекс","Apple","Microsoft","Amazon","Meta","Facebook","YouTube","Wikipedia","WordPress","Ahrefs","Semrush","Moz","ChatGPT","OpenAI","Telegram","WhatsApp","Instagram","Twitter",
]);
const RU_EXPERT_R = ["по наблюдениям опытных специалистов","практика показывает","специалисты отрасли отмечают","по данным отраслевых опросов"];
const EN_EXPERT_R = ["according to experienced practitioners","practice shows","industry specialists note","based on industry surveys"];
const RU_STAT_R = ["в большинстве случаев","как правило","по наблюдениям специалистов","обычно"];
const EN_STAT_R = ["in most cases","as a rule","typically","according to specialists' observations"];

function pick<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }
function isSafe(name: string) { return SAFE.has(name.trim()) || SAFE.has(name.split(/\s+/)[0]); }
function inLink(text: string, idx: number) {
  const before = text.slice(Math.max(0, idx - 200), idx);
  return before.lastIndexOf("[") > before.lastIndexOf("]");
}

export function validateContent(content: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!content || content.length > 200_000) {
    return { status: "clean", issues, fixedContent: content };
  }
  const isRu = /[а-яё]/i.test(content);
  let m: RegExpExecArray | null;

  const ruP = new RegExp(RU_EXPERT_NAME.source, "g");
  while ((m = ruP.exec(content)) !== null) {
    const full = m[0]; const name = m[1];
    if (!name || isSafe(name) || inLink(content, m.index)) continue;
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2 || !parts.every(p => /^[А-ЯЁ]/.test(p))) continue;
    issues.push({ type: "fake_expert", original: full, replacement: pick(RU_EXPERT_R) });
  }
  const enP = new RegExp(EN_EXPERT_NAME.source, "g");
  while ((m = enP.exec(content)) !== null) {
    const full = m[0]; const name = m[1];
    if (!name || isSafe(name) || inLink(content, m.index)) continue;
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2 || !parts.every(p => /^[A-Z]/.test(p))) continue;
    const ls = content.lastIndexOf("\n", m.index) + 1;
    if (content[ls] === "#") continue;
    issues.push({ type: "fake_expert", original: full, replacement: pick(EN_EXPERT_R) });
  }
  for (const pat of PSEUDO_STAT_PATTERNS) {
    const r = new RegExp(pat.source, "gi");
    while ((m = r.exec(content)) !== null) {
      issues.push({ type: "pseudo_stat", original: m[0], replacement: pick(isRu ? RU_STAT_R : EN_STAT_R) });
    }
  }
  for (const pat of FAKE_ORG_PATTERNS) {
    const r = new RegExp(pat.source, "gi");
    while ((m = r.exec(content)) !== null) {
      const last = m[0].split(/\s+/).pop() || "";
      if (SAFE.has(last)) continue;
      issues.push({
        type: "fake_company",
        original: m[0],
        replacement: isRu ? pick(["по отраслевым данным","по наблюдениям специалистов","практика показывает"])
                          : pick(["according to industry data","based on professional observations","practice shows"]),
      });
    }
  }

  let fixed = content;
  if (issues.length) {
    const sorted = [...issues].sort((a, b) => content.indexOf(b.original) - content.indexOf(a.original));
    for (const i of sorted) fixed = fixed.replace(i.original, i.replacement);
  }
  return { status: issues.length ? "fixed" : "clean", issues, fixedContent: fixed };
}

// ─── Data Nuggets coverage ─────────────────────────────────────────
// Returns share (0..1) of provided nuggets that appear in the article body.
// A nugget "matches" if its core numeric token (or its first 3 significant words) appears.
export function dataNuggetsCoverage(content: string, nuggets: Array<string | { fact?: string; text?: string }>): {
  total: number; matched: number; ratio: number; missing: string[];
} {
  const lower = content.toLowerCase();
  const missing: string[] = [];
  let matched = 0;
  const items = (nuggets || []).map(n => typeof n === "string" ? n : (n?.fact || n?.text || "")).filter(Boolean);
  for (const raw of items) {
    const txt = String(raw).toLowerCase();
    const num = txt.match(/\d+(?:[.,]\d+)?\s*%?/);
    let hit = false;
    if (num && lower.includes(num[0].replace(/\s+/g, ""))) hit = true;
    if (!hit) {
      const tokens = txt.split(/[^a-zа-яё0-9]+/i).filter(t => t.length >= 4).slice(0, 3);
      hit = tokens.length > 0 && tokens.every(t => lower.includes(t));
    }
    if (hit) matched++; else missing.push(String(raw).slice(0, 80));
  }
  return { total: items.length, matched, ratio: items.length ? matched / items.length : 1, missing };
}

// ─── Persona syntax profile delta ──────────────────────────────────
export type SyntaxProfile = "practitioner" | "academic" | "blogger" | "journalist" | "default";

export function measureSyntax(content: string): { avgSentLen: number; varianceRatio: number; lexDiversity: number } {
  const text = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
    .replace(/[#*_>`|-]+/g, " ");
  const sents = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 5);
  if (!sents.length) return { avgSentLen: 0, varianceRatio: 0, lexDiversity: 0 };
  const lens = sents.map(s => s.split(/\s+/).filter(Boolean).length);
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
  const variance = lens.reduce((a, b) => a + (b - avg) ** 2, 0) / lens.length;
  const stdDev = Math.sqrt(variance);
  const varianceRatio = avg > 0 ? stdDev / avg : 0;
  const words = text.toLowerCase().split(/[^a-zа-яё0-9]+/i).filter(w => w.length > 2);
  const unique = new Set(words);
  const lexDiversity = words.length ? unique.size / words.length : 0;
  return { avgSentLen: avg, varianceRatio, lexDiversity };
}

/**
 * Returns 0..1 deviation between expected profile target ranges and measured stats.
 * 0 = perfect match, 1 = totally off.
 */
export function personaProfileDeviation(content: string, expected: SyntaxProfile | undefined | null): {
  deviation: number; measured: ReturnType<typeof measureSyntax>; expected: SyntaxProfile;
} {
  const m = measureSyntax(content);
  const exp: SyntaxProfile = (expected || "default") as SyntaxProfile;
  // Target avg sentence length per profile (words).
  const targetAvg: Record<SyntaxProfile, number> = {
    practitioner: 11, academic: 22, blogger: 9, journalist: 14, default: 14,
  };
  const targetVar: Record<SyntaxProfile, number> = {
    practitioner: 0.55, academic: 0.30, blogger: 0.65, journalist: 0.45, default: 0.45,
  };
  if (m.avgSentLen === 0) return { deviation: 0, measured: m, expected: exp };
  const tA = targetAvg[exp]; const tV = targetVar[exp];
  const dA = Math.min(1, Math.abs(m.avgSentLen - tA) / tA);
  const dV = Math.min(1, Math.abs(m.varianceRatio - tV) / Math.max(0.2, tV));
  // Weighted: avg length matters more than variance.
  const deviation = Math.min(1, dA * 0.7 + dV * 0.3);
  return { deviation, measured: m, expected: exp };
}