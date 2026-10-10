// General construction-practice reference for common bulk materials, concrete and mortar.
// Used only when the client did not fill tasks in the price list. Every output built from it
// is labelled "ориентир по общей практике, у компании не зафиксировано" - never a company fact.

export interface MaterialRef {
  /** Matches a price-list position name (lowercase, "ё" -> "е"). */
  match: RegExp;
  /** Group label used in README/llms summaries. */
  group: string;
  /** Typical tasks (stems are matched against questions). */
  tasks: string[];
  limit: string;
  /** Bulk density, t/m3, typical range. */
  density?: [number, number];
}

export const REF_NOTE = "ориентир по общей строительной практике, у компании не зафиксировано";

export const MATERIAL_REF: MaterialRef[] = [
  { match: /бетон.*гранит/, group: "бетон", tasks: ["фундамент", "нагруженные конструкции", "перекрытия"], limit: "класс выбирается по проекту" },
  { match: /бетон/, group: "бетон", tasks: ["фундамент", "стяжка", "дорожки", "подготовка под фундамент"], limit: "класс выбирается по проекту" },
  { match: /раствор/, group: "раствор", tasks: ["кладка", "стяжка", "штукатурка"], limit: "марка выбирается по нагрузке и проекту" },
  { match: /щеб.*гранит|гранит.*щеб/, group: "щебень", tasks: ["фундамент", "бетон", "дорога", "парковка"], limit: "дороже известнякового; для легкой отсыпки избыточен", density: [1.35, 1.45] },
  { match: /щеб.*извест|извест.*щеб/, group: "щебень", tasks: ["отсыпка участка", "дорожки", "дорога", "парковка", "основание"], limit: "ниже прочность и морозостойкость, чем у гранита; для ответственного бетона не берут", density: [1.25, 1.35] },
  { match: /щеб.*гравий|гравий/, group: "щебень", tasks: ["бетон", "фундамент", "дренаж", "дорога"], limit: "окатанная форма хуже держит насыпь, чем колотый щебень", density: [1.35, 1.45] },
  { match: /щеб.*шлак|шлак.*щеб/, group: "щебень", tasks: ["отсыпка участка", "дорога", "подсыпка"], limit: "состав зависит от партии; для жилых помещений уточнять документы", density: [1.0, 1.3] },
  { match: /щеб.*долом|долом/, group: "щебень", tasks: ["отсыпка участка", "дорожки", "бетон"], limit: "по прочности ближе к известняковому", density: [1.3, 1.4] },
  { match: /щеб/, group: "щебень", tasks: ["отсыпка участка", "дорога", "бетон"], limit: "фракция и порода уточняются под задачу", density: [1.3, 1.45] },
  { match: /песок.*реч|реч.*песок/, group: "песок", tasks: ["бетон", "кладка", "раствор", "штукатурка", "стяжка"], limit: "дороже карьерного", density: [1.5, 1.6] },
  { match: /песок.*(горн|карьер)/, group: "песок", tasks: ["подушка", "фундамент", "засыпка", "отсыпка участка"], limit: "может содержать глинистые примеси; для бетона и раствора лучше мытый или речной", density: [1.5, 1.6] },
  { match: /песок.*(намыв|гидронамыв)/, group: "песок", tasks: ["подушка", "стяжка", "засыпка", "бетон"], limit: "мелкая фракция; для кладки уточнять модуль крупности", density: [1.55, 1.65] },
  { match: /песок/, group: "песок", tasks: ["подушка", "засыпка", "стяжка", "кладка"], limit: "тип песка уточняется под задачу", density: [1.5, 1.6] },
  { match: /мучк|отсев/, group: "мучка", tasks: ["дорожки", "подсыпка под плитку", "отсыпка участка"], limit: "мелкая фракция, для бетона не основной заполнитель", density: [1.3, 1.5] },
];

export const refFor = (name: string): MaterialRef | undefined => {
  const n = name.toLowerCase().replace(/ё/g, "е");
  return MATERIAL_REF.find((r) => r.match.test(n));
};

/** Task vocabulary: question stem -> canonical task. */
export const TASK_WORDS: Array<[RegExp, string]> = [
  [/фундамент/, "фундамент"],
  [/бетон/, "бетон"],
  [/дорог|подъезд|проезд/, "дорога"],
  [/парков|стоянк/, "парковка"],
  [/подушк/, "подушка"],
  [/кладк|кладоч/, "кладка"],
  [/раствор/, "раствор"],
  [/стяжк/, "стяжка"],
  [/штукат/, "штукатурка"],
  [/отсып|участ/, "отсыпка участка"],
  [/дренаж/, "дренаж"],
  [/дорожк/, "дорожки"],
  [/плитк/, "подсыпка под плитку"],
  [/засып/, "засыпка"],
];

export const tasksOf = (text: string): string[] => {
  const t = text.toLowerCase().replace(/ё/g, "е");
  return [...new Set(TASK_WORDS.filter(([re]) => re.test(t)).map(([, v]) => v))];
};

/** Concrete class guidance (general practice). */
export const CONCRETE_CLASS: Array<[RegExp, string]> = [
  [/в\s?7[,.]5/i, "подготовка (подбетонка), неответственные основания"],
  [/в\s?1[0-5]\b/i, "стяжки, дорожки, отмостки"],
  [/в\s?2[0-2]/i, "фундаменты частных домов, площадки"],
  [/в\s?2[5-9]|в\s?3\d/i, "нагруженные фундаменты, перекрытия, монолитные конструкции"],
];
export const concreteUse = (name: string) => CONCRETE_CLASS.find(([re]) => re.test(name))?.[1] || "";
