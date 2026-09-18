/* Application state, history, and the model-path helpers everything else
   navigates by. `apply` is the single funnel through which every edit
   reaches the document. */

import {
  BPS, ROW_CLASS, applyEdits, buildModel, classTokens, definingBp,
  detectEol, detectIndentUnit, mergeClasses, nodeAtOffset, parseExtraClasses,
  parseTemplate, usesBs3, usesBs5, widthTokenBp,
} from '@bootstrap-visualizer/core';
import type {
  Breakpoint, ColNode, Edit, El, ExtraClasses, NodePath, RootEl, RowNode, Scaffold,
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
  /** What settled `docBs3`: the document's own classes, or the configured
      default for a document that doesn't say. Shown in the canvas so a written
      class is never unattributed (FOLLOW-UPS §9.14). */
  dialectSource: DialectSource;
  /** One level of indentation as this document writes it (a tab, two spaces,
      four…), detected on every apply. Everything the canvas inserts indents
      with this, so a tab-indented file never gets spaces spliced into it. */
  indentUnit: string;
  /** The document's line ending (`\n` or `\r\n`), detected alongside
      `indentUnit` and used by every builder that inserts a new line. */
  eol: string;
  /** The user's class convention: extra classes every row / column the canvas
      *creates* carries, on top of the grid classes it computes. Parsed from
      the setting; `raw` is what the user typed, echoed back into the field. */
  newRowClasses: ExtraClasses & { raw: string };
  newColClasses: ExtraClasses & { raw: string };
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
  dialectSource: 'setting',
  indentUnit: '  ',
  eol: '\n',
  newRowClasses: { raw: '', tokens: [], dropped: [] },
  newColClasses: { raw: '', tokens: [], dropped: [] },
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
  /** Persist a preference the user set in the canvas (the view toggles, the
      class convention), so it's remembered next open. Optional: the standalone
      has nowhere to persist to and omits it; the extension writes it to the
      user's VS Code settings. */
  persistPref?(change: PrefChange): void;
  /** What to offer when there is nothing to draw, as an HTML fragment shown
      under the shared "No `.row` elements found." line. The way *in* is the
      one thing the two frontends don't share — the standalone has a source
      pane, a sample and a file picker; the extension has the editor the canvas
      is bound to — so naming a control here is the host's job, not the shared
      renderer's. Optional: a host that omits it gets the bare finding, and the
      inspector's "Add row" either way.

      Returns a trusted literal: it is inserted as HTML, so a host must never
      build it from document text. */
  emptyCanvasHint?(): string;
}

/** The canvas controls that double as remembered settings: the two view
    toggles (booleans) and the class convention fields (strings). Carried as a
    discriminated union so a key and a value of the wrong type can't be paired
    — the host maps these straight onto settings. */
export type ViewPref = 'stretchSheet' | 'tintOverfull';
export type ClassPref = 'newRowClasses' | 'newColumnClasses';
export type PrefChange =
  | { pref: ViewPref; value: boolean }
  | { pref: ClassPref; value: string }
  | { pref: 'dialect'; value: Dialect };

/** Settings the host seeds the canvas with at open (extension only). All
    optional — an absent field keeps the built-in default. */
export interface OpenConfig {
  breakpoint?: Breakpoint;
  stretchSheet?: boolean;
  tintOverfull?: boolean;
  /** Dialect for *new* classes when the file's own classes don't settle it. */
  dialect?: 'bootstrap5' | 'bootstrap3';
  /** Class convention for created rows / columns (see `state.newRowClasses`). */
  newRowClasses?: string;
  newColumnClasses?: string;
}

/** The two class styles, as the setting names them. */
export type Dialect = 'bootstrap5' | 'bootstrap3';
/** What decided the dialect in force: the document's own classes, or the
    configured default (`dialectDefault`) for one whose classes don't say. */
export type DialectSource = 'file' | 'setting';

/** Dialect for a document whose own classes don't settle it — no grid classes,
    or only ones both dialects share (set by config; BS5 unless the host says
    otherwise). A file carrying evidence of one dialect wins over this — see
    `detectDialect`. */
let dialectDefault = false;   // false = Bootstrap 4/5

/** How the dialect reads in the canvas. Deliberately the framework's own
    version numbers rather than the setting's `bootstrap5` — the class style is
    shared by 4 and 5, and a user on Bootstrap 4 should recognise themselves in
    it. */
export function dialectLabel(bs3: boolean): string {
  return bs3 ? 'Bootstrap 3' : 'Bootstrap 4/5';
}

/** Set the fallback dialect and re-resolve the open document. Re-resolving is
    what makes the change visible, and only where it should be: a document
    relying on the fallback follows it, one whose own classes decide is
    unmoved, and the chip stays a status light there.

    Doesn't tell the host — see `setDialectPref` for the canvas's end and
    `readLiveSettings` for the host's. */
export function setDialectDefault(value: Dialect): void {
  dialectDefault = value === 'bootstrap3';
  if (state.root) {
    const d = decideDialect(state.root);
    state.docBs3 = d.bs3;
    state.dialectSource = d.source;
  }
}

/** The header chip's end of that change: set it, and ask the host to remember
    it. Split from `setDialectDefault` so the host's own push can reuse the
    setting half without writing straight back to where it came from. */
export function setDialectPref(value: Dialect): void {
  setDialectDefault(value);
  host?.persistPref?.({ pref: 'dialect', value });
}

/** Seed the canvas from the host's settings, once, before the first render.
    The settings above seed and are then the canvas's to change; the ones in
    `readLiveSettings` keep following the host all session. */
export function applyOpenConfig(cfg: OpenConfig): void {
  if (cfg.breakpoint) state.bp = cfg.breakpoint;
  if (cfg.stretchSheet != null) state.stretchSheet = cfg.stretchSheet;
  if (cfg.tintOverfull != null) state.tintOverfull = cfg.tintOverfull;
  readLiveSettings(cfg);
}

/** Take the settings that can also arrive *mid-session* out of a config — the
    user edited them in the host's settings with the canvas already open. Split
    from `applyOpenConfig` because re-running the whole open config then would
    yank the breakpoint and the view toggles back from under someone who had
    changed them on the canvas.

    These two are live for the same reason: the canvas *writes* them as well as
    reads them, so a panel holding a stale copy would clobber an edit made in
    settings. Nothing here writes back — the value arrived from the host, and
    answering it with a write of the same value is just an echo. */
export function readLiveSettings(cfg: OpenConfig): void {
  if (cfg.newRowClasses != null) setClassConvention('row', cfg.newRowClasses, false);
  if (cfg.newColumnClasses != null) setClassConvention('col', cfg.newColumnClasses, false);
  if (cfg.dialect) setDialectDefault(cfg.dialect);
}

let host: Host | null = null;
export function setHost(h: Host): void { host = h; }

/** Set a sticky view preference and tell the host to remember it. */
export function persistViewPref(pref: ViewPref, value: boolean): void {
  state[pref] = value;
  host?.persistPref?.({ pref, value });
}

/** Set the class convention for created rows or columns. `persist` is false
    when the value *came from* the host (open config, or a settings change), so
    it isn't written straight back. */
export function setClassConvention(
  kind: 'row' | 'col', raw: string, persist = true,
): void {
  const key = kind === 'row' ? 'newRowClasses' : 'newColClasses';
  if (state[key].raw === raw) return;
  state[key] = { raw, ...parseExtraClasses(raw) };
  if (persist) {
    host?.persistPref?.({
      pref: kind === 'row' ? 'newRowClasses' : 'newColumnClasses', value: raw,
    });
  }
}

/** The host's "nothing to draw" suggestion, or null when it has none (or no
    host is wired yet — the canvas can render before `setHost`). */
export function emptyCanvasHint(): string | null {
  return host?.emptyCanvasHint?.() ?? null;
}

/** Does this host remember preferences at all? The standalone doesn't, and
    the inspector says so rather than implying the field is sticky. */
export function canPersistPrefs(): boolean {
  return !!host?.persistPref;
}

/** The document's whitespace, as the markup builders in core want it.
    `indent` is the indent of the block being inserted. */
export function scaffoldAt(indent: string): Scaffold {
  return { eol: state.eol, indent, indentUnit: state.indentUnit };
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
  /** Select the deepest block at this offset **in the new source** once the
      model is rebuilt, instead of carrying the old selection's path across.
      For an edit that moves an element: its path is unknown until the model
      exists, but where its text lands is known from the edit batch, and an
      offset survives what a path and a content hash don't (FOLLOW-UPS §10.2).
      The host is asked to reveal the result, as a click on it would be. */
  selectAt?: number;
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
  const dialect = decideDialect(root);
  state.docBs3 = dialect.bs3;
  state.dialectSource = dialect.source;
  state.indentUnit = detectIndentUnit(newSrc);
  state.eol = detectEol(newSrc);
  if (opts.selectAt != null) state.sel = nodeAtOffset(model, opts.selectAt);
  else if (!keepSel) state.sel = null;
  if (state.sel && !resolvePath(state.sel.path)) state.sel = null;
  if (!state.sel) state._bandLines = null;
  host?.commit(newSrc, edits);   // the host owns source-out (textarea / buffer)
  render();
  // After the commit, so the host's source view holds the text the span
  // points into (the standalone's band is positioned over its textarea).
  if (opts.selectAt != null) {
    const node = state.sel && resolvePath(state.sel.path);
    revealSource(node ? node.el : null);
  }
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

/** Which dialect new classes follow in this document, and what decided it.
    Three-way, because *having* grid classes is not the same as having declared
    a dialect: `col-sm-6` is valid
    in both. Evidence only one dialect has decides — BS3 evidence (`usesBs3`)
    → BS3, BS4/5-only evidence (`usesBs5`) → BS4/5 — and a document whose grid
    classes are ambiguous (or absent) falls back to the configured
    `dialectDefault`. So the setting decides every case the file itself does
    not, and never overrides one it does.

    BS3 wins a document carrying both, since mixing the forms on one element
    (`col-xs-6` beside `offset-md-3`) is the one outcome that is broken in
    either framework. */
export function decideDialect(root: El): { bs3: boolean; source: DialectSource } {
  let bs5 = false;
  const bs3 = (function walk(e: El): boolean {
    for (const c of e.children) {
      const toks = classTokens(c);
      if (usesBs3(toks)) return true;
      if (!bs5 && usesBs5(toks)) bs5 = true;
      if (walk(c)) return true;
    }
    return false;
  })(root);
  if (bs3) return { bs3: true, source: 'file' };
  if (bs5) return { bs3: false, source: 'file' };
  return { bs3: dialectDefault, source: 'setting' };
}

/** Just the answer, for the callers that write tokens and don't care who
    decided. */
export function detectDialect(root: El): boolean {
  return decideDialect(root).bs3;
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

/** Full class list for a brand-new column: the computed width tokens, then
    the user's column convention. */
export function newColClassList(
  refTokens: string[] | null, rowNode: RowNode | ColNode | null,
): string[] {
  return mergeClasses(conventionNewColTokens(refTokens, rowNode), state.newColClasses.tokens);
}

/** Full class list for a brand-new row: the canonical `row` (so the canvas
    can always see what it created), then the user's row convention. */
export function newRowClassList(): string[] {
  return mergeClasses([ROW_CLASS], state.newRowClasses.tokens);
}

/** The single column a brand-new row is created with: full width, in the
    document's dialect (Bootstrap 3 has no bare `col`), plus the column
    convention. Not `conventionNewColTokens` — that one sizes a *sibling* of
    existing columns, which for a fresh one-column row would be too narrow. */
export function newRowColClassList(): string[] {
  return mergeClasses(state.docBs3 ? ['col-xs-12'] : ['col'], state.newColClasses.tokens);
}

/* Re-exported so callers don't need a second import for the common case. */
export { classTokens };
