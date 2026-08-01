import { describe, expect, it } from 'vitest';
import {
  mergeClasses, newColMarkup, newRowMarkup, parseExtraClasses,
} from './scaffold.js';
import type { Scaffold } from './scaffold.js';

const SPACES: Scaffold = { eol: '\n', indent: '  ', indentUnit: '  ' };

describe('parseExtraClasses', () => {
  it('splits on any run of whitespace and trims', () => {
    expect(parseExtraClasses('  clearfix   form-group\t px-2 ').tokens)
      .toEqual(['clearfix', 'form-group', 'px-2']);
  });

  it('is empty for an unset, empty or blank setting', () => {
    for (const raw of [undefined, null, '', '   ', '\n']) {
      expect(parseExtraClasses(raw)).toEqual({ tokens: [], dropped: [] });
    }
  });

  it('drops duplicates, keeping the first', () => {
    expect(parseExtraClasses('a b a').tokens).toEqual(['a', 'b']);
  });

  it('drops the row class, so the whole attribute can be pasted in', () => {
    // "row clearfix form-group" (what the user's markup looks like) and
    // "clearfix form-group" (just the addition) must agree.
    expect(parseExtraClasses('row clearfix form-group').tokens)
      .toEqual(parseExtraClasses('clearfix form-group').tokens);
    expect(parseExtraClasses('row clearfix').dropped).toEqual(['row']);
    expect(parseExtraClasses('form-row clearfix').tokens).toEqual(['clearfix']);
  });

  it('drops width and offset tokens — the canvas computes those', () => {
    const got = parseExtraClasses('col col-md-6 col-xs-4 offset-2 col-sm-offset-3 px-2');
    expect(got.tokens).toEqual(['px-2']);
    expect(got.dropped).toEqual(['col', 'col-md-6', 'col-xs-4', 'offset-2', 'col-sm-offset-3']);
  });

  it('keeps class names that merely start like a grid token', () => {
    expect(parseExtraClasses('col-form-label columns offset-anchor').tokens)
      .toEqual(['col-form-label', 'columns', 'offset-anchor']);
  });

  it('drops anything that could break out of the class attribute', () => {
    const got = parseExtraClasses('ok a"b c<d e&f g=h i\'j');
    expect(got.tokens).toEqual(['ok']);
    expect(got.dropped).toEqual(['a"b', 'c<d', 'e&f', 'g=h', "i'j"]);
  });

  it('reports each dropped token once', () => {
    expect(parseExtraClasses('row row').dropped).toEqual(['row']);
  });

  it('keeps display utilities — hiding a new column is the user\'s call', () => {
    expect(parseExtraClasses('d-none d-md-block').tokens).toEqual(['d-none', 'd-md-block']);
  });
});

describe('mergeClasses', () => {
  it('puts the computed grid tokens first and the convention after', () => {
    expect(mergeClasses(['col-md-6'], ['form-group'])).toEqual(['col-md-6', 'form-group']);
  });

  it('never repeats a token the base already has', () => {
    expect(mergeClasses(['col', 'px-2'], ['px-2', 'mb-3'])).toEqual(['col', 'px-2', 'mb-3']);
  });

  it('leaves the base alone', () => {
    const base = ['col'];
    mergeClasses(base, ['x']);
    expect(base).toEqual(['col']);
  });
});

describe('newColMarkup', () => {
  it('writes the element with a placeholder comment, indented one level in', () => {
    expect(newColMarkup(['col-md-6'], SPACES)).toBe(
      '\n  <div class="col-md-6">\n    <!-- new column -->\n  </div>');
  });

  it('joins every class it is given', () => {
    expect(newColMarkup(['col', 'form-group'], SPACES))
      .toContain('<div class="col form-group">');
  });

  it('uses the document\'s indent unit and line ending', () => {
    const tabs: Scaffold = { eol: '\r\n', indent: '\t\t', indentUnit: '\t' };
    expect(newColMarkup(['col'], tabs)).toBe(
      '\r\n\t\t<div class="col">\r\n\t\t\t<!-- new column -->\r\n\t\t</div>');
  });
});

describe('newRowMarkup', () => {
  it('nests one column inside the row, indented a further level', () => {
    expect(newRowMarkup(['row'], ['col'], SPACES)).toBe(
      '\n  <div class="row">' +
      '\n    <div class="col">' +
      '\n      <!-- new column -->' +
      '\n    </div>' +
      '\n  </div>');
  });

  it('leads with a line break, a blank line, or nothing', () => {
    const body = '  <div class="row">' +
      '\n    <div class="col">\n      <!-- new column -->\n    </div>\n  </div>';
    expect(newRowMarkup(['row'], ['col'], SPACES, { lead: 'none' })).toBe(body);
    expect(newRowMarkup(['row'], ['col'], SPACES, { lead: 'newline' })).toBe('\n' + body);
    expect(newRowMarkup(['row'], ['col'], SPACES, { lead: 'blank-line' })).toBe('\n\n' + body);
    // a plain line break is the default
    expect(newRowMarkup(['row'], ['col'], SPACES)).toBe('\n' + body);
  });

  it('carries both conventions', () => {
    const html = newRowMarkup(['row', 'clearfix'], ['col-md-6', 'form-group'], SPACES);
    expect(html).toContain('<div class="row clearfix">');
    expect(html).toContain('<div class="col-md-6 form-group">');
  });

  it('uses the document\'s indent unit at both nesting levels', () => {
    const tabs: Scaffold = { eol: '\n', indent: '\t', indentUnit: '\t' };
    expect(newRowMarkup(['row'], ['col'], tabs)).toBe(
      '\n\t<div class="row">' +
      '\n\t\t<div class="col">' +
      '\n\t\t\t<!-- new column -->' +
      '\n\t\t</div>' +
      '\n\t</div>');
  });
});
