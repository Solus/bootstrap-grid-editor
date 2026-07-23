/* Application state, history, and the model-path helpers everything else
   navigates by. `apply` is the single funnel through which every edit
   reaches the document. */

import {
  BPS, applyEdits, buildModel, classTokens, classValue, definingBp,
  parseTemplate, usesBs3, widthTokenBp,
} from '@bootstrap-visualizer/core';
import type {
  Breakpoint, ColNode, Edit, El, NodePath, RootEl, RowNode,
} from '@bootstrap-visualizer/core';
import { toast } from './dom.js';
import { render } from './render.js';
import { dnd } from './dnd.js';

export interface Selection {
  path: NodePath;
  kind: 'row' | 'col';
}

export interface AppState {
  src: string;
  root: RootEl | null;
  model: RowNode[];
  bp: Breakpoint;
  sel: Selection | null;
  history: string[];
  hIndex: number;
  /** Textarea edited but not applied. */
  dirty: boolean;
  /** Row identity keys collapsed via the chevron. */
  collapsed: Set<string>;
  /** Which branch of each `@if` region is shown (region key → branch index;
      default 0). View-state, keyed by content so it survives re-parse. */
  activeBranch: Record<string, number>;
  /** Amber row border on overfull rows (View section). */
  tintOverfull: boolean;
  /** Let the sheet use the full canvas panel instead of the breakpoint's
      representative width (View section). Purely presentational — all grid
      semantics are 12-col span math, so proportions are unchanged. */
  stretchSheet: boolean;
  /** Name of the opened file, used for Download. */
  fileName: string | null;
  /** Any BS3-style grid class anywhere in the document. */
  docBs3: boolean;
  find: string;
  findMatches: Selection[];
  findIdx: number | null;
  inspDetailsOpen: boolean;
  _rowIds: Map<string, string>;
  _findSet: Set<string> | null;
  _bandLines: [number, number] | null;
}

export const SHEET_WIDTH: Record<Breakpoint, number> = {
  xs: 400, sm: 560, md: 740, lg: 920, xl: 1080, xxl: 1180,
};

export const state: AppState = {
  src: '',
  root: null,
  model: [],
  bp: 'md',
  sel: null,
  history: [],
  hIndex: -1,
  dirty: false,
  collapsed: new Set(),
  activeBranch: {},
  tintOverfull: false,
  stretchSheet: false,
  fileName: null,
  docBs3: false,
  find: '',
  findMatches: [],
  findIdx: null,
  inspDetailsOpen: false,
  _rowIds: new Map(),
  _findSet: null,
  _bandLines: null,
};

export const resize = { active: false };

export const DIRTY_MSG =
  'Source pane has unapplied edits — Apply (Ctrl+Enter) or Revert first';

/* ── host adapter ─────────────────────────────────────────────────── */

/** The two ends of the pipe that differ between frontends (PLAN.md). The
    shared engine drives everything else; the host owns *source in / edits
    out* and the "is it safe to edit now?" guard. Standalone's host wraps the
    textarea; the extension's will bridge to the editor document. */
export interface Host {
  /** May a canvas-originated edit be applied right now? The single
      authoritative guard (resolves FOLLOW-UPS §1.3); resize/drag consult it
      too, to abort a gesture early. */
  canApplyEdit(): { ok: true } | { ok: false; reason: string };
  /** The engine has committed `newSrc`. `edits` is the span batch for an
      incremental edit (applyOps), or null for a whole-document replace
      (file load / sample / undo-redo). The host pushes this outward:
      standalone syncs its textarea; the extension replays the batch as
      minimal workspace edits (or replaces the document when null). */
  commit(newSrc: string, edits: Edit[] | null): void;
  /** Reflect the current selection in the host's source view: `el` to reveal
      that element's span (standalone: textarea selection + highlight band;
      extension: editor.revealRange), or null when selection is cleared. */
  revealSource(el: El | null): void;
}

let host: Host | null = null;
export function setHost(h: Host): void { host = h; }

export function canApplyEdit(): { ok: true } | { ok: false; reason: string } {
  return host ? host.canApplyEdit() : { ok: true };
}

export function revealSource(el: El | null): void {
  host?.revealSource(el);
}

/* ── state / history ─────────────────────────────────────────────── */

export interface ApplyOpts {
  pushHistory?: boolean;
  keepSel?: boolean;
  fromSource?: boolean;
  /** The span batch that produced this apply (from applyOps), or null for a
      whole-document replace. Passed through to the host. */
  edits?: Edit[] | null;
}

export function apply(newSrc: string, opts: ApplyOpts = {}): void {
  const { pushHistory = true, keepSel = true, fromSource = false, edits = null } = opts;
  if (!fromSource) {
    const guard = canApplyEdit();
    if (!guard.ok) {
      toast(guard.reason, 'warn');
      render();             // restore any live previews (e.g. resize)
      return;
    }
  }
  dnd.src = null;
  document.body.classList.remove('dnd');
  if (pushHistory) {
    state.history = state.history.slice(0, state.hIndex + 1);
    state.history.push(newSrc);
    state.hIndex = state.history.length - 1;
  }
  state.src = newSrc;
  state.root = parseTemplate(newSrc);
  state.model = buildModel(state.root, state.activeBranch);
  state.docBs3 = computeDocBs3(state.root);
  if (!keepSel) state.sel = null;
  if (state.sel && !resolvePath(state.sel.path)) state.sel = null;
  if (!state.sel) state._bandLines = null;
  host?.commit(newSrc, edits);   // the host owns source-out (textarea / buffer)
  render();
}

/** Rebuild the model from the current source with the current branch
    selection, and re-render — WITHOUT touching the document, history, or the
    host. Used by the `@if` branch toggle (a pure view change). */
export function rebuildModel(): void {
  if (!state.root) return;
  state.model = buildModel(state.root, state.activeBranch);
  if (state.sel && !resolvePath(state.sel.path)) state.sel = null;
  render();
}

/** Show branch `index` of `@if` region `region` (view-state only). */
export function setActiveBranch(region: string, index: number): void {
  state.activeBranch[region] = index;
  rebuildModel();
}

/** Apply a batch of span edits produced by an edit operation. This is the
    incremental edits-out path (as opposed to `apply`, which replaces the
    whole document — used by file load, sample, undo/redo). Today it splices
    the edits into a new source string and funnels through `apply`; the
    extension host will additionally replay the same batch onto the editor
    document as minimal workspace edits. */
export function applyOps(edits: Edit[], opts: ApplyOpts = {}): void {
  if (!edits.length) return;
  apply(applyEdits(state.src, edits), { ...opts, edits });
}

/* undo/redo pre-check: `apply()` holds the authoritative guard, but it runs
   *after* we move `hIndex` — a refusal there would desync history from the
   document. Ask the same guard first so the index only moves when the apply
   will be accepted. (FOLLOW-UPS §1.3: early checks like this and the two in
   dnd.ts are deliberate redundancy for ordering/UX, never the only
   protection.) */

export function undo(): void {
  const guard = canApplyEdit();
  if (!guard.ok) { toast(guard.reason, 'warn'); return; }
  if (state.hIndex > 0) {
    state.hIndex--;
    apply(state.history[state.hIndex]!, { pushHistory: false });
  }
}

export function redo(): void {
  const guard = canApplyEdit();
  if (!guard.ok) { toast(guard.reason, 'warn'); return; }
  if (state.hIndex < state.history.length - 1) {
    state.hIndex++;
    apply(state.history[state.hIndex]!, { pushHistory: false });
  }
}

/* ── model paths ─────────────────────────────────────────────────── */

/** path = [rowIdx, colIdx, rowIdx, colIdx, …] into the model tree */
export function resolvePath(path: NodePath | null): RowNode | ColNode | null {
  if (!path) return null;
  let node: RowNode | ColNode | null = null;
  let list: (RowNode | ColNode)[] = state.model;
  for (let i = 0; i < path.length; i++) {
    node = list[path[i]!] ?? null;
    if (!node) return null;
    list = node.kind === 'row' ? node.cols : node.nestedRows;
  }
  return node;
}

export function rowOfSel(): RowNode | ColNode | null {
  return state.sel ? resolvePath(state.sel.path.slice(0, -1)) : null;
}

/** Any BS3-style grid class anywhere in the document? */
export function computeDocBs3(root: El): boolean {
  let found = false;
  (function walk(e: El) {
    if (found) return;
    for (const c of e.children) {
      const v = classValue(c);
      if (v && usesBs3(v.trim().split(/\s+/))) { found = true; return; }
      walk(c);
    }
  })(root);
  return found;
}

/* ── tier conventions for newly created tokens ───────────────────── */

/** Tier to create a new token at when the element defines none for this
    property: the element's own width tier, else the tier its row siblings
    use most, else the current view breakpoint. */
export function fallbackTier(node: ColNode, rowNode: RowNode | ColNode | null): Breakpoint {
  const wdef = definingBp(node.spec.width, state.bp);
  if (wdef) return wdef;
  const own = Object.keys(node.spec.width) as Breakpoint[];
  if (own.length) return own[0]!;
  const dom = dominantTier(rowNode);
  return dom || state.bp;
}

export function dominantTier(rowNode: RowNode | ColNode | null): Breakpoint | null {
  if (!rowNode || rowNode.kind !== 'row') return null;
  const count: Partial<Record<Breakpoint, number>> = {};
  rowNode.cols.forEach(c =>
    (Object.keys(c.spec.width) as Breakpoint[]).forEach(b => count[b] = (count[b] ?? 0) + 1));
  let best: Breakpoint | null = null;
  for (const b of BPS) if (count[b] && (best == null || count[b]! > count[best]!)) best = b;
  return best;
}

/** Width classes for a brand-new column: copy the reference element's width
    tokens verbatim; else follow the row's dominant tier in the doc dialect. */
export function conventionNewColTokens(
  refTokens: string[] | null, rowNode: RowNode | ColNode | null,
): string[] {
  const w = (refTokens ?? []).filter(t => widthTokenBp(t) != null);
  if (w.length) return w.slice();
  const tier = dominantTier(rowNode) || state.bp;
  if (state.docBs3) return [`col-${tier}-6`];
  return [tier === 'xs' ? 'col' : `col-${tier}`];
}

/* Re-exported so callers don't need a second import for the common case. */
export { classTokens };
