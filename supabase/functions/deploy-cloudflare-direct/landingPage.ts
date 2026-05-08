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

import { widgetsCss as sfWidgetsCss, widgetsHtml as sfWidgetsHtml } from "./siteWidgets.ts";
import { pickPhrase } from "./phrasePools.ts";
import { logCost, FAL_IMAGE_COST_USD } from "../_shared/costLogger.ts";

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

/**
 * Detect gender ("male" | "female") from a person's full name.
 * Works for both Russian (uses our seeded pools + Cyrillic suffix heuristics)
 * and English (seeded pools + common-name list). Falls back to "male" only as
 * a last resort so portraits never default to a single sex across the network.
 */
const RU_MALE_SET = new Set(RU_MALE.map((n) => n.toLowerCase()));
const RU_FEMALE_SET = new Set(RU_FEMALE.map((n) => n.toLowerCase()));
const EN_MALE_SET = new Set(EN_MALE.map((n) => n.toLowerCase()));
const EN_FEMALE_SET = new Set(EN_FEMALE.map((n) => n.toLowerCase()));

export function detectGenderFromName(fullName: string, seedSalt = ""): "male" | "female" {
  const raw = String(fullName || "").trim();
  if (!raw) return (_h("g:" + seedSalt) % 2) === 0 ? "male" : "female";
  const first = raw.split(/\s+/)[0].toLowerCase();
  const last = (raw.split(/\s+/)[1] || "").toLowerCase();

  if (RU_MALE_SET.has(first) || EN_MALE_SET.has(first)) return "male";
  if (RU_FEMALE_SET.has(first) || EN_FEMALE_SET.has(first)) return "female";

  // Russian heuristics: female surnames end in -ова/-ева/-ина/-ая, female
  // first names usually end in -а/-я; male first names usually end in
  // a consonant or -й.
  if (/[а-яё]/i.test(first)) {
    if (/(ова|ева|ина|ская|цкая|ая)$/i.test(last)) return "female";
    if (/(ов|ев|ин|ский|цкий|ый|ой|ий)$/i.test(last)) return "male";
    if (/[ая]$/i.test(first)) return "female";
    return "male";
  }
  // English fallback: common female-name endings.
  if (/(a|ie|y|ah|elle|ette)$/i.test(first)) return "female";
  // Deterministic fallback so we don't bias the whole network to one sex.
  return (_h("g:" + seedSalt + ":" + first) % 2) === 0 ? "male" : "female";
}

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

// ----------------------------- Seeded Stats ---------------------------------

/** Niche-specific label pool for the FIRST stat ("clients-equivalent"). */
const STAT_CLIENTS_LABEL_RU: Record<string, string> = {
  florist: "выполненных букетов",
  agro: "проданных единиц техники",
  renovation: "сданных объектов",
  legal: "выигранных дел",
  dental: "довольных пациентов",
  auto: "обслуженных автомобилей",
  cleaning: "выполненных уборок",
  delivery: "доставок в месяц",
  food: "довольных гостей",
  beauty: "постоянных клиентов",
  fitness: "активных участников",
  tech: "запущенных проектов",
  realty: "закрытых сделок",
  edu: "выпускников курсов",
  medical: "пациентов в год",
  generic: "довольных клиентов",
};
const STAT_CLIENTS_LABEL_EN: Record<string, string> = {
  florist: "bouquets delivered",
  agro: "units sold",
  renovation: "projects delivered",
  legal: "cases won",
  dental: "happy patients",
  auto: "cars serviced",
  cleaning: "cleanings completed",
  delivery: "monthly deliveries",
  food: "happy guests",
  beauty: "regular clients",
  fitness: "active members",
  tech: "projects shipped",
  realty: "deals closed",
  edu: "graduates",
  medical: "patients per year",
  generic: "happy clients",
};

/** Build a deterministic, niche-aware stats block. */
function buildSeededStats(
  topic: string, lang: "ru" | "en", seed: string,
): { value: string; label: string }[] {
  const niche = detectNiche(topic);
  const clientsPool = ["150+", "320+", "500+", "780+", "1200+", "2000+", "3500+", "5000+"];
  const yearsPool = ["3", "5", "7", "8", "10", "12", "15"];
  const pctPool = ["94%", "96%", "97%", "98%", "99%"];
  const fourthPoolRu: { value: string; label: string }[] = [
    { value: "24/7", label: "поддержка" },
    { value: "1 день", label: "срок выезда" },
    { value: "50+", label: "городов работы" },
    { value: "30 мин", label: "среднее время реакции" },
    { value: "0", label: "скрытых платежей" },
  ];
  const fourthPoolEn: { value: string; label: string }[] = [
    { value: "24/7", label: "support" },
    { value: "1 day", label: "on-site response" },
    { value: "50+", label: "cities served" },
    { value: "30 min", label: "average response" },
    { value: "0", label: "hidden fees" },
  ];
  const clients = _pick(clientsPool, seed, "st-clients");
  const years = _pick(yearsPool, seed, "st-years");
  const pct = _pick(pctPool, seed, "st-pct");
  const fourth = _pick(lang === "ru" ? fourthPoolRu : fourthPoolEn, seed, "st-4");
  const clientsLabel = lang === "ru"
    ? (STAT_CLIENTS_LABEL_RU[niche] || STAT_CLIENTS_LABEL_RU.generic)
    : (STAT_CLIENTS_LABEL_EN[niche] || STAT_CLIENTS_LABEL_EN.generic);
  return [
    { value: clients, label: clientsLabel },
    { value: years, label: lang === "ru" ? "лет на рынке" : "years on the market" },
    { value: pct, label: lang === "ru" ? "положительных отзывов" : "positive reviews" },
    fourth,
  ];
}

// ----------------------------- Seeded Services ------------------------------

type ServicePack = { title: string; bullets: string[]; price: string };
type NichePackTemplate = {
  titles: [string, string, string];
  prices: [string, string, string]; // a price expression per tier (RU: ₽, EN: $)
  bullets: [string[], string[], string[]];
};

/** Niche-aware service templates (RU). Three tiers per niche. */
const SERVICE_PACKS_RU: Record<string, NichePackTemplate> = {
  florist: {
    titles: ["Букет", "Композиция", "VIP оформление"],
    prices: ["от 1 200 ₽", "от 3 500 ₽", "от 12 000 ₽"],
    bullets: [
      ["Сезонные цветы", "Упаковка в крафт", "Открытка в подарок"],
      ["Авторская композиция", "Премиум упаковка", "Доставка в течение дня"],
      ["Эксклюзивные цветы", "Дизайнерское оформление", "Срочная доставка курьером", "Фотоотчет получателя"],
    ],
  },
  agro: {
    titles: ["Базовая комплектация", "Расширенная комплектация", "Премиум комплектация"],
    prices: ["от 145 000 ₽", "от 220 000 ₽", "от 380 000 ₽"],
    bullets: [
      ["Минитрактор без навесного", "Гарантия 12 месяцев", "Обучение работе"],
      ["Минитрактор с базовым навесным", "Гарантия 24 месяца", "Доставка по региону"],
      ["Минитрактор с полным навесным комплектом", "Расширенная гарантия 36 мес", "Сервисное обслуживание", "Запчасти в наличии"],
    ],
  },
  renovation: {
    titles: ["Косметический ремонт", "Комплексный ремонт", "Ремонт под ключ"],
    prices: ["от 3 500 ₽/м²", "от 6 500 ₽/м²", "от 11 000 ₽/м²"],
    bullets: [
      ["Покраска и обои", "Замена напольных покрытий", "Гарантия 6 месяцев"],
      ["Полная замена коммуникаций", "Выравнивание стен и потолков", "Гарантия 24 месяца"],
      ["Дизайн-проект", "Закупка материалов", "Авторский надзор", "Гарантия 36 месяцев"],
    ],
  },
  legal: {
    titles: ["Консультация", "Сопровождение", "Полный пакет"],
    prices: ["от 2 500 ₽", "от 25 000 ₽/мес", "от 80 000 ₽"],
    bullets: [
      ["Анализ ситуации", "Письменное заключение", "Рекомендации по действиям"],
      ["Подготовка документов", "Представительство в инстанциях", "Текущие консультации"],
      ["Полное ведение дела", "Представительство в суде", "Досудебное урегулирование", "Контроль исполнения решения"],
    ],
  },
  dental: {
    titles: ["Профилактика", "Лечение", "Имплантация"],
    prices: ["от 1 800 ₽", "от 6 500 ₽", "от 45 000 ₽"],
    bullets: [
      ["Осмотр и консультация", "Профессиональная гигиена", "Рекомендации по уходу"],
      ["Лечение кариеса", "Восстановление пломб", "Анестезия включена"],
      ["Установка импланта", "Постоянная коронка", "Гарантия на работу 5 лет", "Контрольные визиты"],
    ],
  },
  auto: {
    titles: ["Диагностика", "Плановое ТО", "Капитальный ремонт"],
    prices: ["от 1 500 ₽", "от 6 000 ₽", "от 35 000 ₽"],
    bullets: [
      ["Компьютерная диагностика", "Проверка ходовой", "Письменное заключение"],
      ["Замена масла и фильтров", "Проверка тормозной системы", "Гарантия на работы"],
      ["Полный разбор узла", "Замена изношенных деталей", "Сборка и регулировка", "Гарантия 12 месяцев"],
    ],
  },
  cleaning: {
    titles: ["Поддерживающая уборка", "Генеральная уборка", "После ремонта"],
    prices: ["от 2 800 ₽", "от 6 500 ₽", "от 9 500 ₽"],
    bullets: [
      ["Влажная уборка полов", "Пыль и поверхности", "Санузел и кухня"],
      ["Мойка окон", "Чистка мебели", "Глубокая обработка кухни и санузла"],
      ["Удаление строительной пыли", "Мойка стекол и плитки", "Чистка вентиляции", "Дезинфекция"],
    ],
  },
  delivery: {
    titles: ["Стандарт", "Экспресс", "Корпоративный"],
    prices: ["от 250 ₽", "от 600 ₽", "от 15 000 ₽/мес"],
    bullets: [
      ["Доставка в течение дня", "Подтверждение получателя", "СМС-уведомления"],
      ["Доставка за 2 часа", "Приоритетная обработка", "Онлайн-трекинг"],
      ["Выделенный менеджер", "Ежедневные маршруты", "Закрывающие документы", "Гибкие тарифы по объему"],
    ],
  },
  food: {
    titles: ["Бизнес-ланч", "Заказ из меню", "Банкет"],
    prices: ["от 350 ₽", "от 850 ₽", "от 2 500 ₽/чел"],
    bullets: [
      ["Суп, горячее, напиток", "Свежие продукты дня", "Доставка к 13:00"],
      ["Блюда из основного меню", "Доставка за 60 минут", "Упаковка для горячего"],
      ["Холодные и горячие закуски", "Основные блюда на выбор", "Сервировка стола", "Помощь официанта"],
    ],
  },
  beauty: {
    titles: ["Стрижка", "Окрашивание", "Полное преображение"],
    prices: ["от 1 500 ₽", "от 4 500 ₽", "от 12 000 ₽"],
    bullets: [
      ["Консультация мастера", "Мытье головы", "Укладка феном"],
      ["Подбор оттенка", "Окрашивание премиум-краской", "Уход после окрашивания"],
      ["Стрижка и окрашивание", "Уходовые процедуры", "Профессиональная укладка", "Подбор домашнего ухода"],
    ],
  },
  fitness: {
    titles: ["Месячный абонемент", "Полугодовой", "Годовой"],
    prices: ["от 2 800 ₽", "от 14 500 ₽", "от 24 000 ₽"],
    bullets: [
      ["Доступ в тренажерный зал", "Групповые программы", "Раздевалка с душем"],
      ["Безлимитный доступ", "Персональная программа", "2 тренировки с тренером"],
      ["Все зоны клуба", "Сауна и бассейн", "Персональный тренер", "Заморозка абонемента"],
    ],
  },
  tech: {
    titles: ["Лендинг", "Корпоративный сайт", "Веб-сервис"],
    prices: ["от 65 000 ₽", "от 180 000 ₽", "от 450 000 ₽"],
    bullets: [
      ["Дизайн на 1 экран", "Адаптивная верстка", "Подключение форм и аналитики"],
      ["До 10 страниц", "Уникальный дизайн", "CMS для самостоятельных правок"],
      ["Техническое задание", "Дизайн и разработка", "Интеграции с CRM/платежами", "Поддержка после запуска"],
    ],
  },
  realty: {
    titles: ["Подбор объекта", "Сопровождение сделки", "Полный цикл"],
    prices: ["от 15 000 ₽", "от 45 000 ₽", "от 3% от сделки"],
    bullets: [
      ["Анализ требований", "Подборка вариантов", "Организация просмотров"],
      ["Юридическая проверка", "Подготовка договора", "Сопровождение в МФЦ"],
      ["Поиск и проверка", "Переговоры с продавцом", "Полное юридическое сопровождение", "Контроль расчетов"],
    ],
  },
  edu: {
    titles: ["Базовый курс", "Расширенная программа", "Индивидуально"],
    prices: ["от 9 500 ₽", "от 28 000 ₽", "от 65 000 ₽"],
    bullets: [
      ["Видеоуроки и материалы", "Домашние задания", "Сертификат об окончании"],
      ["Все из базового", "Куратор и обратная связь", "Практический проект"],
      ["Программа под ваши цели", "Личный наставник", "Гибкий график", "Гарантия результата"],
    ],
  },
  medical: {
    titles: ["Прием специалиста", "Диагностический комплекс", "Программа наблюдения"],
    prices: ["от 1 800 ₽", "от 8 500 ₽", "от 25 000 ₽"],
    bullets: [
      ["Консультация профильного врача", "Первичный осмотр", "Назначение схемы лечения"],
      ["Анализы и обследования", "Расшифровка результатов", "Заключение специалиста"],
      ["Регулярные визиты по графику", "Анализы в динамике", "Корректировка лечения", "Личный куратор"],
    ],
  },
  generic: {
    titles: ["Стартовый", "Оптимальный", "Расширенный"],
    prices: ["от 4 500 ₽", "от 12 000 ₽", "от 28 000 ₽"],
    bullets: [
      ["Консультация специалиста", "Подбор решения под задачу", "Письменная смета"],
      ["Полный комплекс работ", "Гарантия 12 месяцев", "Сопровождение менеджером"],
      ["Работы под ключ", "Срочное выполнение", "Расширенная гарантия 24 мес", "Постгарантийный сервис"],
    ],
  },
};

const SERVICE_PACKS_EN: Record<string, NichePackTemplate> = {
  florist: {
    titles: ["Bouquet", "Composition", "VIP Arrangement"],
    prices: ["from $25", "from $60", "from $180"],
    bullets: [
      ["Seasonal flowers", "Kraft wrapping", "Greeting card included"],
      ["Custom composition", "Premium wrapping", "Same-day delivery"],
      ["Exclusive flowers", "Designer arrangement", "Express courier", "Recipient photo"],
    ],
  },
  agro: {
    titles: ["Base Package", "Extended Package", "Premium Package"],
    prices: ["from $4,500", "from $7,800", "from $13,500"],
    bullets: [
      ["Tractor only", "12-month warranty", "Operator training"],
      ["Tractor with basic implements", "24-month warranty", "Regional delivery"],
      ["Full implement set", "36-month extended warranty", "Service plan", "Spare parts in stock"],
    ],
  },
  renovation: {
    titles: ["Cosmetic", "Comprehensive", "Turnkey"],
    prices: ["from $35/sqft", "from $65/sqft", "from $110/sqft"],
    bullets: [
      ["Painting and wallpaper", "Floor replacement", "6-month warranty"],
      ["Full utility replacement", "Wall and ceiling leveling", "24-month warranty"],
      ["Design project", "Material procurement", "Author supervision", "36-month warranty"],
    ],
  },
  legal: {
    titles: ["Consultation", "Retainer", "Full Representation"],
    prices: ["from $150", "from $850/mo", "from $3,500"],
    bullets: [
      ["Case review", "Written opinion", "Action plan"],
      ["Document preparation", "Agency representation", "Ongoing advice"],
      ["Full case management", "Court representation", "Pre-trial settlement", "Enforcement follow-up"],
    ],
  },
  dental: {
    titles: ["Preventive", "Treatment", "Implant"],
    prices: ["from $80", "from $250", "from $1,800"],
    bullets: [
      ["Exam and consultation", "Professional cleaning", "Care recommendations"],
      ["Cavity treatment", "Filling restoration", "Anesthesia included"],
      ["Implant placement", "Permanent crown", "5-year work warranty", "Follow-up visits"],
    ],
  },
  auto: {
    titles: ["Diagnostic", "Scheduled Service", "Major Repair"],
    prices: ["from $80", "from $250", "from $1,400"],
    bullets: [
      ["Computer diagnostic", "Suspension check", "Written report"],
      ["Oil and filter change", "Brake system check", "Service warranty"],
      ["Full unit teardown", "Worn part replacement", "Reassembly and tuning", "12-month warranty"],
    ],
  },
  cleaning: {
    titles: ["Maintenance Cleaning", "Deep Cleaning", "Post-Renovation"],
    prices: ["from $90", "from $220", "from $320"],
    bullets: [
      ["Damp floor mopping", "Dust and surfaces", "Bathroom and kitchen"],
      ["Window cleaning", "Furniture cleaning", "Deep kitchen and bath"],
      ["Construction dust removal", "Glass and tile wash", "Vent cleaning", "Disinfection"],
    ],
  },
  delivery: {
    titles: ["Standard", "Express", "Corporate"],
    prices: ["from $9", "from $22", "from $450/mo"],
    bullets: [
      ["Same-day delivery", "Recipient confirmation", "SMS notifications"],
      ["2-hour delivery", "Priority handling", "Online tracking"],
      ["Dedicated manager", "Daily routes", "Closing documents", "Volume-based pricing"],
    ],
  },
  food: {
    titles: ["Business Lunch", "Menu Order", "Banquet"],
    prices: ["from $12", "from $28", "from $85/person"],
    bullets: [
      ["Soup, main, drink", "Fresh daily ingredients", "Delivered by 1 PM"],
      ["Main menu dishes", "60-minute delivery", "Hot food packaging"],
      ["Cold and hot appetizers", "Choice of main courses", "Table setup", "Server assistance"],
    ],
  },
  beauty: {
    titles: ["Haircut", "Coloring", "Full Makeover"],
    prices: ["from $45", "from $140", "from $360"],
    bullets: [
      ["Stylist consultation", "Shampoo wash", "Blow-dry"],
      ["Shade selection", "Premium color treatment", "Post-color care"],
      ["Cut and color", "Care treatments", "Professional styling", "Home-care advice"],
    ],
  },
  fitness: {
    titles: ["Monthly Pass", "6-Month Pass", "Annual Pass"],
    prices: ["from $85", "from $440", "from $720"],
    bullets: [
      ["Gym floor access", "Group classes", "Locker room with shower"],
      ["Unlimited access", "Personal program", "2 PT sessions"],
      ["All club zones", "Sauna and pool", "Personal trainer", "Membership freeze"],
    ],
  },
  tech: {
    titles: ["Landing Page", "Corporate Site", "Web App"],
    prices: ["from $1,800", "from $5,500", "from $14,000"],
    bullets: [
      ["One-screen design", "Responsive markup", "Forms and analytics"],
      ["Up to 10 pages", "Unique design", "CMS for self-edits"],
      ["Technical spec", "Design and development", "CRM/payment integrations", "Post-launch support"],
    ],
  },
  realty: {
    titles: ["Property Search", "Deal Support", "Full Cycle"],
    prices: ["from $450", "from $1,400", "from 3% of deal"],
    bullets: [
      ["Requirements analysis", "Property shortlist", "Viewing arrangements"],
      ["Legal due diligence", "Contract preparation", "Closing support"],
      ["Search and verification", "Seller negotiations", "Full legal support", "Settlement control"],
    ],
  },
  edu: {
    titles: ["Basic Course", "Extended Program", "One-on-One"],
    prices: ["from $290", "from $850", "from $2,000"],
    bullets: [
      ["Video lessons and materials", "Homework", "Completion certificate"],
      ["Everything in Basic", "Curator and feedback", "Practical project"],
      ["Tailored to your goals", "Personal mentor", "Flexible schedule", "Result guarantee"],
    ],
  },
  medical: {
    titles: ["Specialist Visit", "Diagnostic Suite", "Care Program"],
    prices: ["from $80", "from $380", "from $1,100"],
    bullets: [
      ["Specialist consultation", "Initial exam", "Treatment plan"],
      ["Tests and imaging", "Result interpretation", "Specialist conclusion"],
      ["Scheduled visits", "Trend testing", "Treatment adjustments", "Personal coordinator"],
    ],
  },
  generic: {
    titles: ["Starter", "Optimal", "Extended"],
    prices: ["from $140", "from $380", "from $850"],
    bullets: [
      ["Specialist consultation", "Tailored solution", "Written estimate"],
      ["Full service", "12-month warranty", "Account manager"],
      ["Turnkey delivery", "Priority response", "24-month extended warranty", "Post-warranty service"],
    ],
  },
};

/** Build a deterministic, niche-aware services block. */
function buildSeededServices(
  topic: string, lang: "ru" | "en", seed: string,
): ServicePack[] {
  const niche = detectNiche(topic);
  const tpl = (lang === "ru" ? SERVICE_PACKS_RU : SERVICE_PACKS_EN)[niche]
    || (lang === "ru" ? SERVICE_PACKS_RU : SERVICE_PACKS_EN).generic;
  // Deterministic per-tier bullet shuffle so identical niches still differ.
  return [0, 1, 2].map((i) => ({
    title: tpl.titles[i],
    price: tpl.prices[i],
    bullets: _shuffle(tpl.bullets[i], seed + ":svc" + i),
  }));
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
  /** Brand icon (FAL-generated, NO text). Rendered next to siteName text. */
  iconUrl?: string;
  /** Floating "Back to top" position; default left-bottom. */
  totopPosition?: "left-bottom" | "right-bottom" | "left-top" | "right-top" | "hidden";
  /** Stable seed for phrase-pool randomization (defaults to domain). */
  projectId?: string;
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

// Strips non-ASCII (Cyrillic etc.) from any string that we feed into Flux.
// The model treats Cyrillic as visual glyphs and bakes garbled letters into
// the picture, so prompts MUST stay pure English.
function asciiOnly(s: string, max = 120): string {
  return String(s || "").replace(/[^\x20-\x7E]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

const NO_TEXT_RULE = "ABSOLUTELY NO TEXT, no letters, no words, no captions, no signs, no logos, no watermarks, no typography, no writing of any kind anywhere in the image";
const NO_TEXT_NEG  = "text, letters, words, captions, signs, logos, watermarks, typography, writing, characters, font, alphabet, cyrillic, latin text, numbers, labels, subtitles, title cards";

async function falGenerate(
  falKey: string,
  prompt: string,
  size: "landscape_16_9" | "landscape_4_3" | "square_hd",
  costCtx?: { admin?: any; projectId?: string; slot?: string; opType?: "fal_ai_photo" | "fal_ai_portrait" | "fal_ai_logo" },
): Promise<string | null> {
  try {
    const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
      method: "POST",
      headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        negative_prompt: NO_TEXT_NEG,
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
    const ok = typeof url === "string" && /^https?:\/\//.test(url);
    if (ok && costCtx?.admin) {
      void logCost(costCtx.admin, {
        project_id: costCtx.projectId,
        operation_type: costCtx.opType || "fal_ai_photo",
        model: "fal-ai/flux/schnell",
        cost_usd: FAL_IMAGE_COST_USD,
        metadata: { slot: costCtx.slot, size },
      });
    }
    return ok ? url : null;
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

  // Sanitize: prompts must be ASCII only — Flux bakes Cyrillic letters as
  // garbled glyphs directly into the photo otherwise.
  const niche = asciiOnly(input.niche || "business", 80) || "business";
  const region = asciiOnly(input.region || "", 60);
  const audience = asciiOnly(input.audience || "", 80);
  const ctxLine = [niche, region && `in ${region}`, audience && `for ${audience}`]
    .filter(Boolean).join(" ");

  // Build the slot generation plan
  type Job = { slot: string; prompt: string; size: "landscape_16_9" | "landscape_4_3" | "square_hd" };
  const jobs: Job[] = [];

  const baseStyle = `high quality, natural lighting, photorealistic, magazine quality, ${NO_TEXT_RULE}`;

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

  // Team portraits — gender MUST match each member's actual name (otherwise
  // we get "Sergey" with a female face). Age varies deterministically per slot
  // so the three portraits don't look like clones.
  const ageBuckets = ["28-35", "30-42", "35-48"];
  const looks = ["friendly smile", "confident expression", "warm professional smile"];
  for (let i = 0; i < Math.min(3, input.team.length || 3); i++) {
    const slot = `team_${i + 1}`;
    if (out[slot]) continue;
    const member = input.team[i];
    const gender = detectGenderFromName(member?.name || "", `${projectId}:team:${i}`);
    const subject = gender === "male" ? "a man" : "a woman";
    const ageRange = ageBuckets[i % ageBuckets.length];
    const look = looks[i % looks.length];
    jobs.push({
      slot, size: "square_hd",
      prompt: `Professional headshot portrait photo of ${subject}, ${ageRange} years old, ${look}, modern office background, soft natural lighting, working in ${niche} industry, photorealistic, sharp focus on face, ${baseStyle}.`,
    });
  }

  // Blog post previews — up to 3.
  // We deliberately do NOT inject the post title (it's typically Cyrillic and
  // would be rendered as garbled text on the image). Use the niche context
  // only and add a per-slot variation hint so previews don't look identical.
  const postHints = [
    "wide environmental shot",
    "close-up detail shot",
    "team or workspace shot",
  ];
  for (let i = 0; i < Math.min(3, input.posts.length); i++) {
    const slot = `post_${i + 1}`;
    if (out[slot]) continue;
    jobs.push({
      slot, size: "landscape_16_9",
      prompt: `Editorial photograph related to ${ctxLine}, ${postHints[i % postHints.length]}, ${baseStyle}.`,
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
        const isPortrait = j.slot.startsWith("team_");
        const url = await falGenerate(falKey, j.prompt, j.size, {
          admin, projectId, slot: j.slot,
          opType: isPortrait ? "fal_ai_portrait" : "fal_ai_photo",
        });
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

/**
 * Generates (or reuses cached) a minimalist brand ICON via FAL flux/schnell.
 * The icon contains NO text/letters — text part is rendered in HTML next to it.
 *
 * Cached in `site_image_cache` under slot `logo_icon`, keyed by project_id.
 * On any failure returns null (caller falls back to first-letter avatar).
 */
export async function ensureSiteIcon(
  admin: any,
  projectId: string,
  falKey: string | null,
  niche: string,
  accent: string,
): Promise<string | null> {
  // 1) reuse cache
  try {
    const { data: cached } = await admin
      .from("site_image_cache")
      .select("image_url")
      .eq("project_id", projectId)
      .eq("slot", "logo_icon")
      .maybeSingle();
    if (cached?.image_url && /^https?:\/\//.test(cached.image_url)) {
      return cached.image_url as string;
    }
  } catch (e: any) {
    console.warn("[landingPage.icon] cache read failed:", e?.message);
  }

  if (!falKey) {
    console.log("[landingPage.icon] no FAL key, skipping logo generation");
    return null;
  }

  const cleanNiche = asciiOnly(niche || "business", 60) || "business";
  const colorHex = (accent || "#0ea5e9").trim();
  const prompt =
    `minimalist icon logo for ${cleanNiche} business, ` +
    `simple flat icon only, NO TEXT, NO LETTERS, NO WORDS, NO TYPOGRAPHY, ` +
    `single icon symbol, ${colorHex} color, white background, ` +
    `vector style, clean lines, geometric, professional minimalist design, ` +
    `centered, plenty of whitespace, app icon style`;

  const url = await falGenerate(falKey, prompt, "square_hd", {
    admin, projectId, slot: "logo_icon", opType: "fal_ai_logo",
  });
  if (!url) return null;

  try {
    await admin.from("site_image_cache").upsert({
      project_id: projectId,
      slot: "logo_icon",
      prompt: prompt.slice(0, 1000),
      image_url: url,
      source: "fal",
    }, { onConflict: "project_id,slot" });
  } catch (e: any) {
    console.warn("[landingPage.icon] cache write failed:", e?.message);
  }
  return url;
}

// ----------------------------- AI Content Generation -------------------------

import { fetchUnsplashPhotos, getUnsplashKey, type UnsplashPhoto } from "../_shared/unsplash.ts";

/**
 * Fills any missing landing image slots (hero/why/guarantee/about/post_*)
 * from Unsplash. Mutates and returns the same slots map. Also returns
 * attribution entries for the photos that were actually used.
 *
 * Cached in `site_image_cache` (source='unsplash') so re-deploys are stable.
 */
export async function ensureUnsplashImages(
  admin: any,
  projectId: string,
  niche: string,
  slots: Record<string, string>,
): Promise<{ slots: Record<string, string>; attributions: UnsplashPhoto[] }> {
  const wanted = ["hero", "why", "guarantee", "about", "post_1", "post_2", "post_3"];
  const missing = wanted.filter((s) => !slots[s] || !/^https?:\/\//.test(slots[s]));

  // Always try to load existing attributions from cache so the footer credit
  // shows even on subsequent deploys (no fresh API call needed).
  const attributions: UnsplashPhoto[] = [];
  try {
    const { data: cached } = await admin
      .from("site_image_cache")
      .select("slot, image_url, prompt, source")
      .eq("project_id", projectId)
      .eq("source", "unsplash");
    for (const row of (cached || [])) {
      if (!row?.prompt) continue;
      try {
        const meta = JSON.parse(String(row.prompt));
        if (meta?.authorName && meta?.photoUrl) {
          attributions.push({
            url: row.image_url, thumb: row.image_url,
            authorName: meta.authorName, authorUrl: meta.authorUrl || "https://unsplash.com",
            photoUrl: meta.photoUrl, alt: meta.alt || "",
          });
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  if (missing.length === 0) return { slots, attributions };

  const accessKey = await getUnsplashKey(admin);
  if (!accessKey) {
    return { slots, attributions };
  }

  const photos = await fetchUnsplashPhotos(accessKey, niche, missing.length);
  if (photos.length === 0) return { slots, attributions };

  for (let i = 0; i < missing.length && i < photos.length; i++) {
    const slot = missing[i];
    const p = photos[i];
    slots[slot] = p.url;
    attributions.push(p);
    try {
      await admin.from("site_image_cache").upsert({
        project_id: projectId,
        slot,
        prompt: JSON.stringify({
          authorName: p.authorName, authorUrl: p.authorUrl,
          photoUrl: p.photoUrl, alt: p.alt,
        }).slice(0, 1000),
        image_url: p.url,
        source: "unsplash",
      }, { onConflict: "project_id,slot" });
    } catch (e: any) {
      console.warn("[unsplash] cache write failed:", slot, e?.message);
    }
  }
  return { slots, attributions };
}

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
  const seededStats = buildSeededStats(topic, lang, _seed);
  const seededServices = buildSeededServices(topic, lang, _seed);
  const fallback: LandingContent = {
    ...baseFallback,
    ...seededHero,
    team: seededTeam,
    stats: seededStats,
    services: seededServices,
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
HERO (КРИТИЧНО): heroTitle - это конкретное УТП компании: что делает, для кого, где (например: «Доставка свежих цветов и букетов по Москве», «Продажа и обслуживание минитракторов для дачи»). СТРОГО ЗАПРЕЩЕНЫ шаблонные фразы: «профессиональные решения по теме», «решения по теме», «решения в области», «услуги по теме», «комплекс услуг», «лидер рынка» - не используй их ни в каком виде. Ключевое слово ниши должно входить в heroTitle естественно. heroSubtitle - 1-2 предложения о главной выгоде клиента (что получит и за какой срок), без воды. heroBadge - короткий маркер доверия («Работаем с 2014 года», «Доставка за 2 часа»), не «Лидер рынка».
КОМАНДА: должности СТРОГО из ниши (флорист, механик, прораб, юрист, стоматолог и т.п.). Запрещено использовать «Руководитель», «Главный специалист», «Менеджер проектов» - эти три формулировки одинаковы для всех сайтов и являются фингерпринтом. Имена и фамилии - разнообразные русские (Андрей Козлов, Екатерина Новикова, Михаил Морозов). НЕ используй имена «Алексей Иванов», «Мария Петрова», «Дмитрий Соколов». BIO - 1-2 предложения с привязкой к нише: что человек делает в этой нише и сколько лет (например «Создает букеты для свадеб 8 лет»), не «управляет проектами полного цикла».
СТАТИСТИКА (КРИТИЧНО): 4 цифры должны быть РЕАЛИСТИЧНЫМИ для конкретной ниши и НЕ шаблонными. Запрещено использовать набор «1500+ / 12 / 98% / 24/7» - это фингерпринт всех сайтов. Подбирай: 1) количество клиентов/проектов/единиц - из реалистичного диапазона ниши (для флориста - букетов, для агро - единиц техники, для стоматологии - пациентов); 2) лет на рынке - 3..15; 3) процент положительных отзывов - 94-99%; 4) четвертый показатель уникальный для ниши (срок выезда, города, время реакции, отсутствие скрытых платежей).
ПАКЕТЫ УСЛУГ (КРИТИЧНО): названия пакетов СТРОГО из ниши, НИКОГДА не «Базовый/Стандарт/Премиум» - это шаблонный фингерпринт. Используй реальные названия: для цветочного - «Букет / Композиция / VIP оформление», для ремонта - «Косметический / Комплексный / Под ключ», для минитракторов - «Базовая комплектация / Расширенная / Премиум комплектация», для юристов - «Консультация / Сопровождение / Полный пакет». ЦЕНЫ - реалистичные для рынка России 2025 в выбранной нише: цветы 800-12000 ₽, ремонт 3000-11000 ₽/м², минитрактор 85000-380000 ₽, юристы 2500-80000 ₽. СОСТАВ - 3-4 пункта строго из ниши, без общих «Консультация специалиста».
ОБЯЗАТЕЛЬНО: 1) ВСЕ услуги, цены, профессии команды, отзывы, статистика, FAQ - строго из указанной ниши. Никаких общих "консультаций" если ниша - продажа минитракторов. 2) Названия услуг используют РЕАЛЬНУЮ терминологию ниши (для ниши "минитракторы" - "продажа минитрактора", "сервис и ТО", "доставка навесного оборудования", а не "Базовый/Стандарт/Премиум"). 3) Цены реалистичные для рынка ниши и региона (минитрактор от 250 000 руб, а не от 5 000). 4) Команда - должности из ниши (агроном, механик по сельхозтехнике), а не "руководитель/специалист". 5) Статистика релевантна нише (тракторов продано, моделей в наличии). 6) Отзывы - от целевой аудитории ниши. 7) Адрес и код телефона - в указанном регионе.
ФОРМАТ: Естественный язык, без канцелярита и без слова «уникальный». Цены, телефон, адрес - реалистичные. НЕ используй жирный шрифт и звёздочки. Замени все длинные тире на дефисы. Никогда не используй букву «ё» - только «е». Никаких выдуманных сертификатов. Иконки в полях icon - короткие unicode-символы (★ ✓ ⚡ ₽ ① ② ③ ④ ✦ ⬢ ◆ ●), не emoji.`
    : `You write copy for a real business landing page. Topic and brand name are given.
HERO (CRITICAL): heroTitle is a concrete value proposition: what the company does, for whom, where (e.g. "Fresh flower delivery across NYC", "Compact tractor sales and service in Texas"). STRICTLY FORBIDDEN cliches: "professional solutions for", "solutions in the field of", "comprehensive services", "industry leader", "market leader". The niche keyword must appear naturally in heroTitle. heroSubtitle - 1-2 sentences about the main client benefit. heroBadge - a short trust marker like "Trusted since 2014" or "Same-day delivery", not "Industry Leader".
TEAM: roles STRICTLY niche-specific (florist, mechanic, foreman, attorney, dentist etc.). Do NOT use "Director", "Lead Specialist", "Project Manager" - these three are identical across all sites and act as a fingerprint. Names - varied Western names. NOT "Alex Johnson, Maria Smith, David Brown". BIO - 1-2 niche-specific sentences (what the person actually does and for how many years).
STATS (CRITICAL): the 4 numbers must be REALISTIC for the specific niche and NOT generic. Forbidden fingerprint set: "1500+ / 12 / 98% / 24/7" (used by every template site). Pick: 1) clients/projects/units in a realistic niche range; 2) years on the market 3..15; 3) positive reviews 94-99%; 4) a 4th niche-specific metric (response time, cities served, hidden-fee guarantee, etc.).
SERVICE PACKAGES (CRITICAL): pack titles STRICTLY niche-specific, NEVER "Basic/Standard/Premium" (template fingerprint). Use real names: florist - "Bouquet / Composition / VIP Arrangement", renovation - "Cosmetic / Comprehensive / Turnkey", tractors - "Base / Extended / Premium Package", legal - "Consultation / Retainer / Full Representation". PRICES realistic for the market: do not use $99/$299/$599 placeholders. BULLETS 3-4 niche-specific items, not generic "Specialist consultation".
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
    // Post-AI guard: if the model still produced banned phrases or hardcoded
    // template names, swap those fields for the deterministic seeded fallback.
    const BANNED_HERO = /(профессиональные решения по теме|решения по теме|решения в области|услуги по теме|комплекс услуг|лидер рынка|professional solutions for|solutions in the field of|comprehensive services|industry leader|market leader)/i;
    const BANNED_NAMES = new Set(["Алексей Иванов","Мария Петрова","Дмитрий Соколов","Alex Johnson","Maria Smith","David Brown"]);
    const BANNED_ROLES = /^(руководитель|главный специалист|менеджер проектов|director|lead specialist|project manager)$/i;
    const BANNED_SERVICE_TITLES = /^(базовый( пакет)?|стандарт|премиум|basic( package)?|standard|premium)$/i;
    // Fingerprint stat values from the old hardcoded fallback.
    const FINGERPRINT_STATS = new Set(["1500+", "1,500+", "12", "98%", "24/7"]);
    if (BANNED_HERO.test(clean.heroTitle) || BANNED_HERO.test(clean.heroSubtitle)) {
      Object.assign(clean, seededHero);
    }
    if (clean.team.some((m) => BANNED_NAMES.has(m.name) || BANNED_ROLES.test((m.role || "").trim()))) {
      clean.team = seededTeam;
    }
    // If AI returned the generic Basic/Standard/Premium packs, swap with seeded niche packs.
    if (
      !Array.isArray(clean.services) || clean.services.length < 3 ||
      clean.services.slice(0, 3).every((s) => BANNED_SERVICE_TITLES.test((s.title || "").trim()))
    ) {
      clean.services = seededServices;
    }
    // If AI parroted the old fingerprint stat numbers, swap with seeded ones.
    if (
      !Array.isArray(clean.stats) || clean.stats.length < 4 ||
      clean.stats.slice(0, 4).every((s) => FINGERPRINT_STATS.has((s.value || "").trim()))
    ) {
      clean.stats = seededStats;
    }
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
  // Anti-fingerprint: replace template-fixed UI phrases with seed-stable
  // variants from the shared phrase pool so different sites in the same PBN
  // do not share byte-identical CTA/section labels.
  {
    const seed = String(ctx.projectId || ctx.domain || ctx.siteName || "site");
    c = {
      ...c,
      whyTitle: pickPhrase("whyTitle", ctx.lang, seed),
      ctaSectionText: pickPhrase("ctaSectionText", ctx.lang, seed),
    };
  }
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
.brand{display:inline-flex;align-items:center;gap:10px;line-height:1}
.brand-icon{width:36px;height:36px;border-radius:8px;object-fit:contain;background:#fff;flex-shrink:0;display:block}
.brand-text{display:inline-block;vertical-align:middle}
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
.foot-grid .brand-foot{display:inline-flex;align-items:center;gap:8px;font-size:18px}
.foot-grid .brand-foot .brand-icon{width:32px;height:32px;border-radius:6px;background:#fff;padding:2px;object-fit:contain}
.foot-grid .desc{font-size:14px;line-height:1.6;color:rgba(255,255,255,.6)}
.copy{max-width:1200px;margin:48px auto 0;padding-top:24px;border-top:1px solid rgba(255,255,255,.1);font-size:13px;color:rgba(255,255,255,.5);text-align:center}
@media(max-width:860px){.foot-grid{grid-template-columns:1fr 1fr;gap:32px 20px}}
${sfWidgetsCss(ctx.totopPosition || "left-bottom")}
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
    const initials = String(tt.name || "?").trim().split(/\s+/).filter(Boolean)
      .slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
    const tints = ["#fef3c7","#dbeafe","#fce7f3","#dcfce7","#ede9fe","#ffedd5"];
    let h = 2166136261 >>> 0;
    for (let k = 0; k < tt.name.length; k++) { h ^= tt.name.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0; }
    const bg = tints[h % tints.length];
    const fg = (ctx.accent || "#1a1a1a").slice(0, 9);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 42 42'><rect width='42' height='42' rx='21' fill='${bg}'/><text x='21' y='27' text-anchor='middle' font-family='Georgia,serif' font-size='17' font-weight='700' fill='${fg}'>${initials}</text></svg>`;
    const ava = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    return `
    <div class="test">
      <div class="stars" aria-label="${tt.rating} of 5">${stars}</div>
      <p>"${esc(tt.text)}"</p>
      <div class="author"><img src="${ava}" alt="${esc(tt.name)}" loading="lazy" width="42" height="42"><div><div class="name">${esc(tt.name)}</div><div class="who">${esc(tt.role)}</div></div></div>
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

  const _localeMap: Record<string, string> = {
    ru: "ru-RU", en: "en-US", de: "de-DE", es: "es-ES", fr: "fr-FR",
    it: "it-IT", pl: "pl-PL", uk: "uk-UA", tr: "tr-TR", pt: "pt-BR",
  };
  const _htmlLocale = _localeMap[String((ctx as any).lang || "ru").toLowerCase().slice(0, 2)] || "ru-RU";
  return `<!doctype html>
<html lang="${_htmlLocale}">
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
    <a href="/" class="brand">${ctx.iconUrl ? `<img class="brand-icon" src="${esc(ctx.iconUrl)}" alt="" width="36" height="36" loading="eager" decoding="async">` : ""}<span class="brand-text">${esc(ctx.siteName)}</span></a>
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
      <span class="brand-foot">${ctx.iconUrl ? `<img class="brand-icon" src="${esc(ctx.iconUrl)}" alt="" width="32" height="32" loading="lazy" decoding="async">` : ""}<span>${esc(ctx.siteName)}</span></span>
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

${sfWidgetsHtml({
  lang: ctx.lang,
  accent: ctx.accent,
  consultantName: (c.team[0]?.name) || ctx.siteName,
  consultantPhoto: ctx.generatedImages?.team_1,
  siteName: ctx.siteName,
  topic: ctx.topic,
  seed: ctx.projectId || ctx.domain || ctx.siteName,
})}

</body>
</html>`;
}