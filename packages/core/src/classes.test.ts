import { describe, expect, it } from 'vitest';
import {
  classIsInterpolated, colSpec, definingBp, effectiveAt, halveWidthTokenStr,
  halvedWidthTokens, hasDynamicClassBinding, isHiddenAt, offsetTokenBp,
  setOffsetToken, setWidthToken, usesBs3, usesBs5, widthTokenBp,
} from './classes.js';
import { buildModel } from './model.js';
import { parseTemplate } from './parser.js';

describe('colSpec / effectiveAt', () => {
  const spec = colSpec(['col-md-4', 'col-lg-6', 'offset-lg-2', 'form-group']);

  it('spec md', () => expect(spec.width.md).toBe(4));
  it('spec lg', () => expect(spec.width.lg).toBe(6));
  it('spec offset lg', () => expect(spec.offset.lg).toBe(2));
  it('eff at xl cascades', () => expect(effectiveAt(spec.width, 'xl')).toBe(6));
  it('eff at sm null', () => expect(effectiveAt(spec.width, 'sm')).toBe(null));
  it('bare col', () => expect(colSpec(['col']).width.xs).toBe('equal'));
  it('col-auto', () => expect(colSpec(['col-auto']).width.xs).toBe('auto'));
  it('col-md bare', () => expect(colSpec(['col-md']).width.md).toBe('equal'));
});

describe('d-* display / isHiddenAt', () => {
  it('parses d-none and breakpoint displays', () => {
    const s = colSpec(['col-lg-3', 'd-none', 'd-lg-block']);
    expect(s.display).toEqual({ xs: false, lg: true });
  });

  it('a plain d-none column is hidden at every breakpoint', () => {
    const s = colSpec(['col-6', 'd-none']);
    expect(isHiddenAt(s, 'xs')).toBe(true);
    expect(isHiddenAt(s, 'xxl')).toBe(true);
  });

  it('d-none d-lg-block: hidden below lg, shown at lg and up (mobile-first)', () => {
    const s = colSpec(['col-lg-3', 'd-none', 'd-lg-block']);
    expect(isHiddenAt(s, 'xs')).toBe(true);
    expect(isHiddenAt(s, 'md')).toBe(true);
    expect(isHiddenAt(s, 'lg')).toBe(false);
    expect(isHiddenAt(s, 'xl')).toBe(false);
  });

  it('d-lg-none: shown until lg, then hidden', () => {
    const s = colSpec(['col-6', 'd-lg-none']);
    expect(isHiddenAt(s, 'md')).toBe(false);
    expect(isHiddenAt(s, 'lg')).toBe(true);
  });

  it('a column with no d-* is never hidden', () => {
    expect(isHiddenAt(colSpec(['col-6']), 'md')).toBe(false);
  });
});

describe('setWidthToken preserves order & other tokens', () => {
  it('replace in place', () =>
    expect(setWidthToken(['form-group', 'col-md-4', 'col-lg-6'], 'md', 8))
      .toEqual(['form-group', 'col-md-8', 'col-lg-6']));
  it('remove token', () =>
    expect(setWidthToken(['col-md-4', 'x'], 'md', null)).toEqual(['x']));
  it('add after existing col', () =>
    expect(setWidthToken(['a', 'col-md-4', 'b'], 'lg', 3))
      .toEqual(['a', 'col-md-4', 'col-lg-3', 'b']));
  it('equal token md', () => expect(setWidthToken([], 'md', 'equal')).toEqual(['col-md']));
  it('xs numeric', () => expect(setWidthToken([], 'xs', 6)).toEqual(['col-6']));
  it('offset set', () =>
    expect(setOffsetToken(['col-md-4'], 'md', 2)).toEqual(['col-md-4', 'offset-md-2']));
  it('offset remove', () =>
    expect(setOffsetToken(['col-md-4', 'offset-md-2'], 'md', 0)).toEqual(['col-md-4']));
  it('offset replace', () =>
    expect(setOffsetToken(['offset-md-2', 'x'], 'md', 3)).toEqual(['offset-md-3', 'x']));
});

describe('dynamic class detection', () => {
  const src9 = `<div class="row"><div class="col-{{n}}">x</div><div class="col-6" [ngClass]="{a:b}">y</div></div>`;
  const m9 = buildModel(parseTemplate(src9));

  it('interpolated class flagged', () =>
    expect(classIsInterpolated(m9[0]!.cols[0]!.el)).toBe(true));
  it('ngClass flagged', () =>
    expect(hasDynamicClassBinding(m9[0]!.cols[1]!.el)).toBe(true));
  it('static not flagged', () =>
    expect(classIsInterpolated(m9[0]!.cols[1]!.el)).toBe(false));
});

describe('Bootstrap 3 dialect', () => {
  const s3 = colSpec(['col-sm-4', 'col-sm-offset-4', 'col-md-offset-2']);

  it('bs3 offset sm', () => expect(s3.offset.sm).toBe(4));
  it('bs3 offset md', () => expect(s3.offset.md).toBe(2));
  it('bs3 offset not width', () => expect(s3.width.md).toBe(undefined));
  it('bs3 xs width', () => expect(colSpec(['col-xs-6']).width.xs).toBe(6));
  it('bs3 bare col-xs', () => expect(colSpec(['col-xs']).width.xs).toBe('equal'));
  it('bs3 eff cascade', () =>
    expect(effectiveAt(colSpec(['col-xs-6', 'col-md-4']).width, 'lg')).toBe(4));
  it('bs3 offset eff', () =>
    expect(effectiveAt(colSpec(['col-sm-offset-4']).offset, 'xl')).toBe(4));

  it('bs3 offset replace', () =>
    expect(setOffsetToken(['col-sm-4', 'col-sm-offset-4'], 'sm', 3))
      .toEqual(['col-sm-4', 'col-sm-offset-3']));
  it('bs3 offset remove', () =>
    expect(setOffsetToken(['col-sm-4', 'col-sm-offset-4'], 'sm', 0)).toEqual(['col-sm-4']));
  it('bs3 offset add', () =>
    expect(setOffsetToken(['col-xs-6'], 'md', 2)).toEqual(['col-xs-6', 'col-md-offset-2']));
  it('modern offset add', () =>
    expect(setOffsetToken(['col-md-4'], 'md', 2)).toEqual(['col-md-4', 'offset-md-2']));
  it('modern offset replace stays modern', () =>
    expect(setOffsetToken(['offset-md-2', 'x'], 'md', 3)).toEqual(['offset-md-3', 'x']));

  it('bs3 xs width replace', () =>
    expect(setWidthToken(['col-xs-6', 'col-md-4'], 'xs', 4)).toEqual(['col-xs-4', 'col-md-4']));
  it('bs3 xs width add (list is bs3)', () =>
    expect(setWidthToken(['col-sm-offset-4', 'col-sm-6'], 'xs', 3))
      .toEqual(['col-sm-offset-4', 'col-sm-6', 'col-xs-3']));
  it('modern xs add unaffected', () =>
    expect(setWidthToken(['col-md-4'], 'xs', 6)).toEqual(['col-md-4', 'col-6']));

  it('offset token is not width', () => expect(widthTokenBp('col-sm-offset-4')).toBe(null));
  it('offset token bp', () => expect(offsetTokenBp('col-sm-offset-4')).toBe('sm'));
  it('modern offset bp', () => expect(offsetTokenBp('offset-3')).toBe('xs'));

  it('width edit leaves bs3 offset alone', () =>
    expect(setWidthToken(['col-sm-4', 'col-sm-offset-4'], 'sm', 8))
      .toEqual(['col-sm-8', 'col-sm-offset-4']));
});

describe('definingBp cascade', () => {
  const dspec = colSpec(['col-sm-6', 'col-sm-offset-4']);
  const dspec2 = colSpec(['col-sm-6', 'col-lg-4']);

  it('defining bp width at md', () => expect(definingBp(dspec.width, 'md')).toBe('sm'));
  it('defining bp width at sm', () => expect(definingBp(dspec.width, 'sm')).toBe('sm'));
  it('defining bp width at xs', () => expect(definingBp(dspec.width, 'xs')).toBe(null));
  it('defining bp offset at xl', () => expect(definingBp(dspec.offset, 'xl')).toBe('sm'));
  it('defining none', () => expect(definingBp({}, 'md')).toBe(null));
  it('nearest tier wins', () => expect(definingBp(dspec2.width, 'xl')).toBe('lg'));
  it('below override', () => expect(definingBp(dspec2.width, 'md')).toBe('sm'));

  // editing the defining token: sm token edited while "viewing md"
  it('edit defining sm token', () =>
    expect(setWidthToken(['col-sm-6', 'col-sm-offset-4'], definingBp(dspec.width, 'md')!, 4))
      .toEqual(['col-sm-4', 'col-sm-offset-4']));
  it('edit defining sm offset', () =>
    expect(setOffsetToken(['col-sm-6', 'col-sm-offset-4'], definingBp(dspec.offset, 'md')!, 3))
      .toEqual(['col-sm-6', 'col-sm-offset-3']));
});

describe('halving (split) preserves dialect and tiers', () => {
  it('halve bs3 token', () => expect(halveWidthTokenStr('col-xs-8', 'ceil')).toBe('col-xs-4'));
  it('halve odd ceil', () => expect(halveWidthTokenStr('col-sm-5', 'ceil')).toBe('col-sm-3'));
  it('halve odd floor', () => expect(halveWidthTokenStr('col-sm-5', 'floor')).toBe('col-sm-2'));
  it('halve min 1', () => expect(halveWidthTokenStr('col-md-1', 'floor')).toBe('col-md-1'));
  it('halve equal untouched', () => expect(halveWidthTokenStr('col-md', 'ceil')).toBe('col-md'));
  it('halve auto untouched', () => expect(halveWidthTokenStr('col-auto', 'ceil')).toBe('col-auto'));
  it('halved multi-tier', () =>
    expect(halvedWidthTokens(['form-group', 'col-sm-8', 'col-lg-6', 'col-sm-offset-2'], 'floor'))
      .toEqual(['col-sm-4', 'col-lg-3']));
  it('halved keeps bare col', () =>
    expect(halvedWidthTokens(['col', 'x'], 'ceil')).toEqual(['col']));
});

describe('bs3Hint drives dialect of newly created tokens', () => {
  it('hint makes new offset bs3', () =>
    expect(setOffsetToken(['col-sm-4'], 'sm', 2, true)).toEqual(['col-sm-4', 'col-sm-offset-2']));
  it('no hint stays modern', () =>
    expect(setOffsetToken(['col-sm-4'], 'sm', 2, false)).toEqual(['col-sm-4', 'offset-sm-2']));
  it('hint makes new xs width bs3', () =>
    expect(setWidthToken(['col-sm-4'], 'xs', 6, true)).toEqual(['col-sm-4', 'col-xs-6']));
  it('hint irrelevant when token exists', () =>
    expect(setOffsetToken(['offset-sm-2'], 'sm', 3, true)).toEqual(['offset-sm-3']));
});

describe('explicit offset-*-0 cancels inherited offset', () => {
  it('keepZero writes explicit -0', () =>
    expect(setOffsetToken(['col-sm-4', 'offset-sm-3'], 'md', 0, false, true))
      .toEqual(['col-sm-4', 'offset-sm-3', 'offset-md-0']));
  it('zero without keepZero removes token', () =>
    expect(setOffsetToken(['offset-md-3'], 'md', 0, false, false)).toEqual([]));
  it('bs3 explicit zero', () =>
    expect(setOffsetToken(['col-sm-4', 'col-sm-offset-3'], 'md', 0, true, true))
      .toEqual(['col-sm-4', 'col-sm-offset-3', 'col-md-offset-0']));
});

describe('dialect evidence: usesBs3 / usesBs5 / neither', () => {
  // Bootstrap 3 only.
  it('col-xs-* is bs3', () => expect(usesBs3(['col-xs-6'])).toBe(true));
  it('bare col-xs is bs3', () => expect(usesBs3(['col-xs'])).toBe(true));
  it('col-*-offset-* is bs3', () => expect(usesBs3(['col-sm-4', 'col-md-offset-2'])).toBe(true));
  it('bs3 tokens are not bs5', () =>
    expect(usesBs5(['col-xs-6', 'col-sm-offset-4'])).toBe(false));

  // Bootstrap 4/5 only.
  it('bare col is bs5', () => expect(usesBs5(['col'])).toBe(true));
  it('bare col-md is bs5', () => expect(usesBs5(['col-md'])).toBe(true));
  it('col-auto is bs5', () => expect(usesBs5(['col-auto'])).toBe(true));
  it('col-md-auto is bs5', () => expect(usesBs5(['col-md-auto'])).toBe(true));
  it('xl tier is bs5', () => expect(usesBs5(['col-xl-4'])).toBe(true));
  it('xxl tier is bs5', () => expect(usesBs5(['col-xxl-4'])).toBe(true));
  it('offset-* is bs5', () => expect(usesBs5(['col-sm-4', 'offset-sm-2'])).toBe(true));
  it('bare offset-N is bs5', () => expect(usesBs5(['offset-2'])).toBe(true));
  it('row-cols-* is bs5', () => expect(usesBs5(['row', 'row-cols-md-3'])).toBe(true));
  it('bs5 tokens are not bs3', () => expect(usesBs3(['col', 'col-xl-4', 'offset-md-2'])).toBe(false));

  // Shared by both dialects — the ambiguous case the setting exists to break.
  it('col-sm-6 claims neither', () => {
    expect(usesBs3(['col-sm-6'])).toBe(false);
    expect(usesBs5(['col-sm-6'])).toBe(false);
  });
  it('col-md-4 / col-lg-3 claim neither', () => {
    expect(usesBs5(['col-md-4', 'col-lg-3'])).toBe(false);
    expect(usesBs3(['col-md-4', 'col-lg-3'])).toBe(false);
  });
  it('non-grid classes claim neither', () => {
    expect(usesBs5(['row', 'form-group', 'px-2'])).toBe(false);
    expect(usesBs3(['row', 'form-group', 'px-2'])).toBe(false);
  });
  it('a bs3 offset is not read as a bs5 offset', () =>
    expect(usesBs5(['col-sm-offset-4'])).toBe(false));
});
