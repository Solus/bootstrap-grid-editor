/* Offset-preserving template parser.

   Parses HTML-ish Angular template text into an element tree where every
   element remembers exact source offsets, so edits can be surgical.
   Tolerant of unclosed and mismatched tags.

   Session 2 replaces this with an @angular/compiler adapter; everything
   downstream talks to the model, not to this tree. */

import type { Attr, El, RootEl } from './types.js';

export const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

interface OpenTag {
  tag: string;
  attrs: Attr[];
  selfClosing: boolean;
  end: number;
}

export function parseTemplate(src: string): RootEl {
  const root: RootEl = {
    tag: '#root', attrs: [], children: [], start: 0, end: src.length,
    openEnd: 0, contentStart: 0, contentEnd: src.length, parent: null,
  };
  const stack: El[] = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    i = lt;
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i);
      i = e < 0 ? src.length : e + 3;
      continue;
    }
    if (src[i + 1] === '!' || src[i + 1] === '?') {
      const gt = src.indexOf('>', i);
      i = gt < 0 ? src.length : gt + 1;
      continue;
    }
    if (src[i + 1] === '/') {
      const gt = src.indexOf('>', i);
      if (gt < 0) break;
      const name = src.slice(i + 2, gt).trim().toLowerCase();
      let k = stack.length - 1;
      while (k > 0 && stack[k]!.tag.toLowerCase() !== name) k--;
      if (k > 0) {
        // implicitly close inner unclosed elements at position i
        while (stack.length - 1 > k) {
          const inner = stack.pop()!;
          inner.contentEnd = i; inner.end = i;
        }
        const el = stack.pop()!;
        el.contentEnd = i;
        el.end = gt + 1;
      }
      i = gt + 1;
      continue;
    }
    const parsed = parseOpenTag(src, i);
    if (!parsed) { i++; continue; }
    const el: El = {
      tag: parsed.tag, attrs: parsed.attrs, children: [],
      start: i, openEnd: parsed.end, end: parsed.end,
      contentStart: parsed.end, contentEnd: parsed.end,
      selfClosing: parsed.selfClosing, parent: stack[stack.length - 1]!,
    };
    stack[stack.length - 1]!.children.push(el);
    if (!parsed.selfClosing && !VOID_TAGS.has(parsed.tag.toLowerCase())) {
      stack.push(el);
    }
    i = parsed.end;
  }
  while (stack.length > 1) {
    const el = stack.pop()!;
    el.contentEnd = src.length; el.end = src.length;
  }
  return root;
}

/* Parse one opening tag starting at `start` ('<'). Quote-aware so Angular
   bindings like [disabled]="a > b" don't break tag-end detection. */
export function parseOpenTag(src: string, start: number): OpenTag | null {
  let i = start + 1;
  const nameM = /^[A-Za-z][^\s/>]*/.exec(src.slice(i));
  if (!nameM) return null;
  const tag = nameM[0];
  i += tag.length;
  const attrs: Attr[] = [];
  let selfClosing = false;

  while (i < src.length) {
    // skip whitespace
    while (i < src.length && /\s/.test(src[i]!)) i++;
    if (i >= src.length) break;
    const ch = src[i];
    if (ch === '>') { i++; return { tag, attrs, selfClosing, end: i }; }
    if (ch === '/' && src[i + 1] === '>') { selfClosing = true; i += 2; return { tag, attrs, selfClosing, end: i }; }
    // attribute name: anything up to ws, '=', '>' ( '/' allowed only as part of '/>' )
    const ns = i;
    while (i < src.length && !/[\s=>]/.test(src[i]!)) {
      if (src[i] === '/' && src[i + 1] === '>') break;
      i++;
    }
    const name = src.slice(ns, i);
    if (!name) { i++; continue; }
    const attr: Attr = { name, valueStart: -1, valueEnd: -1, value: null, quote: '' };
    // skip ws before possible '='
    let j = i;
    while (j < src.length && /\s/.test(src[j]!)) j++;
    if (src[j] === '=') {
      j++;
      while (j < src.length && /\s/.test(src[j]!)) j++;
      const q = src[j];
      if (q === '"' || q === "'") {
        const vEnd = src.indexOf(q, j + 1);
        attr.quote = q;
        attr.valueStart = j + 1;
        attr.valueEnd = vEnd < 0 ? src.length : vEnd;
        attr.value = src.slice(attr.valueStart, attr.valueEnd);
        i = (vEnd < 0 ? src.length : vEnd + 1);
      } else {
        // unquoted value
        let ve = j;
        while (ve < src.length && !/[\s>]/.test(src[ve]!)) ve++;
        attr.quote = '';
        attr.valueStart = j; attr.valueEnd = ve;
        attr.value = src.slice(j, ve);
        i = ve;
      }
    }
    attrs.push(attr);
  }
  return { tag, attrs, selfClosing, end: i };
}
