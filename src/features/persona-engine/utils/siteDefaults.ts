// Черновое заполнение шага «Автор» на основе Site DNA.
// Всё, что здесь получается, - только предзаполнение: пользователь может править руками.

import type { SiteDnaData } from "../types";

const list = (v: unknown, max = 3): string[] =>
  Array.isArray(v) ? v.filter(x => typeof x === "string" && x.trim()).slice(0, max) as string[] : [];

const str = (v: unknown): string => (typeof v === "string" && v.trim() ? v.trim() : "");

export interface SiteDefaults {
  description: string;
  name: string;
  role: string;
  expertise: string;
  values: Record<string, number>;
}

/** Роль автора по типу бизнеса и отрасли. */
function buildRole(d: SiteDnaData): string {
  const industry = str(d.industry) || str(d.business_type);
  if (!industry) return "";
  return `Практикующий эксперт: ${industry.toLowerCase()}`;
}

function buildExpertise(d: SiteDnaData): string {
  const areas = list(d.expertise_areas, 3);
  if (areas.length) return areas.join(", ");
  const services = list(d.services, 3);
  if (services.length) return services.join(", ");
  return list(d.categories, 3).join(", ");
}

function buildDescription(d: SiteDnaData): string {
  const parts: string[] = [];
  const brand = str(d.brand_name);
  const industry = str(d.industry) || str(d.business_type);
  if (industry) {
    parts.push(
      `Автор пишет для ${brand ? `проекта ${brand}` : "сайта"} в сфере: ${industry.toLowerCase()}.`
    );
  }
  const audience = str(d.audience);
  if (audience) parts.push(`Аудитория: ${audience}`);
  const positioning = str(d.positioning);
  if (positioning) parts.push(`Позиционирование: ${positioning}`);
  const usp = list(d.usp, 3);
  if (usp.length) parts.push(`Сильные стороны проекта: ${usp.join("; ")}.`);
  const voice = str(d.brand_voice);
  if (voice) parts.push(`Тон бренда: ${voice}`);
  const terms = list(d.terminology, 6);
  if (terms.length) parts.push(`Использует рабочую терминологию: ${terms.join(", ")}.`);
  const restrictions = list(d.restrictions, 3);
  if (restrictions.length) parts.push(`Ограничения: ${restrictions.join("; ")}.`);
  parts.push("Пишет как практик: объясняет сложное простым языком, не выдумывает личный опыт, цифры и кейсы.");
  return parts.join(" ");
}

/** Слайдеры по тону бренда - грубая эвристика, дальше правит пользователь. */
function buildValues(d: SiteDnaData): Record<string, number> {
  const voice = `${str(d.brand_voice)} ${str(d.editorial_context)}`.toLowerCase();
  const has = (...w: string[]) => w.some(x => voice.includes(x));

  const formality = has("официал", "строг", "делов", "юридич", "формал") ? 75
    : has("дружелюб", "разговорн", "неформал", "прост") ? 35 : 55;
  const conversationality = 100 - formality > 20 ? Math.min(70, 100 - formality) : 35;
  const emotionality = has("эмоцион", "вдохнов", "живо", "тепл") ? 55 : 30;
  const storytelling = has("истори", "кейс", "storytelling", "опыт") ? 50 : 30;
  const terminology = has("эксперт", "профессионал", "техническ", "b2b") ? 65 : 45;
  const subjectivity = has("мнение", "автор", "экспертн") ? 45 : 30;

  return { formality, conversationality, emotionality, storytelling, terminology, subjectivity };
}

export function buildSiteDefaults(d: SiteDnaData | null | undefined): SiteDefaults {
  const data = d || {};
  return {
    description: buildDescription(data),
    name: "",
    role: buildRole(data),
    expertise: buildExpertise(data),
    values: buildValues(data),
  };
}

export function hasSiteSignal(d: SiteDnaData | null | undefined): boolean {
  if (!d) return false;
  return Boolean(str(d.industry) || str(d.business_type) || str(d.brand_voice) || str(d.audience));
}
