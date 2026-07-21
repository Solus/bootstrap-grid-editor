/* The grid model: rows, columns and the classification rules that decide
   what a column *is*. Everything downstream (render, inspector, fill,
   search, edits) talks to this, never to the parse tree directly. */

import { classTokens, colSpec, hasClass, isColTokens } from './classes.js';
import type { ColNode, El, NodeRef, RowNode } from './types.js';

export function isRowEl(el: El): boolean {
  return hasClass(el, 'row') || hasClass(el, 'form-row');
}

export function isHeadingEl(el: El): boolean {
  return /^(legend|h[1-6])$/i.test(el.tag);
}

export function isSpacerEl(el: El): boolean {
  return /^(br|hr)$/i.test(el.tag);
}

export function subtreeHasRow(el: El): boolean {
  return el.children.some(c => isRowEl(c) || subtreeHasRow(c));
}

/* ── building ────────────────────────────────────────────────────── */

/** Collect rows whose nearest grid ancestor is `el` — recursion stops at
    each row, so a row's own nested rows belong to its columns, not here. */
export function findRows(el: El, out: RowNode[] = []): RowNode[] {
  for (const c of el.children) {
    if (isRowEl(c)) out.push(buildRow(c));
    else findRows(c, out);
  }
  return out;
}

export function buildRow(el: El): RowNode {
  return { kind: 'row', el, cols: el.children.map(buildCol) };
}

export function buildCol(el: El): ColNode {
  const tokens = classTokens(el);
  return {
    kind: 'col', el,
    spec: colSpec(tokens),
    isCol: isColTokens(tokens),
    nestedRows: findRows(el, []),
  };
}

export function buildModel(root: El): RowNode[] {
  return findRows(root, []);
}

/* ── classification ──────────────────────────────────────────────── */

/** The element's own text outside its child elements, comments stripped. */
export function looseText(src: string, el: El): string {
  let txt = '', pos = el.contentStart;
  for (const c of el.children) {
    txt += src.slice(pos, c.start);
    pos = c.end;
  }
  txt += src.slice(pos, el.contentEnd);
  return txt.replace(/<!--[\s\S]*?-->/g, '');
}

/** Angular 17 control-flow blocks (@if/@else/@for/@switch) make a row's
    fill sum unreliable — all branches parse as simultaneous columns, so
    they double-count. Rows like this show `~unreliable`, never a warning. */
export function rowHasControlFlow(src: string, el: El): boolean {
  return /@(if|else|for|switch)\b/.test(looseText(src, el));
}

/** A "container" column is structural scaffolding: it leads to nested rows,
    every element child is a row, a heading (legend/h1-h6 as section title),
    a spacer (br/hr), or a wrapper whose subtree contains rows (panel
    sections, fieldsets, ng-container…), and it has no loose content text.
    Anything else is a *content* column. */
export function isContainerCol(src: string, el: El): boolean {
  if (!el.children.length) return false;
  if (!el.children.some(c => isRowEl(c) || subtreeHasRow(c))) return false;
  if (!el.children.every(c =>
      isRowEl(c) || isHeadingEl(c) || isSpacerEl(c) || subtreeHasRow(c))) return false;
  return looseText(src, el).trim() === '';
}

/* ── lookup ──────────────────────────────────────────────────────── */

/** Small stable hash, used for identity tracking across re-parses. */
export function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The deepest row/col in the model whose source span contains `pos`. */
export function nodeAtOffset(model: RowNode[], pos: number): NodeRef | null {
  let best: NodeRef | null = null;
  (function walk(rlist: RowNode[], base: number[]) {
    rlist.forEach((r, i) => {
      const p = base.concat(i);
      if (pos >= r.el.start && pos < r.el.end) {
        best = { path: p, kind: 'row' };
        r.cols.forEach((c, ci) => {
          if (pos >= c.el.start && pos < c.el.end) {
            best = { path: p.concat(ci), kind: 'col' };
            walk(c.nestedRows, p.concat(ci));
          }
        });
      }
    });
  })(model, []);
  return best;
}
