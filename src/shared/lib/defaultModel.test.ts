import { describe, it, expect } from "vitest";
import { getDefaultModel } from "./defaultModel";

describe("getDefaultModel", () => {
  it("free + 0 articles → Opus", () => {
    expect(getDefaultModel("nano", 0)).toBe("anthropic/claude-opus-4");
  });
  it("free + 1 article → Flash", () => {
    expect(getDefaultModel("nano", 1)).toBe("google/gemini-2.5-flash");
  });
  it("nano + 0 articles → Opus", () => {
    expect(getDefaultModel("nano", 0)).toBe("anthropic/claude-opus-4");
  });
  it("basic (PRO) → Opus", () => {
    expect(getDefaultModel("basic", 50)).toBe("anthropic/claude-opus-4");
  });
  it("pro (FACTORY) → Opus", () => {
    expect(getDefaultModel("pro", 100)).toBe("anthropic/claude-opus-4");
  });
  it("unknown → Flash", () => {
    expect(getDefaultModel("unknown", 0)).toBe("google/gemini-2.5-flash");
  });
});