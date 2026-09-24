import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import { deriveName, keywordVariants, parseSpec } from "../src/template/spec.js";

const SPEC = `
version: 1
episode: 167
keyword: EP167
hook: "New episode is live - tap for the link!"
url: "https://drbrt.in/ep167"
tag: "Podcast | EP167 | Clicked"
targets: [podcast-fb, podcast-ig]
`;

describe("parseSpec", () => {
  it("parses a podcast spec and derives keyword variants", () => {
    const spec = parseSpec(SPEC, "spec.yaml");
    expect(spec.episode).toBe(167);
    expect(spec.keywords).toEqual(["EP167", "EP 167"]);
    expect(spec.hook).toContain("New episode");
    expect(spec.url).toBe("https://drbrt.in/ep167");
    expect(spec.targets).toEqual(["podcast-fb", "podcast-ig"]);
  });

  it("derives article keyword variants including singular forms", () => {
    expect(keywordVariants("ADHD PERIODS")).toEqual([
      "ADHD PERIODS",
      "ADHDPERIODS",
      "ADHD PERIOD",
      "ADHDPERIOD",
    ]);
    expect(keywordVariants("EP167")).toEqual(["EP167", "EP 167"]);
  });

  it("rejects http urls", () => {
    const bad = SPEC.replace("https://drbrt.in/ep167", "http://drbrt.in/ep167");
    expect(() => parseSpec(bad, "spec.yaml")).toThrowError(/https/);
  });

  it("rejects placeholders", () => {
    const bad = SPEC.replace("https://drbrt.in/ep167", "https://REPLACE_ME");
    expect(() => parseSpec(bad, "spec.yaml")).toThrowError(AxiError);
  });

  it("requires episode or title", () => {
    const bad = SPEC.replace("episode: 167", "");
    expect(() => parseSpec(bad, "spec.yaml")).toThrowError(/episode.*title|title.*episode/i);
  });

  it("requires targets", () => {
    const bad = SPEC.replace("targets: [podcast-fb, podcast-ig]", "");
    expect(() => parseSpec(bad, "spec.yaml")).toThrowError(/targets/);
  });

  it("accepts explicit keyword lists verbatim (uppercased)", () => {
    const spec = parseSpec(
      SPEC.replace("keyword: EP167", "keywords: [\"ep one\", EPONE]"),
      "spec.yaml",
    );
    expect(spec.keywords).toEqual(["EP ONE", "EPONE"]);
  });
});

describe("deriveName", () => {
  const base = parseSpec(SPEC, "spec.yaml");

  it("derives per-kind names", () => {
    expect(deriveName("podcast-fb", base)).toBe("EP167 to DM FB");
    expect(deriveName("podcast-ig", base)).toBe("EP167 to DM");
  });

  it("supports explicit names and patterns", () => {
    expect(deriveName("podcast-fb", { ...base, name: "Custom Name" })).toBe("Custom Name");
    expect(deriveName("custom", base, "S{{episode}} Custom")).toBe("S167 Custom");
  });
});
