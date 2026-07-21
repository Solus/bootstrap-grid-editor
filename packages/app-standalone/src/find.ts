/* The find field: match rows by title and columns by everything core says
   they're findable by, then step through hits. */

import { colSearchText, elementTitle } from '@bootstrap-visualizer/core';
import type { NodePath, RowNode } from '@bootstrap-visualizer/core';
import { $, rowsHost } from './dom.js';
import { state, type Selection } from './state.js';
import { render } from './render.js';

export function computeFind(): void {
  state.findMatches = [];
  state._findSet = null;
  const q = (state.find || '').trim().toLowerCase();
  if (!q) return;
  (function walk(rlist: RowNode[], base: NodePath) {
    rlist.forEach((r, i) => {
      const p = base.concat(i);
      const rt = elementTitle(state.src, r.el);
      if (rt && rt.toLowerCase().includes(q)) {
        state.findMatches.push({ path: p, kind: 'row' });
      }
      r.cols.forEach((c, ci) => {
        const cp = p.concat(ci);
        if (colSearchText(state.src, c.el).includes(q)) {
          state.findMatches.push({ path: cp, kind: 'col' });
        }
        walk(c.nestedRows, cp);
      });
    });
  })(state.model, []);
  state._findSet = new Set(state.findMatches.map(m => m.kind + ':' + m.path.join(',')));
  if (state.findIdx != null) {
    if (!state.findMatches.length) state.findIdx = null;
    else if (state.findIdx >= state.findMatches.length) {
      state.findIdx = state.findMatches.length - 1;
    }
  }
}

export function updateFindCount(): void {
  const c = $('#findCount');
  if (!c) return;
  if (!(state.find || '').trim()) { c.textContent = ''; return; }
  const n = state.findMatches.length;
  c.textContent = n === 0 ? '0 hits'
    : state.findIdx == null ? n + ' hit' + (n === 1 ? '' : 's')
    : (state.findIdx + 1) + '/' + n;
}

/** Expand any collapsed rows above this path so it can be seen. */
export function expandAncestors(path: NodePath): void {
  for (let len = 1; len < path.length; len += 2) {
    const key = state._rowIds.get(path.slice(0, len).join(','));
    if (key && state.collapsed.has(key)) state.collapsed.delete(key);
  }
}

export function findGo(dir: number): void {
  const m = state.findMatches;
  if (!m.length) return;
  state.findIdx = ((state.findIdx == null ? -1 : state.findIdx) + dir + m.length) % m.length;
  const hit = m[state.findIdx]! as Selection;
  expandAncestors(hit.path);
  state.sel = { path: hit.path.slice(), kind: hit.kind };
  render();
  const el = rowsHost.querySelector('[data-path="' + hit.path.join(',') + '"]');
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  updateFindCount();
}
