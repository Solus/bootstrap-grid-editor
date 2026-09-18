/* Titles, content hints and section structure — everything the canvas
   labels a block with, derived from the markup itself.

   Precedence is deliberate: an author's comment beats a heading, and a
   form control's name beats an i18n key beats a bare tag name. */

import { isHeadingEl, isRowEl, isSpacerEl, subtreeHasRow } from './model.js';
import type { ColSeqItem, ContentHint, El, Label } from './types.js';

/* ── i18n keys ───────────────────────────────────────────────────── */

export function i18nKey(el: El): string | null {
  const a = el.attrs.find(x => {
    const n = x.name.toLowerCase();
    return n === 'app-i18n' || n === 'lc-l10n' || n.includes('i18n');
  });
  return a && a.value ? a.value : null;
}

export function lastKeySegment(key: string): string {
  const p = key.split('.');
  return p[p.length - 1] || key;
}

/* ── title comments ──────────────────────────────────────────────── */

/** A comment directly above `pos` with only whitespace between, e.g.
    `<!--COL3-->` → `{open, text:'COL3'}`.

    A blank line between the comment and the element breaks the
    association — such a comment describes a section, not this element,
    so it is neither adopted as a title nor carried along on a move.
    Commented-out markup (text containing '<') is ignored. */
export function precedingCommentRange(
  src: string, pos: number,
): { open: number; text: string } | null {
  let i = pos;
  let newlines = 0;
  while (i > 0 && /\s/.test(src[i - 1]!)) {
    if (src[i - 1] === '\n' && ++newlines >= 2) return null;
    i--;
  }
  if (src.slice(i - 3, i) !== '-->') return null;
  const open = src.lastIndexOf('<!--', i - 3);
  if (open < 0) return null;
  const text = src.slice(open + 4, i - 3).trim();
  if (!text || text.includes('<')) return null;
  return { open, text };
}

/** Title of an element: the comment above it, else its first inner comment. */
export function elementTitle(src: string, el: El): string | null {
  const pre = precedingCommentRange(src, el.start);
  if (pre) return pre.text;
  let i = el.contentStart;
  while (i < el.contentEnd && /\s/.test(src[i]!)) i++;
  if (src.startsWith('<!--', i)) {
    const e = src.indexOf('-->', i);
    if (e >= 0 && e < el.contentEnd) {
      const text = src.slice(i + 4, e).trim();
      if (text && !text.includes('<')) return text;
    }
  }
  return null;
}

/* ── headings & section titles ───────────────────────────────────── */

/** Label of one heading element: its text, else its i18n key's last segment. */
export function headingLabel(src: string, h: El): Label | null {
  const txt = src.slice(h.contentStart, h.contentEnd)
    .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (txt) return { text: txt, full: txt };
  const k = i18nKey(h);
  if (k) return { text: lastKeySegment(k), full: k };
  return null;
}

/** Title taken from the column's first heading child. */
export function headingTitle(src: string, el: El): Label | null {
  const h = el.children.find(isHeadingEl);
  if (!h) return null;
  return headingLabel(src, h);
}

/** `sectionTitle="demo.editor.sectionF"` on wrapper components. */
export function sectionTitleAttr(el: El): Label | null {
  const a = el.attrs.find(x => {
    const n = x.name.toLowerCase();
    return n === 'sectiontitle' || n === '[sectiontitle]';
  });
  if (!a || !a.value) return null;
  return { text: lastKeySegment(a.value), full: a.value };
}

/** Combined title for a column: an explicit comment wins, then a heading. */
export function colTitle(src: string, el: El): Label | null {
  const c = elementTitle(src, el);
  if (c) return { text: c, full: c };
  return headingTitle(src, el);
}

/* ── inner structure ─────────────────────────────────────────────── */

/** Ordered walk of a column's inner structure: rows interleaved with the
    headings and titled wrappers between them. Rows appear in exactly the
    order findRows collects them, so the two line up index-for-index. */
export function colSequence(
  src: string, el: El, out: ColSeqItem[] = [], direct = true,
): ColSeqItem[] {
  for (const c of el.children) {
    if (isRowEl(c)) {
      out.push({ kind: 'row', el: c });
    } else if (isHeadingEl(c)) {
      const lab = headingLabel(src, c);
      if (lab) out.push({ kind: 'sep', text: lab.text, full: lab.full, direct });
    } else if (isSpacerEl(c)) {
      continue;
    } else if (subtreeHasRow(c)) {
      const t = sectionTitleAttr(c);
      if (t) out.push({ kind: 'sep', text: t.text, full: t.full, direct: false });
      colSequence(src, c, out, false);
    }
  }
  return out;
}

/* ── content hints ───────────────────────────────────────────────── */

export function controlName(el: El): string | null {
  const a = el.attrs.find(x => {
    const n = x.name.toLowerCase();
    return n === 'formcontrolname' || n === '[formcontrol]' || n === 'formcontrol';
  });
  return a && a.value ? a.value : null;
}

/** Best content hint for a column, searched shallowly (depth 3) among
    non-row descendants: a form control's name beats an i18n key beats
    the first tag name. `tag` says which element type supplied it. */
export function contentHint(_src: string, el: El): ContentHint | null {
  const q = el.children.filter(c => !isRowEl(c) && !isSpacerEl(c)).map(c => ({ e: c, d: 1 }));
  let firstTag: string | null = null;
  let firstI18n: string | null = null;
  let firstI18nTag: string | null = null;
  while (q.length) {
    const { e, d } = q.shift()!;
    const cn = controlName(e);
    if (cn) return { text: cn, kind: 'control', tag: e.tag };
    if (!firstI18n) {
      const k = i18nKey(e);
      if (k) { firstI18n = lastKeySegment(k); firstI18nTag = e.tag; }
    }
    if (!firstTag && !isHeadingEl(e)) firstTag = '<' + e.tag + '>';
    if (d < 3) e.children.forEach(c => { if (!isRowEl(c) && !isSpacerEl(c)) q.push({ e: c, d: d + 1 }); });
  }
  if (firstI18n) return { text: firstI18n, kind: 'i18n', tag: firstI18nTag ?? undefined };
  if (firstTag) return { text: firstTag, kind: 'tag' };
  return null;
}

/* ── search ──────────────────────────────────────────────────────── */

/** Everything a column is findable by: its title (short and full), its
    content hint (name and providing tag), and the section separators
    inside it — so searching "sectionM" finds the container holding it. */
export function colSearchText(src: string, el: El): string {
  const parts: string[] = [];
  const t = colTitle(src, el);
  if (t) { parts.push(t.text); if (t.full !== t.text) parts.push(t.full); }
  const h = contentHint(src, el);
  if (h) { parts.push(h.text); if (h.tag) parts.push(h.tag); }
  for (const item of colSequence(src, el)) {
    if (item.kind === 'sep') {
      parts.push(item.text);
      if (item.full && item.full !== item.text) parts.push(item.full);
    }
  }
  return parts.join(' ').toLowerCase();
}
