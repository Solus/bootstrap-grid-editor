import { describe, expect, it } from 'vitest';
import {
  buildModel, hashStr, isContainerCol, looseText, nodeAtOffset, rowHasControlFlow,
} from './model.js';
import { parseTemplate } from './parser.js';
import { splice } from './edits.js';

describe('model building on realistic template', () => {
  const src3 = `<div class="container">
  <div class="row">
    <div class="col-md-6">
      <div class="row">
        <div class="col-6">a</div>
        <div class="col-6">b</div>
      </div>
    </div>
    <div class="col-md-6">c</div>
  </div>
</div>`;
  const model3 = buildModel(parseTemplate(src3));

  it('one top row', () => expect(model3.length).toBe(1));
  it('two cols', () => expect(model3[0]!.cols.length).toBe(2));
  it('nested rows in col0', () => expect(model3[0]!.cols[0]!.nestedRows.length).toBe(1));
  it('nested cols', () => expect(model3[0]!.cols[0]!.nestedRows[0]!.cols.length).toBe(2));
  it('col1 no nested', () => expect(model3[0]!.cols[1]!.nestedRows.length).toBe(0));
});

/** Parse `src` and hand back its first row's column at `i`. */
function col(src: string, i = 0) {
  return buildModel(parseTemplate(src))[0]!.cols[i]!.el;
}

describe('container column detection', () => {
  const cs1 = `<div class="row"><div class="col-md-6"><div class="row"><div class="col">a</div></div></div></div>`;
  it('pure single row = container', () => expect(isContainerCol(cs1, col(cs1))).toBe(true));

  const cs2 = `<div class="row"><div class="col-md-6">
  <div class="row"><div class="col">a</div></div>
  <div class="row"><div class="col">b</div></div>
</div></div>`;
  it('multiple rows = container', () => expect(isContainerCol(cs2, col(cs2))).toBe(true));

  const cs3 = `<div class="row"><div class="col-md-6"><legend>Hi</legend><div class="row"><div class="col">a</div></div></div></div>`;
  it('legend+row = container (amended rule)', () =>
    expect(isContainerCol(cs3, col(cs3))).toBe(true));

  const cs4 = `<div class="row"><div class="col-md-6">Some text
  <div class="row"><div class="col">a</div></div>
</div></div>`;
  it('loose text + row = content', () => expect(isContainerCol(cs4, col(cs4))).toBe(false));

  const cs5 = `<div class="row"><div class="col-md-6"><!-- HDR:X -->
  <div class="row"><div class="col">a</div></div>
</div></div>`;
  it('comment + row still container', () => expect(isContainerCol(cs5, col(cs5))).toBe(true));

  const cs6 = `<div class="row"><div class="col-md-6"><input></div></div>`;
  it('plain content col not container', () => expect(isContainerCol(cs6, col(cs6))).toBe(false));

  // amended rule: @if scaffolding around rows is structure, not loose text
  const cs8 = `<div class="row"><div class="col-md-6">
  @if (a) { <div class="row"><div class="col">x</div></div> }
  @else { <div class="row"><div class="col">y</div></div> }
</div></div>`;
  it('@if wrapping rows still container', () => expect(isContainerCol(cs8, col(cs8))).toBe(true));

  const cs9 = `<div class="row"><div class="col-md-6">note:
  @if (a) { <div class="row"><div class="col">x</div></div> }
</div></div>`;
  it('real loose text beside an @if still content', () =>
    expect(isContainerCol(cs9, col(cs9))).toBe(false));

  const cs7 = `<div class="row"><div class="col"></div></div>`;
  it('empty col not container', () => expect(isContainerCol(cs7, col(cs7))).toBe(false));
});

describe('amended container rule: legend + rows = container', () => {
  const lg1 = `<div class="row"><div class="col-sm-4">
  <legend class="group-title" app-i18n="demo.editor.sectionC"></legend>
  <div class="row"><div class="col-sm-6">x</div></div>
</div></div>`;
  it('legend + rows = container', () => expect(isContainerCol(lg1, col(lg1))).toBe(true));

  const lg2 = `<div class="row"><div class="col-sm-4">
  <legend app-i18n="a.b.sectionL"></legend>
  <div class="row"><div class="col">x</div></div>
  <legend app-i18n="a.b.sectionM"></legend>
  <div class="row"><div class="col">y</div></div>
</div></div>`;
  it('mid-column legend still container', () => expect(isContainerCol(lg2, col(lg2))).toBe(true));

  const lg3 = `<div class="row"><div class="col-sm-4">
  <legend app-i18n="a.b.c"></legend>
  <text-input formControlName="q"></text-input>
</div></div>`;
  it('legend + input = content', () => expect(isContainerCol(lg3, col(lg3))).toBe(false));
});

describe('spacers and wrapper components in the container rule', () => {
  const sp1 = `<div class="row"><div class="col-sm-4">
  <legend app-i18n="a.b.sectionH"></legend>
  <div class="row"><div class="col-sm-6">x</div></div>
  <br />
  <div class="row"><div class="col-sm-6">y</div></div>
</div></div>`;
  it('br between rows still container', () => expect(isContainerCol(sp1, col(sp1))).toBe(true));

  const sp2 = `<div class="row"><div class="col-sm-4"><hr><div class="row"><div class="col">x</div></div></div></div>`;
  it('hr still container', () => expect(isContainerCol(sp2, col(sp2))).toBe(true));

  const sp3 = `<div class="row"><div class="col-sm-4"><br /></div></div>`;
  it('br alone (no rows) not container', () => expect(isContainerCol(sp3, col(sp3))).toBe(false));

  const wr1 = `<div class="row"><div class="col-sm-12">
  <expandable-panel [settings]="s">
    <panel-section id="a"><div class="row"><div class="col">x</div></div></panel-section>
    <panel-section id="b"><div class="row"><div class="col">y</div></div></panel-section>
  </expandable-panel>
</div></div>`;
  it('wrapper components leading to rows = container', () =>
    expect(isContainerCol(wr1, col(wr1))).toBe(true));

  const wr2 = `<div class="row"><div class="col-sm-6"><text-input formControlName="q"></text-input></div></div>`;
  it('plain control col unaffected', () => expect(isContainerCol(wr2, col(wr2))).toBe(false));
});

describe('control-flow detection & looseText', () => {
  const cf1 = `<div class="row">
  @if (!featureModeEnabled) {
  <div class="col-sm-10">a</div>
  } @else {
  <div class="col-sm-4">b</div>
  }
</div>`;
  it('@if row detected', () =>
    expect(rowHasControlFlow(cf1, buildModel(parseTemplate(cf1))[0]!.el)).toBe(true));

  const cf2 = `<div class="row"><div class="col-sm-6">x</div><div class="col-sm-6">y</div></div>`;
  it('plain row not flagged', () =>
    expect(rowHasControlFlow(cf2, buildModel(parseTemplate(cf2))[0]!.el)).toBe(false));

  // an email address in body text must not read as a control-flow block
  const cf3 = `<div class="row">contact admin@iframe.example <div class="col-6">x</div></div>`;
  it('@ in plain text not flagged', () =>
    expect(rowHasControlFlow(cf3, buildModel(parseTemplate(cf3))[0]!.el)).toBe(false));

  const lt = `<div class="row"> hey <!-- c --> <div class="col">inner</div> there</div>`;
  it('looseText content', () =>
    expect(looseText(lt, buildModel(parseTemplate(lt))[0]!.el).replace(/\s+/g, ' ').trim())
      .toBe('hey there'));
});

describe('@if grouping into active-branch cols', () => {
  const cf = `<div class="row">
    <div class="col-2">head</div>
    @if (a) { <div class="col-6">A</div> }
    @else { <div class="col-4">B1</div> <div class="col-4">B2</div> }
    <div class="col-1">tail</div>
  </div>`;
  const root = parseTemplate(cf);
  const region = Object.keys(root.condRegions)[0]!;
  // pull the col-* token straight out of each column's source span
  const clsOf = (src: string) => (c: { el: { start: number; openEnd: number } }) =>
    /col-\d+/.exec(src.slice(c.el.start, c.el.openEnd))?.[0];

  it('default (no active map) shows branch 0, interleaved with untagged cols', () => {
    const row = buildModel(root)[0]!;
    // head + A + tail  (B1/B2 are the hidden @else branch)
    expect(row.cols.map(clsOf(cf))).toEqual(['col-2', 'col-6', 'col-1']);
  });

  it('a modeled @if row is not marked unreliable', () => {
    const row = buildModel(root)[0]!;
    expect(rowHasControlFlow(cf, row.el)).toBe(true); // regex still matches...
    expect(row.conds?.length).toBe(1);                // ...but it is modeled
  });

  it('active map switches to branch 1 and preserves interleaving order', () => {
    const row = buildModel(root, { [region]: 1 })[0]!;
    expect(row.cols.map(clsOf(cf))).toEqual(['col-2', 'col-4', 'col-4', 'col-1']);
  });

  it('attaches CondRegion metadata with the resolved activeIndex', () => {
    const row = buildModel(root, { [region]: 1 })[0]!;
    const cr = row.conds![0]!;
    expect(cr.region).toBe(region);
    expect(cr.activeIndex).toBe(1);
    expect(cr.branches.map(b => b.condition)).toEqual(['a', null]);
  });

  it('a top-level @if-of-rows emits only the active branch, interleaved', () => {
    const s = `<div class="container">
      <div class="row"><div class="col-2">head</div></div>
      @if (a) { <div class="row"><div class="col-3">A</div></div> }
      @else {
        <div class="row"><div class="col-4">B1</div></div>
        <div class="row"><div class="col-5">B2</div></div>
      }
      <div class="row"><div class="col-6">tail</div></div>
    </div>`;
    const root2 = parseTemplate(s);
    const reg2 = Object.keys(root2.condRegions)[0]!;
    const colOf = (r: { cols: { el: { start: number; openEnd: number } }[] }) =>
      /col-\d+/.exec(s.slice(r.cols[0]!.el.start, r.cols[0]!.el.openEnd))?.[0];
    expect(buildModel(root2).map(colOf)).toEqual(['col-2', 'col-3', 'col-6']);
    expect(buildModel(root2, { [reg2]: 1 }).map(colOf))
      .toEqual(['col-2', 'col-4', 'col-5', 'col-6']);
    expect(buildModel(root2, { [reg2]: -1 }).map(colOf)).toEqual(['col-2', 'col-6']);
  });

  it('a branch wrapping rows in a plain container still yields its rows', () => {
    // the branch element is a wrapper, not a row — findRows must descend
    const s = `<div>
      @if (a) { <section><div class="row"><div class="col-7">IN</div></div></section> }
    </div>`;
    const root2 = parseTemplate(s);
    const reg2 = Object.keys(root2.condRegions)[0]!;
    expect(buildModel(root2).length).toBe(1);
    expect(buildModel(root2, { [reg2]: -1 }).length).toBe(0);
  });

  it('an @if wrapping nested rows in a container column toggles per-column', () => {
    const s = `<div class="row"><div class="col-6">
      @if (a) { <div class="row"><div class="col-3">A</div></div> }
      @else { <div class="row"><div class="col-9">B</div></div> }
    </div></div>`;
    const root2 = parseTemplate(s);
    const reg2 = Object.keys(root2.condRegions)[0]!;
    // the container column is the sole col of a synthetic-less parse: find it
    const findCol = (m: ReturnType<typeof buildModel>) => {
      for (const r of m) for (const c of r.cols) if (c.conds?.length) return c;
      return null;
    };
    const c0 = findCol(buildModel(root2))!;
    expect(c0.nestedRows[0]!.cols.map(clsOf(s))).toEqual(['col-3']);
    const c1 = findCol(buildModel(root2, { [reg2]: 1 }))!;
    expect(c1.nestedRows[0]!.cols.map(clsOf(s))).toEqual(['col-9']);
  });
});

describe('@if nested directly inside another @if branch', () => {
  /* Both blocks flatten to the same level of the element tree, so the whole
     nesting lives in `El.condPath`. Getting this wrong doesn't just draw the
     boxes side by side — it shows columns Angular wouldn't render. */
  const clsOf = (src: string) => (c: { el: { start: number; openEnd: number } }) =>
    /col-\d+/.exec(src.slice(c.el.start, c.el.openEnd))?.[0];

  const inIf = `<div class="row">
    @if (a) {
      @if (b) { <div class="col-6">A</div> }
      <div class="col-3">B</div>
    } @else { <div class="col-12">C</div> }
  </div>`;
  const rootIf = parseTemplate(inIf);
  const outerIf = Object.values(rootIf.condRegions).find(r => r.branches.length === 2)!.region;
  const innerIf = Object.values(rootIf.condRegions).find(r => r.branches.length === 1)!.region;

  it('shows the inner branch inside the active outer branch', () => {
    expect(buildModel(rootIf)[0]!.cols.map(clsOf(inIf))).toEqual(['col-6', 'col-3']);
  });

  it('switching the outer branch hides the whole inner block', () => {
    // col-6 lives inside the `@if (a)` branch we just switched away from, so
    // it must not render — the bug this nesting fixes.
    expect(buildModel(rootIf, { [outerIf]: 1 })[0]!.cols.map(clsOf(inIf)))
      .toEqual(['col-12']);
  });

  it('hiding the inner branch leaves the outer branch alone', () => {
    expect(buildModel(rootIf, { [innerIf]: -1 })[0]!.cols.map(clsOf(inIf)))
      .toEqual(['col-3']);
  });

  it('lists the inner region only while it is reachable', () => {
    const shown = buildModel(rootIf)[0]!.conds!.map(c => c.region);
    expect(shown).toEqual([outerIf, innerIf]);
    // outer switched to @else: the inner block isn't rendered, so no chip
    expect(buildModel(rootIf, { [outerIf]: 1 })[0]!.conds!.map(c => c.region))
      .toEqual([outerIf]);
  });

  const inElse = `<div class="row">
    @if (a) { <div class="col-3">B</div> }
    @else {
      @if (b) { <div class="col-6">A</div> }
      <div class="col-12">C</div>
    }
  </div>`;
  const rootElse = parseTemplate(inElse);
  const outerElse = Object.values(rootElse.condRegions).find(r => r.branches.length === 2)!.region;

  it('nesting inside an @else branch behaves the same way', () => {
    expect(buildModel(rootElse)[0]!.cols.map(clsOf(inElse))).toEqual(['col-3']);
    expect(buildModel(rootElse, { [outerElse]: 1 })[0]!.cols.map(clsOf(inElse)))
      .toEqual(['col-6', 'col-12']);
  });

  it('an interposed nested region does not split the outer one into two chips', () => {
    // grouping by subtree, not by adjacency: the outer region is one entry even
    // though the inner run sits between two of its members
    const conds = buildModel(rootElse, { [outerElse]: 1 })[0]!.conds!;
    expect(conds.filter(c => c.region === outerElse)).toHaveLength(1);
  });

  it('nests @if-of-rows the same way at the top level', () => {
    const s = `<div class="container">
      @if (a) {
        @if (b) { <div class="row"><div class="col-6">A</div></div> }
        <div class="row"><div class="col-3">B</div></div>
      } @else { <div class="row"><div class="col-12">C</div></div> }
    </div>`;
    const root2 = parseTemplate(s);
    const outer = Object.values(root2.condRegions).find(r => r.branches.length === 2)!.region;
    const colOf = (r: { cols: { el: { start: number; openEnd: number } }[] }) =>
      /col-\d+/.exec(s.slice(r.cols[0]!.el.start, r.cols[0]!.el.openEnd))?.[0];
    expect(buildModel(root2).map(colOf)).toEqual(['col-6', 'col-3']);
    expect(buildModel(root2, { [outer]: 1 }).map(colOf)).toEqual(['col-12']);
  });

  it('nests @if-of-rows the same way inside a container column', () => {
    const s = `<div class="row"><div class="col-6">
      @if (a) {
        @if (b) { <div class="row"><div class="col-4">A</div></div> }
        <div class="row"><div class="col-5">B</div></div>
      } @else { <div class="row"><div class="col-9">C</div></div> }
    </div></div>`;
    const root2 = parseTemplate(s);
    const outer = Object.values(root2.condRegions).find(r => r.branches.length === 2)!.region;
    const nested = (m: ReturnType<typeof buildModel>) =>
      m[0]!.cols[0]!.nestedRows.map(r => clsOf(s)(r.cols[0]!));
    expect(nested(buildModel(root2))).toEqual(['col-4', 'col-5']);
    expect(nested(buildModel(root2, { [outer]: 1 }))).toEqual(['col-9']);
  });
});

describe('hashStr identity stability', () => {
  const hs = `<div class="row"><div class="col">a</div></div>
<div class="row"><div class="col">TARGET</div></div>`;
  const hrm = buildModel(parseTemplate(hs));
  const before = hashStr(hs.slice(hrm[1]!.el.start, hrm[1]!.el.end));
  const hs2 = splice(hs, hrm[0]!.cols[0]!.el.contentStart, hrm[0]!.cols[0]!.el.contentEnd, 'CHANGED');
  const hrm2 = buildModel(parseTemplate(hs2));
  const after = hashStr(hs2.slice(hrm2[1]!.el.start, hrm2[1]!.el.end));

  it('row identity survives edits elsewhere', () => expect(before).toBe(after));
  it('identity changes when own content changes', () =>
    expect(hashStr(hs2.slice(hrm2[0]!.el.start, hrm2[0]!.el.end)))
      .not.toBe(hashStr(hs.slice(hrm[0]!.el.start, hrm[0]!.el.end))));
});

describe('nodeAtOffset (reverse selection sync)', () => {
  const no1 = `<div class="container">
<div class="row"><div class="col-sm-6">alpha</div><div class="col-sm-6">
  <div class="row"><div class="col">deep</div></div>
</div></div>
<div class="row"><div class="col-12">beta</div></div>
</div>`;
  const nom = buildModel(parseTemplate(no1));

  it('offset in first col', () =>
    expect(nodeAtOffset(nom, no1.indexOf('alpha'))).toEqual({ path: [0, 0], kind: 'col' }));
  it('offset in nested col', () =>
    expect(nodeAtOffset(nom, no1.indexOf('deep'))).toEqual({ path: [0, 1, 0, 0], kind: 'col' }));
  it('offset in second row col', () =>
    expect(nodeAtOffset(nom, no1.indexOf('beta'))).toEqual({ path: [1, 0], kind: 'col' }));
  it('offset in row open tag = row', () =>
    expect(nodeAtOffset(nom, no1.indexOf('<div class="row">') + 2))
      .toEqual({ path: [0], kind: 'row' }));
  it('offset outside grid = null', () => expect(nodeAtOffset(nom, 3)).toBe(null));
  it('offset at very end = null', () => expect(nodeAtOffset(nom, no1.length - 1)).toBe(null));
});
