// Unsplash API helper for site factory.
// Looks up the access key from app_settings.unsplash_access_key, fetches a pool
// of topical photos, and returns a randomized subset. On any failure, returns
// an empty array — callers must keep their existing fallbacks.

const NICHE_TRANSLATIONS: Record<string, string> = {
  // Russian niche → English Unsplash query
  "цветы": "flowers bouquet",
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
  if (!accessKey || count <= 0) return [];
  const query = nicheToUnsplashQuery(niche);
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