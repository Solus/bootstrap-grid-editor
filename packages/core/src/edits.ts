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

/** The edits that set `el`'s class attribute value to `newTokens`, adding the
    attribute if it's missing.

    On a quoted value these are **token-level**: unchanged tokens — and the
    author's whitespace around them, including newlines in a class list wrapped
    across lines — are left byte-for-byte alone; only the tokens that actually
    changed get a span. That keeps the surgical-edit promise ("we change what you
    changed") and keeps each undo step and each `WorkspaceEdit` as small as the
    edit really is. Returns a batch because a change can touch more than one
    place (e.g. a token replaced at the front and another removed at the back);
    `applyEdits` orders it. An unquoted value can't hold spaces, so a multi-token
    result is replaced *with* quotes as one span. */
export function classEdit(src: string, el: El, newTokens: string[]): Edit[] {
  const a = getAttr(el, 'class');

  // No class attribute — insert one before '>' (or '/>').
  if (!a || a.valueStart < 0) {
    let pos = el.openEnd - 1;                    // at '>'
    if (src[el.openEnd - 2] === '/') pos = el.openEnd - 2;
    const lead = /\s/.test(src[pos - 1]!) ? '' : ' ';
    return [{ start: pos, end: pos, text: `${lead}class="${newTokens.join(' ')}"` }];
  }

  // Unquoted value: requote as a whole (see above).
  if (a.quote === '') {
    return [{ start: a.valueStart, end: a.valueEnd, text: '"' + newTokens.join(' ') + '"' }];
  }

  // Emptying the list clears the whole value in one span (also drops any stray
  // whitespace between the quotes).
  if (newTokens.length === 0) {
    return a.valueEnd > a.valueStart
      ? [{ start: a.valueStart, end: a.valueEnd, text: '' }]
      : [];
  }

  const old = tokenSpans(src, a.valueStart, a.valueEnd);

  // An empty (or whitespace-only) value takes the new list wholesale.
  if (old.length === 0) {
    return [{ start: a.valueStart, end: a.valueEnd, text: newTokens.join(' ') }];
  }

  return diffTokenSpans(old, newTokens);
}

interface TokenSpan { text: string; start: number; end: number; }

/** The non-whitespace runs of `src[start, end)`, as absolute spans. */
function tokenSpans(src: string, start: number, end: number): TokenSpan[] {
  const out: TokenSpan[] = [];
  const value = src.slice(start, end);
  for (const m of value.matchAll(/\S+/g)) {
    out.push({ text: m[0], start: start + m.index, end: start + m.index + m[0].length });
  }
  return out;
}

/** Diff the existing token spans against the desired token list and emit the
    smallest set of edits that transforms one into the other, touching only
    changed tokens. Uses an LCS alignment, so runs of unchanged tokens (and the
    whitespace between them) are never in an edit range. */
function diffTokenSpans(old: TokenSpan[], neu: string[]): Edit[] {
  const n = old.length, m = neu.length;

  // LCS length table: dp[i][j] = LCS of old[i..], neu[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = old[i]!.text === neu[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  // Turn the alignment into a flat op list (eq keeps a token, del removes one,
  // ins adds one). `k` indexes old for eq/del, neu for ins.
  type Op = { t: 'eq' | 'del' | 'ins'; k: number };
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (old[i]!.text === neu[j]!) { ops.push({ t: 'eq', k: i }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { ops.push({ t: 'del', k: i }); i++; }
    else { ops.push({ t: 'ins', k: j }); j++; }
  }
  while (i < n) { ops.push({ t: 'del', k: i }); i++; }
  while (j < m) { ops.push({ t: 'ins', k: j }); j++; }

  // Group consecutive non-eq ops into change blocks. `leftEnd` is the end of the
  // unchanged token before the block (−1 at the value's start); the eq op after
  // it (if any) gives the right bound. Unchanged runs are never in an edit.
  const edits: Edit[] = [];
  let leftEnd = -1;
  for (let k = 0; k < ops.length; ) {
    if (ops[k]!.t === 'eq') { leftEnd = old[ops[k]!.k]!.end; k++; continue; }
    const removed: TokenSpan[] = [];
    const inserted: string[] = [];
    for (; k < ops.length && ops[k]!.t !== 'eq'; k++) {
      if (ops[k]!.t === 'del') removed.push(old[ops[k]!.k]!);
      else inserted.push(neu[ops[k]!.k]!);
    }
    const rightStart = k < ops.length ? old[ops[k]!.k]!.start : -1;
    edits.push(...blockEdit(removed, inserted, leftEnd, rightStart));
    if (removed.length) leftEnd = removed[removed.length - 1]!.end;
  }
  return edits;
}

/** One change block → its edit(s). `leftEnd`/`rightStart` are the offsets just
    outside the block (an unchanged token's edge, or −1 when the block is at the
    value's edge). Whitespace is taken from the block's own side so the
    surviving neighbour keeps exactly one separator. */
function blockEdit(
  removed: TokenSpan[], inserted: string[], leftEnd: number, rightStart: number,
): Edit[] {
  const text = inserted.join(' ');
  if (removed.length && inserted.length) {
    // Replace the removed run in place.
    return [{ start: removed[0]!.start, end: removed[removed.length - 1]!.end, text }];
  }
  if (removed.length) {
    // Pure removal: drop the tokens and one adjacent separator, preferring the
    // one before them so `a b c` minus `b` becomes `a c`, not `a  c`.
    const start = leftEnd >= 0 ? leftEnd : removed[0]!.start;
    const end = leftEnd >= 0 ? removed[removed.length - 1]!.end
              : rightStart >= 0 ? rightStart
              : removed[removed.length - 1]!.end;
    return [{ start, end, text: '' }];
  }
  // Pure insertion: splice next to a neighbour with a single separating space.
  if (leftEnd >= 0) return [{ start: leftEnd, end: leftEnd, text: ' ' + text }];
  if (rightStart >= 0) return [{ start: rightStart, end: rightStart, text: text + ' ' }];
  return [];   // no neighbours — caller handles the empty-value case
}

/** Replace the class attribute's value on `el` and return the new source.
    Thin wrapper over classEdit for callers that want the whole string
    (and the ported test suite). */
export function writeClass(src: string, el: El, newTokens: string[]): string {
  return applyEdits(src, classEdit(src, el, newTokens));
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

/** Indent to use for a new child of `el`: copied from its first element
    child, else the element's own indent plus one level (`unit`). */
export function childIndent(src: string, el: El, unit?: string): string {
  const first = el.children[0];
  if (first) return elementCutRange(src, first).indent;
  return elementCutRange(src, el).indent + (unit ?? detectIndentUnit(src));
}

/** `childIndent` under its original name — a row's columns are what it was
    written for, and the callers that insert columns still read better this
    way. */
export const rowChildIndent = childIndent;

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
