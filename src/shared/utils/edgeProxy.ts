/**
 * Edge Function proxy interceptor.
 * Patches global fetch so that requests to Supabase Edge Functions
 * are routed through the PHP proxy on seo-modul.pro,
 * avoiding geo-blocks in Russia.
 */

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
const PROXY_BASE = "/api/proxy.php";

const nativeFetch = window.fetch.bind(window);

function isPreviewHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".lovable.app") ||
    hostname.endsWith(".lovableproject.com") ||
    hostname.endsWith(".lovable.dev")
  );
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}

function toProxyRequestInit(input: RequestInfo | URL, init?: RequestInit): RequestInit {
  if (!(input instanceof Request)) {
    return init ? { ...init } : {};
  }

  const headers = new Headers(input.headers);

  if (init?.headers) {
    const overrideHeaders = new Headers(init.headers);
    overrideHeaders.forEach((value, key) => headers.set(key, value));
  }

  const method = init?.method ?? input.method;
  const hasBody = !["GET", "HEAD"].includes(method.toUpperCase());

  return {
    method,
    headers,
    body: init?.body ?? (hasBody ? input.clone().body ?? undefined : undefined),
    credentials: init?.credentials ?? input.credentials,
    cache: init?.cache ?? input.cache,
    integrity: init?.integrity ?? input.integrity,
    keepalive: init?.keepalive ?? input.keepalive,
    mode: init?.mode ?? input.mode,
    redirect: init?.redirect ?? input.redirect,
    referrer: init?.referrer ?? input.referrer,
    referrerPolicy: init?.referrerPolicy ?? input.referrerPolicy,
    signal: init?.signal ?? input.signal,
  };
}

let proxyHealthy: boolean | null = null; // null = unknown, true = works, false = broken

async function checkProxyHealth(): Promise<boolean> {
  if (proxyHealthy !== null) return proxyHealthy;
  try {
    const res = await nativeFetch(`${PROXY_BASE}?path=${encodeURIComponent("/auth/v1/settings")}`, {
      method: "GET",
      headers: { "apikey": (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) },
    });
    // If we get HTML back (404 page), proxy is broken
    const ct = res.headers.get("content-type") || "";
    proxyHealthy = res.ok && ct.includes("application/json");
  } catch {
    proxyHealthy = false;
  }
  console.info("[EdgeProxy] Health check:", proxyHealthy ? "OK" : "FAILED — will use direct requests");
  return proxyHealthy;
}

function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = resolveRequestUrl(input);

  if (url.startsWith(SUPABASE_URL)) {
    // If proxy is known to be broken, go direct
    if (proxyHealthy === false) {
      return nativeFetch(input, init);
    }

    const upstreamPath = url.slice(SUPABASE_URL.length);
    const proxyUrl = `${PROXY_BASE}?path=${encodeURIComponent(upstreamPath)}`;

    console.info("[EdgeProxy] Proxying:", upstreamPath.slice(0, 80));

    return nativeFetch(proxyUrl, toProxyRequestInit(input, init)).then((res) => {
      // Detect HTML error pages (proxy misconfigured / 404)
      const ct = res.headers.get("content-type") || "";
      if (!res.ok && ct.includes("text/html")) {
        console.warn("[EdgeProxy] Proxy returned HTML error, falling back to direct request");
        proxyHealthy = false;
        return nativeFetch(input, init);
      }
      return res;
    }).catch((err) => {
      console.warn("[EdgeProxy] Proxy network error, falling back to direct:", err.message);
      proxyHealthy = false;
      return nativeFetch(input, init);
    });
  }

  return nativeFetch(input, init);
}

export function installEdgeProxy(): void {
  const hostname = window.location.hostname;

  if (!isPreviewHost(hostname)) {
    window.fetch = patchedFetch as typeof window.fetch;
    (globalThis as typeof window).fetch = patchedFetch as typeof fetch;
    console.info("[EdgeProxy] Installed on", hostname, "— proxying ALL backend requests through", PROXY_BASE);
  } else {
    console.info("[EdgeProxy] Skipped — preview host:", hostname);
  }
}
