// Archive calculators: text tables an AI can read and cite (no scripts).
// Client calculators come from the form; auto calculators use only the client's own price list and delivery tiers.

export interface KbCalcVar { name: string; values: number[]; unit: string }
export interface KbCalculator {
  id: string;
  title: string;
  formula: string;
  vars: KbCalcVar[];
  resultUnit: string;
  caveat: string;
  source: "client_form" | "price_list" | "delivery_tariffs";
  rows: Array<{ inputs: number[]; result: number }>;
  error?: string;
}

const num = (s: string) => Number(String(s).replace(/\s/g, "").replace(",", "."));
export const fmtCalc = (n: number) => {
  const r = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100;
  return String(r).replace(/\B(?=(\d{3})+(?!\d))/g, " ").replace(".", ",");
};

/** Safe arithmetic: numbers, variable names, + - * / ( ). No eval. */
export function evalFormula(expr: string, vars: Record<string, number>): number {
  const src = expr.replace(/[×х]/g, "*").replace(/[÷:]/g, "/").replace(/,/g, ".").toLowerCase().replace(/ё/g, "е");
  const toks = src.match(/\d+(?:\.\d+)?|[a-zа-я_][a-zа-я0-9_]*|[+\-*/()]|\S/gi) || [];
  let i = 0;
  const peek = () => toks[i];
  const expr_ = (): number => {
    let v = term();
    while (peek() === "+" || peek() === "-") { const op = toks[i++]; const r = term(); v = op === "+" ? v + r : v - r; }
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (peek() === "*" || peek() === "/") { const op = toks[i++]; const r = factor(); v = op === "*" ? v * r : v / r; }
    return v;
  };
  const factor = (): number => {
    const t = toks[i++];
    if (t === undefined) throw new Error("формула оборвана");
    if (t === "-") return -factor();
    if (t === "(") { const v = expr_(); if (toks[i++] !== ")") throw new Error("нет закрывающей скобки"); return v; }
    if (/^\d/.test(t)) return Number(t);
    if (/^[a-zа-я_]/i.test(t)) { if (!(t in vars)) throw new Error(`неизвестная величина "${t}"`); return vars[t]; }
    throw new Error(`недопустимый символ "${t}"`);
  };
  const v = expr_();
  if (i < toks.length) throw new Error(`лишний символ "${toks[i]}"`);
  if (!Number.isFinite(v)) throw new Error("результат не число (деление на 0?)");
  return v;
}

const key = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, "_");

/** Form line: "Название | формула | площадь=20/60/100 м2; слой=0,1/0,15 м; плотность=1,4 т/м3 | т | оговорка". */
export function parseClientCalculators(s?: string): KbCalculator[] {
  return String(s ?? "").split(/\n+/).map((l) => l.split("|").map((x) => x.trim())).filter((c) => c.length >= 3 && c[0] && c[1])
    .map(([title, formula, varsRaw = "", resultUnit = "", caveat = ""], idx) => {
      const vars: KbCalcVar[] = varsRaw.split(";").map((v) => v.trim()).filter(Boolean).map((v) => {
        const m = v.match(/^([^=]+)=\s*([\d\s.,/]+)\s*(.*)$/);
        if (!m) return { name: key(v), values: [], unit: "" };
        return { name: key(m[1]), values: m[2].split("/").map(num).filter((n) => Number.isFinite(n)).slice(0, 6), unit: m[3].trim() };
      });
      const calc: KbCalculator = { id: `calc-${idx + 1}`, title, formula: formula.replace(/\s+/g, " "), vars, resultUnit, caveat, source: "client_form", rows: [] };
      try {
        if (!vars.length || vars.some((v) => !v.values.length)) throw new Error("у величин нет значений (пример: площадь=20/60 м2)");
        const formulaKeyed = calc.formula.replace(/[a-zа-яё_][a-zа-яё0-9_ ]*/gi, (w) => key(w));
        let combos: number[][] = [[]];
        for (const v of vars) combos = combos.flatMap((c) => v.values.map((x) => [...c, x]));
        calc.rows = combos.slice(0, 24).map((inputs) => ({
          inputs,
          result: evalFormula(formulaKeyed, Object.fromEntries(vars.map((v, j) => [v.name, inputs[j]]))),
        }));
      } catch (e) { calc.error = (e as Error).message; calc.rows = []; }
      return calc;
    });
}

type Price = { name: string; priceFrom: string; unit: string; currency: string };
type Tier = { dist: string; price: string; min: string; scope: string };

/** Cost of a batch from the client's own price list ("от" prices): volume × price. */
export function autoCalculators(prices: Price[], tiers: Tier[]): KbCalculator[] {
  const out: KbCalculator[] = [];
  const bulk = prices.filter((p) => /^(т|м3|м³|тонн?а?)$/i.test(p.unit.trim()) && num(String(p.priceFrom).match(/\d[\d\s]*(?:[.,]\d+)?/)?.[0] || "") > 0).slice(0, 8);
  if (bulk.length) {
    const vols = [5, 10, 20];
    out.push({
      id: "calc-batch-cost", title: "Стоимость партии по ценам \"от\"", formula: "стоимость = количество × цена_от",
      vars: [{ name: "количество", values: vols, unit: "т или м3 (единица позиции)" }],
      resultUnit: "руб", caveat: "Цены \"от\" - ориентир, не оферта; доставка не включена.", source: "price_list",
      rows: [],
    });
    (out[0] as any).table = bulk.map((p) => {
      const pr = num(String(p.priceFrom).match(/\d[\d\s]*(?:[.,]\d+)?/)?.[0] || "");
      return { name: p.name, unit: p.unit, price: pr, results: vols.map((v) => v * pr) };
    });
  }
  const numeric = tiers.map((t) => ({ ...t, p: num(t.price.match(/\d[\d\s]*(?:[.,]\d+)?/)?.[0] || "") })).filter((t) => t.p > 0 && /м3|м³/.test(t.price));
  if (numeric.length) {
    const min = num(numeric.find((t) => /\d/.test(t.min))?.min.match(/(\d+[.,]?\d*)\s*м/)?.[1] || "0") || 0;
    const vols = [3, 6, 10, 20].filter((v) => v >= 1);
    out.push({
      id: "calc-delivery-cost", title: `Стоимость доставки по расстоянию${numeric[0].scope && numeric[0].scope !== "не указано" ? ` (${numeric[0].scope})` : ""}`,
      formula: min ? `доставка = max(объем, ${fmtCalc(min)}) × тариф_за_м3` : "доставка = объем × тариф_за_м3",
      vars: [{ name: "объем", values: vols, unit: "м3" }], resultUnit: "руб",
      caveat: `Тарифы - из сетки доставки компании${min ? `; объем меньше ${fmtCalc(min)} м3 оплачивается как ${fmtCalc(min)} м3` : ""}. Расстояния, где цена договорная, не считаются.`,
      source: "delivery_tariffs", rows: [],
    });
    (out[out.length - 1] as any).table = numeric.map((t) => ({ name: t.dist, unit: "м3", price: t.p, results: vols.map((v) => Math.max(v, min) * t.p) }));
  }
  return out;
}

type TableRow = { name: string; unit: string; price: number; results: number[] };

export function calculatorsMarkdown(company: string, site: string, checkedAt: string, calcs: KbCalculator[]): string {
  const ok = calcs.filter((c) => !c.error);
  const parts = [`# Калькуляторы ${company}`, "",
    `Готовые расчеты по данным компании ${company} (${site}). Формула записана словами, результаты посчитаны заранее - их можно цитировать без вычислений. Данные на ${checkedAt}.`, ""];
  for (const c of ok) {
    parts.push(`## ${c.title}`, "", `Формула: ${c.formula}`, "");
    const table = (c as any).table as TableRow[] | undefined;
    if (table) {
      const vals = c.vars[0].values;
      parts.push(`| Позиция | Цена | ${vals.map((v) => `${c.vars[0].name} ${fmtCalc(v)}`).join(" | ")} |`, `|---|---|${vals.map(() => "---|").join("")}`,
        ...table.map((r) => `| ${r.name} | ${fmtCalc(r.price)} руб/${r.unit} | ${r.results.map((x) => `${fmtCalc(x)} ${c.resultUnit}`).join(" | ")} |`), "");
      const r = table[0];
      parts.push(`Пример: ${c.vars[0].name} ${fmtCalc(vals[1] ?? vals[0])} (${r.name}) = ${fmtCalc(vals[1] ?? vals[0])} × ${fmtCalc(r.price)} = ${fmtCalc(r.results[1] ?? r.results[0])} ${c.resultUnit}${c.source === "delivery_tariffs" ? " (с учетом минимального объема)" : ""}.`, "");
    } else {
      parts.push(`| ${c.vars.map((v) => `${v.name}${v.unit ? `, ${v.unit}` : ""}`).join(" | ")} | Результат |`, `|${c.vars.map(() => "---|").join("")}---|`,
        ...c.rows.map((r) => `| ${r.inputs.map(fmtCalc).join(" | ")} | ${fmtCalc(r.result)} ${c.resultUnit} |`), "");
      const r = c.rows[0];
      if (r) parts.push(`Пример: ${c.vars.map((v, j) => `${v.name} ${fmtCalc(r.inputs[j])}${v.unit ? ` ${v.unit}` : ""}`).join(", ")} - результат ${fmtCalc(r.result)} ${c.resultUnit}.`, "");
    }
    const src = c.source === "client_form" ? "формула и коэффициенты предоставлены компанией" : c.source === "price_list" ? "прайс компании" : "сетка доставки компании";
    parts.push(`Источник: ${src}.${c.caveat ? ` ${c.caveat}` : ""}`, "");
  }
  parts.push("Точный расчет под объект - у компании. Расчеты не являются офертой.", "");
  return parts.join("\n");
}

export function calculatorsJson(checkedAt: string, calcs: KbCalculator[]): string {
  return JSON.stringify({ version: "1.0", checked_at: checkedAt, calculators: calcs.filter((c) => !c.error).map((c) => ({
    id: c.id, title: c.title, formula: c.formula, variables: c.vars, result_unit: c.resultUnit, source: c.source, caveat: c.caveat,
    examples: (c as any).table ?? c.rows,
  })) }, null, 2) + "\n";
}
