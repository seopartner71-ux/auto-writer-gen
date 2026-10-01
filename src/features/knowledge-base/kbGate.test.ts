// Test-only fixtures. Abstract clients, never imported by prod code or the client archive.
import { describe, it, expect } from "vitest";
import { buildKnowledgeBaseGated, priceAnswerBlockers, defaultDocs, type KbInput, type KbPrice } from "./buildKnowledgeBase";

const P = (name: string, priceFrom: string, unit: string, useCases = "", category = ""): KbPrice =>
  ({ name, priceFrom, currency: "руб", unit, zone: "", category, useCases, pageUrl: "", imageUrl: "" });

const base = (o: Partial<KbInput>): KbInput => ({
  companyName: "Альфа", legalName: "ООО Альфа", site: "https://alpha.example", city: "Гамма", region: "",
  geographyNote: "Гамма и окрестности", description: "Компания Альфа.", contactsPage: "https://alpha.example/contacts",
  owner: "менеджер", repoName: "alpha-kb", license: "CC-BY-4.0", docs: defaultDocs("https://alpha.example"),
  facts: [], queries: [], checkedAt: "2026-10-01",
  contacts: { warehouses: "ул. Бета, 1", address: "ул. Бета, 1", phoneSales: "+7 900 000-00-00", emailSales: "", phoneSupport: "", emailSupport: "", workHours: "" },
  ...o,
});

const qs = (pos: string, missing: string) => [
  `Где заказать ${pos} с доставкой?`, `Сколько стоит ${pos}?`, `Сколько стоит ${missing}?`,
  "Как рассчитать объем?", "От чего зависит доставка?", "Какой выбрать?", "Заказать с доставкой",
].map((query) => ({ query, doc: "", sitePage: "" }));

const EXPECT = ["entity.find", "offer.price", "offer.price", "calc.volume", "offer.delivery", "offer.select", "entity.find"];

const FIX: Record<string, KbInput> = {
  A: base({ priceList: [P("Изделие Зета", "от 1 750 руб/м3", "м3"), P("Изделие Каппа", "900", "шт")], queries: qs("изделие Зета", "изделие Сигма") }),
  B: base({ productsServices: "Услуга Омега", queries: qs("услугу Омега", "услугу Сигма") }),
  C: base({ priceList: [P("Изделие Зета", "1750", "м3", "задача Ипсилон"), P("Изделие Каппа", "900", "шт"), P("Изделие Лямбда", "500", "шт", "задача Тау")], queries: qs("изделие Лямбда", "изделие Сигма") }),
};

const rows: string[] = [];
describe("KB gate fixtures", () => {
  for (const [k, input] of Object.entries(FIX)) {
    it(`fixture ${k}: 7 questions route correctly, gate green`, () => {
      const g = buildKnowledgeBaseGated(input);
      g.faq.forEach((f, i) => {
        const ok = f.intent === EXPECT[i];
        rows.push(`${k} | ${i + 1} | ${f.query} | ${f.intent} | ${ok ? "ok" : "ERR"} | ${f.answer}`);
        expect(f.intent).toBe(EXPECT[i]);
      });
      expect(g.faq[2].answer).toMatch(/Цена не указана/);
      if (input.priceList) expect(g.faq[1].answer).toMatch(/ от \d+/);
      expect(g.faq[0].answer).not.toMatch(/доставк/i);
      expect(g.files["README.md"]).toMatch(/^География: Гамма и окрестности$/m);
      expect(Object.values(g.files).join("\n")).not.toMatch(/Склад.*Бета/);
      expect(g.files["data/selection-matrix.csv"] !== undefined).toBe(k === "C");
      if (k === "C") expect(g.files["data/selection-matrix.csv"]).not.toMatch(/Каппа/);
      rows.push(`${k} | blockers | ${g.blockers.join("; ") || "нет"}`);
      expect(g.blockers).toEqual([]);
    });
  }

  it("Q8: empty price -> blocker; empty contacts -> blocker", () => {
    const a = buildKnowledgeBaseGated({ ...FIX.A, priceList: [P("Изделие Зета", "по запросу", "м3")] });
    const b = buildKnowledgeBaseGated({ ...FIX.B, contactsPage: "", contacts: undefined });
    rows.push(`A | 8 | ${a.blockers.join("; ")}`, `B | 8 | ${b.blockers.join("; ")}`);
    expect(a.blockers.some((x) => /0 числовых цен/.test(x))).toBe(true);
    expect(b.blockers.some((x) => /Контакты пустые/.test(x))).toBe(true);
    const c = buildKnowledgeBaseGated({ ...FIX.C, geographyNote: "" , contacts: { ...FIX.C.contacts!, warehouses: "ул. Бета, 1\nул. Дельта, 2" } });
    rows.push(`C | 8 | ${c.blockers.join("; ") || "нет"}`);
    console.log(rows.join("\n"));
  });
});

describe("KB gate patch: price blocker, secondary facts, synonyms", () => {
  it("price question about a missing item is not red; existing item answered 'уточнить' is red", () => {
    const ok = buildKnowledgeBaseGated({ ...FIX.A, queries: [{ query: "Сколько стоит изделие Сигма?", doc: "", sitePage: "" }] });
    expect(ok.blockers).toEqual([]);
    const red = priceAnswerBlockers(FIX.A, [{ query: "Сколько стоит изделие Зета?", answer: "Цена не указана, уточнить у компании." }]);
    const green = priceAnswerBlockers(FIX.A, [{ query: "Сколько стоит изделие Сигма?", answer: "Цена не указана, уточнить у компании." }]);
    console.log("missing item:", green, "| item from price:", red);
    expect(red.length).toBe(1);
    expect(green).toEqual([]);
  });
  it("secondary facts stay in facts.csv only", () => {
    const g = buildKnowledgeBaseGated({ ...FIX.A, facts: [{ id: "S1", topic: "company", statement: "Работаем с поставщиками Ипсилон", parameter: "", unit: "", value: "", standard: "", source_url: "https://alpha.example/about", status: "confirmed", doc: "" } as never], queries: [{ query: "С какими поставщиками работаете Ипсилон?", doc: "", sitePage: "" }] });
    expect(g.files["data/facts.csv"]).toMatch(/S1,secondary.*needs_confirmation/);
    for (const f of ["README.md", "llms.txt", "site/llms.txt", "data/faq.json", "docs/faq/faq.md"]) expect(g.files[f] || "").not.toMatch(/Ипсилон[^?]/);
  });
  it("synonyms column matches only when filled", () => {
    const q = [{ query: "Сколько стоит омикрон?", doc: "", sitePage: "" }];
    const without = buildKnowledgeBaseGated({ ...FIX.A, queries: q });
    expect(without.faq[0].answer).toMatch(/Цена не указана/);
    const withSyn = buildKnowledgeBaseGated({ ...FIX.A, priceList: [{ ...P("Изделие Зета", "1750", "м3"), synonyms: "омикрон, дзета" }, P("Изделие Каппа", "900", "шт")], queries: q });
    expect(withSyn.faq[0].answer).toMatch(/Изделие Зета от 1750/);
    expect(withSyn.faq[0].answer).not.toMatch(/Каппа/);
    expect(withSyn.blockers).toEqual([]);
  });
});
