import { describe, expect, it } from "vitest";
import { isTrustedExternalHost, rootDomain, trustedExternalDomains } from "./sourceTrust";

const hostOf = (u: string) => {
  try {
    return new URL(u.startsWith("http") ? u : `https://${u}`).hostname;
  } catch {
    return "";
  }
};

describe("source trust filter", () => {
  it("rejects the participant's own domain and its subdomains", () => {
    expect(isTrustedExternalHost("shop.example.ru", "example.ru")).toBe(false);
    expect(isTrustedExternalHost("www.example.ru", "example.ru")).toBe(false);
  });

  it("rejects user-generated platforms", () => {
    for (const h of ["avito.ru", "vk.com", "t.me", "dzen.ru", "test.wordpress.com", "ozon.ru", "yell.ru"]) {
      expect(isTrustedExternalHost(h, "example.ru"), h).toBe(false);
    }
  });

  it("accepts independent media, registries and industry portals", () => {
    for (const h of ["vc.ru", "habr.com", "nalog.gov.ru", "avtoexpert124.ru"]) {
      expect(isTrustedExternalHost(h, "example.ru"), h).toBe(true);
    }
  });

  it("counts distinct trusted roots only", () => {
    const set = trustedExternalDomains(
      [
        "https://vc.ru/a",
        "https://news.vc.ru/b",
        "https://avito.ru/c",
        "https://example.ru/catalog",
        "https://habr.com/d",
        "",
      ],
      "example.ru",
      hostOf,
    );
    expect([...set].sort()).toEqual(["habr.com", "vc.ru"]);
  });

  it("collapses subdomains to the registrable root", () => {
    expect(rootDomain("a.b.example.co")).toBe("example.co");
  });
});
