/* Markup the canvas *creates* — the new row / new column blocks the
   structural edits splice in, and the class convention they follow.

   This lives in core for the same reason the token math does: composing a
   class list (which tokens, in what order, deduped) and templating the
   element that carries it is exactly the string work a frontend must never
   re-implement. The frontend supplies the document's own whitespace
   (`Scaffold`) and the user's convention; core decides what the markup is. */

import { offsetTokenBp, widthTokenBp } from './classes.js';

/** A user's class convention, parsed from a settings string.

    `dropped` is what was ignored and why-worthy — the UI shows it rather
    than letting the setting silently disagree with what gets written. */
export interface ExtraClasses {
  tokens: string[];
  dropped: string[];
}

export const NO_EXTRA_CLASSES: ExtraClasses = { tokens: [], dropped: [] };

/* A class name that can be spliced into a double-quoted attribute as-is.
   Anything with a quote, angle bracket, ampersand or equals would either
   break the attribute or smuggle markup into the document. */
const SAFE_TOKEN = /^[^\s"'<>&=]+$/;

/** Parse a convention string ("clearfix form-group") into the tokens every
    created row/column gets, plus the ones that were ignored.

    Dropped, so a convention can never fight the canvas or corrupt the file:
    - **grid tokens** (`col`, `col-md-6`, `offset-2`, …) — widths and offsets
      are computed from the document's dialect and the column being created;
      a fixed one in the convention would either duplicate or contradict them.
    - **`row` / `form-row`** — the builders emit the canonical row class
      themselves. Dropping it means "row clearfix form-group" (the whole
      class attribute, pasted) and "clearfix form-group" (just the addition)
      both produce `class="row clearfix form-group"`.
    - **duplicates**, and anything unsafe to write into an attribute. */
export function parseExtraClasses(raw: string | undefined | null): ExtraClasses {
  const tokens: string[] = [];
  const dropped: string[] = [];
  for (const t of (raw ?? '').trim().split(/\s+/)) {
    if (!t) continue;
    const bad = t === 'row' || t === 'form-row' ||
      widthTokenBp(t) != null || offsetTokenBp(t) != null || !SAFE_TOKEN.test(t);
    if (bad || tokens.includes(t)) {
      if (bad && !dropped.includes(t)) dropped.push(t);
      continue;
    }
    tokens.push(t);
  }
  return { tokens, dropped };
}

/** The class list for a created element: what the canvas computed, then the
    user's convention. Order is meaningful to nobody but the reader, so the
    computed grid tokens lead and duplicates never repeat. */
export function mergeClasses(base: string[], extras: string[]): string[] {
  const out = base.slice();
  for (const t of extras) if (!out.includes(t)) out.push(t);
  return out;
}

/** The document's own whitespace, so inserted markup matches the file it
    lands in rather than forcing spaces into a tab-indented template. */
export interface Scaffold {
  /** The document's line ending (`detectEol`). */
  eol: string;
  /** Indent of the inserted block itself. */
  indent: string;
  /** One level of indentation as this document writes it (`detectIndentUnit`). */
  indentUnit: string;
}

/** A new column: the element, and a placeholder comment so it reads as
    deliberately empty rather than broken. Starts with a line break — every
    caller splices it directly after an existing element. */
export function newColMarkup(classes: string[], s: Scaffold): string {
  const { eol, indent, indentUnit } = s;
  return eol + indent + '<div class="' + classes.join(' ') + '">' +
    eol + indent + indentUnit + '<!-- new column -->' +
    eol + indent + '</div>';
}

/** What separates a new row from what precedes it:
    - `blank-line` — a blank line, how rows are spaced when inserted after an
      existing element (rows are the coarse structure);
    - `newline` — a plain line break;
    - `none` — nothing, for an insert that already sits at the start of a line
      (an empty document, or one ending in a newline). */
export type Lead = 'none' | 'newline' | 'blank-line';

/** A new row wrapping exactly one column. */
export function newRowMarkup(
  rowClasses: string[], colClasses: string[], s: Scaffold,
  opts: { lead?: Lead } = {},
): string {
  const { eol, indent, indentUnit } = s;
  const lead = opts.lead ?? 'newline';
  const inner = { eol, indent: indent + indentUnit, indentUnit };
  return (lead === 'blank-line' ? eol + eol : lead === 'newline' ? eol : '') +
    indent + '<div class="' + rowClasses.join(' ') + '">' +
    newColMarkup(colClasses, inner) +
    eol + indent + '</div>';
}

/** The canonical row class the canvas creates rows with. `isRowEl` recognises
    it, so every created row is visible on the canvas by construction. */
export const ROW_CLASS = 'row';
