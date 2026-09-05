import { supabase } from "@/integrations/supabase/client";
import { defaultMonitorConfig } from "./constants";

export interface MonitorRow {
  id: string;
  name: string;
  domain: string;
  is_active: boolean;
  project_id: string | null;
  created_at: string;
}

export interface PageRow {
  id: string;
  monitor_id: string;
  url: string;
  label: string | null;
  frequency: string;
  is_enabled: boolean;
  status: string;
  last_error: string | null;
  last_checked_at: string | null;
  next_check_at: string;
  monitor_config: Record<string, boolean> | null;
}

export interface ChangeRow {
  id: string;
  page_id: string;
  monitor_id: string;
  detected_at: string;
  severity: string;
  score: number;
  summary: Record<string, unknown>;
  diff: Record<string, unknown>;
  ai_analysis: Record<string, unknown> | null;
  is_read: boolean;
}

export function normalizeDomain(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

export function isValidPageUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname.includes(".");
  } catch {
    return false;
  }
}

export async function fetchMonitors(): Promise<MonitorRow[]> {
  const { data, error } = await supabase
    .from("competitor_monitors")
    .select("id,name,domain,is_active,project_id,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as MonitorRow[];
}

export async function fetchPages(monitorId?: string): Promise<PageRow[]> {
  let q = supabase
    .from("competitor_pages")
    .select("id,monitor_id,url,label,frequency,is_enabled,status,last_error,last_checked_at,next_check_at,monitor_config")
    .order("created_at", { ascending: false });
  if (monitorId) q = q.eq("monitor_id", monitorId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as unknown as PageRow[];
}

export async function fetchChanges(opts: { pageId?: string; limit?: number; offset?: number; onlyImportant?: boolean } = {}) {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  let q = supabase
    .from("competitor_changes")
    .select("id,page_id,monitor_id,detected_at,severity,score,summary,diff,ai_analysis,is_read", { count: "exact" })
    .order("detected_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (opts.pageId) q = q.eq("page_id", opts.pageId);
  if (opts.onlyImportant) q = q.in("severity", ["high", "critical"]);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data || []) as unknown as ChangeRow[], total: count ?? 0 };
}

export async function createMonitor(input: {
  name: string;
  domain: string;
  projectId: string | null;
  pages: { url: string; label: string; frequency: string }[];
  monitorConfig: Record<string, boolean>;
}) {
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes?.user?.id;
  if (!userId) throw new Error("Требуется вход в аккаунт");

  const { data: monitor, error } = await supabase
    .from("competitor_monitors")
    .insert({ user_id: userId, name: input.name, domain: normalizeDomain(input.domain), project_id: input.projectId })
    .select("id")
    .single();
  if (error) throw error;

  if (input.pages.length) {
    const { error: pErr } = await supabase.from("competitor_pages").insert(
      input.pages.map(p => ({
        monitor_id: monitor.id,
        user_id: userId,
        url: p.url.trim(),
        label: p.label?.trim() || null,
        frequency: p.frequency,
        monitor_config: input.monitorConfig,
        next_check_at: new Date().toISOString(),
      })),
    );
    if (pErr) throw pErr;
  }
  return monitor.id as string;
}

export async function addPages(monitorId: string, pages: { url: string; label: string; frequency: string }[], monitorConfig?: Record<string, boolean>) {
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes?.user?.id;
  if (!userId) throw new Error("Требуется вход в аккаунт");
  const { error } = await supabase.from("competitor_pages").insert(
    pages.map(p => ({
      monitor_id: monitorId,
      user_id: userId,
      url: p.url.trim(),
      label: p.label?.trim() || null,
      frequency: p.frequency,
      monitor_config: monitorConfig || defaultMonitorConfig(),
      next_check_at: new Date().toISOString(),
    })),
  );
  if (error) throw error;
}

export async function runCheck(pageId: string) {
  const { data, error } = await supabase.functions.invoke("competitor-monitor", {
    body: { mode: "check", page_id: pageId },
  });
  if (error) throw error;
  return data as { ok: boolean; results: { status: string; detail?: string }[] };
}

export async function fetchSnapshot(pageId: string) {
  const { data, error } = await supabase
    .from("competitor_snapshots")
    .select("id,checked_at,title,description,h1,word_count,headings,faq,images,internal_links,external_links,canonical,robots,is_baseline")
    .eq("page_id", pageId)
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchDashboardStats() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const [monitors, pages, week, important] = await Promise.all([
    supabase.from("competitor_monitors").select("id", { count: "exact", head: true }),
    supabase.from("competitor_pages").select("id", { count: "exact", head: true }),
    supabase.from("competitor_changes").select("id", { count: "exact", head: true }).gte("detected_at", weekAgo),
    supabase.from("competitor_changes").select("id", { count: "exact", head: true }).in("severity", ["high", "critical"]).gte("detected_at", weekAgo),
  ]);
  return {
    competitors: monitors.count ?? 0,
    pages: pages.count ?? 0,
    changesThisWeek: week.count ?? 0,
    importantChanges: important.count ?? 0,
  };
}
