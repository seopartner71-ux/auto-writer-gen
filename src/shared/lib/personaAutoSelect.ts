// Mirror of supabase/functions/_shared/authorAutoSelect.ts kept in sync so the
// UI can pre-select the same Persona the backend would auto-pick from
// onboarding_niche. Order matters — more specific rules first.

const NICHE_RULES: { match: RegExp; name: string }[] = [
  { match: /медиц|здоров|психолог|питан|спорт|реабилит|клиник|фарм|стоматол/i, name: "Врач-практик" },
  { match: /финанс|инвест|бизнес|налог|кредит|недвиж|банк|трейд|крипт|бухгалт/i, name: "Финансист-практик" },
  { match: /прав|юрист|юриспруд|закон|суд|документ|трудов|нотари/i, name: "Юрист-практик" },
  { match: /техник|строит|инструмент|оборуд|ремонт|сантехн|электр|стройк/i, name: "Прораб со стажем" },
  { match: /сад|огород|ферм|животн|сельск|растен|агро|урож/i, name: "Агроном-практик" },
  { match: /\bit\b|программ|код|разраб|devops|технолог|искусств|нейрос|software|hardware|саас|saas/i, name: "Техно-гик (Deep Tech)" },
  { match: /наук|исслед|аналит|статист|академ/i, name: "Академический аналитик" },
  { match: /копирайт|маркет|реклам|\bseo\b|smm|контент|таргет/i, name: "Провокационный копирайтер" },
  { match: /блог|лайфстайл|еда|путеш|интерьер|красот|цвет|мода|кулин|туризм|дом|быт/i, name: "Лайфстайл-блогер" },
];

export function pickPresetNameByNiche(niche: string | null | undefined): string | null {
  if (!niche) return null;
  const trimmed = String(niche).trim();
  if (!trimmed) return null;
  const rule = NICHE_RULES.find(r => r.match.test(trimmed));
  return rule?.name || null;
}

export function findPresetAuthorByNiche<T extends { name?: string; type?: string }>(
  authors: T[] | null | undefined,
  niche: string | null | undefined,
): T | null {
  const name = pickPresetNameByNiche(niche);
  if (!name) return null;
  const presets = (authors || []).filter(a => a.type === "preset" && a.name === name);
  return presets[0] || null;
}