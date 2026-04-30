// ============================================================================
// Professional landing page generator for PBN sites.
// Replaces the simple "list of posts" home page with a real business landing:
// hero, stats, services, process, team, guarantee, CTA, contacts, footer.
//
// Content is produced by Lovable AI (one structured-output call per site)
// so that text matches the site topic. Images: FAL.ai for hero (already
// uploaded by seed-starter-articles), Picsum by seed for the rest.
// ============================================================================

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";

// ----------------------------- Niche-aware fallbacks ------------------------

/** Tiny deterministic FNV-1a for seeded picks. */
function _h(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function _pick<T>(arr: T[], seed: string, salt: string): T {
  return arr[_h(seed + ":" + salt) % arr.length];
}
function _shuffle<T>(arr: T[], seed: string): T[] {
  const a = arr.slice();
  let s = _h(seed) || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const RU_MALE = ["Андрей","Сергей","Михаил","Павел","Денис","Артем","Роман","Виктор","Олег","Дмитрий","Игорь","Кирилл","Антон","Максим","Никита","Владимир","Алексей","Иван","Евгений","Юрий"];
const RU_FEMALE = ["Анна","Екатерина","Наталья","Ольга","Татьяна","Юлия","Елена","Марина","Светлана","Ирина","Алена","Полина","Дарья","Анастасия","Ксения","Валентина","Людмила","Вера","Любовь","Галина"];
const RU_LAST_M = ["Козлов","Смирнов","Новиков","Морозов","Волков","Соколов","Лебедев","Попов","Орлов","Зайцев","Никитин","Беляев","Тарасов","Белов","Комаров","Сафонов","Богданов","Воронин","Гусев","Кузьмин"];
const RU_LAST_F = ["Козлова","Смирнова","Новикова","Морозова","Волкова","Соколова","Лебедева","Попова","Орлова","Зайцева","Никитина","Беляева","Тарасова","Белова","Комарова","Сафонова","Богданова","Воронина","Гусева","Кузьмина"];

const EN_MALE = ["James","Michael","David","John","Robert","Thomas","Daniel","Christopher","Andrew","Matthew","Joseph","Mark","Steven","Brian","Kevin","Eric","Patrick","Sean","Ryan","Adam"];
const EN_FEMALE = ["Mary","Patricia","Jennifer","Linda","Elizabeth","Susan","Jessica","Sarah","Karen","Nancy","Lisa","Margaret","Sandra","Ashley","Emily","Donna","Michelle","Carol","Amanda","Melissa"];
const EN_LAST = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Walker","Hall","Allen","Young"];

/** Detect a coarse niche bucket from free-text topic for picking sane defaults. */
function detectNiche(topic: string): string {
  const t = topic.toLowerCase();
  if (/(цвет|букет|флорист|flower|florist|bouquet)/.test(t)) return "florist";
  if (/(минитрактор|трактор|сельхоз|agro|tractor|farm)/.test(t)) return "agro";
  if (/(ремонт квартир|отделка|строит|renovation|remodel|construction)/.test(t)) return "renovation";
  if (/(юрид|адвокат|law|legal|attorney)/.test(t)) return "legal";
  if (/(стомат|зуб|dental|dentist)/.test(t)) return "dental";
  if (/(автосерв|автомоб|шиномонт|auto|car|tire)/.test(t)) return "auto";
  if (/(клининг|уборк|cleaning)/.test(t)) return "cleaning";
  if (/(достав|курьер|delivery|courier)/.test(t)) return "delivery";
  if (/(restoran|кафе|ресторан|cafe|restaurant|food|пицц|суши)/.test(t)) return "food";
  if (/(красот|салон|парик|маник|beauty|salon|hair)/.test(t)) return "beauty";
  if (/(фитнес|спорт|тренаж|gym|fitness)/.test(t)) return "fitness";
  if (/(it|web|разработ|software|саит|сайт|студи)/.test(t)) return "tech";
  if (/(недвижим|риелтор|real ?estate|realty)/.test(t)) return "realty";
  if (/(обуч|курс|школ|education|school|course)/.test(t)) return "edu";
  if (/(мед|клиник|здоров|health|medical|clinic)/.test(t)) return "medical";
  return "generic";
}

/** Niche-specific role pools (RU). The first entry is the "lead" role. */
const ROLE_POOL_RU: Record<string, string[]> = {
  florist:    ["Старший флорист","Флорист","Менеджер заказов","Декоратор","Курьер-флорист"],
  agro:       ["Технический специалист","Механик","Менеджер продаж","Агроинженер","Сервис-инженер"],
  renovation: ["Прораб","Дизайнер интерьера","Сметчик","Бригадир","Технадзор"],
  legal:      ["Юрист","Адвокат","Помощник юриста","Судебный представитель","Налоговый консультант"],
  dental:     ["Врач-стоматолог","Стоматолог-ортопед","Гигиенист","Ассистент стоматолога","Администратор клиники"],
  auto:       ["Автомеханик","Диагност","Шиномонтажник","Мастер-приемщик","Кузовщик"],
  cleaning:   ["Старший клинер","Менеджер заказов","Бригадир","Специалист по химчистке","Логист"],
  delivery:   ["Старший курьер","Логист","Диспетчер","Менеджер доставки","Курьер"],
  food:       ["Шеф-повар","Су-шеф","Менеджер зала","Кондитер","Бариста"],
  beauty:     ["Топ-стилист","Колорист","Мастер маникюра","Бровист","Администратор салона"],
  fitness:    ["Старший тренер","Персональный тренер","Инструктор групповых программ","Нутрициолог","Администратор клуба"],
  tech:       ["Тимлид","Frontend-разработчик","Backend-разработчик","UX-дизайнер","DevOps-инженер"],
  realty:     ["Старший риелтор","Риелтор","Ипотечный брокер","Юрист по сделкам","Менеджер по аренде"],
  edu:        ["Методист","Преподаватель","Куратор курса","Эксперт-практик","Координатор обучения"],
  medical:    ["Главный врач","Врач-специалист","Медсестра","Администратор клиники","Координатор"],
  generic:    ["Старший специалист","Технолог","Менеджер по работе с клиентами","Эксперт направления","Координатор"],
};

const ROLE_POOL_EN: Record<string, string[]> = {
  florist:    ["Lead Florist","Florist","Order Manager","Decorator","Courier-Florist"],
  agro:       ["Technical Specialist","Mechanic","Sales Manager","Agronomist","Service Engineer"],
  renovation: ["Foreman","Interior Designer","Estimator","Crew Lead","Site Supervisor"],
  legal:      ["Attorney","Senior Attorney","Paralegal","Litigation Counsel","Tax Advisor"],
  dental:     ["Dentist","Prosthodontist","Dental Hygienist","Dental Assistant","Clinic Administrator"],
  auto:       ["Auto Mechanic","Diagnostic Tech","Tire Specialist","Service Advisor","Body Shop Tech"],
  cleaning:   ["Lead Cleaner","Account Manager","Crew Lead","Dry-Clean Specialist","Logistics"],
  delivery:   ["Lead Courier","Logistics Manager","Dispatcher","Delivery Manager","Courier"],
  food:       ["Head Chef","Sous Chef","Floor Manager","Pastry Chef","Barista"],
  beauty:     ["Top Stylist","Colorist","Nail Artist","Brow Artist","Salon Manager"],
  fitness:    ["Head Trainer","Personal Trainer","Group Instructor","Nutritionist","Club Manager"],
  tech:       ["Tech Lead","Frontend Engineer","Backend Engineer","UX Designer","DevOps Engineer"],
  realty:     ["Senior Realtor","Realtor","Mortgage Broker","Closing Attorney","Rental Manager"],
  edu:        ["Lead Instructor","Course Mentor","Curriculum Designer","Practitioner Expert","Program Coordinator"],
  medical:    ["Chief Physician","Specialist","Nurse","Clinic Administrator","Coordinator"],
  generic:    ["Senior Specialist","Lead Practitioner","Account Manager","Domain Expert","Coordinator"],
};

/** Build a deterministic team for a project. */
function buildSeededTeam(
  topic: string, lang: "ru" | "en", seed: string, sizeHint?: number,
): { name: string; role: string; bio: string }[] {
  const niche = detectNiche(topic);
  const roles = (lang === "ru" ? ROLE_POOL_RU : ROLE_POOL_EN)[niche] || (lang === "ru" ? ROLE_POOL_RU : ROLE_POOL_EN).generic;
  // 2..4 deterministic
  const size = sizeHint && sizeHint >= 2 && sizeHint <= 4
    ? sizeHint
    : 2 + (_h(seed + ":size") % 3);
  const orderedRoles = [roles[0], ..._shuffle(roles.slice(1), seed + ":r")].slice(0, size);

  const yearsPool = [3, 4, 5, 6, 7, 8, 9, 10, 12, 15];
  const out: { name: string; role: string; bio: string }[] = [];
  for (let i = 0; i < size; i++) {
    const isMale = (_h(seed + ":g" + i) % 2) === 0;
    let name: string;
    if (lang === "ru") {
      const first = _pick(isMale ? RU_MALE : RU_FEMALE, seed, "fn" + i);
      const last  = _pick(isMale ? RU_LAST_M : RU_LAST_F, seed, "ln" + i);
      name = `${first} ${last}`;
    } else {
      const first = _pick(isMale ? EN_MALE : EN_FEMALE, seed, "fn" + i);
      const last  = _pick(EN_LAST, seed, "ln" + i);
      name = `${first} ${last}`;
    }
    const years = _pick(yearsPool, seed, "y" + i);
    const role = orderedRoles[i];
    const bio = lang === "ru"
      ? `Работает в направлении «${topic}» ${years} лет. Ведет проекты от заявки до результата и держит качество на высоком уровне.`
      : `${years} years of hands-on work in ${topic}. Owns projects end-to-end and keeps quality bar high.`;
    out.push({ name, role, bio });
  }
  return out;
}

/** Build niche-aware Hero copy when AI is unavailable. */
function buildSeededHero(
  topic: string, siteName: string, lang: "ru" | "en", region: string, seed: string,
): { heroTitle: string; heroSubtitle: string; heroBadge: string } {
  const niche = detectNiche(topic);
  const place = region ? (lang === "ru" ? ` в ${region}` : ` in ${region}`) : "";
  const titlesRu: Record<string, string[]> = {
    florist:    [`Доставка свежих цветов и авторских букетов${place}`, `Букеты и композиции с доставкой${place} за 2 часа`, `Свежие цветы для любого повода${place}`],
    agro:       [`Продажа и обслуживание минитракторов${place}`, `Минитракторы и навесное оборудование${place}`, `Сельхозтехника${place}: продажа, сервис, запчасти`],
    renovation: [`Ремонт квартир и домов под ключ${place}`, `Качественный ремонт${place} с гарантией`, `Отделка квартир${place} от дизайн-проекта до сдачи`],
    legal:      [`Юридическая помощь бизнесу и частным лицам${place}`, `Решаем юридические вопросы${place} быстро и по делу`, `Адвокаты${place} с опытом сложных дел`],
    dental:     [`Современная стоматология${place} без боли`, `Лечение, имплантация и эстетика${place}`, `Стоматология полного цикла${place}`],
    auto:       [`Ремонт и обслуживание автомобилей${place}`, `Автосервис${place}: ремонт, ТО, диагностика`, `Качественный автосервис${place} с гарантией`],
    cleaning:   [`Профессиональная уборка квартир и офисов${place}`, `Клининг${place} с экосредствами и гарантией качества`, `Чисто за 1 визит — клининг${place}`],
    delivery:   [`Курьерская доставка${place} в день заказа`, `Доставка по городу${place} от 1 часа`, `Логистика и доставка${place} для бизнеса и людей`],
    food:       [`Доставка вкусной еды${place} за 60 минут`, `Кухня${place}: блюда из свежих продуктов`, `Заказ еды${place} с доставкой и навынос`],
    beauty:     [`Салон красоты${place}: стрижки, окрашивание, уход`, `Парикмахерские услуги и маникюр${place}`, `Красота и уход${place} от практикующих мастеров`],
    fitness:    [`Фитнес-клуб${place} с персональными тренировками`, `Тренировки${place}: сила, выносливость, фигура`, `Фитнес и здоровье${place} с реальным результатом`],
    tech:       [`Разработка сайтов и веб-сервисов${place}`, `Цифровые продукты${place}: дизайн, код, поддержка`, `IT-решения${place} для бизнеса любого масштаба`],
    realty:     [`Покупка, продажа и аренда недвижимости${place}`, `Подбор и сопровождение сделок${place}`, `Недвижимость${place}: безопасные сделки под ключ`],
    edu:        [`Обучение${place} с практикующими экспертами`, `Курсы${place} с поддержкой до результата`, `Образовательные программы${place} для взрослых`],
    medical:    [`Медицинская помощь${place} в современной клинике`, `Прием профильных специалистов${place}`, `Клиника${place}: диагностика, лечение, наблюдение`],
    generic:    [`${siteName}: услуги по направлению «${topic}»${place}`, `Решаем задачи в нише «${topic}»${place}`, `Команда ${siteName}${place} в нише «${topic}»`],
  };
  const subsRu = [
    "Опыт более 10 лет, прозрачные цены и официальный договор. Перезвоним за 15 минут.",
    "Работаем с частными и корпоративными клиентами. Гарантия на все работы.",
    "Качество, сроки и цена фиксируются договором. Бесплатная консультация по заявке.",
  ];
  const titlesEn: Record<string, string[]> = {
    florist:    [`Fresh flower bouquets delivered${place}`, `Same-day flower delivery${place}`, `Hand-tied bouquets${place} for every occasion`],
    agro:       [`Compact tractor sales and service${place}`, `Compact tractors and implements${place}`, `Farm equipment${place}: sales, service, parts`],
    renovation: [`Turnkey home and apartment renovation${place}`, `Quality renovations${place} with warranty`, `Apartment finishing${place} from design to handover`],
    legal:      [`Legal counsel for business and individuals${place}`, `Effective legal solutions${place}`, `Attorneys${place} with complex case experience`],
    dental:     [`Modern, pain-free dentistry${place}`, `Treatment, implants and aesthetics${place}`, `Full-cycle dentistry${place}`],
    auto:       [`Auto repair and maintenance${place}`, `Full-service auto shop${place}`, `Reliable auto service${place} with warranty`],
    cleaning:   [`Professional cleaning for homes and offices${place}`, `Eco-friendly cleaning${place} with quality guarantee`, `Spotless in one visit — cleaning${place}`],
    delivery:   [`Same-day courier delivery${place}`, `City delivery${place} from 1 hour`, `Delivery and logistics${place} for business`],
    food:       [`Tasty food delivered${place} in 60 minutes`, `Fresh-ingredient kitchen${place}`, `Order food${place}: delivery and takeaway`],
    beauty:     [`Beauty salon${place}: cut, color, care`, `Hair and nails${place} by certified artists`, `Beauty and care${place} from practicing masters`],
    fitness:    [`Fitness club${place} with personal training`, `Workouts${place}: strength, endurance, shape`, `Fitness and health${place} with real results`],
    tech:       [`Website and web app development${place}`, `Digital products${place}: design, code, support`, `IT solutions${place} for any business`],
    realty:     [`Buy, sell and rent real estate${place}`, `Property search and deal support${place}`, `Real estate${place}: safe turnkey transactions`],
    edu:        [`Learning${place} with practicing experts`, `Courses${place} with mentoring to the result`, `Adult education programs${place}`],
    medical:    [`Medical care${place} in a modern clinic`, `Specialist consultations${place}`, `Clinic${place}: diagnostics, treatment, follow-up`],
    generic:    [`${siteName}: services in "${topic}"${place}`, `Solving tasks in the "${topic}" niche${place}`, `${siteName}${place} for the "${topic}" niche`],
  };
  const subsEn = [
    "10+ years of experience, transparent prices and a written contract. Callback in 15 minutes.",
    "We work with private and corporate clients. Warranty on every job.",
    "Quality, timing and price are fixed by contract. Free consultation on request.",
  ];
  const titles = lang === "ru" ? (titlesRu[niche] || titlesRu.generic) : (titlesEn[niche] || titlesEn.generic);
  const subs = lang === "ru" ? subsRu : subsEn;
  return {
    heroTitle: _pick(titles, seed, "ht"),
    heroSubtitle: _pick(subs, seed, "hs"),
    heroBadge: lang === "ru" ? "Работаем с 2014 года" : "Trusted since 2014",
  };
}

// ----------------------------- Types ----------------------------------------

export interface LandingContent {
  heroTitle: string;
  heroSubtitle: string;
  heroBadge: string;
  ctaPrimary: string;
  ctaSecondary: string;
  phone: string;
  email: string;
  address: string;
  workHours: string;
  stats: { value: string; label: string }[];                 // 4
  whyTitle: string;
  whyText: string;
  features: { icon: string; title: string; text: string }[]; // 4-6
  services: { title: string; bullets: string[]; price: string }[]; // 3-6
  process: { icon: string; title: string; text: string }[];  // 4
  team: { name: string; role: string; bio: string }[];       // 3
  guaranteeTitle: string;
  guaranteeText: string;
  guaranteeBullets: string[];
  testimonials: { name: string; role: string; text: string; rating: number }[]; // 3
  ctaSectionTitle: string;
  ctaSectionText: string;
  blogTitle: string;
  aboutShortTitle: string;
  aboutShortText: string;
}

export interface LandingCtx {
  siteName: string;
  topic: string;
  lang: "ru" | "en";
  accent: string;
  headingFont: string;
  bodyFont: string;
  domain: string;
  // Visual skin: 1..8 (deterministic based on template key/name)
  skin: number;
  // Real posts to feature in "Latest from blog" section
  posts: { title: string; slug: string; excerpt: string; featuredImageUrl?: string }[];
  // Optional company data from project (overrides AI defaults)
  companyName?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyAddress?: string;
  workHours?: string;
  whatsappUrl?: string;
  telegramUrl?: string;
  heroImageUrl?: string;
  // Pre-resolved AI-generated images by slot (hero, why, guarantee, about,
  // team_1..3, post_1..3). When provided, the renderer uses them directly;
  // otherwise it falls back to Unsplash by topic and finally UI Avatars.
  generatedImages?: Record<string, string>;
}

// ----------------------------- Helpers --------------------------------------

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Themed fallback when no AI image is available. Uses Unsplash Source which
// returns a topical photo by keywords (no API key needed).
function pickImage(seed: string, w = 1200, h = 800): string {
  const kw = String(seed || "business")
    .replace(/[«»"().,:;!?\-—]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(",");
  const safe = encodeURIComponent(kw || "business");
  return `https://source.unsplash.com/${w}x${h}/?${safe}`;
}

// Avatar fallback when AI portrait generation fails or is disabled.
function avatarFallback(name: string): string {
  const n = encodeURIComponent(String(name || "User").slice(0, 40));
  return `https://ui-avatars.com/api/?name=${n}&size=320&background=random&format=png`;
}

function getImage(
  ctx: LandingCtx,
  slot: string,
  fallbackSeed: string,
  w = 1200,
  h = 800,
): string {
  const url = ctx.generatedImages?.[slot];
  if (url && /^https?:\/\//.test(url)) return url;
  return pickImage(fallbackSeed, w, h);
}

// Deterministic RNG from string for stable "skin" picks
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function pickSkin(key: string): number {
  return (hashStr(key) % 8) + 1;
}

// ----------------------------- FAL.ai Image Generator ------------------------

/** Slots we generate via FAL.ai (with team_1..3 added dynamically). */
export interface ImageGenInput {
  niche: string;
  region?: string;
  audience?: string;
  team: { name: string; role: string; bio: string }[];
  posts: { title: string; slug: string }[];
}

async function falGenerate(
  falKey: string,
  prompt: string,
  size: "landscape_16_9" | "landscape_4_3" | "square_hd",
): Promise<string | null> {
  try {
    const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
      method: "POST",
      headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        image_size: size,
        num_images: 1,
        num_inference_steps: 4,
        enable_safety_checker: true,
      }),
    });
    if (!res.ok) {
      console.warn("[landingPage.fal] HTTP", res.status);
      return null;
    }
    const data = await res.json();
    const url = data?.images?.[0]?.url || null;
    return typeof url === "string" && /^https?:\/\//.test(url) ? url : null;
  } catch (e: any) {
    console.warn("[landingPage.fal] error:", e?.message);
    return null;
  }
}

/**
 * Generates (or reuses cached) AI images for all landing slots.
 * Returns a map slot -> URL. On any failure, the slot is omitted and the
 * renderer falls back to Unsplash by topic / UI Avatars.
 *
 * Caching is keyed by (project_id, slot) in `site_image_cache` so re-deploys
 * never regenerate the same picture.
 */
export async function ensureLandingImages(
  admin: any,
  projectId: string,
  falKey: string | null,
  input: ImageGenInput,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  // 1) Read existing cache for this project
  try {
    const { data: cached } = await admin
      .from("site_image_cache")
      .select("slot, image_url")
      .eq("project_id", projectId);
    for (const row of (cached || [])) {
      if (row?.slot && row?.image_url) out[row.slot] = row.image_url;
    }
  } catch (e: any) {
    console.warn("[landingPage.images] cache read failed:", e?.message);
  }

  if (!falKey) {
    console.log("[landingPage.images] no FAL key, skipping generation, will fallback to Unsplash");
    return out;
  }

  const niche = String(input.niche || "business").slice(0, 120);
  const region = String(input.region || "").slice(0, 80);
  const audience = String(input.audience || "").slice(0, 120);
  const ctxLine = [niche, region && `in ${region}`, audience && `for ${audience}`]
    .filter(Boolean).join(" ");

  // Build the slot generation plan
  type Job = { slot: string; prompt: string; size: "landscape_16_9" | "landscape_4_3" | "square_hd" };
  const jobs: Job[] = [];

  const baseStyle = "high quality, natural lighting, photorealistic, no text, no watermarks, magazine quality";

  if (!out["hero"]) jobs.push({
    slot: "hero", size: "landscape_16_9",
    prompt: `Professional editorial photo of ${ctxLine}, hero shot, cinematic, ${baseStyle}.`,
  });
  if (!out["why"]) jobs.push({
    slot: "why", size: "landscape_4_3",
    prompt: `Professional photo illustrating expertise and quality service in ${ctxLine}, ${baseStyle}.`,
  });
  if (!out["guarantee"]) jobs.push({
    slot: "guarantee", size: "landscape_4_3",
    prompt: `Professional photo representing trust, warranty and reliability in ${ctxLine}, handshake or certificate, ${baseStyle}.`,
  });
  if (!out["about"]) jobs.push({
    slot: "about", size: "landscape_4_3",
    prompt: `Professional photo of a small business team or office working on ${ctxLine}, ${baseStyle}.`,
  });

  // Team portraits — 3 different people
  const teamPlans = [
    { gender: "male", age: "40", look: "confident director" },
    { gender: "female", age: "32", look: "friendly manager" },
    { gender: "male", age: "28", look: "young specialist" },
  ];
  for (let i = 0; i < Math.min(3, input.team.length || 3); i++) {
    const slot = `team_${i + 1}`;
    if (out[slot]) continue;
    const p = teamPlans[i];
    jobs.push({
      slot, size: "square_hd",
      prompt: `Professional business portrait of a ${p.gender}, ${p.age} years old, ${p.look}, modern office background, friendly smile, ${baseStyle}.`,
    });
  }

  // Blog post previews — up to 3
  for (let i = 0; i < Math.min(3, input.posts.length); i++) {
    const slot = `post_${i + 1}`;
    if (out[slot]) continue;
    const p = input.posts[i];
    jobs.push({
      slot, size: "landscape_16_9",
      prompt: `Editorial photograph illustrating "${p.title}" in the context of ${ctxLine}, ${baseStyle}.`,
    });
  }

  if (jobs.length === 0) return out;

  console.log(`[landingPage.images] generating ${jobs.length} new images via FAL`);

  // Run in small parallel batches to keep latency low without hammering FAL.
  const BATCH = 3;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const slice = jobs.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map(async (j) => {
        const url = await falGenerate(falKey, j.prompt, j.size);
        return { job: j, url };
      }),
    );
    for (const { job, url } of results) {
      if (!url) continue;
      out[job.slot] = url;
      try {
        await admin.from("site_image_cache").upsert({
          project_id: projectId,
          slot: job.slot,
          prompt: job.prompt.slice(0, 1000),
          image_url: url,
          source: "fal",
        }, { onConflict: "project_id,slot" });
      } catch (e: any) {
        console.warn("[landingPage.images] cache write failed for", job.slot, e?.message);
      }
    }
  }

  return out;
}

// ----------------------------- AI Content Generation -------------------------

const FALLBACK_RU = (topic: string, siteName: string): LandingContent => ({
  heroTitle: `${siteName} — профессиональные решения по теме «${topic}»`,
  heroSubtitle: `Помогаем клиентам уже более 10 лет. Качество, гарантия, индивидуальный подход.`,
  heroBadge: "Лидер рынка",
  ctaPrimary: "Оставить заявку",
  ctaSecondary: "Узнать подробнее",
  phone: "+7 (495) 123-45-67",
  email: "info@" + siteName.toLowerCase().replace(/\s+/g, "") + ".ru",
  address: "г. Москва, ул. Тверская, 1",
  workHours: "Пн-Пт 9:00-19:00, Сб 10:00-16:00",
  stats: [
    { value: "1500+", label: "довольных клиентов" },
    { value: "12", label: "лет на рынке" },
    { value: "98%", label: "положительных отзывов" },
    { value: "24/7", label: "поддержка" },
  ],
  whyTitle: "Почему клиенты выбирают нас",
  whyText:
    "Мы знаем тематику изнутри: занимаемся ей более десяти лет, постоянно обучаем команду и обновляем оборудование. Каждый проект ведёт персональный менеджер, а на работы предоставляется официальная гарантия.",
  features: [
    { icon: "★", title: "Опыт", text: "Более 10 лет в отрасли. Сотни успешно завершённых проектов." },
    { icon: "✓", title: "Гарантия", text: "Официальная гарантия по договору на все виды работ." },
    { icon: "⚡", title: "Скорость", text: "Выезд в день обращения. Сроки фиксируются в договоре." },
    { icon: "₽", title: "Прозрачные цены", text: "Никаких скрытых платежей. Точная смета до начала работ." },
  ],
  services: [
    { title: "Базовый пакет", bullets: ["Консультация специалиста", "Выезд на объект", "Подбор решения"], price: "от 5 000 ₽" },
    { title: "Стандарт", bullets: ["Всё из «Базового»", "Полный комплекс работ", "Гарантия 12 месяцев"], price: "от 15 000 ₽" },
    { title: "Премиум", bullets: ["Всё из «Стандарта»", "Срочный выезд", "Расширенная гарантия 24 мес"], price: "от 35 000 ₽" },
  ],
  process: [
    { icon: "①", title: "Заявка", text: "Оставьте заявку на сайте или позвоните нам." },
    { icon: "②", title: "Консультация", text: "Бесплатно проконсультируем и подготовим расчёт." },
    { icon: "③", title: "Работа", text: "Согласованные работы выполняются в чёткие сроки." },
    { icon: "④", title: "Результат", text: "Сдаём проект и предоставляем гарантию." },
  ],
  team: [
    { name: "Алексей Иванов", role: "Руководитель", bio: "Более 15 лет в отрасли. Управляет проектами полного цикла." },
    { name: "Мария Петрова", role: "Главный специалист", bio: "Эксперт-практик, сертифицированный инженер." },
    { name: "Дмитрий Соколов", role: "Менеджер проектов", bio: "Сопровождает клиентов от заявки до сдачи." },
  ],
  guaranteeTitle: "Гарантируем результат",
  guaranteeText:
    "Мы уверены в качестве своей работы и закрепляем это в договоре. Если что-то пойдёт не так — устраним за свой счёт.",
  guaranteeBullets: [
    "Письменный договор и официальные документы",
    "Гарантийный срок до 24 месяцев",
    "Бесплатное гарантийное обслуживание",
  ],
  testimonials: [
    { name: "Ольга К.", role: "Постоянный клиент", text: "Обращаюсь уже не первый год. Всегда чётко по срокам, без сюрпризов.", rating: 5 },
    { name: "Игорь Н.", role: "Корпоративный клиент", text: "Профессиональный подход и прозрачные цены. Рекомендую.", rating: 5 },
    { name: "Светлана М.", role: "Частный клиент", text: "Помогли решить вопрос быстро и качественно. Спасибо команде.", rating: 5 },
  ],
  ctaSectionTitle: "Готовы начать?",
  ctaSectionText: "Оставьте заявку — наш менеджер перезвонит в течение 15 минут и бесплатно проконсультирует.",
  blogTitle: "Полезные статьи из блога",
  aboutShortTitle: "О компании",
  aboutShortText:
    "Работаем с частными и корпоративными клиентами по всей стране. В основе работы — честность, профессионализм и внимание к деталям.",
});

const FALLBACK_EN = (topic: string, siteName: string): LandingContent => ({
  heroTitle: `${siteName} — professional ${topic} solutions you can trust`,
  heroSubtitle: "Serving clients for over 10 years with quality, guarantees and a personal approach.",
  heroBadge: "Industry Leader",
  ctaPrimary: "Get a Quote",
  ctaSecondary: "Learn More",
  phone: "+1 (555) 123-4567",
  email: "info@" + siteName.toLowerCase().replace(/\s+/g, "") + ".com",
  address: "123 Main Street, New York, NY",
  workHours: "Mon-Fri 9 AM - 7 PM, Sat 10 AM - 4 PM",
  stats: [
    { value: "1,500+", label: "happy clients" },
    { value: "12", label: "years on the market" },
    { value: "98%", label: "positive reviews" },
    { value: "24/7", label: "support" },
  ],
  whyTitle: "Why clients choose us",
  whyText:
    "We know the field inside out: more than ten years of experience, ongoing team training and modern equipment. Every project gets a personal manager and an official warranty.",
  features: [
    { icon: "★", title: "Experience", text: "10+ years in the industry. Hundreds of successful projects." },
    { icon: "✓", title: "Warranty", text: "Official contractual warranty on all work." },
    { icon: "⚡", title: "Speed", text: "Same-day service. Deadlines fixed by contract." },
    { icon: "$", title: "Transparent Prices", text: "No hidden fees. Accurate estimate before any work begins." },
  ],
  services: [
    { title: "Basic Package", bullets: ["Consultation", "On-site visit", "Solution design"], price: "from $99" },
    { title: "Standard", bullets: ["Everything in Basic", "Full service", "12-month warranty"], price: "from $299" },
    { title: "Premium", bullets: ["Everything in Standard", "Priority response", "24-month warranty"], price: "from $599" },
  ],
  process: [
    { icon: "①", title: "Request", text: "Send a request via the site or call us." },
    { icon: "②", title: "Consultation", text: "Free consultation and detailed estimate." },
    { icon: "③", title: "Work", text: "Agreed work performed on a strict schedule." },
    { icon: "④", title: "Result", text: "Project delivered with a warranty." },
  ],
  team: [
    { name: "Alex Johnson", role: "Director", bio: "15+ years in the industry. Runs full-cycle projects." },
    { name: "Maria Smith", role: "Lead Specialist", bio: "Hands-on expert, certified engineer." },
    { name: "David Brown", role: "Project Manager", bio: "Guides clients from request to delivery." },
  ],
  guaranteeTitle: "We guarantee the result",
  guaranteeText:
    "We stand behind our work and put it in writing. If anything goes wrong, we fix it at our own cost.",
  guaranteeBullets: ["Written contract and official paperwork", "Warranty up to 24 months", "Free warranty service"],
  testimonials: [
    { name: "Olivia K.", role: "Returning client", text: "Always on time, no surprises. Recommended.", rating: 5 },
    { name: "Ian N.", role: "Corporate client", text: "Professional approach and transparent pricing.", rating: 5 },
    { name: "Sandra M.", role: "Private client", text: "Solved our issue quickly and professionally.", rating: 5 },
  ],
  ctaSectionTitle: "Ready to start?",
  ctaSectionText: "Leave a request — a manager will call back within 15 minutes for a free consultation.",
  blogTitle: "Latest from the blog",
  aboutShortTitle: "About the company",
  aboutShortText:
    "We work with private and corporate clients across the country. Our principles: honesty, professionalism and attention to detail.",
});

const LANDING_TOOL = {
  type: "function" as const,
  function: {
    name: "produce_landing",
    description: "Produce all text content for a business landing page on a given topic.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [
        "heroTitle", "heroSubtitle", "heroBadge", "ctaPrimary", "ctaSecondary",
        "phone", "email", "address", "workHours",
        "stats", "whyTitle", "whyText", "features", "services", "process",
        "team", "guaranteeTitle", "guaranteeText", "guaranteeBullets",
        "testimonials", "ctaSectionTitle", "ctaSectionText", "blogTitle",
        "aboutShortTitle", "aboutShortText",
      ],
      properties: {
        heroTitle: { type: "string" },
        heroSubtitle: { type: "string" },
        heroBadge: { type: "string" },
        ctaPrimary: { type: "string" },
        ctaSecondary: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        address: { type: "string" },
        workHours: { type: "string" },
        stats: {
          type: "array",
          minItems: 4, maxItems: 4,
          items: { type: "object", required: ["value", "label"], properties: { value: { type: "string" }, label: { type: "string" } } },
        },
        whyTitle: { type: "string" },
        whyText: { type: "string" },
        features: {
          type: "array", minItems: 4, maxItems: 6,
          items: { type: "object", required: ["icon", "title", "text"], properties: { icon: { type: "string" }, title: { type: "string" }, text: { type: "string" } } },
        },
        services: {
          type: "array", minItems: 3, maxItems: 4,
          items: {
            type: "object", required: ["title", "bullets", "price"],
            properties: {
              title: { type: "string" },
              bullets: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
              price: { type: "string" },
            },
          },
        },
        process: {
          type: "array", minItems: 4, maxItems: 4,
          items: { type: "object", required: ["icon", "title", "text"], properties: { icon: { type: "string" }, title: { type: "string" }, text: { type: "string" } } },
        },
        team: {
          type: "array", minItems: 3, maxItems: 3,
          items: { type: "object", required: ["name", "role", "bio"], properties: { name: { type: "string" }, role: { type: "string" }, bio: { type: "string" } } },
        },
        guaranteeTitle: { type: "string" },
        guaranteeText: { type: "string" },
        guaranteeBullets: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
        testimonials: {
          type: "array", minItems: 3, maxItems: 3,
          items: {
            type: "object", required: ["name", "role", "text", "rating"],
            properties: { name: { type: "string" }, role: { type: "string" }, text: { type: "string" }, rating: { type: "integer", minimum: 4, maximum: 5 } },
          },
        },
        ctaSectionTitle: { type: "string" },
        ctaSectionText: { type: "string" },
        blogTitle: { type: "string" },
        aboutShortTitle: { type: "string" },
        aboutShortText: { type: "string" },
      },
    },
  },
};

export async function generateLandingContent(
  topic: string,
  siteName: string,
  lang: "ru" | "en",
  overrides: Partial<LandingContent> = {},
  nicheCtx: {
    region?: string;
    services?: string;
    audience?: string;
    businessType?: string;
  } = {},
  seed: string = "",
): Promise<LandingContent> {
  const baseFallback = lang === "ru" ? FALLBACK_RU(topic, siteName) : FALLBACK_EN(topic, siteName);
  // Replace generic placeholder hero & team with deterministic, niche-aware ones.
  const _seed = seed || (siteName + "::" + topic);
  const seededHero = buildSeededHero(topic, siteName, lang, (nicheCtx.region || "").trim(), _seed);
  const seededTeam = buildSeededTeam(topic, lang, _seed);
  const fallback: LandingContent = {
    ...baseFallback,
    ...seededHero,
    team: seededTeam,
  };

  if (!LOVABLE_API_KEY) {
    return { ...fallback, ...overrides };
  }

  const region   = (nicheCtx.region   || "").trim();
  const services = (nicheCtx.services || "").trim();
  const audience = (nicheCtx.audience || "").trim();
  const bizType  = (nicheCtx.businessType || "").trim();

  const sys = lang === "ru"
    ? `Ты создаёшь тексты для лендинга реальной российской компании. Тематика и название известны.
ОБЯЗАТЕЛЬНО: 1) ВСЕ услуги, цены, профессии команды, отзывы, статистика, FAQ - строго из указанной ниши. Никаких общих "консультаций" если ниша - продажа минитракторов. 2) Названия услуг используют РЕАЛЬНУЮ терминологию ниши (для ниши "минитракторы" - "продажа минитрактора", "сервис и ТО", "доставка навесного оборудования", а не "Базовый/Стандарт/Премиум"). 3) Цены реалистичные для рынка ниши и региона (минитрактор от 250 000 руб, а не от 5 000). 4) Команда - должности из ниши (агроном, механик по сельхозтехнике), а не "руководитель/специалист". 5) Статистика релевантна нише (тракторов продано, моделей в наличии). 6) Отзывы - от целевой аудитории ниши. 7) Адрес и код телефона - в указанном регионе.
ФОРМАТ: Естественный язык, без канцелярита и без слова «уникальный». Цены, телефон, адрес - реалистичные. НЕ используй жирный шрифт и звёздочки. Замени все длинные тире на дефисы. Никогда не используй букву «ё» - только «е». Никаких выдуманных сертификатов. Иконки в полях icon - короткие unicode-символы (★ ✓ ⚡ ₽ ① ② ③ ④ ✦ ⬢ ◆ ●), не emoji.`
    : `You write copy for a real business landing page. Topic and brand name are given.
MANDATORY: 1) ALL services, prices, team roles, testimonials, stats, FAQ - strictly from the specified niche. No generic "consultations" if niche is selling tractors. 2) Service names use REAL niche terminology (for "compact tractors" niche - "tractor sales", "service and maintenance", "implement delivery", not "Basic/Standard/Premium"). 3) Prices realistic for the niche market and region (tractor from $5,000, not "from $99"). 4) Team - roles from the niche (agronomist, equipment mechanic), not generic "director/specialist". 5) Stats relevant to the niche (tractors sold, models in stock). 6) Testimonials from the actual target audience. 7) Address and phone area code - in the specified region.
FORMAT: Natural English, no corporate jargon. Realistic prices, phone, address. No bold or asterisks. Replace em-dashes with hyphens. No fabricated certifications. Icon fields - short unicode symbols (★ ✓ ⚡ $ ① ② ③ ④ ✦ ⬢ ◆ ●), not emoji.`;

  const ctxLinesRu = [
    `Ниша / тематика сайта: «${topic}»`,
    `Название компании: «${siteName}»`,
    region   ? `Регион: ${region}` : "",
    bizType  ? `Тип бизнеса: ${bizType}` : "",
    services ? `Ключевые услуги/товары (используй везде в контенте): ${services}` : "",
    audience ? `Целевая аудитория: ${audience}` : "",
  ].filter(Boolean).join("\n");
  const ctxLinesEn = [
    `Niche / site topic: "${topic}"`,
    `Brand name: "${siteName}"`,
    region   ? `Region: ${region}` : "",
    bizType  ? `Business type: ${bizType}` : "",
    services ? `Key services/products (reference them throughout): ${services}` : "",
    audience ? `Target audience: ${audience}` : "",
  ].filter(Boolean).join("\n");
  const user = lang === "ru"
    ? `${ctxLinesRu}\n\nСоздай весь контент лендинга СТРОГО под эту нишу. Все услуги, цены, команда, отзывы, статистика и FAQ должны быть из этой ниши, а не общими.`
    : `${ctxLinesEn}\n\nProduce the FULL landing copy STRICTLY for this niche. Services, prices, team, testimonials, stats and FAQ must be niche-specific, not generic.`;

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30_000);
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        tools: [LANDING_TOOL],
        tool_choice: { type: "function", function: { name: "produce_landing" } },
      }),
    });
    clearTimeout(timer);
    if (!resp.ok) {
      console.warn("[landing] AI gateway HTTP", resp.status, (await resp.text()).slice(0, 300));
      return { ...fallback, ...overrides };
    }
    const data = await resp.json();
    const argsStr = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) {
      console.warn("[landing] No tool_call in response");
      return { ...fallback, ...overrides };
    }
    const parsed = JSON.parse(argsStr) as LandingContent;
    // Sanitize — remove ё, replace em-dash, strip bold markup
    const clean = sanitizeContent(parsed, lang);
    return { ...clean, ...overrides };
  } catch (e) {
    console.warn("[landing] AI gen failed:", (e as Error).message);
    return { ...fallback, ...overrides };
  }
}

function sanitizeText(s: string, lang: "ru" | "en"): string {
  let t = String(s ?? "");
  t = t.replace(/—/g, "-").replace(/–/g, "-");
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
  if (lang === "ru") t = t.replace(/ё/g, "е").replace(/Ё/g, "Е");
  return t.trim();
}

function sanitizeContent(c: LandingContent, lang: "ru" | "en"): LandingContent {
  const s = (x: string) => sanitizeText(x, lang);
  // Hard length caps so a long site_about / niche text never blows up the hero.
  const cap = (x: string, n: number) => {
    const v = s(x);
    if (v.length <= n) return v;
    const cut = v.slice(0, n);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > n * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[«"',.\-–—\s]+$/u, "");
  };
  return {
    ...c,
    heroTitle: cap(c.heroTitle, 90),
    heroSubtitle: cap(c.heroSubtitle, 180),
    heroBadge: cap(c.heroBadge, 28),
    ctaPrimary: s(c.ctaPrimary), ctaSecondary: s(c.ctaSecondary),
    phone: s(c.phone), email: s(c.email), address: s(c.address), workHours: s(c.workHours),
    stats: c.stats.map(x => ({ value: s(x.value), label: s(x.label) })),
    whyTitle: s(c.whyTitle), whyText: s(c.whyText),
    features: c.features.map(x => ({ icon: x.icon, title: s(x.title), text: s(x.text) })),
    services: c.services.map(x => ({ title: s(x.title), bullets: x.bullets.map(s), price: s(x.price) })),
    process: c.process.map(x => ({ icon: x.icon, title: s(x.title), text: s(x.text) })),
    team: c.team.map(x => ({ name: s(x.name), role: s(x.role), bio: s(x.bio) })),
    guaranteeTitle: s(c.guaranteeTitle), guaranteeText: s(c.guaranteeText),
    guaranteeBullets: c.guaranteeBullets.map(s),
    testimonials: c.testimonials.map(x => ({ name: s(x.name), role: s(x.role), text: s(x.text), rating: Math.min(5, Math.max(4, x.rating || 5)) })),
    ctaSectionTitle: s(c.ctaSectionTitle), ctaSectionText: s(c.ctaSectionText),
    blogTitle: s(c.blogTitle), aboutShortTitle: s(c.aboutShortTitle), aboutShortText: s(c.aboutShortText),
  };
}

// ----------------------------- Visual Skins ---------------------------------

interface SkinTokens {
  bg: string;
  ink: string;
  muted: string;
  surface: string;
  border: string;
  cardRadius: string;
  btnRadius: string;
  shadow: string;
  sectionPad: string;
  hero: "split" | "centered" | "imageRight";
  cards: "flat" | "shadow" | "outlined" | "tilted";
  heroOverlay: string;
}

function skinTokens(skin: number, accent: string): SkinTokens {
  const base: SkinTokens = {
    bg: "#ffffff", ink: "#0f172a", muted: "#64748b", surface: "#f8fafc",
    border: "#e2e8f0",
    cardRadius: "16px", btnRadius: "10px",
    shadow: "0 10px 30px -10px rgba(15,23,42,.15)",
    sectionPad: "80px 24px",
    hero: "split", cards: "shadow",
    heroOverlay: "linear-gradient(180deg, rgba(15,23,42,.55), rgba(15,23,42,.75))",
  };
  switch (skin) {
    case 1: // Modern Tech (split hero, blue tint)
      return { ...base, surface: "#f1f5f9", cardRadius: "14px", hero: "split", cards: "shadow" };
    case 2: // Corporate Trust (centered hero, navy)
      return { ...base, ink: "#0c1f3f", surface: "#f5f7fb", cardRadius: "8px", btnRadius: "6px", hero: "centered", cards: "outlined" };
    case 3: // Warm Service (round, amber)
      return { ...base, surface: "#fdf6ec", border: "#f0e3cf", cardRadius: "22px", btnRadius: "999px", hero: "imageRight", cards: "shadow" };
    case 4: // Industrial (sharp, dark accents)
      return { ...base, ink: "#111", surface: "#f4f4f5", border: "#d4d4d8", cardRadius: "4px", btnRadius: "4px", hero: "split", cards: "outlined", shadow: "none" };
    case 5: // Premium (deep, gold-ish accent)
      return { ...base, bg: "#fafaf7", ink: "#1a1a1a", surface: "#fff", border: "#e7e3d8", cardRadius: "12px", btnRadius: "8px", hero: "centered", cards: "shadow",
        heroOverlay: "linear-gradient(180deg, rgba(0,0,0,.4), rgba(0,0,0,.7))" };
    case 6: // Fresh / Friendly
      return { ...base, bg: "#fbfbff", surface: "#f0f4ff", cardRadius: "20px", btnRadius: "999px", hero: "imageRight", cards: "tilted" };
    case 7: // Minimal / Editorial
      return { ...base, bg: "#fff", surface: "#fafafa", border: "#eee", cardRadius: "0px", btnRadius: "2px", hero: "centered", cards: "flat", shadow: "none" };
    case 8: // Bold / Modern
    default:
      return { ...base, bg: "#fff", surface: "#0f172a08", cardRadius: "18px", btnRadius: "12px", hero: "split", cards: "shadow",
        heroOverlay: "linear-gradient(135deg, rgba(15,23,42,.5), rgba(15,23,42,.85))" };
  }
}

// ----------------------------- HTML Renderer --------------------------------

export function renderLandingHtml(
  ctx: LandingCtx,
  c: LandingContent,
  navHtml: string,
  chromeOverride?: { headerHtml?: string; footerHtml?: string; chromeCss?: string },
): string {
  const t = skinTokens(ctx.skin, ctx.accent);
  const isRu = ctx.lang === "ru";
  const heroImg = ctx.heroImageUrl && /^https?:\/\//.test(ctx.heroImageUrl)
    ? ctx.heroImageUrl
    : getImage(ctx, "hero", ctx.topic + " " + ctx.siteName + " hero", 1600, 900);

  const consentLine = isRu
    ? "Оставляя заявку, вы соглашаетесь на обработку персональных данных."
    : "By submitting the form you agree to the processing of personal data.";
  const phoneHref = (c.phone || "").replace(/[^+\d]/g, "");

  const fontsHref = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(ctx.headingFont)}:wght@600;700;800&family=${encodeURIComponent(ctx.bodyFont)}:wght@400;500;600&display=swap`;

  const css = `
:root{--accent:${ctx.accent};--bg:${t.bg};--ink:${t.ink};--muted:${t.muted};--surface:${t.surface};--border:${t.border};--cr:${t.cardRadius};--br:${t.btnRadius};--sh:${t.shadow}}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:"${ctx.bodyFont}",system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--ink);line-height:1.6;-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block;height:auto}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.container{max-width:1200px;margin:0 auto;padding:0 24px}
h1,h2,h3{font-family:"${ctx.headingFont}","${ctx.bodyFont}",sans-serif;line-height:1.2;color:var(--ink);font-weight:700}
h1{font-size:clamp(28px,4.5vw,52px)}
h2{font-size:clamp(24px,3vw,38px);margin-bottom:16px}
h3{font-size:20px;margin-bottom:8px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:14px 28px;border-radius:var(--br);background:var(--accent);color:#fff;font-weight:600;border:none;cursor:pointer;font-size:15px;font-family:inherit;transition:transform .15s, box-shadow .15s}
.btn:hover{transform:translateY(-1px);box-shadow:0 12px 30px -10px var(--accent);text-decoration:none;color:#fff}
.btn-outline{background:transparent;color:var(--ink);border:2px solid var(--ink)}
.btn-outline:hover{background:var(--ink);color:#fff;box-shadow:none}
.btn-light{background:#fff;color:var(--ink)}
.btn-light:hover{box-shadow:0 12px 30px -10px rgba(0,0,0,.4);color:var(--ink)}
section{padding:${t.sectionPad}}
.muted{color:var(--muted)}
.section-head{text-align:center;max-width:720px;margin:0 auto 48px}
.section-head .eyebrow{display:inline-block;color:var(--accent);font-weight:600;font-size:13px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px}

/* Header */
.site-header{position:sticky;top:0;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--border);z-index:100}
.site-header .container{display:flex;align-items:center;justify-content:space-between;padding-top:16px;padding-bottom:16px;gap:24px}
.brand{font-family:"${ctx.headingFont}",sans-serif;font-weight:800;font-size:22px;color:var(--ink);text-decoration:none}
.brand:hover{text-decoration:none;color:var(--ink)}
.main-nav{display:flex;gap:28px;align-items:center}
.main-nav a{color:var(--ink);font-weight:500;font-size:15px}
.header-cta{display:flex;align-items:center;gap:16px}
.header-phone{color:var(--ink);font-weight:600;font-size:15px;white-space:nowrap}
@media(max-width:860px){.main-nav,.header-phone{display:none}}

/* Hero */
.hero{position:relative;color:#fff;padding:0;background:#0f172a}
.hero-bg{position:absolute;inset:0;background-image:linear-gradient(180deg,rgba(15,23,42,.55),rgba(15,23,42,.85)),url('${heroImg}');background-size:cover;background-position:center}
.hero-inner{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;padding:96px 0;min-height:560px}
.hero-text h1{color:#fff;margin-bottom:20px}
.hero-text .badge{display:inline-block;padding:6px 14px;border-radius:999px;background:var(--accent);color:#fff;font-size:13px;font-weight:600;margin-bottom:20px;letter-spacing:.04em}
.hero-text p{font-size:18px;color:rgba(255,255,255,.85);margin-bottom:28px;max-width:520px}
.hero-text .ctas{display:flex;gap:14px;flex-wrap:wrap}
.hero-form{background:#fff;color:var(--ink);border-radius:var(--cr);padding:32px;box-shadow:0 30px 60px -20px rgba(0,0,0,.4)}
.hero-form h3{margin-bottom:8px}
.hero-form p.f-sub{color:var(--muted);margin-bottom:20px;font-size:14px}
.hero-form .field{margin-bottom:14px}
.hero-form input{width:100%;padding:13px 16px;border:1px solid var(--border);border-radius:var(--br);font-size:15px;font-family:inherit;background:#fff;color:var(--ink)}
.hero-form input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.hero-form .btn{width:100%;justify-content:center;margin-top:6px}
.hero-form .consent{font-size:12px;color:var(--muted);margin-top:12px;line-height:1.5}
.form-agree{display:flex;align-items:flex-start;gap:8px;margin:12px 0 4px;font-size:12px;color:var(--muted);line-height:1.5;text-align:left;cursor:pointer}
.form-agree input[type=checkbox]{width:16px;height:16px;margin-top:2px;accent-color:var(--accent);flex-shrink:0;cursor:pointer}
.form-agree a{color:var(--accent);text-decoration:underline}
.cta-form .form-agree{flex-basis:100%;justify-content:center;color:rgba(255,255,255,.75);margin-top:4px}
.cta-form .form-agree a{color:#fff}
@media(max-width:860px){.hero-inner{grid-template-columns:1fr;padding:64px 0;min-height:auto}}

/* Stats */
.stats{background:var(--surface);padding:48px 24px}
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;text-align:center}
.stat-val{font-family:"${ctx.headingFont}",sans-serif;font-size:42px;font-weight:800;color:var(--accent);line-height:1}
.stat-lbl{color:var(--muted);font-size:14px;margin-top:8px}
@media(max-width:760px){.stats-grid{grid-template-columns:repeat(2,1fr);gap:32px 16px}.stat-val{font-size:32px}}

/* Why */
.why-grid{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.why-grid img{border-radius:var(--cr);box-shadow:var(--sh);aspect-ratio:4/3;object-fit:cover;width:100%}
.features{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px}
.feat{padding:20px;background:var(--surface);border-radius:var(--cr);border:1px solid var(--border)}
.feat .ic{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:10px;background:var(--accent);color:#fff;font-size:20px;margin-bottom:10px}
.feat h3{font-size:16px;margin-bottom:4px}
.feat p{font-size:14px;color:var(--muted)}
@media(max-width:860px){.why-grid{grid-template-columns:1fr;gap:32px}.features{grid-template-columns:1fr}}

/* Services */
.services{background:var(--surface)}
.svc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.svc{background:#fff;border-radius:var(--cr);padding:32px 28px;box-shadow:var(--sh);border:1px solid var(--border);display:flex;flex-direction:column}
.svc.featured{border-color:var(--accent);transform:translateY(-8px)}
.svc h3{color:var(--ink)}
.svc .price{font-family:"${ctx.headingFont}",sans-serif;font-size:28px;font-weight:700;color:var(--accent);margin:8px 0 18px}
.svc ul{list-style:none;padding:0;margin:0 0 24px;flex:1}
.svc li{padding:8px 0 8px 26px;position:relative;color:var(--ink);font-size:14px;border-bottom:1px solid var(--border)}
.svc li:before{content:"✓";position:absolute;left:0;top:8px;color:var(--accent);font-weight:bold}
.svc li:last-child{border:none}
.svc .btn{justify-content:center}
@media(max-width:860px){.svc-grid{grid-template-columns:1fr}.svc.featured{transform:none}}

/* Process */
.proc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;counter-reset:step}
.proc{text-align:center;padding:24px}
.proc .ic{display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:50%;background:var(--accent);color:#fff;font-size:26px;font-weight:700;margin-bottom:14px}
.proc h3{font-size:17px;margin-bottom:6px}
.proc p{font-size:14px;color:var(--muted)}
@media(max-width:860px){.proc-grid{grid-template-columns:repeat(2,1fr)}}

/* Team */
.team{background:var(--surface)}
.team-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:32px}
.member{background:#fff;border-radius:var(--cr);overflow:hidden;text-align:center;box-shadow:var(--sh);border:1px solid var(--border)}
.member img{width:100%;aspect-ratio:1/1;object-fit:cover}
.member .info{padding:22px}
.member h3{font-size:18px;margin-bottom:2px}
.member .role{color:var(--accent);font-size:13px;font-weight:600;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em}
.member p{font-size:14px;color:var(--muted)}
@media(max-width:860px){.team-grid{grid-template-columns:1fr;max-width:380px;margin:0 auto}}

/* Guarantee */
.guar-grid{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.guar-grid img{border-radius:var(--cr);box-shadow:var(--sh);aspect-ratio:4/3;object-fit:cover;width:100%}
.guar ul{list-style:none;padding:0;margin:20px 0 0}
.guar li{padding:10px 0 10px 32px;position:relative;font-size:15px}
.guar li:before{content:"✓";position:absolute;left:0;top:10px;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold}
@media(max-width:860px){.guar-grid{grid-template-columns:1fr;gap:32px}}

/* Testimonials */
.testimonials{background:var(--surface)}
.test-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.test{background:#fff;border-radius:var(--cr);padding:28px;border:1px solid var(--border);box-shadow:var(--sh)}
.test .stars{color:#f5b400;font-size:18px;margin-bottom:12px;letter-spacing:2px}
.test p{font-style:italic;color:var(--ink);margin-bottom:18px;font-size:15px}
.test .author{display:flex;align-items:center;gap:12px;border-top:1px solid var(--border);padding-top:14px}
.test .author img{width:42px;height:42px;border-radius:50%;background:#eee}
.test .author .name{font-weight:600;font-size:14px}
.test .author .who{font-size:12px;color:var(--muted)}
@media(max-width:860px){.test-grid{grid-template-columns:1fr}}

/* Blog teaser */
.blog-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.bcard{background:#fff;border-radius:var(--cr);overflow:hidden;border:1px solid var(--border);box-shadow:var(--sh);transition:transform .2s}
.bcard:hover{transform:translateY(-4px);text-decoration:none}
.bcard img{width:100%;aspect-ratio:16/9;object-fit:cover}
.bcard .info{padding:20px}
.bcard h3{font-size:18px;color:var(--ink);margin-bottom:8px}
.bcard p{color:var(--muted);font-size:14px}
@media(max-width:860px){.blog-grid{grid-template-columns:1fr}}

/* About short */
.about-short{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.about-short img{border-radius:var(--cr);box-shadow:var(--sh);aspect-ratio:4/3;object-fit:cover;width:100%}
@media(max-width:860px){.about-short{grid-template-columns:1fr;gap:32px}}

/* CTA section */
.cta-section{background:linear-gradient(135deg,var(--ink),#1f2a44);color:#fff;text-align:center}
.cta-section h2{color:#fff}
.cta-section p{color:rgba(255,255,255,.8);max-width:560px;margin:12px auto 28px;font-size:17px}
.cta-form{display:flex;gap:12px;max-width:560px;margin:0 auto;flex-wrap:wrap;justify-content:center}
.cta-form input{flex:1;min-width:200px;padding:14px 18px;border-radius:var(--br);border:none;font-size:15px;font-family:inherit}

/* Map + Contacts */
.map-wrap{margin:0 auto;border-radius:var(--cr);overflow:hidden;box-shadow:var(--sh);max-width:1200px}
.map-wrap iframe{width:100%;height:380px;border:0;display:block}
.contacts-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;margin-top:32px}
.cinfo{padding:20px;background:var(--surface);border-radius:var(--cr);border:1px solid var(--border)}
.cinfo .lbl{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
.cinfo .val{font-weight:600;font-size:15px;color:var(--ink)}
@media(max-width:860px){.contacts-grid{grid-template-columns:1fr 1fr}}

/* Footer */
.site-footer{background:#0f172a;color:rgba(255,255,255,.8);padding:64px 24px 24px}
.foot-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:40px;max-width:1200px;margin:0 auto}
.foot-grid h4{color:#fff;font-size:15px;margin-bottom:14px;font-family:"${ctx.headingFont}",sans-serif}
.foot-grid a{color:rgba(255,255,255,.7);font-size:14px;display:block;padding:4px 0}
.foot-grid a:hover{color:#fff;text-decoration:none}
.foot-grid .brand-foot{font-family:"${ctx.headingFont}",sans-serif;font-size:22px;color:#fff;font-weight:800;margin-bottom:12px;display:block}
.foot-grid .desc{font-size:14px;line-height:1.6;color:rgba(255,255,255,.6)}
.copy{max-width:1200px;margin:48px auto 0;padding-top:24px;border-top:1px solid rgba(255,255,255,.1);font-size:13px;color:rgba(255,255,255,.5);text-align:center}
@media(max-width:860px){.foot-grid{grid-template-columns:1fr 1fr;gap:32px 20px}}
`;

  const stats = c.stats.slice(0, 4).map((s) => `
    <div><div class="stat-val">${esc(s.value)}</div><div class="stat-lbl">${esc(s.label)}</div></div>`).join("");

  const features = c.features.slice(0, 6).map((f) => `
    <div class="feat"><div class="ic">${esc(f.icon)}</div><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></div>`).join("");

  const services = c.services.slice(0, 3).map((sv, i) => `
    <div class="svc${i === 1 ? " featured" : ""}">
      <h3>${esc(sv.title)}</h3>
      <div class="price">${esc(sv.price)}</div>
      <ul>${sv.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      <a class="btn" href="#cta">${esc(c.ctaPrimary)}</a>
    </div>`).join("");

  const process = c.process.slice(0, 4).map((p) => `
    <div class="proc"><div class="ic">${esc(p.icon)}</div><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></div>`).join("");

  const team = c.team.slice(0, 3).map((m, i) => {
    const slot = `team_${i + 1}`;
    const av = (ctx.generatedImages?.[slot] && /^https?:\/\//.test(ctx.generatedImages![slot]))
      ? ctx.generatedImages![slot]
      : avatarFallback(m.name);
    return `
    <div class="member" itemscope itemtype="https://schema.org/Person">
      <img src="${av}" alt="${esc(m.name)}" loading="lazy" itemprop="image" width="320" height="320">
      <div class="info"><h3 itemprop="name">${esc(m.name)}</h3><div class="role" itemprop="jobTitle">${esc(m.role)}</div><p itemprop="description">${esc(m.bio)}</p></div>
    </div>`;
  }).join("");

  const testimonials = c.testimonials.slice(0, 3).map((tt) => {
    const stars = "★".repeat(tt.rating) + "☆".repeat(5 - tt.rating);
    const seed = encodeURIComponent(tt.name).slice(0, 60);
    return `
    <div class="test">
      <div class="stars" aria-label="${tt.rating} of 5">${stars}</div>
      <p>"${esc(tt.text)}"</p>
      <div class="author"><img src="https://api.dicebear.com/7.x/initials/svg?seed=${seed}" alt="${esc(tt.name)}" loading="lazy" width="42" height="42"><div><div class="name">${esc(tt.name)}</div><div class="who">${esc(tt.role)}</div></div></div>
    </div>`;
  }).join("");

  const blogCards = ctx.posts.slice(0, 3).map((p, i) => {
    const img = p.featuredImageUrl && /^https?:\/\//.test(p.featuredImageUrl)
      ? p.featuredImageUrl
      : getImage(ctx, `post_${i + 1}`, p.slug || p.title, 600, 340);
    return `
    <a class="bcard" href="/posts/${esc(p.slug)}.html">
      <img src="${esc(img)}" alt="${esc(p.title)}" loading="lazy" width="600" height="340">
      <div class="info"><h3>${esc(p.title)}</h3><p>${esc(p.excerpt)}</p></div>
    </a>`;
  }).join("") || `<p class="muted">${esc(isRu ? "Скоро здесь появятся новые материалы." : "Posts coming soon.")}</p>`;

  const aboutImg = getImage(ctx, "about", ctx.topic + " office team", 800, 600);
  const whyImg = getImage(ctx, "why", ctx.topic + " professional work", 800, 600);
  const guarImg = getImage(ctx, "guarantee", ctx.topic + " quality guarantee", 800, 600);

  // Map: simple OSM embed, centered loosely; we don't have geo, so use generic.
  const mapSrc = `https://www.openstreetmap.org/export/embed.html?bbox=37.5%2C55.6%2C37.8%2C55.8&layer=mapnik`;

  const navItems = navHtml || (isRu
    ? `<a href="/">Главная</a><a href="/services.html">Услуги</a><a href="/about.html">О нас</a><a href="/blog/">Блог</a><a href="/contacts.html">Контакты</a>`
    : `<a href="/">Home</a><a href="/services.html">Services</a><a href="/about.html">About</a><a href="/blog/">Blog</a><a href="/contacts.html">Contacts</a>`);

  // Parse work hours (Пн-Пт 9:00-18:00) into openingHoursSpecification.
  const orgId = `https://${ctx.domain}/#organization`;
  const lbId  = `https://${ctx.domain}/#localbusiness`;
  const dayMap: Record<string, string> = {
    пн: "Monday", вт: "Tuesday", ср: "Wednesday", чт: "Thursday",
    пт: "Friday", сб: "Saturday", вс: "Sunday",
    mo: "Monday", tu: "Tuesday", we: "Wednesday", th: "Thursday",
    fr: "Friday", sa: "Saturday", su: "Sunday",
  };
  const openingHoursSpec: unknown[] = [];
  if (c.workHours) {
    const re = /([а-яa-z]{2,3})\s*[-–]\s*([а-яa-z]{2,3})\s*([0-9]{1,2}[:.][0-9]{2})\s*[-–]\s*([0-9]{1,2}[:.][0-9]{2})/gi;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(c.workHours)) !== null) {
      const order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      const from = dayMap[mm[1].toLowerCase().slice(0, 2)];
      const to = dayMap[mm[2].toLowerCase().slice(0, 2)];
      if (!from || !to) continue;
      const i1 = order.indexOf(from), i2 = order.indexOf(to);
      if (i1 < 0 || i2 < 0) continue;
      openingHoursSpec.push({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: order.slice(i1, i2 + 1),
        opens: mm[3].replace(".", ":"),
        closes: mm[4].replace(".", ":"),
      });
    }
  }

  const addressParts = (c.address || "").split(",").map((p) => p.trim()).filter(Boolean);
  const postalMatch = (c.address || "").match(/\b(\d{5,6})\b/);

  const localBusiness = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": lbId,
    name: ctx.siteName,
    url: `https://${ctx.domain}/`,
    image: heroImg || undefined,
    telephone: c.phone,
    email: c.email,
    description: c.heroSubtitle,
    priceRange: isRu ? "₽₽" : "$$",
    address: {
      "@type": "PostalAddress",
      streetAddress: addressParts[0] || c.address,
      addressLocality: addressParts[1] || undefined,
      postalCode: postalMatch ? postalMatch[1] : undefined,
      addressCountry: isRu ? "RU" : "US",
    },
    openingHoursSpecification: openingHoursSpec.length ? openingHoursSpec : undefined,
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.9",
      reviewCount: String(150 + (hashStr(ctx.siteName) % 200)),
    },
  };

  const servicesLd = (c.services || []).slice(0, 6).map((s) => ({
    "@context": "https://schema.org",
    "@type": "Service",
    name: s.title,
    description: (s.bullets || []).slice(0, 3).join(". "),
    provider: { "@type": "Organization", "@id": orgId, name: ctx.siteName, url: `https://${ctx.domain}/` },
    offers: s.price ? {
      "@type": "Offer",
      price: String(s.price).replace(/[^\d.]/g, "") || undefined,
      priceCurrency: isRu ? "RUB" : "USD",
      description: s.price,
    } : undefined,
  }));

  const allLd = [localBusiness, ...servicesLd];

  return `<!doctype html>
<html lang="${isRu ? "ru" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ctx.siteName)} — ${esc(c.heroBadge)}</title>
<meta name="description" content="${esc(c.heroSubtitle).slice(0, 160)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fontsHref}">
<link rel="canonical" href="https://${ctx.domain}/">
<meta property="og:title" content="${esc(ctx.siteName)}">
<meta property="og:description" content="${esc(c.heroSubtitle).slice(0, 200)}">
<meta property="og:type" content="website">
<meta property="og:url" content="https://${ctx.domain}/">
<meta property="og:image" content="${esc(heroImg)}">
<style>${css}</style>
${chromeOverride?.chromeCss ? `<style>${chromeOverride.chromeCss}</style>` : ""}
${allLd.map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head>
<body>

${chromeOverride?.headerHtml || `<header class="site-header">
  <div class="container">
    <a href="/" class="brand">${esc(ctx.siteName)}</a>
    <nav class="main-nav">${navItems}</nav>
    <div class="header-cta">
      <a class="header-phone" href="tel:${esc(phoneHref)}">${esc(c.phone)}</a>
      <a class="btn" href="#cta">${esc(c.ctaPrimary)}</a>
    </div>
  </div>
</header>`}

<section class="hero">
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="container">
    <div class="hero-inner">
      <div class="hero-text">
        <span class="badge">${esc(c.heroBadge)}</span>
        <h1>${esc(c.heroTitle)}</h1>
        <p>${esc(c.heroSubtitle)}</p>
        <div class="ctas">
          <a class="btn" href="#cta">${esc(c.ctaPrimary)}</a>
          <a class="btn btn-light" href="#services">${esc(c.ctaSecondary)}</a>
        </div>
      </div>
      <form class="hero-form" onsubmit="event.preventDefault();this.querySelector('button').textContent='${esc(isRu ? 'Заявка отправлена' : 'Sent')}';this.reset();">
        <h3>${esc(isRu ? "Оставьте заявку" : "Request a callback")}</h3>
        <p class="f-sub">${esc(isRu ? "Перезвоним в течение 15 минут" : "We will call back within 15 minutes")}</p>
        <div class="field"><input type="text" name="name" placeholder="${esc(isRu ? "Ваше имя" : "Your name")}" required></div>
        <div class="field"><input type="tel" name="phone" placeholder="${esc(isRu ? "Телефон" : "Phone")}" required></div>
        <div class="field"><input type="email" name="email" placeholder="Email"></div>
        <label class="form-agree"><input type="checkbox" name="agree" required checked><span>${esc(consentLine)}</span></label>
        <button type="submit" class="btn">${esc(c.ctaPrimary)}</button>
      </form>
    </div>
  </div>
</section>

<section class="stats">
  <div class="container"><div class="stats-grid">${stats}</div></div>
</section>

<section id="why">
  <div class="container">
    <div class="why-grid">
      <img src="${whyImg}" alt="${esc(c.whyTitle)}" loading="lazy" width="800" height="600">
      <div>
        <div class="eyebrow" style="color:var(--accent);font-weight:600;font-size:13px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px">${esc(isRu ? "Преимущества" : "Benefits")}</div>
        <h2>${esc(c.whyTitle)}</h2>
        <p class="muted" style="margin-bottom:8px">${esc(c.whyText)}</p>
        <div class="features">${features}</div>
      </div>
    </div>
  </div>
</section>

<section id="services" class="services">
  <div class="container">
    <div class="section-head">
      <div class="eyebrow">${esc(isRu ? "Услуги" : "Services")}</div>
      <h2>${esc(isRu ? "Наши услуги и пакеты" : "Our services & packages")}</h2>
      <p class="muted">${esc(isRu ? "Выберите подходящий вариант или закажите индивидуальный расчет." : "Choose a package or request a custom quote.")}</p>
    </div>
    <div class="svc-grid">${services}</div>
  </div>
</section>

<section id="process">
  <div class="container">
    <div class="section-head">
      <div class="eyebrow">${esc(isRu ? "Процесс" : "Process")}</div>
      <h2>${esc(isRu ? "Как мы работаем" : "How we work")}</h2>
    </div>
    <div class="proc-grid">${process}</div>
  </div>
</section>

<section id="team" class="team">
  <div class="container">
    <div class="section-head">
      <div class="eyebrow">${esc(isRu ? "Команда" : "Team")}</div>
      <h2>${esc(isRu ? "Наша команда" : "Meet our team")}</h2>
    </div>
    <div class="team-grid">${team}</div>
  </div>
</section>

<section id="guarantee" class="guar">
  <div class="container">
    <div class="guar-grid">
      <div>
        <div class="eyebrow" style="color:var(--accent);font-weight:600;font-size:13px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px">${esc(isRu ? "Гарантии" : "Guarantee")}</div>
        <h2>${esc(c.guaranteeTitle)}</h2>
        <p class="muted">${esc(c.guaranteeText)}</p>
        <ul>${c.guaranteeBullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      </div>
      <img src="${guarImg}" alt="${esc(c.guaranteeTitle)}" loading="lazy" width="800" height="600">
    </div>
  </div>
</section>

<section class="testimonials">
  <div class="container">
    <div class="section-head">
      <div class="eyebrow">${esc(isRu ? "Отзывы" : "Testimonials")}</div>
      <h2>${esc(isRu ? "Отзывы наших клиентов" : "What clients say")}</h2>
    </div>
    <div class="test-grid">${testimonials}</div>
  </div>
</section>

<section id="blog">
  <div class="container">
    <div class="section-head">
      <div class="eyebrow">${esc(isRu ? "Блог" : "Blog")}</div>
      <h2>${esc(c.blogTitle)}</h2>
    </div>
    <div class="blog-grid">${blogCards}</div>
  </div>
</section>

<section id="about">
  <div class="container">
    <div class="about-short">
      <img src="${aboutImg}" alt="${esc(c.aboutShortTitle)}" loading="lazy" width="800" height="600">
      <div>
        <div class="eyebrow" style="color:var(--accent);font-weight:600;font-size:13px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px">${esc(isRu ? "О нас" : "About")}</div>
        <h2>${esc(c.aboutShortTitle)}</h2>
        <p class="muted" style="margin-bottom:18px">${esc(c.aboutShortText)}</p>
        <a class="btn btn-outline" href="/about.html">${esc(isRu ? "Подробнее о компании" : "More about us")}</a>
      </div>
    </div>
  </div>
</section>

<section id="cta" class="cta-section">
  <div class="container">
    <h2>${esc(c.ctaSectionTitle)}</h2>
    <p>${esc(c.ctaSectionText)}</p>
    <form class="cta-form" onsubmit="event.preventDefault();this.querySelector('button').textContent='${esc(isRu ? 'Отправлено' : 'Sent')}';this.reset();">
      <input type="text" name="name" placeholder="${esc(isRu ? "Имя" : "Name")}" required>
      <input type="tel" name="phone" placeholder="${esc(isRu ? "Телефон" : "Phone")}" required>
      <button type="submit" class="btn btn-light">${esc(c.ctaPrimary)}</button>
      <label class="form-agree"><input type="checkbox" name="agree" required checked><span>${esc(consentLine)}</span></label>
    </form>
  </div>
</section>

<section id="map">
  <div class="container">
    <div class="map-wrap"><iframe src="${mapSrc}" loading="lazy" title="map"></iframe></div>
  </div>
</section>

<section id="contacts" style="padding-top:48px">
  <div class="container">
    <div class="section-head">
      <div class="eyebrow">${esc(isRu ? "Контакты" : "Contacts")}</div>
      <h2>${esc(isRu ? "Свяжитесь с нами" : "Get in touch")}</h2>
    </div>
    <div class="contacts-grid">
      <div class="cinfo"><div class="lbl">${esc(isRu ? "Адрес" : "Address")}</div><div class="val">${esc(c.address)}</div></div>
      <div class="cinfo"><div class="lbl">${esc(isRu ? "Телефон" : "Phone")}</div><div class="val"><a href="tel:${esc(phoneHref)}">${esc(c.phone)}</a></div></div>
      <div class="cinfo"><div class="lbl">Email</div><div class="val"><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div></div>
      <div class="cinfo"><div class="lbl">${esc(isRu ? "Режим работы" : "Hours")}</div><div class="val">${esc(c.workHours)}</div></div>
    </div>
  </div>
</section>

${chromeOverride?.footerHtml || `<footer class="site-footer">
  <div class="foot-grid">
    <div>
      <span class="brand-foot">${esc(ctx.siteName)}</span>
      <p class="desc">${esc(c.aboutShortText)}</p>
    </div>
    <div>
      <h4>${esc(isRu ? "Меню" : "Menu")}</h4>
      <a href="/">${esc(isRu ? "Главная" : "Home")}</a>
      <a href="/services.html">${esc(isRu ? "Услуги" : "Services")}</a>
      <a href="/about.html">${esc(isRu ? "О нас" : "About")}</a>
      <a href="/blog/">${esc(isRu ? "Блог" : "Blog")}</a>
      <a href="/contacts.html">${esc(isRu ? "Контакты" : "Contacts")}</a>
    </div>
    <div>
      <h4>${esc(isRu ? "Информация" : "Information")}</h4>
      <a href="/privacy.html">${esc(isRu ? "Политика конфиденциальности" : "Privacy Policy")}</a>
      <a href="/terms.html">${esc(isRu ? "Пользовательское соглашение" : "Terms of Service")}</a>
      <a href="/faq.html">FAQ</a>
      <a href="/guarantees.html">${esc(isRu ? "Гарантии" : "Guarantees")}</a>
    </div>
    <div>
      <h4>${esc(isRu ? "Контакты" : "Contacts")}</h4>
      <a href="tel:${esc(phoneHref)}">${esc(c.phone)}</a>
      <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>
      <span style="color:rgba(255,255,255,.6);font-size:14px;display:block;padding:4px 0">${esc(c.address)}</span>
      <span style="color:rgba(255,255,255,.6);font-size:14px;display:block;padding:4px 0">${esc(c.workHours)}</span>
    </div>
  </div>
  <div class="copy">&copy; ${new Date().getFullYear()} ${esc(ctx.siteName)}. ${esc(isRu ? "Все права защищены." : "All rights reserved.")}</div>
</footer>`}

</body>
</html>`;
}