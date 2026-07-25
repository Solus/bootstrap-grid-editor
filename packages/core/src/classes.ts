/* Class-attribute reading and Bootstrap grid-token math.

   Both dialects are understood and, crucially, *preserved* on edit:
     BS4/5: col-6, col-md-4, offset-2, offset-md-3
     BS3:   col-xs-6, col-sm-offset-4, col-md-offset-2 */

import type { Attr, Breakpoint, ColSpec, El, WidthValue } from './types.js';

export const BPS: Breakpoint[] = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'];

export const BP_LABEL: Record<Breakpoint, string> = {
  xs: '<576px', sm: '≥576px', md: '≥768px',
  lg: '≥992px', xl: '≥1200px', xxl: '≥1400px',
};

/* ── attribute helpers ───────────────────────────────────────────── */

export function getAttr(el: El, name: string): Attr | null {
  const lower = name.toLowerCase();
  return el.attrs.find(a => a.name.toLowerCase() === lower) ?? null;
}

export function classValue(el: El): string {
  const a = getAttr(el, 'class');
  return a && a.value != null ? a.value : '';
}

export function classTokens(el: El): string[] {
  const v = classValue(el).trim();
  return v ? v.split(/\s+/) : [];
}

export function hasClass(el: El, name: string): boolean {
  return classTokens(el).includes(name);
}

export function hasDynamicClassBinding(el: El): boolean {
  return el.attrs.some(a => {
    const n = a.name.toLowerCase();
    return n === '[ngclass]' || n === 'ngclass' || n === '[class]' || n.startsWith('[class.');
  });
}

export function classIsInterpolated(el: El): boolean {
  return classValue(el).includes('{{');
}

/* ── reading grid tokens ─────────────────────────────────────────── */

/** Extract the declared widths and offsets from a token list.
    Width values are 1–12 | 'auto' | 'equal' (a bare `col` / `col-md`). */
export function colSpec(tokens: string[]): ColSpec {
  const spec: ColSpec = { width: {}, offset: {} };
  for (const t of tokens) {
    let m = /^col-(xs|sm|md|lg|xl|xxl)-offset-(\d{1,2})$/.exec(t);   // BS3 offset
    if (m) { spec.offset[m[1] as Breakpoint] = parseInt(m[2]!, 10); continue; }
    m = /^col-xs(?:-(\d{1,2}|auto))?$/.exec(t);                      // BS3 xs width
    if (m) {
      spec.width.xs = m[1] == null ? 'equal' : (m[1] === 'auto' ? 'auto' : parseInt(m[1], 10));
      continue;
    }
    m = /^col(?:-(sm|md|lg|xl|xxl))?(?:-(\d{1,2}|auto))?$/.exec(t);
    if (m) {
      const bp = (m[1] ?? 'xs') as Breakpoint;
      spec.width[bp] = m[2] == null ? 'equal' : (m[2] === 'auto' ? 'auto' : parseInt(m[2], 10));
      continue;
    }
    m = /^offset(?:-(sm|md|lg|xl|xxl))?-(\d{1,2})$/.exec(t);         // BS4/5 offset
    if (m) {
      spec.offset[(m[1] ?? 'xs') as Breakpoint] = parseInt(m[2]!, 10);
      continue;
    }
    // d-* display utilities: only none-vs-visible matters for the grid
    m = /^d-(?:(sm|md|lg|xl|xxl)-)?(none|inline|inline-block|block|flex|inline-flex|grid|table|table-cell|table-row|contents)$/.exec(t);
    if (m) {
      (spec.display ??= {})[(m[1] ?? 'xs') as Breakpoint] = m[2] !== 'none';
    }
  }
  return spec;
}

/** Is this column hidden at `bp` by a `d-*` utility? Mobile-first: the nearest
    `d-*` at or below `bp` decides — `d-none` hides, anything else (or nothing)
    shows. A hidden column occupies no grid width at that breakpoint. */
export function isHiddenAt(spec: ColSpec, bp: Breakpoint): boolean {
  return effectiveAt(spec.display ?? {}, bp) === false;
}

export function isColTokens(tokens: string[]): boolean {
  return tokens.some(t => /^col(-|$)/.test(t) || /^offset(-|$)/.test(t));
}

/** Which breakpoint does this token set the *width* for? (null = neither) */
export function widthTokenBp(t: string): Breakpoint | null {
  if (/^col-(xs|sm|md|lg|xl|xxl)-offset-\d{1,2}$/.test(t)) return null;  // offset, not width
  let m = /^col-xs(?:-(\d{1,2}|auto))?$/.exec(t);
  if (m) return 'xs';
  m = /^col(?:-(sm|md|lg|xl|xxl))?(?:-(\d{1,2}|auto))?$/.exec(t);
  if (m) return (m[1] ?? 'xs') as Breakpoint;
  return null;
}

export function offsetTokenBp(t: string): Breakpoint | null {
  let m = /^col-(xs|sm|md|lg|xl|xxl)-offset-(\d{1,2})$/.exec(t);
  if (m) return m[1] as Breakpoint;
  m = /^offset(?:-(sm|md|lg|xl|xxl))?-(\d{1,2})$/.exec(t);
  if (m) return (m[1] ?? 'xs') as Breakpoint;
  return null;
}

/** Does this token list look like Bootstrap 3? */
export function usesBs3(tokens: string[]): boolean {
  return tokens.some(t => /^col-xs(-|$)/.test(t) ||
                          /^col-(xs|sm|md|lg|xl|xxl)-offset-\d/.test(t));
}

/* ── writing grid tokens ─────────────────────────────────────────── */

/** Rebuild the token list with the width token for `bp` set to `val`
    (1–12, 'auto', 'equal', or null to remove). Preserves the other
    tokens, the token's position, and its BS3/BS4+ dialect. */
export function setWidthToken(
  tokens: string[], bp: Breakpoint, val: WidthValue | null, bs3Hint?: boolean,
): string[] {
  const isW = (t: string) => widthTokenBp(t) === bp;
  const idx = tokens.findIndex(isW);
  const oldTok = idx >= 0 ? tokens[idx]! : null;
  const bs3 = oldTok ? /^col-xs/.test(oldTok)
                     : (bp === 'xs' && (usesBs3(tokens) || !!bs3Hint));
  let newTok: string | null = null;
  if (val != null) {
    if (bp === 'xs') {
      newTok = bs3
        ? (val === 'equal' ? 'col-xs' : `col-xs-${val}`)
        : (val === 'equal' ? 'col' : `col-${val}`);
    } else {
      newTok = val === 'equal' ? `col-${bp}` : `col-${bp}-${val}`;
    }
  }
  const out = tokens.filter(t => !isW(t));
  if (newTok != null) {
    if (idx >= 0) out.splice(Math.min(idx, out.length), 0, newTok);
    else {
      let last = -1;
      out.forEach((t, i2) => { if (/^col(-|$)/.test(t)) last = i2; });
      if (last >= 0) out.splice(last + 1, 0, newTok); else out.push(newTok);
    }
  }
  return out;
}

/** As setWidthToken, for offsets. `keepZero` writes an explicit
    `offset-*-0` so an inherited nonzero offset can be cancelled;
    without it, 0 means "remove the token". */
export function setOffsetToken(
  tokens: string[], bp: Breakpoint, val: number | null,
  bs3Hint?: boolean, keepZero?: boolean,
): string[] {
  const isO = (t: string) => offsetTokenBp(t) === bp;
  const idx = tokens.findIndex(isO);
  const oldTok = idx >= 0 ? tokens[idx]! : null;
  const bs3 = oldTok ? /^col-/.test(oldTok) : (usesBs3(tokens) || !!bs3Hint);
  const remove = val == null || (val === 0 && !keepZero);
  const newTok = remove ? null
    : bs3 ? `col-${bp}-offset-${val}`
    : (bp === 'xs' ? `offset-${val}` : `offset-${bp}-${val}`);
  const out = tokens.filter(t => !isO(t));
  if (newTok != null) {
    if (idx >= 0) out.splice(Math.min(idx, out.length), 0, newTok);
    else out.push(newTok);
  }
  return out;
}

/* ── the mobile-first cascade ────────────────────────────────────── */

/** Effective value at `bp`, falling back down the cascade; null if none. */
export function effectiveAt<T>(map: Partial<Record<Breakpoint, T>>, bp: Breakpoint): T | null {
  for (let i = BPS.indexOf(bp); i >= 0; i--) {
    const v = map[BPS[i]!];
    if (v !== undefined) return v;
  }
  return null;
}

/** Which breakpoint's token actually produces the effective value at `bp`.
    This is the token a width edit must target — editing at a breakpoint the
    element doesn't declare would otherwise create an override by accident. */
export function definingBp(
  map: Partial<Record<Breakpoint, unknown>>, bp: Breakpoint,
): Breakpoint | null {
  for (let i = BPS.indexOf(bp); i >= 0; i--) {
    if (map[BPS[i]!] !== undefined) return BPS[i]!;
  }
  return null;
}

/* ── splitting ───────────────────────────────────────────────────── */

/** Halve one numeric width token, preserving its exact format and dialect:
    col-sm-6 → col-sm-3, col-xs-8 → col-xs-4. Non-numeric tokens
    (col, col-md, col-auto) are returned unchanged. */
export function halveWidthTokenStr(t: string, mode: 'ceil' | 'floor'): string {
  const m = /^(.*-)(\d{1,2})$/.exec(t);
  if (!m) return t;
  const v = parseInt(m[2]!, 10);
  const h = Math.max(1, mode === 'ceil' ? Math.ceil(v / 2) : Math.floor(v / 2));
  return m[1]! + h;
}

/** The width tokens of a class list, halved (offsets and other classes dropped). */
export function halvedWidthTokens(tokens: string[], mode: 'ceil' | 'floor'): string[] {
  return tokens.filter(t => widthTokenBp(t) != null)
               .map(t => halveWidthTokenStr(t, mode));
}
