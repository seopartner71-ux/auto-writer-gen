/**
 * Edge Function proxy interceptor.
 * Patches global fetch so that requests to Supabase Edge Functions
 * are routed through the PHP proxy on seo-modul.pro,
 * avoiding geo-blocks in Russia.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const FUNCTIONS_PREFIX = `${SUPABASE_URL}/functions/v1/`;

// Proxy is co-located with the frontend on Beget
const PROXY_BASE = 'https://seo-modul.pro/api/proxy.php';

const nativeFetch = window.fetch.bind(window);

function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let url: string;

  if (typeof input === 'string') {
    url = input;
  } else if (input instanceof URL) {
    url = input.href;
  } else {
    url = (input as Request).url;
  }

  // Only intercept Edge Function calls
  if (url.startsWith(FUNCTIONS_PREFIX)) {
    const functionName = url.slice(FUNCTIONS_PREFIX.length).split('?')[0];
    const proxyUrl = `${PROXY_BASE}?function=${encodeURIComponent(functionName)}`;

    // Clone init to avoid mutating the original
    const proxyInit: RequestInit = { ...init };

    return nativeFetch(proxyUrl, proxyInit);
  }

  return nativeFetch(input, init);
}

export function installEdgeProxy(): void {
  // Only install in production (when hosted on seo-modul.pro)
  // In dev / preview on lovable.app, Supabase is accessible directly
  const hostname = window.location.hostname;
  if (hostname.includes('seo-modul.pro') || hostname.includes('beget.')) {
    (window as any).fetch = patchedFetch;
    console.info('[EdgeProxy] Installed — routing Edge Functions through proxy');
  }
}
