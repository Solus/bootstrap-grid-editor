import { describe, expect, it } from 'vitest';
import { parseTemplate } from './parser.js';
import { buildModel } from './model.js';

describe('parser basics', () => {
  const src1 = `<div class="row">
  <div class="col-md-4" [disabled]="a > b" *ngIf="x">Hi</div>
  <input class="col-6" formControlName="q">
  <app-x [v]="1"></app-x>
</div>`;
  const r1 = parseTemplate(src1);
  const row1 = r1.children[0]!;
  const c1 = row1.children[0]!;

  it('one root child', () => expect(r1.children.length).toBe(1));
  it('row tag', () => expect(row1.tag).toBe('div'));
  it('row children count', () => expect(row1.children.length).toBe(3));
  it('row end covers all', () => expect(src1.slice(row1.end - 6, row1.end)).toBe('</div>'));
  it('quote-aware > in binding', () => expect(c1.tag).toBe('div'));
  it('c1 attrs', () => expect(c1.attrs.map(a => a.name)).toEqual(['class', '[disabled]', '*ngIf']));
  it('c1 content', () => expect(src1.slice(c1.contentStart, c1.contentEnd)).toBe('Hi'));
  it('void input closed', () => expect(row1.children[1]!.tag).toBe('input'));
  it('offsets exact', () => expect(src1.slice(c1.start, c1.start + 4)).toBe('<div'));
});

describe('mismatched/unclosed tolerance', () => {
  const src2 = `<div class="row"><div class="col-6"><span>x</div></div>`;
  const r2 = parseTemplate(src2);

  it('tolerant children', () => expect(r2.children[0]!.children.length).toBe(1));
  it('tolerant parse no throw', () => expect(() => parseTemplate(src2)).not.toThrow());
});

describe('comments and *ngFor attrs survive', () => {
  const src8 = `<!-- top -->\n<div class="row">\n  <div class="col-4" *ngFor="let i of items">{{i}}</div>\n</div>`;
  const m8 = buildModel(parseTemplate(src8));

  it('comment skipped, row found', () => expect(m8.length).toBe(1));
  it('ngFor attr kept', () =>
    expect(m8[0]!.cols[0]!.el.attrs.some(a => a.name === '*ngFor')).toBe(true));
  it('interpolation content ok', () => {
    const el = m8[0]!.cols[0]!.el;
    expect(src8.slice(el.contentStart, el.contentEnd)).toBe('{{i}}');
  });
});
