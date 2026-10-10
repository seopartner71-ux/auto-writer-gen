// Regressions for the archive review: dead glued URLs in facts, site typos, delivery distance tiers,
// identical FAQ answers, query-map -> FAQ link, glossary size. Test-only fixture.
import { describe, it, expect } from "vitest";
import { buildKnowledgeBaseGated, defaultDocs, type KbInput, type KbPrice } from "./buildKnowledgeBase";

const P = (name: string, priceFrom: string): KbPrice =>
  ({ name, priceFrom, currency: "руб", unit: "м3", zone: "", category: "", useCases: "", pageUrl: "https://ex.example/prices/", imageUrl: "" });
const F = (id: string, statement: string, url = "https://ex.example/contactscontacts/") =>
  ({ id, topic: "company", statement, parameter: "", unit: "", value: "", standard: "", source_url: url, status: "needs_confirmation" as const, doc: "" });

const input: KbInput = {
  companyName: "Омега", legalName: "ООО Омега", site: "https://ex.example", city: "Гамма", region: "", geographyNote: "Гамма",
  description: "", contactsPage: "https://ex.example/contacts/", owner: "менеджер", repoName: "omega", license: "CC-BY-4.0",
  docs: defaultDocs("https://ex.example"), checkedAt: "2026-10-10",
  facts: [F("F-1", "КПП: 710001001"), F("F-2", "Банк: Альфа"), F("F-3", "Экскаватор на гусенечном ходу", "https://ex.example/tech/"),
    F("F-4", "Доставка бетона до 10 км - 600 руб/м3, минимальный объем 6 м3", "https://ex.example/delivery/")],
  queries: ["Как рассчитать объем бетона для фундамента?", "Сколько кубов бетона нужно для ленточного фундамента?", "Сколько стоит бетон?"]
    .map((query) => ({ query, doc: "", sitePage: "" })),
  contacts: { warehouses: "", address: "г. Гамма, ул. Бета, 1", phoneSales: "+7 900 000-00-00", emailSales: "", phoneSupport: "", emailSupport: "", workHours: "" },
  priceList: [P("Бетон В15", "7000"), P("Щебень гранитный", "2000"), P("Песок речной", "1000"), P("Аренда экскаватора на гусенечном ходу", "3000")],
};

describe("KB review remarks", () => {
  const g = buildKnowledgeBaseGated(input);
  const all = Object.values(g.files).join("\n");

  it("dbg", () => { console.log("KEYS", Object.keys(g.files).join(",")); });
  it("no glued /contactscontacts/ URL anywhere", () => {
    expect(all).not.toMatch(/contactscontacts/);
    expect(g.blockers).toEqual([]);
  });
  it("typo kept only as a quote in facts, fixed elsewhere", () => {
    expect(g.files["data/facts.csv"]).toMatch(/гусеничном ходу \(на сайте написано: ""гусенечном""\)/);
    expect(g.files["data/products.csv"]).not.toMatch(/гусенечн/);
  });
  it("distance delivery tier reaches delivery.md and delivery.csv", () => {
    expect(g.files["docs/catalog/delivery.md"]).toMatch(/до 10 км \| 600 руб\/м3/);
    expect(g.files["data/delivery.csv"]).toMatch(/600 руб/);
  });
  it("identical answers are merged, never repeated word for word", () => {
    const faq = JSON.parse(g.files["data/faq.json"]).items;
    const answers = faq.map((x: { answer: string }) => x.answer);
    expect(new Set(answers).size).toBe(answers.length);
    expect(g.files["docs/faq/faq.md"]).toMatch(/Также спрашивают/);
  });
  it("every query-map row links to a FAQ anchor that exists", () => {
    const rows = g.files["data/query-map.csv"].trim().split("\n").slice(1);
    for (const r of rows) {
      const anchor = r.match(/docs\/faq\/faq\.md#(q-\d+)/)?.[1];
      expect(anchor).toBeTruthy();
      expect(g.files["docs/faq/faq.md"]).toContain(`<a id="${anchor}"></a>`);
    }
  });
  it("glossary is topped up to 12 with labelled general terms", () => {
    const items = JSON.parse(g.files["data/glossary.json"]).items;
    expect(items.length).toBe(12);
    expect(items.some((t: { context: string }) => /не зафиксировано/.test(t.context))).toBe(true);
  });
});
