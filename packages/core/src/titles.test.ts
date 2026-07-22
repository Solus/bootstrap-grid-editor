import { describe, expect, it } from 'vitest';
import { buildModel } from './model.js';
import { parseTemplate } from './parser.js';
import {
  colSearchText, colSequence, colTitle, contentHint, elementTitle, headingTitle,
  sectionTitleAttr,
} from './titles.js';

/** Parse `src` and hand back its first row's column at `i`. */
function col(src: string, i = 0) {
  return buildModel(parseTemplate(src))[0]!.cols[i]!.el;
}

describe('title comments', () => {
  const srcT = `<div class="row">
  <!--COL3-->
  <div class="col-sm-4">
    <!-- HDR:Roba -->
    <legend class="group-title" lc-l10n="spi.x"></legend>
  </div>
  <div class="col-sm-8">plain</div>
</div>`;
  it('preceding comment title', () => expect(elementTitle(srcT, col(srcT))).toBe('COL3'));
  it('no title on plain col', () => expect(elementTitle(srcT, col(srcT, 1))).toBe(null));

  const srcT2 = `<div class="row">
  <div class="col-sm-4">
    <!-- HDR:Roba -->
    <legend></legend>
  </div>
</div>`;
  it('inner comment fallback', () => expect(elementTitle(srcT2, col(srcT2))).toBe('HDR:Roba'));

  // commented-out markup is NOT a title
  const srcT3 = `<div class="row">
  <!-- <div class="col-6">old</div> -->
  <div class="col-6">x</div>
</div>`;
  it('commented markup ignored', () => expect(elementTitle(srcT3, col(srcT3))).toBe(null));

  const srcT4 = `<!--MAIN-->\n<div class="row"><div class="col">x</div></div>`;
  it('row title', () =>
    expect(elementTitle(srcT4, buildModel(parseTemplate(srcT4))[0]!.el)).toBe('MAIN'));

  const srcT5 = `<div class="row">
  <!--A-->
  <!--B-->
  <div class="col-6">x</div>
  <div class="col-6">y</div>
</div>`;
  it('nearest comment wins as title', () => expect(elementTitle(srcT5, col(srcT5))).toBe('B'));
});

describe('heading titles', () => {
  const lg1 = `<div class="row"><div class="col-sm-4">
  <legend class="group-title" app-i18n="demo.editor.sectionC"></legend>
  <div class="row"><div class="col-sm-6">x</div></div>
</div></div>`;
  it('heading title from i18n key', () =>
    expect(headingTitle(lg1, col(lg1))!.text).toBe('sectionC'));
  it('heading title full key', () =>
    expect(headingTitle(lg1, col(lg1))!.full).toBe('demo.editor.sectionC'));

  const lg4 = `<div class="row"><div class="col-4"><legend>Roba</legend><div class="row"><div class="col">x</div></div></div></div>`;
  it('heading title from text', () => expect(headingTitle(lg4, col(lg4))!.text).toBe('Roba'));

  // an explicit comment beats the heading
  const lg5 = `<div class="row"><!--COL3-->
<div class="col-4"><legend>Roba</legend><div class="row"><div class="col">x</div></div></div></div>`;
  it('comment title wins', () => expect(colTitle(lg5, col(lg5))!.text).toBe('COL3'));
  it('heading fallback via colTitle', () => expect(colTitle(lg4, col(lg4))!.text).toBe('Roba'));
});

describe('content hints', () => {
  const h1 = `<div class="row"><div class="col-sm-3">
  <label appFor="f4" app-i18n="demo.editor.field004"></label>
  <text-input formControlName="field004"></text-input>
</div></div>`;
  it('control name wins', () =>
    expect(contentHint(h1, col(h1))).toEqual({ text: 'field004', kind: 'control', tag: 'text-input' }));

  const h2 = `<div class="row"><div class="col-sm-4">
  <div class="input-group"><text-input formControlName="field023"></text-input><div class="input-group-addon">%</div></div>
</div></div>`;
  it('control found through wrapper', () =>
    expect(contentHint(h2, col(h2))).toEqual({ text: 'field023', kind: 'control', tag: 'text-input' }));

  const h3 = `<div class="row"><div class="col-sm-12">
  <label appFor="f3" app-i18n="demo.editor.field003"></label>
</div></div>`;
  it('i18n key fallback (last segment)', () =>
    expect(contentHint(h3, col(h3))).toEqual({ text: 'field003', kind: 'i18n', tag: 'label' }));

  const h4 = `<div class="row"><div class="col-sm-5"><status-display [statusInput]="s"></status-display></div></div>`;
  it('tag fallback', () =>
    expect(contentHint(h4, col(h4))).toEqual({ text: '<status-display>', kind: 'tag' }));

  const h5 = `<div class="row"><div class="col-sm-2"><text-input [formControl]="helper017"></text-input></div></div>`;
  it('[formControl] binding recognized', () =>
    expect(contentHint(h5, col(h5))).toEqual({ text: 'helper017', kind: 'control', tag: 'text-input' }));

  const tb = `<div class="row"><div class="col-sm-2"><button class="btn" app-i18n="demo.editor.action001"></button></div></div>`;
  it('button i18n typed', () =>
    expect(contentHint(tb, col(tb))).toEqual({ text: 'action001', kind: 'i18n', tag: 'button' }));

  const tl = `<div class="row"><div class="col-sm-4"><label app-i18n="x.y.field014"></label><date-input formControlName="field014"></date-input></div></div>`;
  it('control beats label, keeps type', () =>
    expect(contentHint(tl, col(tl))).toEqual({ text: 'field014', kind: 'control', tag: 'date-input' }));

  const sp4 = `<div class="row"><div class="col-sm-5"><br /><status-display [s]="x"></status-display></div></div>`;
  it('hint skips br', () =>
    expect(contentHint(sp4, col(sp4))).toEqual({ text: '<status-display>', kind: 'tag' }));
});

describe('colSequence: separators interleaved in order', () => {
  const sq1 = `<div class="row"><div class="col-sm-4">
  <legend app-i18n="a.b.sectionL"></legend>
  <div class="row"><div class="col">r1</div></div>
  <legend app-i18n="a.b.sectionM"></legend>
  <div class="row"><div class="col">r2</div></div>
  <br />
  <div class="row"><div class="col">r3</div></div>
</div></div>`;
  it('sequence order', () => {
    const seq1 = colSequence(sq1, col(sq1))
      .map(i => i.kind === 'row' ? 'row' : 'sep:' + i.text + (i.direct ? '(d)' : ''));
    expect(seq1).toEqual(['sep:sectionL(d)', 'row', 'sep:sectionM(d)', 'row', 'row']);
  });

  const sq2 = `<div class="row"><div class="col-sm-12">
  <expandable-panel [settings]="s">
    <panel-section id="f" sectionTitle="demo.editor.sectionF"><div class="row"><div class="col">x</div></div></panel-section>
    <panel-section id="j" sectionTitle="demo.editor.sectionJ"><div class="row"><div class="col">y</div></div></panel-section>
  </expandable-panel>
</div></div>`;
  const sqm2 = buildModel(parseTemplate(sq2));
  const seq2 = colSequence(sq2, sqm2[0]!.cols[0]!.el)
    .map(i => i.kind === 'row' ? 'row' : 'sep:' + i.text);

  it('wrapper sectionTitle separators', () =>
    expect(seq2).toEqual(['sep:sectionF', 'row', 'sep:sectionJ', 'row']));
  it('sequence rows match findRows count', () =>
    expect(seq2.filter(x => x === 'row').length).toBe(sqm2[0]!.cols[0]!.nestedRows.length));
  it('sectionTitleAttr parses', () =>
    expect(sectionTitleAttr(sqm2[0]!.cols[0]!.el.children[0]!.children[0]!))
      .toEqual({ text: 'sectionF', full: 'demo.editor.sectionF' }));

  // a heading nested inside a wrapper is not the column's own title
  const sq3 = `<div class="row"><div class="col-sm-6"><fieldset><legend>Inner</legend><div class="row"><div class="col">x</div></div></fieldset></div></div>`;
  it('nested heading not direct', () => {
    const first = colSequence(sq3, col(sq3))[0]!;
    expect(first.kind === 'sep' && first.direct).toBe(false);
  });
});

/* Added while resolving FOLLOW-UPS §2.5 (not part of the ported 157).
   colSequence and findRows do NOT agree row-for-row in every case:
   findRows recurses into a heading, colSequence emits it as a sep and
   stops. So a row nested inside a heading is in nestedRows yet has no
   'row' item in the sequence. Any consumer pairing the two must do so by
   element identity, never by position — render.ts learned this the hard
   way. This test pins the divergence so it can't be silently reassumed. */
describe('colSequence vs nestedRows divergence (heading-nested rows)', () => {
  const src = `<div class="row"><div class="col">
  <legend>Sec <div class="row"><div class="col">INSIDE</div></div> </legend>
  <div class="row"><div class="col">SIBLING</div></div>
</div></div>`;
  // one parse — identity pairing depends on both views sharing element objects
  const rootCol = buildModel(parseTemplate(src))[0]!.cols[0]!;
  const seqRows = colSequence(src, rootCol.el).filter(i => i.kind === 'row');
  const nested = rootCol.nestedRows;

  it('findRows collects the heading-nested row', () => {
    expect(nested.length).toBe(2);
  });
  it('colSequence omits it (emits the heading as a sep instead)', () => {
    expect(seqRows.length).toBe(1);
  });
  it('so positional pairing would misalign — identity pairing does not', () => {
    // the one sequence row is the SIBLING, which is nested index 1, not 0
    const seqRowEl = (seqRows[0] as { kind: 'row'; el: unknown }).el;
    expect(seqRowEl).toBe(nested[1]!.el);
    expect(seqRowEl).not.toBe(nested[0]!.el);
  });
});

describe('colSearchText', () => {
  const fs1 = `<div class="row"><div class="col-sm-3">
  <label app-i18n="demo.editor.field004"></label>
  <lookup-input formControlName="field004"></lookup-input>
</div></div>`;
  const st1 = colSearchText(fs1, col(fs1));
  it('search finds control name', () => expect(st1).toContain('field004'));
  it('search finds providing tag', () => expect(st1).toContain('lookup-input'));

  const fs2 = `<div class="row"><div class="col-sm-4">
  <legend app-i18n="a.b.sectionL"></legend>
  <div class="row"><div class="col">x</div></div>
  <legend app-i18n="a.b.sectionM"></legend>
  <div class="row"><div class="col">y</div></div>
</div></div>`;
  const st2 = colSearchText(fs2, col(fs2));
  it('search finds title', () => expect(st2).toContain('sectionl'));
  it('search finds inner separator', () => expect(st2).toContain('sectionm'));
  it('search finds full key', () => expect(st2).toContain('a.b.sectionm'));
  it('case-insensitive storage', () => expect(st2).toBe(st2.toLowerCase()));
});

describe('adjacent-comment rule: blank line breaks title association', () => {
  const ac1 = `<div class="row"><div class="col-6">
  <!--ADJACENT-->
  <input formControlName="a">
</div></div>`;
  it('adjacent comment is title', () => expect(colTitle(ac1, col(ac1))!.text).toBe('ADJACENT'));

  const ac2 = `<div class="row">

  <!--SECTION-->

  <div class="col-6"><input formControlName="a"></div>
</div>`;
  it('blank-line comment NOT a title', () => expect(colTitle(ac2, col(ac2))).toBe(null));
});
