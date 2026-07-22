import { describe, expect, it } from 'vitest';
import { classTokens, setWidthToken } from './classes.js';
import {
  applyEdits, classEdit, elementCutRange, rowChildIndent, splice, writeClass,
} from './edits.js';
import { buildModel } from './model.js';
import { parseTemplate } from './parser.js';

describe('writeClass surgical edit', () => {
  const src4 = `<div class="row">\n  <div class="col-md-6">x</div>\n</div>`;
  const el4 = buildModel(parseTemplate(src4))[0]!.cols[0]!.el;
  it('class rewritten', () =>
    expect(writeClass(src4, el4, setWidthToken(classTokens(el4), 'md', 4)))
      .toBe(`<div class="row">\n  <div class="col-md-4">x</div>\n</div>`));

  const src5 = `<div class="row">\n  <div>x</div>\n</div>`;
  it('class inserted', () =>
    expect(writeClass(src5, buildModel(parseTemplate(src5))[0]!.cols[0]!.el, ['col-md-3']))
      .toBe(`<div class="row">\n  <div class="col-md-3">x</div>\n</div>`));

  const src6 = `<div class="row"><input class=col-6></div>`;
  it('unquoted requoted', () =>
    expect(writeClass(src6, buildModel(parseTemplate(src6))[0]!.cols[0]!.el, ['col-4']))
      .toBe(`<div class="row"><input class="col-4"></div>`));
});

describe('elementCutRange / rowChildIndent', () => {
  const src7 = `<div class="row">\n    <div class="col-6">a</div>\n    <div class="col-6">b</div>\n</div>`;
  const m7 = buildModel(parseTemplate(src7));
  const cr = elementCutRange(src7, m7[0]!.cols[1]!.el);

  it('indent captured', () => expect(cr.indent).toBe('    '));
  it('cutStart swallows newline', () => expect(src7[cr.cutStart]).toBe('\n'));
  it('row child indent', () => expect(rowChildIndent(src7, m7[0]!.el)).toBe('    '));
  it('delete clean', () =>
    expect(splice(src7, cr.cutStart, cr.cutEnd, ''))
      .toBe(`<div class="row">\n    <div class="col-6">a</div>\n</div>`));
});

describe('cut range carries the comment', () => {
  const srcT = `<div class="row">
  <!--COL3-->
  <div class="col-sm-4">
    <!-- HDR:Roba -->
    <legend class="group-title" lc-l10n="spi.x"></legend>
  </div>
  <div class="col-sm-8">plain</div>
</div>`;
  const mT = buildModel(parseTemplate(srcT));
  const crT = elementCutRange(srcT, mT[0]!.cols[0]!.el);

  it('textStart at comment', () =>
    expect(srcT.slice(crT.textStart, crT.textStart + 11)).toBe('<!--COL3-->'));
  it('delete removes comment too', () =>
    expect(splice(srcT, crT.cutStart, crT.cutEnd, '')).toBe(`<div class="row">
  <div class="col-sm-8">plain</div>
</div>`));

  const srcT5 = `<div class="row">
  <!--A-->
  <!--B-->
  <div class="col-6">x</div>
  <div class="col-6">y</div>
</div>`;
  it('chained comments included', () => {
    const crT5 = elementCutRange(srcT5, buildModel(parseTemplate(srcT5))[0]!.cols[0]!.el);
    expect(srcT5.slice(crT5.textStart, crT5.textStart + 8)).toBe('<!--A-->');
  });

  // simulating moveCol's slice
  const movedText = srcT.slice(crT.textStart, mT[0]!.cols[0]!.el.end);
  it('move text starts with comment', () => expect(movedText.startsWith('<!--COL3-->')).toBe(true));
  it('move text ends with element', () => expect(movedText.trimEnd().endsWith('</div>')).toBe(true));

  it('plain textStart is el.start', () =>
    expect(elementCutRange(srcT, mT[0]!.cols[1]!.el).textStart).toBe(mT[0]!.cols[1]!.el.start));
});

describe('swapSiblings preserves node kind & carries comments (row reorder)', () => {
  const sw = `<div class="container">
  <!--FIRST-->
  <div class="row"><div class="col">a</div></div>
  <!--SECOND-->
  <div class="row"><div class="col">b</div></div>
</div>`;
  const swm = buildModel(parseTemplate(sw));

  // simulate nudgeRow(down) on row 0: swap rows 0 and 1
  const A = swm[0]!.el, B = swm[1]!.el;
  const [first, second] = A.start < B.start ? [A, B] : [B, A];
  const rF = elementCutRange(sw, first), rS = elementCutRange(sw, second);
  const tF = sw.slice(rF.textStart, first.end), tS = sw.slice(rS.textStart, second.end);
  let s = sw;
  s = splice(s, rS.textStart, second.end, tF);
  s = splice(s, rF.textStart, first.end, tS);
  const m2 = buildModel(parseTemplate(s));

  it('row reorder swaps content', () =>
    expect(s.indexOf('SECOND') < s.indexOf('FIRST')).toBe(true));
  it('both comments survive reorder', () =>
    expect(s.includes('FIRST') && s.includes('SECOND')).toBe(true));
  it('row count preserved', () => expect(m2.length).toBe(2));
});

describe('applyEdits / classEdit (span-edit batch, added Session 3)', () => {
  it('applies a single replacement', () =>
    expect(applyEdits('abcdef', [{ start: 2, end: 4, text: 'XY' }])).toBe('abXYef'));
  it('an insertion has start === end', () =>
    expect(applyEdits('abc', [{ start: 1, end: 1, text: '-' }])).toBe('a-bc'));
  it('a deletion has empty text', () =>
    expect(applyEdits('abc', [{ start: 1, end: 2, text: '' }])).toBe('ac'));
  it('applies multiple non-overlapping edits regardless of order', () => {
    const edits = [
      { start: 0, end: 1, text: 'X' },
      { start: 4, end: 5, text: 'Z' },
    ];
    // order in the array must not matter — applyEdits sorts by offset
    expect(applyEdits('abcde', edits)).toBe('XbcdZ');
    expect(applyEdits('abcde', [...edits].reverse())).toBe('XbcdZ');
  });
  it('a two-edit swap moves text without disturbing between', () => {
    // swap "AA" and "BB" in `[AA]--[BB]`
    const s = '[AA]--[BB]';
    const edits = [
      { start: 1, end: 3, text: 'BB' },
      { start: 7, end: 9, text: 'AA' },
    ];
    expect(applyEdits(s, edits)).toBe('[BB]--[AA]');
  });

  it('classEdit targets the class value span; writeClass is applyEdits of it', () => {
    const s = `<div class="row"><div class="col-6">x</div></div>`;
    const el = buildModel(parseTemplate(s))[0]!.cols[0]!.el;
    const e = classEdit(s, el, ['col-4']);
    expect(s.slice(e.start, e.end)).toBe('col-6');
    expect(e.text).toBe('col-4');
    expect(applyEdits(s, [e])).toBe(writeClass(s, el, ['col-4']));
  });
});

describe('cut range respects the blank-line rule', () => {
  // The comment is separated from the element by a blank line, so it
  // describes a section, not this element — it must be neither carried on a
  // move nor removed on a delete. (Strengthened while resolving FOLLOW-UPS
  // §2.3: the ported assertion was an A||B disjunction satisfiable by either
  // branch; these pin both halves of the intended behavior directly.)
  const ac3 = `<div class="row">
  <!--KEEP-->

  <div class="col-6">x</div>
</div>`;
  const el = buildModel(parseTemplate(ac3))[0]!.cols[0]!.el;
  const cr3 = elementCutRange(ac3, el);

  it('move text starts at the element, not the comment', () =>
    expect(cr3.textStart).toBe(el.start));
  it('the comment is not carried in the moved text', () =>
    expect(ac3.slice(cr3.textStart, el.end)).not.toContain('KEEP'));
  it('a delete leaves the blank-line-separated comment in place', () => {
    const after = splice(ac3, cr3.cutStart, cr3.cutEnd, '');
    expect(after).toContain('KEEP');       // comment survives
    expect(after).not.toContain('col-6');  // element removed
  });
});
