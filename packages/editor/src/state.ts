/* Application state, history, and the model-path helpers everything else
   navigates by. `apply` is the single funnel through which every edit
   reaches the document. */

import {
  BPS, applyEdits, buildModel, classTokens, classValue, definingBp,
  detectIndentUnit, isColTokens, parseTemplate, usesBs3, widthTokenBp,
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
  /** One level of indentation as this document writes it (a tab, two spaces,
      four…), detected on every apply. Everything the canvas inserts indents
      with this, so a tab-indented file never gets spaces spliced into it. */
  indentUnit: string;
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
  indentUnit: '  ',
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
  /** Persist a sticky view preference the user toggled in the canvas
      (stretch/tint), so it's remembered next open. Optional: the standalone
      has nowhere to persist to and omits it; the extension writes it to the
      user's VS Code settings. */
  persistViewPref?(pref: ViewPref, value: boolean): void;
}

/** The view toggles that double as remembered settings. */
export type ViewPref = 'stretchSheet' | 'tintOverfull';

/** Settings the host seeds the canvas with at open (extension only). All
    optional — an absent field keeps the built-in default. */
export interface OpenConfig {
  breakpoint?: Breakpoint;
  stretchSheet?: boolean;
  tintOverfull?: boolean;
  /** Dialect for *new* classes when a file has none to detect from. */
  dialect?: 'bootstrap5' | 'bootstrap3';
}

/** Default dialect for a file with no grid classes (set by config; BS5 unless
    the host says otherwise). A file that *does* declare grid classes always
    wins over this — see `detectDialect`. */
let dialectDefault = false;   // false = Bootstrap 4/5

/** Seed the canvas from the host's settings, once, before the first render. */
export function applyOpenConfig(cfg: OpenConfig): void {
  if (cfg.breakpoint) state.bp = cfg.breakpoint;
  if (cfg.stretchSheet != null) state.stretchSheet = cfg.stretchSheet;
  if (cfg.tintOverfull != null) state.tintOverfull = cfg.tintOverfull;
  if (cfg.dialect) dialectDefault = cfg.dialect === 'bootstrap3';
}

let host: Host | null = null;
export function setHost(h: Host): void { host = h; }

/** Set a sticky view preference and tell the host to remember it. */
export function persistViewPref(pref: ViewPref, value: boolean): void {
  state[pref] = value;
  host?.persistViewPref?.(pref, value);
}

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
  // Parse + build BEFORE touching any state, so a failure here leaves the last
  // good view fully intact: nothing committed, no history push, no host round-
  // trip — the canvas stays on the previous render instead of going blank or
  // half-updated. (parseTemplate itself is tolerant and won't throw; this
  // guards buildModel and any future step that could choke on odd input.)
  let root: RootEl, model: RowNode[];
  try {
    root = parseTemplate(newSrc);
    model = buildModel(root, state.activeBranch);
  } catch (err) {
    console.error('[bootstrap-visualizer] parse/build failed — edit rejected', err);
    toast('Couldn’t read this template — canvas left unchanged', 'warn');
    return;
  }

  dnd.src = null;
  document.body.classList.remove('dnd');
  if (pushHistory) {
    state.history = state.history.slice(0, state.hIndex + 1);
    state.history.push(newSrc);
    state.hIndex = state.history.length - 1;
  }
  state.src = newSrc;
  state.root = root;
  state.model = model;
  state.docBs3 = detectDialect(root);
  state.indentUnit = detectIndentUnit(newSrc);
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
  let model: RowNode[];
  try {
    model = buildModel(state.root, state.activeBranch);
  } catch (err) {
    console.error('[bootstrap-visualizer] model rebuild failed — view left unchanged', err);
    toast('Couldn’t update the view — left unchanged', 'warn');
    return;
  }
  state.model = model;
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
  // Stamp each edit with the exact text it expects to replace, plus a little
  // context on each side, read from the source it was computed against. The
  // extension verifies this before replaying the edit onto the document, so an
  // offset desync (the webview's source out of step with the buffer) is refused
  // as a divergence instead of splicing into the wrong place and corrupting the
  // HTML. The `before`/`after` context is what catches an *insertion* (Add
  // column/row): its `old` is empty and would match anywhere, but a drifted
  // insertion point won't have the expected surrounding text.
  const CTX = 16;
  const stamped = edits.map(e => ({
    ...e,
    old: state.src.slice(e.start, e.end),
    before: state.src.slice(Math.max(0, e.start - CTX), e.start),
    after: state.src.slice(e.end, e.end + CTX),
  }));
  apply(applyEdits(state.src, stamped), { ...opts, edits: stamped });
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

/** Whether new classes should be BS3-style. A file that already declares grid
    classes decides for itself — BS3 evidence → BS3, any other grid class →
    BS4/5. Only a file with *no* grid classes falls back to the configured
    `dialectDefault`, so the setting breaks ties without ever overriding a
    document that has clearly picked a dialect. */
export function detectDialect(root: El): boolean {
  let hasGrid = false;
  const bs3 = (function walk(e: El): boolean {
    for (const c of e.children) {
      const toks = classTokens(c);
      if (usesBs3(toks)) return true;
      if (!hasGrid && isColTokens(toks)) hasGrid = true;
      if (walk(c)) return true;
    }
    return false;
  })(root);
  return bs3 ? true : (hasGrid ? false : dialectDefault);
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
