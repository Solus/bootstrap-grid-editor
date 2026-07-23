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
    const pills = [...document.querySelectorAll('.fill-pill.over')];
    expect(pills.length).toBeGreaterThan(0);
    expect(pills[0]!.textContent).toContain('wraps');
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
