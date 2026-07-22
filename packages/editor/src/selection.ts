/* Selection — the shared part. Which block is selected drives the render and
   the host's source reveal. The textarea-specific highlight band and the
   caret→canvas reverse-sync live in the standalone frontend (source-band.ts),
   behind the host's revealSource. */

import { resolvePath, revealSource, state, type Selection } from './state.js';
import { render } from './render.js';

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
