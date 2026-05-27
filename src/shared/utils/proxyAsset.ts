/**
 * Rewrites Supabase storage / functions URLs to go through the PHP proxy
 * on production (Beget). Needed because <img>, <a download>, etc.
 * bypass the global fetch interceptor and would hit supabase.co directly
 * (blocked in Russia without VPN).
 */
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
const PROXY_BASE = "/api/proxy.php";

function isPreviewHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".lovable.app") ||
    hostname.endsWith(".lovableproject.com") ||
    hostname.endsWith(".lovable.dev")
  );
}

export function proxyAssetUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (typeof window === "undefined") return url;
  if (isPreviewHost(window.location.hostname)) return url;
  if (!url.startsWith(SUPABASE_URL)) return url;
  const path = url.slice(SUPABASE_URL.length);
  return `${PROXY_BASE}?path=${encodeURIComponent(path)}`;
}