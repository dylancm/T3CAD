import { getFiletypeFromFileName, getSharedHighlighter } from "@pierre/diffs";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { loadAtoLanguageRegistration, registerAtoLanguage } from "./registerAtoLanguage";

const SAMPLE = "module App:\n    r = new Resistor\n    r.resistance = 1kohm +/- 10%";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerAtoLanguage", () => {
  it("maps the .ato extension to the ato language", () => {
    registerAtoLanguage();
    expect(getFiletypeFromFileName("main.ato")).toBe("ato");
    expect(getFiletypeFromFileName("boards/main.ato")).toBe("ato");
  });

  it("treats uppercase extensions like the built-in table does (case-sensitive)", () => {
    registerAtoLanguage();
    // Built-in extensions are case-sensitive too, so ".ATO" mirrors ".PY".
    expect(getFiletypeFromFileName("boards/x.ATO")).toBe(getFiletypeFromFileName("x.PY"));
    expect(getFiletypeFromFileName("boards/x.ATO")).toBe("text");
  });

  it("loads a registration for the source.ato grammar", async () => {
    const { default: registrations } = await loadAtoLanguageRegistration();
    expect(registrations).toHaveLength(1);
    const [registration] = registrations;
    expect(registration?.name).toBe("ato");
    expect(registration?.scopeName).toBe("source.ato");
    expect(registration?.aliases).toEqual(["atopile"]);
    expect(registration?.patterns.length).toBeGreaterThan(0);
  });

  it("is idempotent", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      registerAtoLanguage();
      registerAtoLanguage();
    }).not.toThrow();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("compiles in the Oniguruma engine and tokenizes atopile source", async () => {
    registerAtoLanguage();
    const highlighter = await getSharedHighlighter({
      themes: ["pierre-dark"],
      langs: ["ato", "atopile"],
      preferredHighlighter: "shiki-wasm",
    });

    const lines = highlighter.codeToTokensBase(SAMPLE, {
      lang: "ato",
      theme: "pierre-dark",
      includeExplanation: true,
    });
    const scopes = lines
      .flat()
      .flatMap((token) => token.explanation ?? [])
      .flatMap((explanation) => explanation.scopes.map((scope) => scope.scopeName));

    expect(scopes.some((scope) => scope.endsWith(".ato"))).toBe(true);
    expect(scopes.some((scope) => /^(keyword|entity|constant|storage)\./.test(scope))).toBe(true);

    // The markdown-fence alias resolves to the same grammar.
    const aliasLines = highlighter.codeToTokensBase(SAMPLE, {
      lang: "atopile",
      theme: "pierre-dark",
    });
    expect(aliasLines.flat().length).toBeGreaterThan(1);
  });
});
