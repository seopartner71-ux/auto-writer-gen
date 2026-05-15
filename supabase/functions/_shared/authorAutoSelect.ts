// Auto-select preset Persona based on user's onboarding_niche.
// Returns the preset author_profiles row enriched with syntax_profile,
// or null if the niche is empty / does not match any rule.
//
// Used by edge functions when the request omits author_profile_id so the
// generation pipeline applies a niche-appropriate Persona + syntax preset
// without any manual UI selection.

type AdminClient = {
  from: (table: string) => any;
};

interface NicheRule {
  match: RegExp;
  name: string;
  syntax: string;
}

// Order matters: more specific rules first.
const NICHE_RULES: NicheRule[] = [
  { match: /медиц|здоров|психолог|питан|спорт|реабилит|клиник|фарм|стоматол/i, name: "Врач-практик", syntax: "practitioner" },
  { match: /финанс|инвест|бизнес|налог|кредит|недвиж|банк|трейд|крипт|бухгалт/i, name: "Финансист-практик", syntax: "practitioner" },
  { match: /прав|юрист|юриспруд|закон|суд|документ|трудов|нотари/i, name: "Юрист-практик", syntax: "practitioner" },
  { match: /техник|строит|инструмент|оборуд|ремонт|сантехн|электр|стройк/i, name: "Прораб со стажем", syntax: "practitioner" },
  { match: /сад|огород|ферм|животн|сельск|растен|агро|урож/i, name: "Агроном-практик", syntax: "practitioner" },
  { match: /\bit\b|программ|код|разраб|devops|технолог|искусств|нейрос|software|hardware|саас|saas/i, name: "Техно-гик (Deep Tech)", syntax: "academic" },
  { match: /наук|исслед|аналит|статист|академ/i, name: "Академический аналитик", syntax: "academic" },
  { match: /копирайт|маркет|реклам|\bseo\b|smm|контент|таргет/i, name: "Провокационный копирайтер", syntax: "provocateur" },
  { match: /блог|лайфстайл|еда|путеш|интерьер|красот|цвет|мода|кулин|туризм|дом|быт/i, name: "Лайфстайл-блогер", syntax: "blogger" },
];

export function pickRuleByNiche(niche: string | null | undefined): NicheRule | null {
  if (!niche) return null;
  const trimmed = String(niche).trim();
  if (!trimmed) return null;
  return NICHE_RULES.find(r => r.match.test(trimmed)) || null;
}

/**
 * Resolve the preset author profile to use for a user when no explicit
 * author_profile_id was provided. Falls back to null if niche is empty
 * or no rule matches — caller should keep the default (no persona).
 */
export async function resolveAutoAuthorByNiche(
  admin: AdminClient,
  userId: string,
): Promise<any | null> {
  try {
    const { data: profile } = await admin
      .from("profiles")
      .select("onboarding_niche")
      .eq("id", userId)
      .maybeSingle();
    const niche = profile?.onboarding_niche || "";
    const rule = pickRuleByNiche(niche);
    if (!rule) return null;

    // Prefer the preset whose name matches the rule. Some installs have
    // multiple presets with the same display name (e.g. legacy + new) —
    // pick the one that has a non-empty system_instruction.
    const { data: candidates } = await admin
      .from("author_profiles")
      .select("*")
      .eq("type", "preset")
      .eq("name", rule.name)
      .limit(5);

    const list = (candidates || []) as any[];
    if (!list.length) return null;
    const author = list.find(a => (a.system_instruction || "").trim().length > 0) || list[0];

    const styleAnalysis = { ...(author.style_analysis || {}) };
    if (!styleAnalysis.syntax_profile) styleAnalysis.syntax_profile = rule.syntax;

    console.log(
      "[authorAutoSelect] niche='" + niche + "' -> preset='" + author.name +
      "' syntax='" + styleAnalysis.syntax_profile + "'",
    );

    return { ...author, style_analysis: styleAnalysis, _auto_selected: true, _auto_rule_syntax: rule.syntax };
  } catch (err) {
    console.warn("[authorAutoSelect] resolve failed:", (err as Error).message);
    return null;
  }
}