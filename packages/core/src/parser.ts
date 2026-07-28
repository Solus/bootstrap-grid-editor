/* Offset-preserving template parser — an adapter over @angular/compiler.

   `@angular/compiler`'s `parseTemplate` gives a real Angular AST: control
   flow (`@if`/`@for`/`@switch`) as genuine nodes, correct interpolation and
   binding edge cases (`{{ a < b }}`), and guaranteed source spans. We walk
   that AST into the same offset-carrying `El` tree the model builder has
   always consumed, so nothing downstream changes.

   Division of labour:
   - Angular owns the tree structure, the source spans, and control flow.
   - `parseOpenTag` (kept from the hand-rolled parser) re-reads each
     element's *attributes* straight from source, so attribute names stay
     byte-identical to what was written (`[ngClass]`, `*ngFor`,
     `[formControl]`) — Angular normalizes those away, but every classifier
     and edit downstream matches on the source form.

   Control flow is **flattened**: a `Template` wrapper (from `*ngIf`/`*ngFor`)
   is unwrapped to its inner element, and `@if`/`@for`/`@switch` blocks lift
   their branch/case/loop/empty elements into the parent. The resulting tree
   is shape-identical to the hand-rolled parser's, so `rowHasControlFlow`
   still flags the block (via `looseText`) and fill still counts branches as
   simultaneous columns — the `~unreliable` pill. Modelling control flow as a
   first-class `CondRegion` is a separate, later decision (see FOLLOW-UPS
   §1.2); it is deliberately not done here. */

import {
  parseTemplate as ngParseTemplate,
  TmplAstElement, TmplAstForLoopBlock, TmplAstIfBlock, TmplAstIfBlockBranch,
  TmplAstSwitchBlock, TmplAstTemplate,
} from '@angular/compiler';
import type { Attr, CondBranchMeta, El, RootEl } from './types.js';
import { hashStr } from './model.js';

export const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

interface OpenTag {
  tag: string;
  attrs: Attr[];
  selfClosing: boolean;
  end: number;
}

/** Any AST node produced by the compiler; we only reach into a few shapes. */
type Node = { sourceSpan?: unknown; children?: Node[] };

/** Per-parse state threaded through the walk: the root (for the `@if` region
    registry) and an occurrence counter for stable region keys. */
interface Ctx {
  root: RootEl;
  occ: Map<string, number>;
}

function newRoot(src: string): RootEl {
  return {
    tag: '#root', attrs: [], children: [], start: 0, end: src.length,
    openEnd: 0, contentStart: 0, contentEnd: src.length, parent: null,
    condRegions: {},
  };
}

export function parseTemplate(src: string): RootEl {
  let parsed;
  try {
    // preserveWhitespaces keeps offsets exact.
    parsed = ngParseTemplate(src, 'template.html', {
      preserveWhitespaces: true,
      preserveLineEndings: true,
    });
  } catch {
    return parseTemplateLegacy(src);
  }
  // On a parse error the compiler yields no usable nodes, whereas the
  // hand-rolled parser recovered a partial tree. Malformed templates (an
  // unclosed tag, a stray `@` in text) must stay tolerant, so fall back.
  if (parsed.errors && parsed.errors.length) {
    return parseTemplateLegacy(src);
  }
  const root = newRoot(src);
  const ctx: Ctx = { root, occ: new Map() };
  root.children = collectElements(parsed.nodes as Node[], root, src, ctx);
  return root;
}

/** Walk a node list into the El children it contributes, flattening control
    flow and unwrapping structural-directive / ng-template wrappers. `@if`
    branches are flattened too, but each branch's top-level elements are
    tagged (`el.cond`) so the model can group them back into a CondRegion. */
function collectElements(nodes: Node[], parent: El, src: string, ctx: Ctx): El[] {
  const out: El[] = [];
  for (const n of nodes) {
    if (n instanceof TmplAstElement) {
      out.push(buildEl(n, parent, src, ctx));
    } else if (n instanceof TmplAstTemplate) {
      const els = collectElements(n.children as unknown as Node[], parent, src, ctx);
      tagNgIf(els, ctx);
      out.push(...els);
    } else if (n instanceof TmplAstIfBlock) {
      out.push(...collectIf(n, parent, src, ctx));
    } else if (n instanceof TmplAstForLoopBlock) {
      out.push(...collectElements(n.children as unknown as Node[], parent, src, ctx));
      if (n.empty) out.push(...collectElements(n.empty.children as unknown as Node[], parent, src, ctx));
    } else if (n instanceof TmplAstSwitchBlock) {
      for (const g of n.groups) out.push(...collectElements(g.children as unknown as Node[], parent, src, ctx));
    }
    // Text, BoundText, comments, @let, deferred blocks, … contribute no
    // element children; they remain in the source gaps that looseText reads.
  }
  return out;
}

/** Flatten an `@if`, tagging each branch's top-level elements with a shared
    region key + branch index, and registering the full branch list (incl.
    empty branches) on the root. Innermost region wins if an element is already
    tagged by a nested `@if` sitting directly inside a branch. */
function collectIf(n: TmplAstIfBlock, parent: El, src: string, ctx: Ctx): El[] {
  const branches: CondBranchMeta[] = n.branches.map((b, index) => ({
    index,
    label: ifBranchLabel(src, b),
    condition: ifBranchCondition(src, b),
  }));
  const key = hashStr(branches.map(b => b.condition ?? '@else').join('|'));
  const occ = ctx.occ.get(key) ?? 0;
  ctx.occ.set(key, occ + 1);
  const region = `${key}:${occ}`;
  ctx.root.condRegions[region] = { region, branches };

  const out: El[] = [];
  n.branches.forEach((b, branch) => {
    const els = collectElements(b.children as unknown as Node[], parent, src, ctx);
    for (const el of els) if (!el.cond) el.cond = { region, branch };
    out.push(...els);
  });
  return out;
}

/** `*ngIf` desugars to a `<ng-template>` wrapper; after unwrapping, the inner
    element keeps its `*ngIf` attribute. Model it like a bare `@if` — a single-
    branch region — so the frontend boxes it with a show/hide toggle. `*ngFor`
    and plain `<ng-template>` carry no `*ngIf` attr and stay flattened. Only the
    boolean condition is modeled; a `; else tpl` / `; then tpl` reference is
    dropped (the detached template stays flat, as today). */
function tagNgIf(els: El[], ctx: Ctx): void {
  for (const el of els) {
    if (el.cond) continue;                    // already a branch of an inline @if
    const attr = el.attrs.find(a => a.name.toLowerCase() === '*ngif');
    if (!attr) continue;
    const condition = (attr.value ?? '').split(';')[0]!.trim();
    const key = hashStr('*ngIf|' + condition);
    const occ = ctx.occ.get(key) ?? 0;
    ctx.occ.set(key, occ + 1);
    const region = `${key}:${occ}`;
    ctx.root.condRegions[region] = {
      region,
      branches: [{ index: 0, label: `*ngIf (${condition})`, condition }],
      structural: true,   // the `*ngIf` attr rides on the element — no braces
    };
    el.cond = { region, branch: 0 };
  }
}

/** The branch header without the trailing `{`, e.g. `@if (x)`, `@else if (y)`,
    `@else`. `startSourceSpan` covers exactly that header. */
function ifBranchLabel(src: string, b: TmplAstIfBlockBranch): string {
  return src.slice(b.startSourceSpan.start.offset, b.startSourceSpan.end.offset)
    .replace(/\s*\{?\s*$/, '').trim();
}

/** The condition text, or null for the bare `@else`. */
function ifBranchCondition(src: string, b: TmplAstIfBlockBranch): string | null {
  if (b.expression == null) return null;
  const raw = src.slice(b.startSourceSpan.start.offset, b.startSourceSpan.end.offset);
  const m = /\(([\s\S]*)\)\s*\{?\s*$/.exec(raw);
  return m ? m[1]!.trim() : null;
}

function buildEl(node: TmplAstElement, parent: El, src: string, ctx: Ctx): El {
  const start = node.sourceSpan.start.offset;
  const openEnd = node.startSourceSpan.end.offset;
  const end = node.sourceSpan.end.offset;
  // A real closing tag sits after the open tag; without one (void or
  // self-closing) the content span collapses to the end of the open tag.
  const hasClose = node.endSourceSpan != null && node.endSourceSpan.start.offset > openEnd;
  const contentEnd = hasClose ? node.endSourceSpan!.start.offset : openEnd;

  // Re-read tag + attributes from source for byte-identical names/spans.
  const open = parseOpenTag(src, start);
  const el: El = {
    tag: open ? open.tag : node.name,
    attrs: open ? open.attrs : [],
    children: [],
    start, openEnd, end,
    contentStart: openEnd, contentEnd,
    selfClosing: open ? open.selfClosing : false,
    parent,
  };
  el.children = collectElements(node.children as unknown as Node[], el, src, ctx);
  return el;
}

/* Parse one opening tag starting at `start` ('<'). Quote-aware so Angular
   bindings like [disabled]="a > b" don't break tag-end detection. */
export function parseOpenTag(src: string, start: number): OpenTag | null {
  let i = start + 1;
  const nameM = /^[A-Za-z][^\s/>]*/.exec(src.slice(i));
  if (!nameM) return null;
  const tag = nameM[0];
  i += tag.length;
  const attrs: Attr[] = [];
  let selfClosing = false;

  while (i < src.length) {
    // skip whitespace
    while (i < src.length && /\s/.test(src[i]!)) i++;
    if (i >= src.length) break;
    const ch = src[i];
    if (ch === '>') { i++; return { tag, attrs, selfClosing, end: i }; }
    if (ch === '/' && src[i + 1] === '>') { selfClosing = true; i += 2; return { tag, attrs, selfClosing, end: i }; }
    // attribute name: anything up to ws, '=', '>' ( '/' allowed only as part of '/>' )
    const ns = i;
    while (i < src.length && !/[\s=>]/.test(src[i]!)) {
      if (src[i] === '/' && src[i + 1] === '>') break;
      i++;
    }
    const name = src.slice(ns, i);
    if (!name) { i++; continue; }
    const attr: Attr = { name, valueStart: -1, valueEnd: -1, value: null, quote: '' };
    // skip ws before possible '='
    let j = i;
    while (j < src.length && /\s/.test(src[j]!)) j++;
    if (src[j] === '=') {
      j++;
      while (j < src.length && /\s/.test(src[j]!)) j++;
      const q = src[j];
      if (q === '"' || q === "'") {
        const vEnd = src.indexOf(q, j + 1);
        attr.quote = q;
        attr.valueStart = j + 1;
        attr.valueEnd = vEnd < 0 ? src.length : vEnd;
        attr.value = src.slice(attr.valueStart, attr.valueEnd);
        i = (vEnd < 0 ? src.length : vEnd + 1);
      } else {
        // unquoted value
        let ve = j;
        while (ve < src.length && !/[\s>]/.test(src[ve]!)) ve++;
        attr.quote = '';
        attr.valueStart = j; attr.valueEnd = ve;
        attr.value = src.slice(j, ve);
        i = ve;
      }
    }
    attrs.push(attr);
  }
  return { tag, attrs, selfClosing, end: i };
}

/* Tolerant fallback: the original hand-rolled tree walk, used when
   @angular/compiler reports a parse error (unclosed/mismatched tags, a
   stray `@` in text, …). Best-effort structure over broken markup, matching
   the pre-swap behavior exactly. */
export function parseTemplateLegacy(src: string): RootEl {
  const root = newRoot(src);
  const stack: El[] = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    i = lt;
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i);
      i = e < 0 ? src.length : e + 3;
      continue;
    }
    if (src[i + 1] === '!' || src[i + 1] === '?') {
      const gt = src.indexOf('>', i);
      i = gt < 0 ? src.length : gt + 1;
      continue;
    }
    if (src[i + 1] === '/') {
      const gt = src.indexOf('>', i);
      if (gt < 0) break;
      const name = src.slice(i + 2, gt).trim().toLowerCase();
      let k = stack.length - 1;
      while (k > 0 && stack[k]!.tag.toLowerCase() !== name) k--;
      if (k > 0) {
        // implicitly close inner unclosed elements at position i
        while (stack.length - 1 > k) {
          const inner = stack.pop()!;
          inner.contentEnd = i; inner.end = i;
        }
        const el = stack.pop()!;
        el.contentEnd = i;
        el.end = gt + 1;
      }
      i = gt + 1;
      continue;
    }
    const parsed = parseOpenTag(src, i);
    if (!parsed) { i++; continue; }
    const el: El = {
      tag: parsed.tag, attrs: parsed.attrs, children: [],
      start: i, openEnd: parsed.end, end: parsed.end,
      contentStart: parsed.end, contentEnd: parsed.end,
      selfClosing: parsed.selfClosing, parent: stack[stack.length - 1]!,
    };
    stack[stack.length - 1]!.children.push(el);
    if (!parsed.selfClosing && !VOID_TAGS.has(parsed.tag.toLowerCase())) {
      stack.push(el);
    }
    i = parsed.end;
  }
  while (stack.length > 1) {
    const el = stack.pop()!;
    el.contentEnd = src.length; el.end = src.length;
  }
  return root;
}
