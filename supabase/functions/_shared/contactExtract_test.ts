import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { resolveProjectContacts } from "./contactExtract.ts";
Deno.test("pulls contacts out of a free-form block", () => {
  const c = resolveProjectContacts({
    site_contacts: "<p>Телефон: +7 (495) 123-45-67</p><p>info@metiz.ru</p><p>г. Москва, ул. Ленина, д. 5</p>",
  });
  assertEquals(c.phone, "+7 (495) 123-45-67");
  assertEquals(c.email, "info@metiz.ru");
  assertEquals(c.address.includes("Ленина"), true);
});
Deno.test("explicit fields win", () => {
  const c = resolveProjectContacts({ company_phone: "+7 999 000 11 22", site_contacts: "+7 495 111 22 33" });
  assertEquals(c.phone, "+7 999 000 11 22");
});
