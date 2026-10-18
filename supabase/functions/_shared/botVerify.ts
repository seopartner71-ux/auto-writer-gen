// Reverse-DNS verification of bot IPs.
// A bot is "verified" only when the IP's PTR hostname ends with the official
// domain of that crawler AND the hostname resolves back to the same IP
// (forward-confirmed reverse DNS). Anything else claiming a known bot name is
// "spoofed". Bots without a documented rDNS scheme stay "unknown".
// Raw IPs are never stored: only the result and the PTR hostname.

export type BotVerification = "verified" | "spoofed" | "unknown";

// Official PTR suffixes per crawler, keyed by lowercase UA needle
// (must match monitor_bot_signatures.ua_pattern).
const OFFICIAL_RDNS: Record<string, string[]> = {
  gptbot: ["openai.com"],
  "oai-searchbot": ["openai.com"],
  "chatgpt-user": ["openai.com"],
  googlebot: ["googlebot.com", "google.com"],
  "google-extended": ["google.com"],
  bingbot: ["search.msn.com"],
  yandexbot: ["yandex.ru", "yandex.net", "yandex.com"],
  yandexsearch: ["yandex.ru", "yandex.net", "yandex.com"],
  applebot: ["applebot.apple.com"],
  "mail.ru_bot": ["mail.ru"],
};

export function verifiableSuffixes(uaPattern: string): string[] | null {
  return OFFICIAL_RDNS[uaPattern.toLowerCase()] ?? null;
}

async function dns(name: string, type: string, timeoutMs = 2500): Promise<string[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { signal: ctrl.signal });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.Answer ?? []).map((a: { data?: string }) => String(a.data ?? "").replace(/\.$/, "")).filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

function ptrName(ip: string): string | null {
  const parts = ip.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return parts.reverse().join(".") + ".in-addr.arpa";
}

export interface VerifyResult {
  result: BotVerification;
  rdnsHost: string | null;
}

export async function verifyBotIp(ip: string, uaPattern: string): Promise<VerifyResult> {
  const suffixes = verifiableSuffixes(uaPattern);
  if (!suffixes) return { result: "unknown", rdnsHost: null };
  const rev = ptrName(ip.trim());
  if (!rev) return { result: "unknown", rdnsHost: null };

  const ptrs = await dns(rev, "PTR");
  if (!ptrs.length) return { result: "spoofed", rdnsHost: null };

  for (const host of ptrs) {
    const h = host.toLowerCase();
    if (!suffixes.some((s) => h === s || h.endsWith("." + s))) continue;
    // Forward-confirm: the hostname must resolve back to the same IP.
    const addrs = await dns(host, "A");
    if (addrs.includes(ip.trim())) return { result: "verified", rdnsHost: host };
  }
  return { result: "spoofed", rdnsHost: ptrs[0] };
}
