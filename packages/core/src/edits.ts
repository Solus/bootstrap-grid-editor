/* Surgical text edits.

   Every operation here changes the smallest span that can express the
   change — a class attribute's value, or an element's text with its
   adjacent title comment. The document is never regenerated: the user's
   source is preserved byte-for-byte outside the edited span. */

import { getAttr } from './classes.js';
import { precedingCommentRange } from './titles.js';
import type { CutRange, El } from './types.js';

export function splice(src: string, start: number, end: number, text: string): string {
  return src.slice(0, start) + text + src.slice(end);
}

/** Replace the class attribute's value on `el`, adding the attribute if
    it's missing. An unquoted value is replaced *with* quotes, since the
    new value may contain spaces. */
export function writeClass(src: string, el: El, newTokens: string[]): string {
  const val = newTokens.join(' ');
  const a = getAttr(el, 'class');
  if (a && a.valueStart >= 0) {
    if (a.quote === '') {
      return splice(src, a.valueStart, a.valueEnd, '"' + val + '"');
    }
    return splice(src, a.valueStart, a.valueEnd, val);
  }
  // no class attribute — insert before '>' (or '/>')
  let pos = el.openEnd - 1;                    // at '>'
  if (src[el.openEnd - 2] === '/') pos = el.openEnd - 2;
  const lead = /\s/.test(src[pos - 1]!) ? '' : ' ';
  return splice(src, pos, pos, `${lead}class="${val}"`);
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
  if (cs > 0 && src[cs - 1] === '\n') cutStart = cs - 1;
  return { cutStart, cutEnd: el.end, textStart: anchor, indent };
}

/** Indent to use for children of a row: copied from its first element
    child, else the row's own indent plus two spaces. */
export function rowChildIndent(src: string, rowEl: El): string {
  const first = rowEl.children[0];
  if (first) return elementCutRange(src, first).indent;
  return elementCutRange(src, rowEl).indent + '  ';
}
