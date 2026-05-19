// Unsplash API helper for site factory.
// Looks up the access key from app_settings.unsplash_access_key, fetches a pool
// of topical photos, and returns a randomized subset. On any failure, returns
// an empty array — callers must keep their existing fallbacks.

const NICHE_TRANSLATIONS: Record<string, string> = {
  // Russian niche → English Unsplash query
  "цветы": "flowers bouquet",
  "цветок": "flowers bouquet",
  "букет": "flower bouquet",
  "розы": "roses garden",
  "роза": "roses garden",
  "кустовые розы": "rose bush garden",
  "пионы": "peonies flowers",
  "тюльпаны": "tulips flowers",
  "сад": "garden plants",
  "огород": "vegetable garden",
  "растения": "plants greenery",
  "минитрактор": "mini tractor farm",
  "минитрактора": "mini tractor farm",
  "трактор": "tractor farm",
  "трактора": "tractor farm",
  "газовые колонки": "water heater boiler",
  "газовая колонка": "water heater boiler",
  "юридические услуги": "lawyer office",
  "юрист": "lawyer office",
  "медицина": "doctor medical clinic",
  "клиника": "doctor medical clinic",
  "стоматология": "dentist clinic",
  "ремонт": "home renovation tools",
  "недвижимость": "real estate house",
  "автосервис": "car service garage",
  "автомобили": "modern car",
  "красота": "beauty salon spa",
  "косметология": "cosmetology clinic spa",
  "фитнес": "fitness gym workout",
  "образование": "classroom learning students",
  "обучение": "classroom learning students",
  "строительство": "construction site building",
  "доставка": "delivery courier package",
  "ресторан": "restaurant interior food",
  "кафе": "cafe coffee interior",
  "одежда": "fashion clothing store",
  "мебель": "modern furniture interior",
  "финансы": "finance business office",
  "консалтинг": "business consulting office",
  "ит": "technology office computers",
  "разработка": "software developer laptop",
};

function isCyrillic(s: string): boolean {
  return /[\u0400-\u04FF]/.test(s);
}

/** Best-effort Russian → English query mapping for Unsplash. */
export function nicheToUnsplashQuery(raw: string): string {
  const niche = String(raw || "").trim().toLowerCase();
  if (!niche) return "business";
  if (NICHE_TRANSLATIONS[niche]) return NICHE_TRANSLATIONS[niche];
  // partial match
  for (const [ru, en] of Object.entries(NICHE_TRANSLATIONS)) {
    if (niche.includes(ru)) return en;
  }
  // ASCII path: assume already English
  if (!isCyrillic(niche)) return niche.slice(0, 80);
  // Last resort: strip cyrillic, fallback to "business"
  return "business";
}

// In-memory cache for AI translations within a single function invocation.
const AI_QUERY_CACHE = new Map<string, string>();

/**
 * Uses Lovable AI (Gemini Flash Lite via OpenRouter) to extract 2-3 English
 * keywords suitable for a Pexels/Unsplash photo query from a Russian title or
 * niche string. Falls back to the dictionary mapping on any failure.
 */
export async function aiTranslateToPhotoQuery(raw: string): Promise<string> {
  const input = String(raw || "").trim();
  if (!input) return "business";
  // If it's already English / no cyrillic, just clean and return.
  if (!isCyrillic(input)) {
    const dict = nicheToUnsplashQuery(input);
    return dict;
  }
  const cacheKey = input.toLowerCase().slice(0, 200);
  if (AI_QUERY_CACHE.has(cacheKey)) return AI_QUERY_CACHE.get(cacheKey)!;

  const apiKey = (Deno.env.get("OPENROUTER_API_KEY") || "").trim();
  if (!apiKey) return nicheToUnsplashQuery(input);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content:
              "You convert a Russian topic/title into a SHORT English photo search query (2-4 concrete visual keywords). Output ONLY the keywords separated by spaces. No quotes, no punctuation, no explanation. Focus on the visible subject (object, place, activity), not abstract words.",
          },
          { role: "user", content: input.slice(0, 200) },
        ],
        temperature: 0.2,
        max_tokens: 24,
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn("[photo-query] AI HTTP", res.status);
      return nicheToUnsplashQuery(input);
    }
    const data = await res.json();
    let q = String(data?.choices?.[0]?.message?.content || "").trim();
    q = q.replace(/["'`.,!?:;()]+/g, " ").replace(/\s{2,}/g, " ").trim().toLowerCase();
    if (!q || isCyrillic(q)) return nicheToUnsplashQuery(input);
    q = q.split(/\s+/).slice(0, 5).join(" ").slice(0, 80);
    AI_QUERY_CACHE.set(cacheKey, q);
    return q;
  } catch (e: any) {
    console.warn("[photo-query] AI error:", e?.message);
    return nicheToUnsplashQuery(input);
  }
}

export async function getUnsplashKey(admin: any): Promise<string | null> {
  try {
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "unsplash_access_key")
      .maybeSingle();
    const v = String(data?.value || "").trim();
    return v || null;
  } catch {
    return null;
  }
}

export interface UnsplashPhoto {
  url: string;        // urls.regular (~1080px)
  thumb: string;      // urls.small
  authorName: string;
  authorUrl: string;  // links.html for the user
  photoUrl: string;   // links.html for the photo
  alt: string;
}

/**
 * Fetches up to `count` randomized photos from Unsplash for the given niche.
 * Returns [] if the key is missing or the API fails — caller must fallback.
 */
export async function fetchUnsplashPhotos(
  accessKey: string | null,
  niche: string,
  count: number,
): Promise<UnsplashPhoto[]> {
  if (count <= 0) return [];
  const query = nicheToUnsplashQuery(niche);

  // Prefer Pexels if its API key is configured (env secret).
  const pexelsKey = (Deno.env.get("PEXELS_API_KEY") || "").trim();
  if (pexelsKey) {
    const pexels = await fetchPexelsPhotos(pexelsKey, query, count);
    if (pexels.length > 0) return pexels;
    // Try a broader fallback query if first attempt yielded nothing.
    const broader = query.split(/\s+/)[0] || "business";
    if (broader && broader !== query) {
      const retry = await fetchPexelsPhotos(pexelsKey, broader, count);
      if (retry.length > 0) return retry;
    }
  }

  if (!accessKey) return [];
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=30&orientation=landscape&content_filter=high&client_id=${encodeURIComponent(accessKey)}`;
    const res = await fetch(url, { headers: { "Accept-Version": "v1" } });
    if (!res.ok) {
      console.warn("[unsplash] HTTP", res.status, await res.text().catch(() => ""));
      return [];
    }
    const json = await res.json();
    const items: any[] = Array.isArray(json?.results) ? json.results : [];
    const photos: UnsplashPhoto[] = items
      .filter((p) => p?.urls?.regular)
      .map((p) => ({
        url: String(p.urls.regular),
        thumb: String(p.urls.small || p.urls.regular),
        authorName: String(p.user?.name || "Unsplash"),
        authorUrl: String(p.user?.links?.html || "https://unsplash.com"),
        photoUrl: String(p.links?.html || "https://unsplash.com"),
        alt: String(p.alt_description || p.description || query),
      }));
    // Shuffle and take `count`
    for (let i = photos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [photos[i], photos[j]] = [photos[j], photos[i]];
    }
    return photos.slice(0, count);
  } catch (e: any) {
    console.warn("[unsplash] fetch error:", e?.message);
    return [];
  }
}

/**
 * Fetches up to `count` photos from Pexels for the given English query.
 * Returned shape matches UnsplashPhoto so callers don't have to branch.
 * Author/photo URLs point to pexels.com (license requires attribution).
 */
export async function fetchPexelsPhotos(
  apiKey: string,
  query: string,
  count: number,
): Promise<UnsplashPhoto[]> {
  if (!apiKey || count <= 0 || !query) return [];
  try {
    const perPage = Math.min(80, Math.max(5, count * 3));
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
    const res = await fetch(url, { headers: { Authorization: apiKey } });
    if (!res.ok) {
      console.warn("[pexels] HTTP", res.status, await res.text().catch(() => ""));
      return [];
    }
    const json = await res.json();
    const items: any[] = Array.isArray(json?.photos) ? json.photos : [];
    if (items.length === 0) {
      console.warn("[pexels] no photos for query:", query);
      return [];
    }
    const photos: UnsplashPhoto[] = items
      .filter((p) => p?.src?.large || p?.src?.large2x || p?.src?.original)
      .map((p) => ({
        url: String(p.src.large2x || p.src.large || p.src.original),
        thumb: String(p.src.medium || p.src.small || p.src.large || ""),
        authorName: String(p.photographer || "Pexels"),
        authorUrl: String(p.photographer_url || "https://www.pexels.com"),
        photoUrl: String(p.url || "https://www.pexels.com"),
        alt: String(p.alt || query),
      }));
    // Shuffle and take `count`.
    for (let i = photos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [photos[i], photos[j]] = [photos[j], photos[i]];
    }
    return photos.slice(0, count);
  } catch (e: any) {
    console.warn("[pexels] fetch error:", e?.message);
    return [];
  }
}