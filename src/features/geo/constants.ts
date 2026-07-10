// Locale-aware GEO/LANG constants.
// - City names are localized ru/en pairs (EN users see Moscow/Kyiv, RU users see Москва/Київ).
// - Language options use endonyms (Русский, 中文) as is standard for language pickers worldwide.
// This file is data — excluded from lint:i18n. UI strings live in i18n namespaces.

export interface CityPair {
  ru: string;
  en: string;
}

export interface GeoOption {
  value: string;
  labelKey: string;
  cities: CityPair[];
}

const P = (ru: string, en: string): CityPair => ({ ru, en });

export const GEO_OPTIONS: GeoOption[] = [
  { value: "us", labelKey: "geo.us", cities: ["New York", "Los Angeles", "Chicago", "Houston", "Miami", "San Francisco", "Seattle", "Boston", "Dallas", "Denver", "Atlanta", "Phoenix", "Philadelphia", "San Diego", "Austin", "Las Vegas"].map((c) => P(c, c)) },
  { value: "gb", labelKey: "geo.gb", cities: ["London", "Manchester", "Birmingham", "Leeds", "Edinburgh", "Glasgow", "Liverpool", "Bristol", "Cardiff", "Belfast"].map((c) => P(c, c)) },
  { value: "de", labelKey: "geo.de", cities: ["Berlin", "Munich", "Hamburg", "Frankfurt", "Cologne", "Stuttgart", "Düsseldorf", "Dresden", "Leipzig", "Hannover"].map((c) => P(c, c)) },
  { value: "fr", labelKey: "geo.fr", cities: ["Paris", "Lyon", "Marseille", "Toulouse", "Nice", "Bordeaux", "Nantes", "Strasbourg", "Montpellier", "Lille"].map((c) => P(c, c)) },
  { value: "ru", labelKey: "geo.ru", cities: [
    P("Москва", "Moscow"), P("Санкт-Петербург", "Saint Petersburg"), P("Новосибирск", "Novosibirsk"),
    P("Екатеринбург", "Yekaterinburg"), P("Казань", "Kazan"), P("Краснодар", "Krasnodar"),
    P("Нижний Новгород", "Nizhny Novgorod"), P("Самара", "Samara"), P("Ростов-на-Дону", "Rostov-on-Don"),
    P("Уфа", "Ufa"), P("Челябинск", "Chelyabinsk"), P("Воронеж", "Voronezh"),
    P("Красноярск", "Krasnoyarsk"), P("Пермь", "Perm"), P("Волгоград", "Volgograd"), P("Тюмень", "Tyumen"),
  ] },
  { value: "ua", labelKey: "geo.ua", cities: [
    P("Київ", "Kyiv"), P("Харків", "Kharkiv"), P("Одеса", "Odesa"), P("Дніпро", "Dnipro"),
    P("Львів", "Lviv"), P("Запоріжжя", "Zaporizhzhia"), P("Вінниця", "Vinnytsia"),
    P("Полтава", "Poltava"), P("Чернігів", "Chernihiv"), P("Миколаїв", "Mykolaiv"),
  ] },
  { value: "br", labelKey: "geo.br", cities: ["São Paulo", "Rio de Janeiro", "Brasília", "Salvador", "Curitiba", "Belo Horizonte", "Fortaleza", "Recife", "Porto Alegre", "Manaus"].map((c) => P(c, c)) },
  { value: "in", labelKey: "geo.in", cities: ["Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai", "Kolkata", "Pune", "Ahmedabad", "Jaipur", "Lucknow"].map((c) => P(c, c)) },
  { value: "jp", labelKey: "geo.jp", cities: ["Tokyo", "Osaka", "Yokohama", "Nagoya", "Kyoto", "Fukuoka", "Sapporo", "Kobe", "Hiroshima", "Sendai"].map((c) => P(c, c)) },
  { value: "es", labelKey: "geo.es", cities: ["Madrid", "Barcelona", "Valencia", "Seville", "Málaga", "Bilbao", "Zaragoza", "Alicante", "Murcia", "Granada"].map((c) => P(c, c)) },
  { value: "co", labelKey: "geo.co", cities: ["Bogotá", "Medellín", "Cali", "Barranquilla", "Cartagena", "Bucaramanga", "Pereira", "Santa Marta", "Cúcuta", "Manizales"].map((c) => P(c, c)) },
  { value: "mx", labelKey: "geo.mx", cities: ["Ciudad de México", "Guadalajara", "Monterrey", "Cancún", "Puebla", "Tijuana", "Mérida", "León", "Querétaro", "Oaxaca"].map((c) => P(c, c)) },
  { value: "ar", labelKey: "geo.ar", cities: ["Buenos Aires", "Córdoba", "Rosario", "Mendoza", "Mar del Plata", "Tucumán", "La Plata", "Salta", "Bariloche"].map((c) => P(c, c)) },
  { value: "it", labelKey: "geo.it", cities: ["Rome", "Milan", "Naples", "Turin", "Florence", "Bologna", "Venice", "Genoa", "Palermo", "Verona"].map((c) => P(c, c)) },
  { value: "tr", labelKey: "geo.tr", cities: ["Istanbul", "Ankara", "Izmir", "Antalya", "Bursa", "Adana", "Konya", "Gaziantep"].map((c) => P(c, c)) },
  { value: "pl", labelKey: "geo.pl", cities: ["Warsaw", "Kraków", "Wrocław", "Gdańsk", "Poznań", "Łódź", "Katowice", "Lublin"].map((c) => P(c, c)) },
  { value: "kz", labelKey: "geo.kz", cities: [
    P("Алматы", "Almaty"), P("Астана", "Astana"), P("Шымкент", "Shymkent"),
    P("Караганда", "Karaganda"), P("Актобе", "Aktobe"), P("Атырау", "Atyrau"),
    P("Павлодар", "Pavlodar"), P("Семей", "Semey"),
  ] },
  { value: "az", labelKey: "geo.az", cities: [
    P("Баку", "Baku"), P("Гянджа", "Ganja"), P("Сумгаит", "Sumgait"),
    P("Мингечевир", "Mingachevir"), P("Ленкорань", "Lankaran"),
  ] },
  { value: "ge", labelKey: "geo.ge", cities: [
    P("Тбилиси", "Tbilisi"), P("Батуми", "Batumi"), P("Кутаиси", "Kutaisi"),
    P("Рустави", "Rustavi"), P("Зугдиди", "Zugdidi"),
  ] },
  { value: "uz", labelKey: "geo.uz", cities: [
    P("Ташкент", "Tashkent"), P("Самарканд", "Samarkand"), P("Бухара", "Bukhara"),
    P("Наманган", "Namangan"), P("Фергана", "Fergana"), P("Андижан", "Andijan"),
  ] },
  { value: "th", labelKey: "geo.th", cities: ["Bangkok", "Chiang Mai", "Pattaya", "Phuket", "Nakhon Ratchasima"].map((c) => P(c, c)) },
  { value: "id", labelKey: "geo.id", cities: ["Jakarta", "Surabaya", "Bandung", "Medan", "Bali", "Semarang", "Makassar"].map((c) => P(c, c)) },
  { value: "vn", labelKey: "geo.vn", cities: ["Ho Chi Minh City", "Hanoi", "Da Nang", "Hai Phong", "Can Tho", "Nha Trang"].map((c) => P(c, c)) },
  { value: "ae", labelKey: "geo.ae", cities: ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah"].map((c) => P(c, c)) },
  { value: "sa", labelKey: "geo.sa", cities: ["Riyadh", "Jeddah", "Mecca", "Medina", "Dammam"].map((c) => P(c, c)) },
  { value: "au", labelKey: "geo.au", cities: ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Gold Coast", "Canberra"].map((c) => P(c, c)) },
  { value: "ca", labelKey: "geo.ca", cities: ["Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa", "Edmonton", "Winnipeg"].map((c) => P(c, c)) },
  { value: "nl", labelKey: "geo.nl", cities: ["Amsterdam", "Rotterdam", "The Hague", "Utrecht", "Eindhoven"].map((c) => P(c, c)) },
  { value: "kr", labelKey: "geo.kr", cities: ["Seoul", "Busan", "Incheon", "Daegu", "Daejeon", "Gwangju"].map((c) => P(c, c)) },
];

// Language endonyms — do NOT translate (worldwide convention for language pickers).
export const LANG_OPTIONS: { value: string; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "es-CO", label: "Español (Colombia)" },
  { value: "pt", label: "Português" },
  { value: "ja", label: "日本語" },
  { value: "uk", label: "Українська" },
  { value: "it", label: "Italiano" },
  { value: "pl", label: "Polski" },
  { value: "tr", label: "Türkçe" },
  { value: "nl", label: "Nederlands" },
  { value: "ko", label: "한국어" },
  { value: "ar", label: "العربية" },
  { value: "hi", label: "हिन्दी" },
  { value: "th", label: "ไทย" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "id", label: "Bahasa Indonesia" },
  { value: "kk", label: "Қазақша" },
  { value: "az", label: "Azərbaycan" },
  { value: "ka", label: "ქართული" },
  { value: "uz", label: "O'zbek" },
  { value: "zh", label: "中文" },
];

export function cityLabel(city: CityPair, lang: "ru" | "en"): string {
  return lang === "en" ? city.en : city.ru;
}

// City value we send to the API — always Latin/English form for consistency across locales.
export function cityValue(city: CityPair): string {
  return city.en;
}