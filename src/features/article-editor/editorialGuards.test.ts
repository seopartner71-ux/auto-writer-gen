import { describe, expect, it } from "vitest";
import { repairArticleH1 } from "../../../supabase/functions/_shared/articleHeadingGuard";
import { applySafeNarrationFixes, countNarrationViolations, enforceNarrationVoice } from "../../../supabase/functions/_shared/narrationVoice";

const intro = "Щебень в Туле на фундамент, дорогу или подушку под плитку - разберем без красивых буклетов. По моему опыту, переплата идет не за камень, а за лишние плечи и перекупов. Возьмем типы, фракции, цены за куб и за тонну, добавим доставку и подскажем, где брать без сюрпризов.";

describe("article editorial guards", () => {
  it("moves a paragraph-sized HTML H1 into an introduction without losing text", () => {
    const fixed = repairArticleH1(`<h1>${intro}</h1><h2>Цены</h2>`, "Щебень в Туле");
    expect(fixed).toBe(`<h1>Щебень в Туле</h1>\n<p>${intro}</p><h2>Цены</h2>`);
  });
  it("repairs Markdown and preserves all introductory sentences", () => {
    expect(repairArticleH1(`# ${intro}\n\n## Цены`, "Щебень в Туле")).toBe(`# Щебень в Туле\n\n${intro}\n\n## Цены`);
  });
  it("does not change valid headings", () => {
    expect(repairArticleH1("# Щебень в Туле\n\nТекст.", "Другой заголовок")).toBe("# Щебень в Туле\n\nТекст.");
  });
  it("is idempotent", () => {
    const once = repairArticleH1(`<h1>${intro}</h1>`, "Щебень в Туле");
    expect(repairArticleH1(once, "Щебень в Туле")).toBe(once);
  });
  it("fixes the reported singular possessive in plural mode", async () => {
    const result = await enforceNarrationVoice(`<p>По моему опыту, важна фракция. В моей практике это работает.</p>`, "my", "ru");
    expect(result.content).toContain("По нашему опыту");
    expect(result.content).toContain("В нашей практике");
    expect(result.after).toBe(0);
  });
  it("does not alter HTML attributes or parts of words", () => {
    const fixed = applySafeNarrationFixes('<a href="/мой" title="моя">По моему опыту, ящик прочный.</a>', "my", "ru");
    expect(fixed).toBe('<a href="/мой" title="моя">По нашему опыту, ящик прочный.</a>');
  });
  it("does not blindly replace Russian subjects without verb agreement", () => {
    const fixed = applySafeNarrationFixes("Я рекомендую щебень.", "my", "ru");
    expect(fixed).toBe("Я рекомендую щебень.");
    expect(countNarrationViolations(fixed, "my", "ru")).toBe(1);
  });
  it("preserves default voice", async () => {
    expect((await enforceNarrationVoice(intro, null, "ru")).content).toBe(intro);
  });
  it("converts English singular and plural correctly", () => {
    expect(applySafeNarrationFixes("I am ready. In my experience, I've seen it.", "my", "en")).toBe("We are ready. In our experience, We've seen it.");
    expect(countNarrationViolations("We are ready. Our team agrees.", "my", "en")).toBe(0);
  });
});