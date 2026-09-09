import { registerCustomLanguage } from "@pierre/diffs";
import type { LanguageRegistration } from "@pierre/diffs/types";
import {
  ATO_LANGUAGE_ALIAS,
  ATO_LANGUAGE_ID,
  loadAtoLanguageRegistration as loadSharedAtoLanguageRegistration,
} from "@t3tools/client-runtime/kicad/ato-language";

export { ATO_LANGUAGE_ALIAS, ATO_LANGUAGE_ID };

let registered = false;

/**
 * Load the shared atopile grammar (packages/client-runtime/src/kicad, see its
 * LICENSE-atopile.md) in the module shape `registerCustomLanguage` expects.
 * The grammar is data authored against the TextMate JSON schema; TypeScript
 * widens the literal JSON types, so re-tag it as Shiki's registration shape.
 */
export async function loadAtoLanguageRegistration(): Promise<{
  default: LanguageRegistration[];
}> {
  const registration = await loadSharedAtoLanguageRegistration();
  return { default: [registration as unknown as LanguageRegistration] };
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
