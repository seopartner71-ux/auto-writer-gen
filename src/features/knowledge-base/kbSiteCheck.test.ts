import { describe, it, expect } from "vitest";
import { buildKnowledgeBaseGated, defaultDocs, type KbInput } from "./buildKnowledgeBase";

const F = (id: string, statement: string, url: string) =>
  ({ id, topic: "company", statement, parameter: "", unit: "", value: "", standard: "", source_url: url, status: "published" as const, doc: "" });
const base: KbInput = {
  companyName: "Омега", legalName: "ООО Омега", site: "https://ex.example", city: "Гамма", region: "", geographyNote: "Гамма",
  description: "", contactsPage: "https://ex.example/contacts/", owner: "менеджер", repoName: "omega", license: "CC-BY-4.0",
  docs: defaultDocs("https://ex.example"), checkedAt: "2026-10-10", queries: [{ query: "Сколько стоит бетон?", doc: "", sitePage: "" }],
  facts: [F("F-1", "Доставка бетона до 10 км - 600 руб/м3", "https://ex.example/delivery/"), F("F-2", "Работаем с 2005 года", "https://ex.example/about/")],
};

describe("live site check at build time", () => {
  it("hides a fact that vanished from its page and dates the check", () => {
    const g = buildKnowledgeBaseGated({ ...base, siteCheck: { checkedAt: "2026-11-05", pages: [
      { url: "https://ex.example/delivery", ok: true, text: "Доставка бетона: до 10 км - 750 руб/м3" },
      { url: "https://ex.example/about/", ok: true, text: "Компания работает с 2005 года" }] } });
    expect(g.files["data/facts.csv"]).not.toContain("600 руб/м3");
    expect(g.files["REPORT.md"]).toContain("Факт пропал со страницы");
    expect(g.files["index.md"]).toContain("Сверено с сайтом: 2026-11-05 (страниц: 2)");
  });
  it("unread page downgrades the fact to needs_confirmation", () => {
    const g = buildKnowledgeBaseGated({ ...base, siteCheck: { checkedAt: "2026-11-05", pages: [
      { url: "https://ex.example/delivery/", ok: false, text: "" }, { url: "https://ex.example/about/", ok: true, text: "с 2005 года" }] } });
    expect(g.files["data/facts.csv"]).toMatch(/600 руб\/м3[^\n]*needs_confirmation/);
  });
  it("no readable page blocks export", () => {
    const g = buildKnowledgeBaseGated({ ...base, siteCheck: { checkedAt: "2026-11-05", pages: [{ url: "https://ex.example/about/", ok: false, text: "" }] } });
    expect(g.blockers.join(" ")).toContain("ни одна страница не прочитана");
  });
});
