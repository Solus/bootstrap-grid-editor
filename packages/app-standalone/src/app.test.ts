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
import { beforeAll, describe, expect, it } from 'vitest';
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

  it('the dialect setting only breaks ties on a file with no grid classes', async () => {
    const ed = await editor();
    const { parseTemplate } = await import('@bootstrap-visualizer/core');
    ed.applyOpenConfig({ dialect: 'bootstrap3' });
    // no grid classes → the setting decides
    expect(ed.detectDialect(parseTemplate('<div class="row"><div>x</div></div>'))).toBe(true);
    // a file that already picked a dialect always wins over the setting
    expect(ed.detectDialect(parseTemplate('<div class="col-md-6">x</div>'))).toBe(false);
    expect(ed.detectDialect(parseTemplate('<div class="col-xs-6">x</div>'))).toBe(true);
    ed.applyOpenConfig({ dialect: 'bootstrap5' });   // restore default
  });

  it('flipping a sticky pref asks the host to persist it', async () => {
    const ed = await editor();
    const { standaloneHost } = await import('./standalone-host.js');
    const writes: Array<[string, boolean]> = [];
    ed.setHost({ ...standaloneHost, persistViewPref: (p, v) => writes.push([p, v]) });
    ed.persistViewPref('stretchSheet', true);
    expect(writes).toEqual([['stretchSheet', true]]);
    expect(ed.state.stretchSheet).toBe(true);
    ed.setHost(standaloneHost);          // restore the real host
    ed.state.stretchSheet = false;       // and the mutated state
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
});
