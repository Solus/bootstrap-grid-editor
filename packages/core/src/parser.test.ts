import { describe, expect, it } from 'vitest';
import { parseTemplate, parseTemplateLegacy } from './parser.js';
import { buildModel } from './model.js';

/* Span-semantics contract (FOLLOW-UPS §1.4). The surgical edits slice source
   at these exact offsets, so the parser adapter must define them precisely.
   The 157 ported cases cover spans only incidentally; these pin the mapping
   directly, so a bad adapter fails here in core rather than only in a browser.
   `el` for `<div class="c">Hi</div>`:
     start ── openEnd ─────── contentEnd ── end
     <div class="c">   Hi     </div>
                    └ contentStart (= openEnd) */
describe('span semantics (the edit contract)', () => {
  const one = (src: string) => parseTemplate(src).children[0]!;

  it('openEnd is just past the opening tag > , and equals contentStart', () => {
    const s = `<div class="c">Hi</div>`;
    const el = one(s);
    expect(s[el.openEnd - 1]).toBe('>');       // openEnd sits right after '>'
    expect(el.contentStart).toBe(el.openEnd);
    expect(s.slice(el.contentStart, el.contentEnd)).toBe('Hi');
  });

  it('start is the "<" and end is just past the closing tag', () => {
    const s = `  <div class="c">Hi</div>`;
    const el = one(s);
    expect(s[el.start]).toBe('<');
    expect(s.slice(el.end - 6, el.end)).toBe('</div>');
  });

  it('contentEnd bounds exactly the inner text', () => {
    const s = `<div class="c">  x  </div>`;
    const el = one(s);
    expect(s.slice(el.contentStart, el.contentEnd)).toBe('  x  ');
  });

  it('a void element collapses its content span to the open-tag end', () => {
    const s = `<div class="row"><input class="col-6"></div>`;
    const input = one(s).children[0]!;
    expect(input.tag).toBe('input');
    expect(input.contentStart).toBe(input.contentEnd);
    expect(input.contentEnd).toBe(input.end);
    expect(s[input.end - 1]).toBe('>');
  });

  it('a self-closing element collapses its content span', () => {
    const s = `<div class="row"><app-x [v]="1"/></div>`;
    const x = one(s).children[0]!;
    expect(x.tag).toBe('app-x');
    expect(x.contentStart).toBe(x.contentEnd);
    expect(x.contentEnd).toBe(x.end);
  });

  it('nested element spans nest strictly inside the parent content span', () => {
    const s = `<div class="row"><div class="col">a</div></div>`;
    const parent = one(s);
    const child = parent.children[0]!;
    expect(child.start).toBeGreaterThanOrEqual(parent.contentStart);
    expect(child.end).toBeLessThanOrEqual(parent.contentEnd);
  });
});

/* The Angular parser flattens control flow so the model shape is unchanged;
   the legacy fallback (used on parse errors) must agree on that shape. */
describe('control-flow flattening (Angular path)', () => {
  it('@if/@else columns become direct columns of the row', () => {
    const s = `<div class="row">@if (x) { <div class="col-6">a</div> } @else { <div class="col-4">b</div> }</div>`;
    const row = buildModel(parseTemplate(s))[0]!;
    expect(row.cols.map(c => c.el.tag)).toEqual(['div', 'div']);
    expect(row.cols.length).toBe(2);
  });

  it('@for body and @empty columns are lifted into the row', () => {
    const s = `<div class="row">@for (i of xs; track i) { <div class="col">a</div> } @empty { <div class="col-12">none</div> }</div>`;
    const row = buildModel(parseTemplate(s))[0]!;
    expect(row.cols.length).toBe(2);
  });

  it('*ngFor is unwrapped and its attribute survives on the element', () => {
    const s = `<div class="row"><div class="col-4" *ngFor="let i of items">{{i}}</div></div>`;
    const col = buildModel(parseTemplate(s))[0]!.cols[0]!;
    expect(col.el.attrs.some(a => a.name === '*ngFor')).toBe(true);
    expect(s.slice(col.el.contentStart, col.el.contentEnd)).toBe('{{i}}');
  });
});

describe('legacy fallback on parse errors', () => {
  it('a stray @ in text is tolerated (not treated as a block)', () => {
    const s = `<div class="row">contact admin@iframe.example <div class="col-6">x</div></div>`;
    const row = buildModel(parseTemplate(s))[0]!;
    expect(row.cols.length).toBe(1);
  });

  it('parseTemplateLegacy is what the error path returns', () => {
    // an unclosed span: identical structure from parseTemplate and the legacy
    const s = `<div class="row"><div class="col-6"><span>x</div></div>`;
    const viaMain = parseTemplate(s);
    const viaLegacy = parseTemplateLegacy(s);
    expect(viaMain.children[0]!.children.length)
      .toBe(viaLegacy.children[0]!.children.length);
  });
});

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
