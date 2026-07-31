/* Surgical text edits.

   Every operation here changes the smallest span that can express the
   change — a class attribute's value, or an element's text with its
   adjacent title comment. The document is never regenerated: the user's
   source is preserved byte-for-byte outside the edited span.

   This module is also published as its own entry point
   (`@bootstrap-visualizer/core/edits`) so the extension's **Node host** can
   reuse `applyEdits` — it predicts what the buffer should read after its own
   workspace edits — without importing the package index, which reaches the
   parser and would pull `@angular/compiler` into a bundle that has no use
   for it (16 kB → 940 kB, measured). Nothing here touches the parser, so the
   subpath stays dependency-free. */

import { getAttr } from './classes.js';
import { precedingCommentRange } from './titles.js';
import type { CutRange, Edit, El } from './types.js';

export function splice(src: string, start: number, end: number, text: string): string {
  return src.slice(0, start) + text + src.slice(end);
}

/** Apply a batch of non-overlapping edits to `src`. Applied from the highest
    start offset down, so each edit's offsets stay valid as earlier ones are
    spliced in. The batch is the currency of the edits-out seam: the
    standalone splices it into a string, the extension replays it onto the
    editor document as minimal workspace edits. */
export function applyEdits(src: string, edits: Edit[]): string {
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of ordered) out = splice(out, e.start, e.end, e.text);
  return out;
}

/** The span edit that sets `el`'s class attribute value to `newTokens`,
    adding the attribute if it's missing. An unquoted value is replaced
    *with* quotes, since the new value may contain spaces. */
export function classEdit(src: string, el: El, newTokens: string[]): Edit {
  const val = newTokens.join(' ');
  const a = getAttr(el, 'class');
  if (a && a.valueStart >= 0) {
    return a.quote === ''
      ? { start: a.valueStart, end: a.valueEnd, text: '"' + val + '"' }
      : { start: a.valueStart, end: a.valueEnd, text: val };
  }
  // no class attribute — insert before '>' (or '/>')
  let pos = el.openEnd - 1;                    // at '>'
  if (src[el.openEnd - 2] === '/') pos = el.openEnd - 2;
  const lead = /\s/.test(src[pos - 1]!) ? '' : ' ';
  return { start: pos, end: pos, text: `${lead}class="${val}"` };
}

/** Replace the class attribute's value on `el` and return the new source.
    Thin wrapper over classEdit for callers that want the whole string
    (and the ported test suite). */
export function writeClass(src: string, el: El, newTokens: string[]): string {
  return applyEdits(src, [classEdit(src, el, newTokens)]);
}

/** May this element be moved, deleted, or otherwise edited *by its span*?

    Rewriting a class attribute is always safe: its value span is read straight
    off the open tag, which the parser saw in full. Cutting an element is not —
    it trusts `el.end`, and for an unclosed element that is wherever the parser
    had to stop (its parent's close tag, or the end of the file). Moving such an
    element would carry along everything the canvas never drew, and deleting it
    would take the rest of the document with it.

    Only the element's own span matters: a *descendant* with a guessed end is
    carried as text either way, and an unclosed *ancestor* doesn't make this
    element's own tags any less real. */
export function canCutElement(el: El): boolean {
  return !el.unclosed;
}

/** Range of `el` including its leading indentation and any title comments
    directly above it, so moves and deletes carry the label along. */
export function elementCutRange(src: string, el: El): CutRange {
  let s = el.start;
  while (s > 0 && (src[s - 1] === ' ' || src[s - 1] === '\t')) s--;
  const indent = src.slice(s, el.start);

  let anchor = el.start;
  let c: ReturnType<typeof precedingCommentRange>;
  while ((c = precedingCommentRange(src, anchor))) anchor = c.open;

  let cs = anchor;
  while (cs > 0 && (src[cs - 1] === ' ' || src[cs - 1] === '\t')) cs--;
  let cutStart = cs;
  if (cs > 0 && src[cs - 1] === '\n') {
    cutStart = cs - 1;
    // take the \r with the \n in a CRLF document, or the cut leaves the
    // previous line ending in a lone \r
    if (cutStart > 0 && src[cutStart - 1] === '\r') cutStart--;
  }
  return { cutStart, cutEnd: el.end, textStart: anchor, indent };
}

/** Indent to use for children of a row: copied from its first element
    child, else the row's own indent plus one level (`unit`). */
export function rowChildIndent(src: string, rowEl: El, unit?: string): string {
  const first = rowEl.children[0];
  if (first) return elementCutRange(src, first).indent;
  return elementCutRange(src, rowEl).indent + (unit ?? detectIndentUnit(src));
}

/* Leading whitespace of every line that has content on it. */
const INDENTED_LINE = /^[ \t]+(?=\S)/gm;

/** One level of indentation, as *this document* writes it — so inserted or
    re-indented markup matches what's already there instead of forcing two
    spaces into a tab-indented file.

    A tab if tabs are how the file indents (counted by line, so a stray
    space-aligned continuation doesn't outvote them); otherwise the narrowest
    space indent it uses, which is the unit for any consistently indented file
    (2 or 4). Widths of one are ignored — no one indents by a single space, but
    a wrapped attribute or a comment can easily start with one. Two spaces when
    the file has nothing to learn from (all flat, or empty). */
/** The line ending *this document* writes, so inserted markup doesn't leave
    LF lines in a CRLF file (invisible in the editor, loud in a diff, and some
    formatters then rewrite the whole file). CRLF only when it's the document's
    actual convention, not merely present somewhere. */
export function detectEol(src: string): string {
  const crlf = (src.match(/\r\n/g) ?? []).length;
  if (!crlf) return '\n';
  const newlines = (src.match(/\n/g) ?? []).length;   // CRLF ones included
  return crlf * 2 >= newlines ? '\r\n' : '\n';
}

export function detectIndentUnit(src: string): string {
  let tabLines = 0, spaceLines = 0;
  let narrowest = Infinity;
  for (const m of src.matchAll(INDENTED_LINE)) {
    const ws = m[0]!;
    if (ws.includes('\t')) { tabLines++; continue; }
    spaceLines++;
    if (ws.length >= 2 && ws.length < narrowest) narrowest = ws.length;
  }
  if (tabLines && tabLines >= spaceLines) return '\t';
  return ' '.repeat(narrowest === Infinity ? 2 : narrowest);
}
