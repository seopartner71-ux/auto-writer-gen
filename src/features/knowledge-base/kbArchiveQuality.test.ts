// Archive quality gate: every query points to an existing file, answers match their question type,
// no service strings, no empty CSV cells, no duplicated facts. Test-only fixture.
import { describe, it, expect } from "vitest";
import { buildKnowledgeBaseGated, defaultDocs, faqIntent, type KbInput, type KbPrice } from "./buildKnowledgeBase";

const P = (name: string, priceFrom: string, unit = "м3"): KbPrice =>
  ({ name, priceFrom, currency: "руб", unit, zone: "", category: "", useCases: "", pageUrl: "https://ex.example/prices/", imageUrl: "" });

const Q = [
  "Где купить гранитный щебень?", "Какие компании доставляют щебень?", "Сколько стоит куб щебня?",
  "Какой щебень выбрать для фундамента?", "Сколько тонн щебня в одном кубе?", "Что выгоднее для отсыпки: щебень, гравий или шлак?",
  "Как рассчитать количество песка для стяжки пола?", "Какой бетон выбрать для фундамента дома?", "Для каких работ подходит бетон В15?",
  "От чего зависит стоимость доставки?", "(когда вставишь URL раздела бетона - замени)",
];

const input: KbInput = {
  companyName: "Омега", legalName: "ООО   «Омега»", inn: "7100000000", site: "https://ex.example", city: "Гамма", region: "",
  geographyNote: "Гамма и область", description: "Поставка нерудных материалов.", contactsPage: "https://ex.example/contactscontacts/",
  owner: "менеджер", repoName: "omega-kb", license: "CC-BY-4.0", docs: defaultDocs("https://ex.example"), checkedAt: "2026-10-10",
  facts: [{ id: "F-1", topic: "company", statement: "ИНН: 7100000000", parameter: "", unit: "", value: "", standard: "", source_url: "https://ex.example/contacts/", status: "needs_confirmation", doc: "" }],
  queries: Q.map((query) => ({ query, doc: "products/selection-guide", sitePage: "https://ex.example/contactscontacts/" })),
  contacts: { warehouses: "", address: "г. Гамма, ул. Бета, 1", phoneSales: "+7 900 000-00-00", emailSales: "a@ex.example", phoneSupport: "", emailSupport: "a@ex.example", workHours: "пн-сб 9-18" },
  priceList: [P("Щебень гранитный", "5200"), P("Щебень известняковый", "1750"), P("Щебень гравийный", "3600"), P("Щебень шлаковый", "1200"),
    P("Песок речной", "1300"), P("Бетон на гранитном щебне В15", "7560"), P("Бетон на гранитном щебне В25", "8100")],
};

describe("KB archive quality", () => {
  const g = buildKnowledgeBaseGated(input);
  const files = g.files;
  const faq = JSON.parse(files["data/faq.json"]).items as { question: string; intent: string; answer: string; doc: string; site_page: string }[];
  const a = (i: number) => faq[i].answer;

  it("gate is green and the service row is excluded", () => {
    expect(g.blockers).toEqual([]);
    expect(faq.length).toBe(Q.length - 1);
    expect(Object.values(files).join("\n")).not.toMatch(/когда вставишь/);
  });
  it("every query-map row points to an existing file and a clean client page", () => {
    const rows = files["data/query-map.csv"].trim().split("\n").slice(1);
    for (const r of rows) {
      const [, doc, page] = r.split(",").slice(-4);
      expect(files[doc]).toBeDefined();
      expect(page).toMatch(/^https:\/\/ex\.example\//);
      expect(page).not.toMatch(/contactscontacts/);
    }
  });
  it("answers match their question type", () => {
    expect(a(0)).toMatch(/Щебень гранитный - в ассортименте/);
    expect(a(0)).not.toMatch(/ от \d/);
    expect(a(0)).not.toBe(a(1));
    expect(a(3)).toMatch(/щебень гранитный/);
    expect(a(3)).not.toMatch(/Назначение не указано/);
    expect(faqIntent(Q[4])).toBe("calc.density");
    expect(a(4)).toMatch(/т\/м3/);
    expect(a(5)).toMatch(/Щебень шлаковый.*Щебень гравийный/);
    expect(a(6)).toMatch(/стяжк/);
    expect(a(7)).toMatch(/бетон на гранитном щебне в25/i);
    expect(a(8)).toMatch(/стяжки, дорожки/);
  });
  it("delivery doc, selection table and changelog exist", () => {
    expect(files["docs/catalog/delivery.md"]).toMatch(/не зафиксировано на сайте/);
    expect(files["docs/catalog/selection.md"]).toMatch(/\| Задача \| Что брать \| Ограничение \| Цена от \| Источник \|/);
    expect(files["CHANGELOG.md"]).toBeDefined();
    expect(files["llms.txt"]).toBe(files["site/llms.txt"]);
    expect(files["llms.txt"]).toMatch(/Телефоны: \+7 900/);
  });
  it("facts are unique, requisites cite the contacts page, CSV has no empty cells", () => {
    const facts = files["data/facts.csv"];
    expect(facts.match(/7100000000/g)!.length).toBe(2); // statement + value of one row
    expect(facts).toMatch(/ИНН 7100000000,inn,.*https:\/\/ex\.example\/contactscontacts\//);
    expect(facts).not.toMatch(/Почта поддержки/);
    expect(facts).toMatch(/ООО «Омега»/);
    for (const f of ["data/facts.csv", "data/products.csv", "data/query-map.csv"]) expect(files[f]).not.toMatch(/,,|,$/m);
  });
});
