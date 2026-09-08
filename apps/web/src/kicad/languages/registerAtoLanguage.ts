import { registerCustomLanguage } from "@pierre/diffs";
import type { LanguageRegistration } from "@pierre/diffs/types";

/** Shiki language id for atopile sources; also the `.ato` file extension token. */
export const ATO_LANGUAGE_ID = "ato";
/** Markdown fences commonly use the project name instead of the extension. */
export const ATO_LANGUAGE_ALIAS = "atopile";

let registered = false;

/**
 * Load atopile's TextMate grammar (see LICENSE-atopile.md) as a Shiki
 * language registration. Dynamic import keeps the grammar out of the main
 * bundle until the first `.ato` file is highlighted.
 */
export async function loadAtoLanguageRegistration(): Promise<{
  default: LanguageRegistration[];
}> {
  const grammarModule = await import("./ato.tmLanguage.json", { with: { type: "json" } });
  // The grammar is data authored against the TextMate JSON schema; TypeScript
  // widens the literal JSON types, so re-tag it as Shiki's registration shape.
  const grammar = grammarModule.default as unknown as LanguageRegistration;
  return {
    default: [
      {
        ...grammar,
        name: ATO_LANGUAGE_ID,
        aliases: [ATO_LANGUAGE_ALIAS],
        scopeName: "source.ato",
      },
    ],
  };
}

/**
 * Register the `ato` language (and its `atopile` alias) with `@pierre/diffs`
 * and map the `.ato` extension to it. Idempotent.
 *
 * Call this on the main thread only. `@pierre/diffs` resolves custom
 * languages on the main thread (`RegisteredCustomLanguages`) and ships the
 * resolved grammar plus the custom extension map to its highlight workers
 * inside each initialize/file/diff message, so registering once before the
 * first highlight request covers every worker; `resolveLanguage` throws if
 * invoked from a worker context.
 */
export function registerAtoLanguage(): void {
  if (registered) return;
  registered = true;
  registerCustomLanguage(ATO_LANGUAGE_ID, loadAtoLanguageRegistration, [ATO_LANGUAGE_ID]);
  // A second name so fenced blocks tagged ```atopile resolve through
  // getSharedHighlighter as well; the loaded grammar already carries the alias.
  registerCustomLanguage(ATO_LANGUAGE_ALIAS, loadAtoLanguageRegistration);
}
