import { describe, expect, it } from "vitest";
import { extractMarketCategory, stripFirstPerson } from "./semanticNormalization";

describe("extractMarketCategory", () => {
  it("drops marketing verbs, corporate framing and the years-of-experience number", () => {
    expect(extractMarketCategory(["Завод занимается производством РВД 20 лет"], "Регион")).toBe("РВД");
  });

  it("keeps a technical unit next to its number", () => {
    expect(extractMarketCategory(["Продаем лучшие минитракторы 24 л.с. недорого"], "Регион")).toBe(
      "Минитракторы 24 л.с",
    );
  });

  it("caps the phrase at five tokens", () => {
    const out = extractMarketCategory(["рукава высокого давления фитинги муфты адаптеры переходники"], "Регион");
    expect(out.split(" ").length).toBeLessThanOrEqual(5);
  });

  it("falls back to the region when nothing meaningful is left", () => {
    expect(extractMarketCategory(["мы лучшие"], "Челябинск")).toBe("Челябинск");
  });
});

describe("stripFirstPerson", () => {
  it("removes first-person pronouns from prose", () => {
    expect(stripFirstPerson("В нашей практике мы фиксируем рост.")).toBe("В практике фиксируем рост.");
  });

  it("never touches URLs and file names", () => {
    const src = "Источник: https://example.ru/nas/my-page и файл SCORE_MATRIX.csv";
    expect(stripFirstPerson(src)).toBe(src);
  });
});
