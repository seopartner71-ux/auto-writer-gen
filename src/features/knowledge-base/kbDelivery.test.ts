// Full delivery grid from the client's homepage, "published" status, FAQ-first query map, conflict blocker. Test-only fixture.
import { describe, it, expect } from "vitest";
import { buildKnowledgeBaseGated, defaultDocs, type KbInput, type KbFact } from "./buildKnowledgeBase";

const F = (id: string, statement: string, status: KbFact["status"] = "published", url = "https://ex.example/"): KbFact =>
  ({ id, topic: "price", statement, parameter: "", unit: "", value: "", standard: "", source_url: url, status, doc: "" });
const grid = ["До 10 км - 600 руб/1м3", "До 15 км - 650 руб/1м3", "До 20 км - 700 руб/1м3", "До 25 км - 750 руб/1м3", "До 30 км - 800 руб/1м3", "Свыше 30 км - цена договорная"]
  .map((t, i) => F(`F-${i + 1}`, `Стоимость доставки бетона: ${t}`));
const base: KbInput = {
  companyName: "Омега", legalName: "ООО Омега", site: "https://ex.example", city: "Гамма", region: "", geographyNote: "Гамма",
  description: "", contactsPage: "https://ex.example/contacts/", owner: "менеджер", repoName: "omega", license: "CC-BY-4.0",
  docs: defaultDocs("https://ex.example"), checkedAt: "2026-10-10",
  facts: [...grid, F("F-7", "При поставке продукции в количестве менее 6 м3, доставка оплачивается как за 6 м3")],
  queries: ["Сколько стоит доставка бетона?", "Где купить бетон?"].map((query) => ({ query, doc: "", sitePage: "" })),
  contacts: { warehouses: "", address: "г. Гамма, ул. Бета, 1", phoneSales: "+7 900 000-00-00", emailSales: "", phoneSupport: "", emailSupport: "", workHours: "" },
  priceList: [{ name: "Бетон В15", priceFrom: "7000", currency: "руб", unit: "м3", zone: "", category: "", useCases: "", pageUrl: "https://ex.example/prices/", imageUrl: "" }],
};

describe("KB delivery grid and statuses", () => {
  const g = buildKnowledgeBaseGated(base);
  const d = g.files["docs/catalog/delivery.md"];
  it("all six tiers and the minimum rule reach delivery.md and delivery.csv as published", () => {
    for (const x of ["до 10 км | 600", "до 25 км | 750", "до 30 км | 800", "Свыше 30 км | договорная"]) expect(d.toLowerCase()).toContain(x.toLowerCase());
    expect(d).toMatch(/Минимальный объем: менее 6 м3 оплачивается как 6 м3 \(опубликовано на сайте компании/);
    expect(d).not.toMatch(/Минимальный объем: не зафиксировано/);
    expect(d).toMatch(/опубликовано на сайте компании/);
    expect(g.files["data/delivery.csv"]).toMatch(/published/);
    expect(g.blockers).toEqual([]);
  });
  it("published from a foreign host is downgraded", () => {
    const x = buildKnowledgeBaseGated({ ...base, facts: [F("F-1", "Доставка бетона до 10 км - 600 руб/м3", "published", "https://other.example/")] });
    expect(x.files["data/delivery.csv"]).toMatch(/needs_confirmation/);
  });
  it("query map points to the FAQ first", () => {
    const rows = g.files["data/query-map.csv"].trim().split("\n");
    expect(rows[0]).toBe("query,intent,github_doc,related_doc,site_page,owner");
    for (const r of rows.slice(1)) expect(r.split(",")[1]).toMatch(/^docs\/faq\/faq\.md#q-\d+$/);
  });
  it("delivery FAQ uses the published grid and minimum rule, never denies existing tariffs", () => {
    const archive = buildKnowledgeBaseGated({ ...base, queries: [{ query: "От чего зависит доставка бетона?", doc: "", sitePage: "" }] });
    for (const path of ["docs/faq/faq.md", "data/faq.json"]) {
      const answer = archive.files[path].toLowerCase();
      expect(answer).toContain("до 10 км - 600");
      expect(answer).toContain("до 30 км - 800");
      expect(answer).toContain("менее 6 м3 оплачивается как 6 м3");
      expect(answer).toContain("https://ex.example/");
      expect(answer).not.toContain("тарифы на сайте не зафиксированы");
    }
    const count = Object.keys(archive.files).filter((p) => /^docs\/.*\.md$/.test(p)).length;
    expect(archive.files["CHANGELOG.md"]).toContain(`${count} документов`);
    expect(archive.files["REPORT.md"]).toContain(`Документов: ${count}`);
  });
  it("conflict blocks export, outdated is hidden", () => {
    const c = buildKnowledgeBaseGated({ ...base, facts: [...base.facts, F("F-9", "Доставка до 10 км - 550 руб", "conflict")] });
    expect(c.blockers.some((b) => /Противоречие/.test(b))).toBe(true);
    const o = buildKnowledgeBaseGated({ ...base, facts: [...base.facts, F("F-9", "Старый тариф до 40 км - 900 руб", "outdated")] });
    for (const [k, v] of Object.entries(o.files)) if (k !== "data/facts.csv") expect(v, k).not.toMatch(/до 40 км/i);
    expect(o.files["data/facts.csv"]).toMatch(/outdated/);
  });
});
