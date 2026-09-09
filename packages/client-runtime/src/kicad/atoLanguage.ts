/** Shiki language id for atopile sources; also the `.ato` file extension token. */
export const ATO_LANGUAGE_ID = "ato";
/** Markdown fences commonly use the project name instead of the extension. */
export const ATO_LANGUAGE_ALIAS = "atopile";
export const ATO_SCOPE_NAME = "source.ato";

/**
 * Load atopile's TextMate grammar (see LICENSE-atopile.md) shaped as a Shiki
 * language registration. The dynamic import keeps the grammar out of the
 * initial bundle until the first `.ato` file is highlighted. Structurally
 * typed so web (`@pierre/diffs`) and mobile (`@shikijs/core`) each re-tag it
 * as their own registration type.
 */
export async function loadAtoLanguageRegistration() {
  const { default: grammar } = await import("./ato.tmLanguage.json", { with: { type: "json" } });
  return {
    ...grammar,
    name: ATO_LANGUAGE_ID,
    aliases: [ATO_LANGUAGE_ALIAS],
    scopeName: ATO_SCOPE_NAME,
  };
}
