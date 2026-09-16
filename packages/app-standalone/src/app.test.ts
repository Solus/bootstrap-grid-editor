/**
 * @vitest-environment jsdom
 *
 * Boot smoke test for the standalone app.
 *
 * The prototype was one mutually-recursive scope; splitting it into modules
 * introduces import cycles that typecheck and bundle cleanly but can still
 * throw at module-eval time. This boots the real entry point against the
 * real index.html and asserts the canvas actually rendered — which is the
 * cheapest thing that would catch a cycle, a stale element id, or a crash
 * in the first render pass.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import indexHtml from '../index.html?raw';

// Imported dynamically inside tests, NOT statically: the editor's dom.ts
// resolves #rowsHost/#sheet/#inspector at module-load time, so it must not
// evaluate until beforeAll has populated document.body (the very coupling
// §4.2 is about). main.js triggers that evaluation; these re-import the
// already-cached module.
type EditorApi = typeof import('@bootstrap-visualizer/editor');
const editor = () => import('@bootstrap-visualizer/editor') as Promise<EditorApi>;

beforeAll(async () => {
  const body = /<body>([\s\S]*)<\/body>/.exec(indexHtml)![1]!;
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
  // jsdom has no layout engine; the resize handler reads this on pointerdown.
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 960, height: 40, top: 0, left: 0, right: 960, bottom: 40, x: 0, y: 0,
       toJSON: () => ({}) }) as DOMRect;
  await import('./main.js');
});

describe('app boots', () => {
  it('renders rows from the sample', () => {
    expect(document.querySelectorAll('.g-row').length).toBeGreaterThan(0);
  });

  it('renders columns', () => {
    expect(document.querySelectorAll('.g-col').length).toBeGreaterThan(0);
  });

  it('fills the source textarea', () => {
    const ta = document.querySelector<HTMLTextAreaElement>('#src')!;
    expect(ta.value).toContain('container-fluid');
  });

  it('builds the breakpoint switch', () => {
    expect(document.querySelectorAll('#bpSwitch button').length).toBe(6);
  });

  it('marks the current breakpoint active', () => {
    const active = document.querySelector<HTMLElement>('#bpSwitch button.active');
    expect(active?.dataset.bp).toBe('md');
  });

  it('draws the 12-column ruler', () => {
    expect(document.querySelectorAll('#ruler div').length).toBe(12);
  });

  it('shows the empty-state inspector before anything is selected', () => {
    expect(document.querySelector('.insp-empty')).not.toBeNull();
  });
});

describe('sample exercises the interesting paths', () => {
  it('detects container columns', () => {
    expect(document.querySelectorAll('.g-col.container').length).toBeGreaterThan(0);
  });

  it('flags the overfull row', () => {
    const pills = [...document.querySelectorAll('.fill-pill.over')]
      .map(p => p.textContent ?? '');
    expect(pills.length).toBeGreaterThan(0);
    // the intended overfull row (all fixed widths) is a definitive "→ wraps"
    expect(pills.some(t => /\/12 → wraps$/.test(t))).toBe(true);
    // and every over-pill announces the overflow one way or another
    expect(pills.every(t => /→ (wraps|may wrap)$/.test(t))).toBe(true);
  });

  it('models the @if row as a branch toggle (not the unreliable pill)', () => {
    // the sample's @if/@else row is now modeled per-branch — no ~unreliable
    expect(document.querySelector('.fill-pill.unreliable')).toBeNull();
    // the @if region renders as a bounding box with the toggle chip as header
    const box = document.querySelector('.cond-box');
    expect(box).not.toBeNull();
    const chip = box!.querySelector('.branch-chip')!;
    expect(chip.classList.contains('active')).toBe(true);
    expect(chip.textContent).toContain('@if');
  });

  it('toggling a branch re-renders view-only (source untouched)', () => {
    const srcBefore = document.querySelector<HTMLTextAreaElement>('#src')!.value;
    const colsBefore = document.querySelectorAll('.g-col').length;
    // the first multi-branch (⇄) chip = the sample's @if/@else region;
    // re-query after each click — render() rebuilds the DOM
    const chip = () => [...document.querySelectorAll<HTMLButtonElement>('.cond-box .branch-chip')]
      .find(c => c.textContent!.startsWith('⇄'))!;
    chip().click();   // @if → @else (the sample's region has a trailing @else)
    // the shown branch changed...
    expect(chip().textContent).toContain('@else');
    // ...and the canvas re-rendered (the @else branch has a different column count)
    expect(document.querySelectorAll('.g-col').length).not.toBe(colsBefore);
    // ...but the underlying source was never rewritten (no commit / no dirty)
    expect(document.querySelector<HTMLTextAreaElement>('#src')!.value).toBe(srcBefore);
    chip().click();   // cycle back to @if so later tests see the default view
    expect(chip().textContent).toContain('@if');
  });

  it('badges dynamic classes', () => {
    const dyn = [...document.querySelectorAll('.badge.warn')].map(b => b.textContent);
    expect(dyn).toContain('dyn');
  });

  it('renders section separators from wrapper sectionTitles', () => {
    const seps = [...document.querySelectorAll('.nested-sep')].map(s => s.textContent);
    expect(seps).toContain('sectionPricing');
  });

  it('renders nested rows inside container columns', () => {
    expect(document.querySelectorAll('.g-col .nested .g-row').length).toBeGreaterThan(0);
  });
});

describe('view options', () => {
  it('Stretch to fit lifts the sheet cap to the full panel and back', () => {
    const sheet = document.querySelector<HTMLElement>('#sheet')!;
    expect(sheet.style.maxWidth).toMatch(/px$/);           // bp cap by default
    const stretch = [...document.querySelectorAll<HTMLLabelElement>('.view-opt')]
      .find(l => l.textContent!.includes('Stretch to fit'))!
      .querySelector('input')!;
    stretch.click();
    expect(sheet.style.maxWidth).toBe('100%');
    // re-query: render() rebuilt the inspector
    [...document.querySelectorAll<HTMLLabelElement>('.view-opt')]
      .find(l => l.textContent!.includes('Stretch to fit'))!
      .querySelector('input')!.click();
    expect(sheet.style.maxWidth).toMatch(/px$/);
  });
});

describe('host HTML id contract (FOLLOW-UPS §4.2)', () => {
  it('index.html provides every element the shared editor requires', async () => {
    const { assertRequiredIds, REQUIRED_EDITOR_IDS } = await editor();
    // the booted body is the real index.html — the assertion must pass
    expect(() => assertRequiredIds([...REQUIRED_EDITOR_IDS])).not.toThrow();
  });

  it('a missing element throws, naming exactly what is absent', async () => {
    const { assertRequiredIds } = await editor();
    expect(() => assertRequiredIds(['sheet', 'notARealId']))
      .toThrowError(/#notARealId/);
    // and does not blame the elements that are present
    expect(() => assertRequiredIds(['sheet', 'notARealId']))
      .not.toThrowError(/#sheet/);
  });
});

describe('open config + sticky view prefs', () => {
  it('applyOpenConfig seeds breakpoint / stretch / tint', async () => {
    const ed = await editor();
    const before = { bp: ed.state.bp, s: ed.state.stretchSheet, t: ed.state.tintOverfull };
    ed.applyOpenConfig({ breakpoint: 'lg', stretchSheet: true, tintOverfull: true });
    expect(ed.state.bp).toBe('lg');
    expect(ed.state.stretchSheet).toBe(true);
    expect(ed.state.tintOverfull).toBe(true);
    ed.applyOpenConfig({ breakpoint: before.bp, stretchSheet: before.s, tintOverfull: before.t });
  });

  it('the dialect setting decides every file whose own classes do not', async () => {
    const ed = await editor();
    const { parseTemplate } = await import('@bootstrap-visualizer/core');
    const d = (html: string) => ed.detectDialect(parseTemplate(html));
    ed.applyOpenConfig({ dialect: 'bootstrap3' });
    // no grid classes → the setting decides
    expect(d('<div class="row"><div>x</div></div>')).toBe(true);
    // grid classes both dialects share → still the setting's call: `col-md-6`
    // is as much Bootstrap 3 as it is Bootstrap 5, so it is not evidence.
    expect(d('<div class="col-md-6">x</div>')).toBe(true);
    expect(d('<div class="row"><div class="col-sm-4 col-lg-3">x</div></div>')).toBe(true);
    // evidence of a dialect always wins over the setting
    expect(d('<div class="col-xs-6">x</div>')).toBe(true);
    expect(d('<div class="col">x</div>')).toBe(false);
    expect(d('<div class="col-md-6 offset-md-2">x</div>')).toBe(false);
    expect(d('<div class="col-xl-4">x</div>')).toBe(false);
    // and at the shipped default, an ambiguous file reads as BS5 as it always
    // did — this change moves nothing for anyone who never set the option
    ed.applyOpenConfig({ dialect: 'bootstrap5' });
    expect(d('<div class="col-md-6">x</div>')).toBe(false);
    expect(d('<div class="col-xs-6">x</div>')).toBe(true);
    expect(d('<div class="col-md-6 col-md-offset-2">x</div>')).toBe(true);
    // both dialects' evidence in one file: BS3 wins, since mixing the forms on
    // one element is the only outcome broken under either framework
    expect(d('<div class="row"><div class="col-xs-6">a</div>'
           + '<div class="col-md-4 offset-md-2">b</div></div>')).toBe(true);
  });

  it('a bootstrap3 setting reaches the classes a nested file actually gets', async () => {
    const ed = await editor();
    const { parseTemplate } = await import('@bootstrap-visualizer/core');
    ed.applyOpenConfig({ dialect: 'bootstrap3' });
    // the evidence can sit anywhere in the tree, not just on a top-level child
    expect(ed.detectDialect(parseTemplate(
      '<section><div class="row"><div class="col-xs-6">x</div></div></section>'))).toBe(true);
    expect(ed.detectDialect(parseTemplate(
      '<section><div class="row"><div class="col-auto">x</div></div></section>'))).toBe(false);
    ed.applyOpenConfig({ dialect: 'bootstrap5' });
  });

  it('a bootstrap3 project gets bootstrap3 offsets on a file of shared classes', async () => {
    // The end the setting exists for: `col-sm-6` alone is not evidence, so a
    // Bootstrap 3 project used to get `offset-sm-1` written into it however it
    // set this. Now the setting reaches the token.
    const ed = await editor();
    const before = ed.state.src;            // later describes read the sample
    ed.applyOpenConfig({ dialect: 'bootstrap3' });
    ed.state.dirty = false;
    ed.state.sel = null;
    ed.apply('<div class="row">\n  <div class="col-sm-6">A</div>\n</div>');
    expect(ed.state.docBs3).toBe(true);
    ed.changeOffset(ed.state.model[0]!.cols[0]!, 'sm', +1);
    expect(ed.state.src).toContain('class="col-sm-6 col-sm-offset-1"');
    expect(ed.state.src).not.toContain('offset-sm-1');
    ed.applyOpenConfig({ dialect: 'bootstrap5' });
    ed.state.sel = null;
    ed.apply(before);
    ed.state.dirty = false;
  });

  it('flipping a sticky pref asks the host to persist it', async () => {
    const ed = await editor();
    const { standaloneHost } = await import('./standalone-host.js');
    const writes: Array<[string, boolean | string]> = [];
    ed.setHost({ ...standaloneHost, persistPref: c => writes.push([c.pref, c.value]) });
    ed.persistViewPref('stretchSheet', true);
    expect(writes).toEqual([['stretchSheet', true]]);
    expect(ed.state.stretchSheet).toBe(true);
    ed.setHost(standaloneHost);          // restore the real host
    ed.state.stretchSheet = false;       // and the mutated state
  });

  it('setting a class convention asks the host to persist it too', async () => {
    const ed = await editor();
    const { standaloneHost } = await import('./standalone-host.js');
    const writes: Array<[string, boolean | string]> = [];
    ed.setHost({ ...standaloneHost, persistPref: c => writes.push([c.pref, c.value]) });
    ed.setClassConvention('row', 'clearfix form-group');
    ed.setClassConvention('col', 'px-2');
    expect(writes).toEqual([
      ['newRowClasses', 'clearfix form-group'],
      ['newColumnClasses', 'px-2'],
    ]);
    // a value that arrives *from* the host isn't written straight back
    ed.setClassConvention('row', 'mb-3', false);
    expect(writes).toHaveLength(2);
    ed.setHost(standaloneHost);
    ed.setClassConvention('row', '');
    ed.setClassConvention('col', '');
  });
});

describe('graceful failure — the canvas never breaks (robustness)', () => {
  it('a row that fails to draw is skipped in place, not fatal', async () => {
    const ed = await editor();
    const target = ed.state.model.find(r => r.cols.length)!;
    expect(target).toBeDefined();
    const col = target.cols[0]!;
    const savedSpec = col.spec;
    // make computeWidths (inside renderRow) throw for just this row; nothing
    // in the pre-canvas passes reads a column's spec, so only this row's draw
    // fails
    Object.defineProperty(col, 'spec', {
      configurable: true, get() { throw new Error('boom'); },
    });

    expect(() => ed.render()).not.toThrow();
    // the bad row is replaced by an inline marker...
    expect(document.querySelector('.g-row.render-error')).not.toBeNull();
    // ...while other rows still render normally
    expect(document.querySelectorAll('.g-row:not(.render-error)').length)
      .toBeGreaterThan(0);

    Object.defineProperty(col, 'spec', {
      configurable: true, writable: true, value: savedSpec,
    });
    ed.render();
    expect(document.querySelector('.g-row.render-error')).toBeNull();
  });

  it('a build failure rejects the edit and keeps the last good view', async () => {
    const ed = await editor();
    ed.state.dirty = false;                    // ensure the edit isn't refused first
    const srcBefore = ed.state.src;
    const modelBefore = ed.state.model;
    const savedAB = ed.state.activeBranch;
    // buildModel dereferences activeBranch for a conditional region → nulling
    // it makes the build throw on an @if document
    ed.state.activeBranch = null as unknown as Record<string, number>;

    expect(() =>
      ed.apply('<div class="row">@if (x) {<div class="col-6">c</div>}</div>'),
    ).not.toThrow();

    // nothing committed: source and model are still the previous good ones
    expect(ed.state.src).toBe(srcBefore);
    expect(ed.state.model).toBe(modelBefore);
    // and the user got a notice rather than a silent freeze
    expect(document.querySelector('.toast.warn')).not.toBeNull();

    ed.state.activeBranch = savedAB;
  });
});

describe('drag surface keeps a native drag droppable across excursions', () => {
  it('accepts dragover/drop at the document level only while a column is dragged', async () => {
    const ed = await editor();
    // idle: a stray dragover/drop is left alone (no interference with the page)
    const idleOver = new Event('dragover', { bubbles: true, cancelable: true });
    document.dispatchEvent(idleOver);
    expect(idleOver.defaultPrevented).toBe(false);

    // dragging: the whole document accepts the drag, so leaving the dropzones
    // (or the window) and returning keeps the drop armed
    ed.dnd.src = [0, 0];
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    document.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    // a release off every zone is swallowed (can't fall through to a text-drop)
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    document.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);

    ed.dnd.src = null;
  });

  it('leaving the canvas panel cancels the drag after a short grace', async () => {
    vi.useFakeTimers();
    try {
      const ed = await editor();
      const panel = document.querySelector('.canvas-scroll')!;

      // simulate an in-progress drag
      ed.dnd.src = [0, 0];
      document.body.classList.add('dnd');

      // moving onto a child (a dropzone) is NOT leaving — no cancel is scheduled
      const inner = new Event('dragleave', { bubbles: true }) as Event & { relatedTarget: unknown };
      Object.defineProperty(inner, 'relatedTarget', { value: panel.querySelector('*') ?? panel });
      panel.dispatchEvent(inner);
      vi.advanceTimersByTime(300);
      expect(ed.dnd.src).not.toBeNull();

      // truly leaving (relatedTarget outside / null) schedules a cancel — but
      // only fires after the grace, so a quick return could still save it
      const out = new Event('dragleave', { bubbles: true }) as Event & { relatedTarget: unknown };
      Object.defineProperty(out, 'relatedTarget', { value: null });
      panel.dispatchEvent(out);
      expect(ed.dnd.src).not.toBeNull();          // still alive during the grace
      vi.advanceTimersByTime(300);
      expect(ed.dnd.src).toBeNull();              // cancelled once the grace elapsed
      expect(document.body.classList.contains('dnd')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('selection drives the inspector', () => {
  it('selecting a column shows its class and actions', () => {
    const col = document.querySelector<HTMLElement>('.g-col')!;
    col.click();
    const insp = document.querySelector('#inspector')!;
    expect(insp.textContent).toContain('Effective at md');
    expect(insp.textContent).toContain('Split in two');
    expect(document.querySelectorAll('.g-col.selected').length).toBe(1);
  });

  it('selecting a row shows row actions', () => {
    const row = document.querySelector<HTMLElement>('.g-row')!;
    row.click();
    const insp = document.querySelector('#inspector')!;
    expect(insp.textContent).toContain('Add row after');
  });

  it('a column can gain a row of its own', () => {
    document.querySelector<HTMLElement>('.g-col')!.click();
    expect(document.querySelector('#inspector')!.textContent).toContain('Add row inside');
  });

  it('offers a starting point with nothing selected', async () => {
    const ed = await editor();
    ed.clearSelection();
    const insp = document.querySelector('#inspector')!;
    expect(insp.textContent).toContain('Add row');
  });

  it('shows the class convention and what the next insert will write', async () => {
    const ed = await editor();
    ed.clearSelection();
    ed.setClassConvention('row', 'clearfix', false);
    ed.renderInspector();
    const insp = document.querySelector('#inspector')!;
    const field = insp.querySelector<HTMLInputElement>('input[data-conv="row"]')!;
    expect(field.value).toBe('clearfix');
    expect(insp.textContent).toContain('row clearfix');
    // the standalone can't remember it, and says so rather than implying it can
    expect(insp.textContent).toContain('not saved');

    // typing in the field and committing updates the convention
    field.value = 'clearfix form-group';
    field.dispatchEvent(new Event('change'));
    expect(ed.state.newRowClasses.tokens).toEqual(['clearfix', 'form-group']);

    ed.setClassConvention('row', '', false);
    ed.renderInspector();
  });
});

describe('an @if nested in an @if branch draws as a nested box', () => {
  const NESTED = `<div class="row">
    @if (a) {
      @if (b) { <div class="col-6">A</div> }
      <div class="col-3">B</div>
    } @else { <div class="col-12">C</div> }
  </div>`;

  it('boxes the inner region inside the outer one, and follows its branch', async () => {
    const ed = await editor();
    const restore = ed.state.src;
    ed.state.dirty = false;
    ed.apply(NESTED);

    // one region box directly in the row, with the nested block inside it —
    // not two boxes side by side
    const boxes = document.querySelectorAll('.g-row > .cond-box');
    expect(boxes).toHaveLength(1);
    const outer = boxes[0]!;
    expect(outer.querySelector('.cond-box')).not.toBeNull();
    expect(outer.querySelectorAll('.g-col')).toHaveLength(2);      // A (inner) + B

    // switching the outer branch takes the whole inner block with it
    outer.querySelector<HTMLButtonElement>(':scope > .branch-chip')!.click();
    const after = document.querySelector('.g-row > .cond-box')!;
    expect(after.querySelector('.cond-box')).toBeNull();
    expect(document.querySelectorAll('.g-col')).toHaveLength(1);   // just C

    ed.state.activeBranch = {};
    ed.apply(restore);
  });

  it('blocks moving a column out of the inner block into the outer branch', async () => {
    const ed = await editor();
    const restore = ed.state.src;
    ed.state.dirty = false;
    ed.apply(NESTED);
    const srcBefore = ed.state.src;

    // A (inside `@if (b)`) and B (only inside `@if (a)`) are adjacent columns
    // of the same row, but a text swap would carry A across the inner `}`.
    ed.state.sel = { path: [0, 0], kind: 'col' };
    ed.nudgeCol(1);

    expect(ed.state.src).toBe(srcBefore);            // refused, nothing rewritten
    expect(document.querySelector('.toast.warn')!.textContent)
      .toContain('branch boundary');

    ed.state.sel = null;
    ed.state.activeBranch = {};
    ed.apply(restore);
  });
});

describe('canvas edits indent the way the document does', () => {
  const TABS = [
    '<div class="container">',
    '\t<div class="row">',
    '\t\t<div class="col-6">A</div>',
    '\t\t<div class="col-3">B</div>',
    '\t</div>',
    '\t<div class="row">',
    '\t</div>',
    '</div>',
  ].join('\n');

  /** Every indented line of the result, so a single stray space is visible. */
  const indents = (src: string) => src.split('\n')
    .map(l => /^[ \t]+/.exec(l)?.[0] ?? '')
    .filter(Boolean);

  const load = async () => {
    const ed = await editor();
    ed.state.dirty = false;
    ed.state.sel = null;
    ed.apply(TABS);
    expect(ed.state.indentUnit).toBe('\t');   // detected from the document
    return ed;
  };

  it('adding a column writes tabs, not two spaces', async () => {
    const ed = await load();
    ed.addColToRow(ed.state.model[0]!);
    expect(indents(ed.state.src).every(i => !i.includes(' '))).toBe(true);
    expect(ed.state.src).toContain('\n\t\t\t<!-- new column -->');
  });

  it('splitting a column writes tabs', async () => {
    const ed = await load();
    ed.splitCol(ed.state.model[0]!.cols[0]!);
    expect(indents(ed.state.src).every(i => !i.includes(' '))).toBe(true);
  });

  it('adding a row writes tabs at both nesting levels', async () => {
    const ed = await load();
    ed.addRowAfter(ed.state.model[0]!);
    expect(indents(ed.state.src).every(i => !i.includes(' '))).toBe(true);
    expect(ed.state.src).toContain('\n\t\t<div class="col">');
  });

  it('moving a column into an empty row writes tabs', async () => {
    // the reported case: with no child to copy an indent from, the insertion
    // used to fall back to a hardcoded two spaces
    const ed = await load();
    ed.moveCol([0, 1], [1], 0);
    expect(indents(ed.state.src).every(i => !i.includes(' '))).toBe(true);
    expect(ed.state.src).toContain('\n\t\t<div class="col-3">B</div>');
  });

  it('a two-space document still gets two spaces', async () => {
    const ed = await editor();
    ed.state.dirty = false;
    ed.state.sel = null;
    ed.apply('<div class="container">\n  <div class="row">\n  </div>\n</div>');
    expect(ed.state.indentUnit).toBe('  ');
    ed.addColToRow(ed.state.model[0]!);
    expect(ed.state.src).toMatch(/\n {4}<div class="col/);
    expect(ed.state.src).toContain('\n      <!-- new column -->');
    expect(ed.state.src).not.toContain('\t');
  });
});

describe('canvas edits keep the document’s line endings', () => {
  const CRLF = [
    '<div class="container">',
    '\t<div class="row">',
    '\t\t<div class="col-6">A</div>',
    '\t\t<div class="col-3">B</div>',
    '\t</div>',
    '\t<div class="row">',
    '\t</div>',
    '</div>',
  ].join('\r\n');

  /** A \r without a \n after it — or a \n without one before — means the
      document ended up with mixed line endings. */
  const mixed = (src: string) => /\r(?!\n)/.test(src) || /(?<!\r)\n/.test(src);

  const load = async () => {
    const ed = await editor();
    ed.state.dirty = false;
    ed.state.sel = null;
    ed.apply(CRLF);
    expect(ed.state.eol).toBe('\r\n');         // detected from the document
    expect(mixed(ed.state.src)).toBe(false);   // and the input really is pure CRLF
    return ed;
  };

  it('adding a column inserts CRLF lines', async () => {
    const ed = await load();
    ed.addColToRow(ed.state.model[0]!);
    expect(mixed(ed.state.src)).toBe(false);
    expect(ed.state.src).toContain('<!-- new column -->');
  });

  it('adding a row inserts CRLF lines', async () => {
    const ed = await load();
    ed.addRowAfter(ed.state.model[0]!);
    expect(mixed(ed.state.src)).toBe(false);
  });

  it('splitting a column inserts CRLF lines', async () => {
    const ed = await load();
    ed.splitCol(ed.state.model[0]!.cols[0]!);
    expect(mixed(ed.state.src)).toBe(false);
  });

  it('moving a column leaves no orphaned carriage return behind', async () => {
    // the cut has to take \r\n as one unit; taking only the \n would leave the
    // previous line ending in a lone \r
    const ed = await load();
    ed.moveCol([0, 1], [1], 0);
    expect(mixed(ed.state.src)).toBe(false);
    expect(ed.state.src).toContain('\r\n\t\t<div class="col-3">B</div>');
  });

  it('deleting a column leaves no orphaned carriage return', async () => {
    const ed = await load();
    ed.deleteEl(ed.state.model[0]!.cols[1]!);
    expect(mixed(ed.state.src)).toBe(false);
  });

  it('an LF document still gets LF', async () => {
    const ed = await editor();
    ed.state.dirty = false;
    ed.state.sel = null;
    ed.apply(CRLF.replace(/\r\n/g, '\n'));
    expect(ed.state.eol).toBe('\n');
    ed.addColToRow(ed.state.model[0]!);
    expect(ed.state.src).not.toContain('\r');
  });
});

describe('markup the parser had to guess at holds back the destructive edits', () => {
  /* An unclosed element has an `end` nobody read off the source: the compiler
     ends it at its open tag (no error reported), and the fallback parser runs
     it to EOF. Either way a move or a delete by that span touches text the
     canvas never drew — orphaning the columns inside it, or taking the rest of
     the file. Those edits are refused; the class edits, whose spans come from
     the open tag, keep working, because that is the one thing still exact. */

  // no closing </div> for the row: the column is parsed *outside* the row's span
  const OPEN_ROW = '<div class="row">\n  <div class="col-6">A</div>\n  <div class="col-3">B</div>';

  const load = async () => {
    const ed = await editor();
    ed.state.dirty = false;
    ed.state.sel = null;
    ed.apply(OPEN_ROW);
    return ed;
  };

  it('the row really is the unclosed one (the premise of these cases)', async () => {
    const ed = await load();
    expect(ed.state.model[0]!.el.unclosed).toBe(true);
    expect(ed.state.model[0]!.cols.every(c => !c.el.unclosed)).toBe(true);
  });

  it('deleting an unclosed row is refused, and the source is untouched', async () => {
    const ed = await load();
    ed.deleteEl(ed.state.model[0]!);
    expect(ed.state.src).toBe(OPEN_ROW);
  });

  it('adding a row after an unclosed row is refused', async () => {
    const ed = await load();
    ed.addRowAfter(ed.state.model[0]!);
    expect(ed.state.src).toBe(OPEN_ROW);
  });

  it('adding a column into an unclosed row is refused', async () => {
    const ed = await load();
    ed.addColToRow(ed.state.model[0]!);
    expect(ed.state.src).toBe(OPEN_ROW);
  });

  it('the columns inside it are still fully editable', async () => {
    // the guard is per element, not per file: these closed properly, so their
    // spans are exact and every edit on them is safe
    const ed = await load();
    ed.splitCol(ed.state.model[0]!.cols[0]!);
    expect(ed.state.src).toContain('<!-- new column -->');
    expect(ed.state.src).toContain('class="col-3"');
  });

  it('a width edit on the unclosed element itself still applies', async () => {
    // its class attribute span was read straight off the open tag — the one
    // part of an unclosed element the parser did see. So the stepper works on
    // a column you're in the middle of typing; only cutting it is held back.
    const ed = await editor();
    ed.state.dirty = false;
    ed.state.sel = null;
    ed.apply('<div class="row">\n  <div class="col-3">B');
    const col = ed.state.model[0]!.cols[0]!;
    expect(col.el.unclosed).toBe(true);
    ed.quickWidth(col, +1);
    expect(ed.state.src).toContain('class="col-4"');

    // …but deleting that same column is not
    const before = ed.state.src;
    ed.deleteEl(ed.state.model[0]!.cols[0]!);
    expect(ed.state.src).toBe(before);
  });

  it('the canvas says the file did not parse', async () => {
    const ed = await editor();
    ed.state.dirty = false;
    ed.state.sel = null;
    // a closing tag matching nothing open → the tolerant fallback's tree
    ed.apply('<div class="row"><div class="col-6"><span>x</div></div>');
    expect(ed.state.root!.degraded).toBe(true);
    expect(document.querySelector('.parse-degraded')).not.toBeNull();

    ed.apply('<div class="row"><div class="col-6">x</div></div>');
    expect(document.querySelector('.parse-degraded')).toBeNull();
  });
});

describe('the class convention rides along on everything the canvas creates', () => {
  const SRC = [
    '<div class="row">',
    '  <div class="col-6">A</div>',
    '</div>',
  ].join('\n');

  /** Load SRC with a convention set; the caller resets it. */
  const load = async (row: string, col: string) => {
    const ed = await editor();
    ed.state.dirty = false;
    ed.state.sel = null;
    ed.setClassConvention('row', row, false);
    ed.setClassConvention('col', col, false);
    ed.apply(SRC);
    return ed;
  };

  const reset = (ed: EditorApi) => {
    ed.setClassConvention('row', '', false);
    ed.setClassConvention('col', '', false);
  };

  it('adds the row convention after the row class, not instead of it', async () => {
    const ed = await load('clearfix form-group', '');
    ed.addRowAfter(ed.state.model[0]!);
    expect(ed.state.src).toContain('<div class="row clearfix form-group">');
    reset(ed);
  });

  it('adds the column convention after the computed width classes', async () => {
    const ed = await load('', 'px-2');
    ed.addColToRow(ed.state.model[0]!);
    expect(ed.state.src).toContain('<div class="col-6 px-2">');
    reset(ed);
  });

  it('carries the convention through add-after, split and add-row-inside', async () => {
    const ed = await load('clearfix', 'px-2');

    ed.addColAfter(ed.state.model[0]!.cols[0]!);
    expect(ed.state.src).toContain('<div class="col-6 px-2">');

    ed.splitCol(ed.state.model[0]!.cols[0]!);
    expect(ed.state.src).toContain('<div class="col-3 px-2">');

    ed.addRowToCol(ed.state.model[0]!.cols[0]!);
    expect(ed.state.src).toContain('<div class="row clearfix">');
    reset(ed);
  });

  it('ignores anything that would fight the canvas or break the file', async () => {
    const ed = await load('row col-6 clearfix', 'col-md-4 offset-2 a"b px-2');
    ed.addRowAfter(ed.state.model[0]!);
    expect(ed.state.src).toContain('<div class="row clearfix">');
    expect(ed.state.src).toContain('<div class="col px-2">');
    // and the result is still a grid the canvas can read: two rows, one column each
    expect(ed.state.model).toHaveLength(2);
    expect(ed.state.model[1]!.cols).toHaveLength(1);
    reset(ed);
  });

  it('reports what it ignored', async () => {
    const ed = await load('row px-2', '');
    expect(ed.state.newRowClasses.tokens).toEqual(['px-2']);
    expect(ed.state.newRowClasses.dropped).toEqual(['row']);
    reset(ed);
  });

  it('seeds from the host config at open', async () => {
    const ed = await editor();
    ed.applyOpenConfig({ newRowClasses: 'clearfix', newColumnClasses: 'px-2' });
    expect(ed.state.newRowClasses.tokens).toEqual(['clearfix']);
    expect(ed.state.newColClasses.tokens).toEqual(['px-2']);
    reset(ed);
  });
});

describe('rows can be added to a column and to the document', () => {
  const CONTAINER = [
    '<div class="row">',
    '  <div class="col-6">',
    '    <div class="row">',
    '      <div class="col">A</div>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');

  const load = async (src: string) => {
    const ed = await editor();
    ed.state.dirty = false;
    ed.state.sel = null;
    ed.apply(src);
    return ed;
  };

  it('appends a nested row after the column\'s last one', async () => {
    const ed = await load(CONTAINER);
    ed.addRowToCol(ed.state.model[0]!.cols[0]!);
    expect(ed.state.model[0]!.cols[0]!.nestedRows).toHaveLength(2);
    // inside the column, not after it
    expect(ed.state.src.indexOf('<div class="row">', 1))
      .toBeLessThan(ed.state.src.lastIndexOf('</div>'));
    // indented like the row it follows
    expect(ed.state.src).toContain('\n    <div class="row">\n      <div class="col">');
  });

  it('puts a row into a content column after the content already there', async () => {
    const ed = await load('<div class="row">\n  <div class="col-6">A</div>\n</div>');
    ed.addRowToCol(ed.state.model[0]!.cols[0]!);
    const col = ed.state.model[0]!.cols[0]!;
    expect(col.nestedRows).toHaveLength(1);
    expect(ed.state.src.indexOf('A')).toBeLessThan(ed.state.src.indexOf('class="row"', 20));
  });

  it('refuses a column with no closing tag to put a row inside', async () => {
    const ed = await load('<div class="row">\n  <input class="col-6">\n</div>');
    const before = ed.state.src;
    ed.addRowToCol(ed.state.model[0]!.cols[0]!);
    expect(ed.state.src).toBe(before);
    expect(document.querySelector('.toast.warn')!.textContent).toContain('no closing tag');
  });

  it('adds a row after the last top-level one', async () => {
    const ed = await load(CONTAINER);
    ed.addRowAtEnd();
    expect(ed.state.model).toHaveLength(2);
    expect(ed.state.src.trimEnd().endsWith('</div>')).toBe(true);
  });

  it('starts the grid in a document that has none', async () => {
    const ed = await load('<form>\n  <p>nothing here yet</p>\n</form>\n');
    expect(ed.state.model).toHaveLength(0);
    ed.addRowAtEnd();
    expect(ed.state.model).toHaveLength(1);
    expect(ed.state.model[0]!.cols).toHaveLength(1);
    // appended at the end of the file, and no blank first line
    expect(ed.state.src.startsWith('<form>')).toBe(true);
  });

  it('starts the grid in an empty document', async () => {
    const ed = await load('');
    ed.addRowAtEnd();
    expect(ed.state.src.startsWith('<div class="row">')).toBe(true);
    expect(ed.state.model).toHaveLength(1);
  });

  it('gives a new row a full-width column in the document\'s dialect', async () => {
    const ed = await load('<div class="row">\n  <div class="col-xs-6">A</div>\n</div>');
    expect(ed.state.docBs3).toBe(true);
    ed.addRowAfter(ed.state.model[0]!);
    // Bootstrap 3 has no bare `col`
    expect(ed.state.src).toContain('<div class="col-xs-12">');
  });
});
