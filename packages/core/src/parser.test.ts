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

/* `@if` is modeled as a CondRegion (only the active branch's cols appear);
   `@for`/`@switch`/`*ngFor` still flatten. The legacy fallback agrees on the
   flattened shape. */
describe('control-flow (Angular path)', () => {
  it('@if/@else becomes a CondRegion; only the active branch column shows', () => {
    const s = `<div class="row">@if (x) { <div class="col-6">a</div> } @else { <div class="col-4">b</div> }</div>`;
    const row = buildModel(parseTemplate(s))[0]!;
    // default active branch 0 → only the @if branch's col
    expect(row.cols.length).toBe(1);
    expect(row.cols[0]!.el.attrs.find(a => a.name === 'class')!.value).toBe('col-6');
    expect(row.conds).toHaveLength(1);
    expect(row.conds![0]!.branches.map(b => b.condition)).toEqual(['x', null]);
    // selecting the else branch swaps which col is shown
    const elseRow = buildModel(parseTemplate(s), { [row.conds![0]!.region]: 1 })[0]!;
    expect(elseRow.cols[0]!.el.attrs.find(a => a.name === 'class')!.value).toBe('col-4');
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

describe('@if region tagging', () => {
  // find every element in the tree that carries a cond tag (innermost one —
  // the enclosing chain is asserted separately, in the nesting cases)
  function tagged(root: ReturnType<typeof parseTemplate>) {
    const out: { region: string; branch: number; cls: string }[] = [];
    const walk = (el: any) => {
      const t = el.condPath?.[el.condPath.length - 1];
      if (t) out.push({ region: t.region, branch: t.branch, cls: el.cls ?? '' });
      el.children?.forEach(walk);
    };
    root.children.forEach(walk);
    return out;
  }

  it('registers a two-branch region and tags each branch element', () => {
    const s = `<div class="row">
      @if (a) { <div class="col-6">A</div> }
      @else { <div class="col-4">B</div> }
    </div>`;
    const root = parseTemplate(s);
    const regions = Object.values(root.condRegions);
    expect(regions.length).toBe(1);
    const reg = regions[0]!;
    expect(reg.branches.map(b => b.condition)).toEqual(['a', null]);
    expect(reg.branches.map(b => b.label)).toEqual(['@if (a)', '@else']);

    const tags = tagged(root);
    expect(tags.map(t => t.branch)).toEqual([0, 1]);
    expect(tags.every(t => t.region === reg.region)).toBe(true);
    // a block @if is NOT structural — its braces surround the element
    expect(reg.structural).toBeFalsy();
  });

  it('models @else if as three branches with conditions', () => {
    const s = `<div class="row">
      @if (a) { <div class="col-6">A</div> }
      @else if (b) { <div class="col-4">B</div> }
      @else { <div class="col-2">C</div> }
    </div>`;
    const reg = Object.values(parseTemplate(s).condRegions)[0]!;
    expect(reg.branches.length).toBe(3);
    expect(reg.branches.map(b => b.condition)).toEqual(['a', 'b', null]);
    expect(reg.branches.map(b => b.label)).toEqual(['@if (a)', '@else if (b)', '@else']);
  });

  it('a no-@else @if is a single-branch region', () => {
    const s = `<div class="row">@if (x) { <div class="col-6">A</div> }</div>`;
    const reg = Object.values(parseTemplate(s).condRegions)[0]!;
    expect(reg.branches.length).toBe(1);
    expect(reg.branches[0]!.condition).toBe('x');
  });

  it('records an empty branch in the registry even though it tags no element', () => {
    const s = `<div class="row">
      @if (a) { <div class="col-6">A</div> }
      @else { }
    </div>`;
    const root = parseTemplate(s);
    const reg = Object.values(root.condRegions)[0]!;
    expect(reg.branches.length).toBe(2);
    // only the non-empty branch contributed a tagged element
    expect(tagged(root).map(t => t.branch)).toEqual([0]);
  });

  it('gives nested @if its own region key', () => {
    const s = `<div class="col-6">
      @if (a) {
        <div class="row">
          @if (b) { <div class="col-4">B</div> }
          @else { <div class="col-8">C</div> }
        </div>
      }
    </div>`;
    const root = parseTemplate(s);
    const keys = Object.keys(root.condRegions);
    expect(keys.length).toBe(2);
    expect(new Set(keys).size).toBe(2); // distinct
  });

  it('an @if directly inside a branch nests: condPath is outermost-first', () => {
    // Both blocks live at the same level of the element tree (the parser
    // flattens branches into siblings), so the *chain* is the only record that
    // col-6 is inside `@if (a)` as well as `@if (b)`.
    const s = `<div class="row">
      @if (a) {
        @if (b) { <div class="col-6">A</div> }
        <div class="col-3">B</div>
      } @else { <div class="col-12">C</div> }
    </div>`;
    const root = parseTemplate(s);
    const outer = Object.values(root.condRegions).find(r => r.branches.length === 2)!;
    const inner = Object.values(root.condRegions).find(r => r.branches.length === 1)!;
    const [a, b, c] = root.children[0]!.children;

    expect(a!.condPath).toEqual([
      { region: outer.region, branch: 0 },     // outermost first…
      { region: inner.region, branch: 0 },     // …then the nested one
    ]);
    expect(b!.condPath).toEqual([{ region: outer.region, branch: 0 }]);
    expect(c!.condPath).toEqual([{ region: outer.region, branch: 1 }]);
  });

  it('an @if nested in an @else branch records that branch in the chain', () => {
    const s = `<div class="row">
      @if (a) { <div class="col-3">B</div> }
      @else {
        @if (b) { <div class="col-6">A</div> }
        <div class="col-12">C</div>
      }
    </div>`;
    const root = parseTemplate(s);
    const outer = Object.values(root.condRegions).find(r => r.branches.length === 2)!;
    const nested = root.children[0]!.children[1]!;
    expect(nested.condPath![0]).toEqual({ region: outer.region, branch: 1 });
    expect(nested.condPath!.length).toBe(2);
  });

  it('*ngIf on an element inside an @if branch keeps both links', () => {
    const s = `<div class="row">
      @if (a) { <div class="col-6" *ngIf="b">A</div> }
    </div>`;
    const root = parseTemplate(s);
    const path = root.children[0]!.children[0]!.condPath!;
    expect(path.length).toBe(2);
    // the block is the outer link, the structural *ngIf the inner one
    expect(root.condRegions[path[0]!.region]!.structural).toBeFalsy();
    expect(root.condRegions[path[1]!.region]!.structural).toBe(true);
  });

  it('models a column *ngIf as a single-branch region (like a bare @if)', () => {
    const s = `<div class="row">
      <div class="col-6">head</div>
      <div class="col-6" *ngIf="hasWarning"><warn-banner></warn-banner></div>
    </div>`;
    const root = parseTemplate(s);
    const regs = Object.values(root.condRegions);
    expect(regs.length).toBe(1);
    expect(regs[0]!.branches.length).toBe(1);
    expect(regs[0]!.branches[0]!.condition).toBe('hasWarning');
    expect(regs[0]!.branches[0]!.label).toBe('*ngIf (hasWarning)');
    // marked structural: the condition rides on the element, so it moves freely
    expect(regs[0]!.structural).toBe(true);
    // only the *ngIf column is tagged; the plain column is not
    expect(tagged(root).map(t => t.branch)).toEqual([0]);
  });

  it('drops the `; else tpl` reference, modeling only the boolean condition', () => {
    const s = `<div class="row"><div class="col-6" *ngIf="ready; else tpl">x</div></div>`;
    const reg = Object.values(parseTemplate(s).condRegions)[0]!;
    expect(reg.branches[0]!.condition).toBe('ready');
  });

  it('leaves *ngFor flattened (no region)', () => {
    const s = `<div class="row"><div class="col-4" *ngFor="let x of xs">{{x}}</div></div>`;
    expect(Object.keys(parseTemplate(s).condRegions).length).toBe(0);
  });

  it('region key is content-derived: stable across a column edit, changes on a condition edit', () => {
    const key = (s: string) => Object.keys(parseTemplate(s).condRegions)[0]!;
    const base = `<div class="row">@if (a) { <div class="col-6">A</div> } @else { <div class="col-4">B</div> }</div>`;
    const editedCol = `<div class="row">@if (a) { <div class="col-8">A</div> } @else { <div class="col-4">B</div> }</div>`;
    const editedCond = `<div class="row">@if (z) { <div class="col-6">A</div> } @else { <div class="col-4">B</div> }</div>`;
    expect(key(editedCol)).toBe(key(base));      // column width change → same region
    expect(key(editedCond)).not.toBe(key(base)); // condition change → new region
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
