import { describe, it, expect } from "vitest";
import { classifyPhrase, classifyTerms } from "../../../supabase/functions/_shared/termActions";

const Q = "купить щебень в туле";

describe("term actions", () => {
  it("1. шаблонная фраза не становится рекомендацией из-за частоты", () => {
    const rows = classifyTerms(Q, { tfidf: [{ phrase: "политика конфиденциальности", docs: 10, commonality: 100 }] });
    expect(rows[0].action).toBe("skip");
    expect(classifyPhrase("согласие обработку данных", Q).action).toBe("skip");
    expect(classifyPhrase("личный кабинет", Q).action).toBe("skip");
  });
  it("2. частая коммерческая тема не выкидывается, а идет на проверку", () => {
    expect(classifyPhrase("доставка щебня", Q).action).toBe("check");
    expect(classifyPhrase("условия оплаты", Q).action).toBe("check");
  });
  it("4. цена и гарантия конкурента не становятся фактом", () => {
    expect(classifyPhrase("гарантия года", Q).action).toBe("check");
    expect(classifyPhrase("цена 1900 рублей", Q).action).toBe("check");
    expect(classifyPhrase("срок 3 дня", Q).action).toBe("check");
  });
  it("5. нерелевантное и пустое не попадает в обязательные", () => {
    expect(classifyPhrase("2024 2025", Q).action).toBe("skip");
    expect(classifyPhrase("подписаться на рассылку", Q).action).toBe("skip");
  });
  it("тематические фразы остаются для добавления", () => {
    expect(classifyPhrase("фракция щебня", Q).action).toBe("add");
    expect(classifyPhrase("гранитный щебень", Q).action).toBe("add");
  });
  it("шумовой маркер, связанный с запросом, не выкидывается молча", () => {
    expect(classifyPhrase("меню щебень", Q).action).toBe("check");
  });
  it("дедуп и источник", () => {
    const rows = classifyTerms(Q, { mustUse: [{ phrase: "Фракция щебня" }], tfidf: [{ phrase: "фракция щебня", docs: 5 }] });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("ИИ-анализ ТОП-3");
  });
});

describe("реальные фразы из кеша", () => {
  it("информационный запрос: время - это тема, не обещание", () => {
    const q = "сколько сохнут джинсы после стирки";
    expect(classifyPhrase("джинсы минут", q).action).toBe("add");
    expect(classifyPhrase("скорость сушки часов", q).action).toBe("add");
  });
  it("коммерческий запрос: цены конкурента на проверку", () => {
    const q = "разработка сайта москва";
    expect(classifyPhrase("000 рублей", q).action).toBe("check");
    expect(classifyPhrase("рублей заказать", q).action).toBe("check");
    expect(classifyPhrase("создаем сайты", q).action).toBe("add");
  });
});
