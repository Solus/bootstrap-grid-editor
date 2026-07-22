/* Selection — the shared part. Which block is selected drives the render and
   the host's source reveal. The textarea-specific highlight band lives in the
   standalone frontend (source-band.ts), behind the host's revealSource. */

import { nodeAtOffset } from '@bootstrap-visualizer/core';
import { resolvePath, revealSource, state, type Selection } from './state.js';
import { render } from './render.js';
import { rowsHost } from './dom.js';
import { expandAncestors } from './find.js';

export function select(sel: Selection): void {
  state.sel = sel;
  render();
  const node = resolvePath(sel.path);
  revealSource(node ? node.el : null);
}

export function clearSelection(): void {
  state.sel = null;
  state._bandLines = null;
  render();
  revealSource(null);
}

/** Select the deepest canvas block whose source span contains `offset` — the
    reverse direction, driven by the host's source caret (textarea or editor).
    Deliberately does NOT revealSource: the source *is* where this came from,
    so revealing back would feed a caret→canvas→caret loop. The dedup return
    also breaks the loop when a canvas→editor reveal echoes back as a caret
    move. Returns true if the selection changed. */
export function selectAtOffset(offset: number): boolean {
  const hit = nodeAtOffset(state.model, offset);
  if (!hit) return false;
  if (state.sel && state.sel.kind === hit.kind &&
      state.sel.path.join(',') === hit.path.join(',')) return false;
  expandAncestors(hit.path);
  state.sel = hit;
  render();
  const el = rowsHost.querySelector('[data-path="' + hit.path.join(',') + '"]');
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return true;
}
