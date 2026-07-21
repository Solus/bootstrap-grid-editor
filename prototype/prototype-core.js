
/* ═══════════════════════════════════════════════════════════════════
   CORE — pure functions, no DOM. Offset-preserving template parser,
   grid model, class-token math and text-splice edit operations.
   ═══════════════════════════════════════════════════════════════════ */

const VOID_TAGS = new Set(['area','base','br','col','embed','hr','img','input',
  'link','meta','param','source','track','wbr']);

/* Parse HTML-ish Angular template text into an element tree where every
   element remembers exact source offsets, so edits can be surgical.
   Tolerant of unclosed/mismatched tags. */
function parseTemplate2(src){
  const root = {tag:'#root', attrs:[], children:[], start:0, end:src.length,
                contentStart:0, contentEnd:src.length, parent:null};
  const stack = [root];
  let i = 0;
  while(i < src.length){
    const lt = src.indexOf('<', i);
    if(lt < 0) break;
    i = lt;
    if(src.startsWith('<!--', i)){
      const e = src.indexOf('-->', i);
      i = e < 0 ? src.length : e + 3;
      continue;
    }
    if(src[i+1] === '!' || src[i+1] === '?'){
      const gt = src.indexOf('>', i);
      i = gt < 0 ? src.length : gt + 1;
      continue;
    }
    if(src[i+1] === '/'){
      const gt = src.indexOf('>', i);
      if(gt < 0){ break; }
      const name = src.slice(i+2, gt).trim().toLowerCase();
      let k = stack.length - 1;
      while(k > 0 && stack[k].tag.toLowerCase() !== name) k--;
      if(k > 0){
        // implicitly close inner unclosed elements at position i
        while(stack.length - 1 > k){
          const inner = stack.pop();
          inner.contentEnd = i; inner.end = i;
        }
        const el = stack.pop();
        el.contentEnd = i;
        el.end = gt + 1;
      }
      i = gt + 1;
      continue;
    }
    const parsed = parseOpenTag(src, i);
    if(!parsed){ i++; continue; }
    const el = {
      tag: parsed.tag, attrs: parsed.attrs, children: [],
      start: i, openEnd: parsed.end, end: parsed.end,
      contentStart: parsed.end, contentEnd: parsed.end,
      selfClosing: parsed.selfClosing, parent: stack[stack.length-1]
    };
    stack[stack.length-1].children.push(el);
    if(!parsed.selfClosing && !VOID_TAGS.has(parsed.tag.toLowerCase())){
      stack.push(el);
    }
    i = parsed.end;
  }
  while(stack.length > 1){
    const el = stack.pop();
    el.contentEnd = src.length; el.end = src.length;
  }
  return root;
}

/* Parse one opening tag starting at `start` ('<'). Quote-aware so Angular
   bindings like [disabled]="a > b" don't break tag-end detection. */
function parseOpenTag(src, start){
  let i = start + 1;
  const nameM = /^[A-Za-z][^\s/>]*/.exec(src.slice(i));
  if(!nameM) return null;
  const tag = nameM[0];
  i += tag.length;
  const attrs = [];
  let selfClosing = false;

  while(i < src.length){
    // skip whitespace
    while(i < src.length && /\s/.test(src[i])) i++;
    if(i >= src.length) break;
    const ch = src[i];
    if(ch === '>'){ i++; return {tag, attrs, selfClosing, end:i}; }
    if(ch === '/' && src[i+1] === '>'){ selfClosing = true; i += 2; return {tag, attrs, selfClosing, end:i}; }
    // attribute name: anything up to ws, '=', '>' ( '/' allowed only as part of '/>' )
    let ns = i;
    while(i < src.length && !/[\s=>]/.test(src[i])){
      if(src[i] === '/' && src[i+1] === '>') break;
      i++;
    }
    const name = src.slice(ns, i);
    if(!name){ i++; continue; }
    const attr = {name, valueStart:-1, valueEnd:-1, value:null, quote:''};
    // skip ws before possible '='
    let j = i;
    while(j < src.length && /\s/.test(src[j])) j++;
    if(src[j] === '='){
      j++;
      while(j < src.length && /\s/.test(src[j])) j++;
      const q = src[j];
      if(q === '"' || q === "'"){
        const vEnd = src.indexOf(q, j+1);
        attr.quote = q;
        attr.valueStart = j + 1;
        attr.valueEnd = vEnd < 0 ? src.length : vEnd;
        attr.value = src.slice(attr.valueStart, attr.valueEnd);
        i = (vEnd < 0 ? src.length : vEnd + 1);
      }else{
        // unquoted value
        let ve = j;
        while(ve < src.length && !/[\s>]/.test(src[ve])) ve++;
        attr.quote = '';
        attr.valueStart = j; attr.valueEnd = ve;
        attr.value = src.slice(j, ve);
        i = ve;
      }
    }
    attrs.push(attr);
  }
  return {tag, attrs, selfClosing, end:i};
}

/* ── class helpers ─────────────────────────────────────────────── */

function getAttr(el, name){
  const lower = name.toLowerCase();
  return el.attrs.find(a => a.name.toLowerCase() === lower) || null;
}
function classValue(el){
  const a = getAttr(el, 'class');
  return a && a.value != null ? a.value : '';
}
function classTokens(el){
  const v = classValue(el).trim();
  return v ? v.split(/\s+/) : [];
}
function hasClass(el, name){
  return classTokens(el).includes(name);
}
function hasDynamicClassBinding(el){
  return el.attrs.some(a => {
    const n = a.name.toLowerCase();
    return n === '[ngclass]' || n === 'ngclass' || n === '[class]' || n.startsWith('[class.');
  });
}
function classIsInterpolated(el){
  return classValue(el).includes('{{');
}

const BPS = ['xs','sm','md','lg','xl','xxl'];
const BP_LABEL = {xs:'<576px', sm:'≥576px', md:'≥768px', lg:'≥992px', xl:'≥1200px', xxl:'≥1400px'};

/* Extract {width:{bp:val}, offset:{bp:n}} from class tokens.
   val: 1–12 | 'auto' | 'equal' (bare col / col-md)
   Understands both dialects:
     BS4/5: col-6, col-md-4, offset-2, offset-md-3
     BS3:   col-xs-6, col-sm-offset-4, col-md-offset-2 */
function colSpec(tokens){
  const spec = {width:{}, offset:{}};
  for(const t of tokens){
    let m = /^col-(xs|sm|md|lg|xl|xxl)-offset-(\d{1,2})$/.exec(t);   // BS3 offset
    if(m){ spec.offset[m[1]] = parseInt(m[2],10); continue; }
    m = /^col-xs(?:-(\d{1,2}|auto))?$/.exec(t);                      // BS3 xs width
    if(m){
      spec.width.xs = m[1] == null ? 'equal' : (m[1] === 'auto' ? 'auto' : parseInt(m[1],10));
      continue;
    }
    m = /^col(?:-(sm|md|lg|xl|xxl))?(?:-(\d{1,2}|auto))?$/.exec(t);
    if(m){
      const bp = m[1] || 'xs';
      spec.width[bp] = m[2] == null ? 'equal' : (m[2] === 'auto' ? 'auto' : parseInt(m[2],10));
      continue;
    }
    m = /^offset(?:-(sm|md|lg|xl|xxl))?-(\d{1,2})$/.exec(t);         // BS4/5 offset
    if(m){
      spec.offset[m[1] || 'xs'] = parseInt(m[2],10);
    }
  }
  return spec;
}
function isColTokens(tokens){
  return tokens.some(t => /^col(-|$)/.test(t) || /^offset(-|$)/.test(t));
}

/* Which breakpoint does this token set width/offset for? (null = neither) */
function widthTokenBp(t){
  if(/^col-(xs|sm|md|lg|xl|xxl)-offset-\d{1,2}$/.test(t)) return null;  // offset, not width
  let m = /^col-xs(?:-(\d{1,2}|auto))?$/.exec(t);
  if(m) return 'xs';
  m = /^col(?:-(sm|md|lg|xl|xxl))?(?:-(\d{1,2}|auto))?$/.exec(t);
  if(m) return m[1] || 'xs';
  return null;
}
function offsetTokenBp(t){
  let m = /^col-(xs|sm|md|lg|xl|xxl)-offset-(\d{1,2})$/.exec(t);
  if(m) return m[1];
  m = /^offset(?:-(sm|md|lg|xl|xxl))?-(\d{1,2})$/.exec(t);
  if(m) return m[1] || 'xs';
  return null;
}
/* Does this token list look like Bootstrap 3? */
function usesBs3(tokens){
  return tokens.some(t => /^col-xs(-|$)/.test(t) ||
                          /^col-(xs|sm|md|lg|xl|xxl)-offset-\d/.test(t));
}

/* Rebuild the class string with the width token for `bp` set to `val`
   (1–12, 'auto', 'equal', or null to remove). Preserves other tokens,
   the token's position, and its BS3/BS4+ dialect. */
function setWidthToken(tokens, bp, val, bs3Hint){
  const isW = t => widthTokenBp(t) === bp;
  const idx = tokens.findIndex(isW);
  const oldTok = idx >= 0 ? tokens[idx] : null;
  const bs3 = oldTok ? /^col-xs/.test(oldTok)
                     : (bp === 'xs' && (usesBs3(tokens) || !!bs3Hint));
  let newTok = null;
  if(val != null){
    if(bp === 'xs'){
      newTok = bs3
        ? (val === 'equal' ? 'col-xs' : `col-xs-${val}`)
        : (val === 'equal' ? 'col' : `col-${val}`);
    }else{
      newTok = val === 'equal' ? `col-${bp}` : `col-${bp}-${val}`;
    }
  }
  const out = tokens.filter(t => !isW(t));
  if(newTok != null){
    if(idx >= 0) out.splice(Math.min(idx, out.length), 0, newTok);
    else{
      let last = -1;
      out.forEach((t,i2) => { if(/^col(-|$)/.test(t)) last = i2; });
      if(last >= 0) out.splice(last + 1, 0, newTok); else out.push(newTok);
    }
  }
  return out;
}
function setOffsetToken(tokens, bp, val, bs3Hint, keepZero){
  const isO = t => offsetTokenBp(t) === bp;
  const idx = tokens.findIndex(isO);
  const oldTok = idx >= 0 ? tokens[idx] : null;
  const bs3 = oldTok ? /^col-/.test(oldTok) : (usesBs3(tokens) || !!bs3Hint);
  // 0 normally means "remove the token"; keepZero writes an explicit
  // offset-*-0 so an inherited nonzero offset can be cancelled.
  const remove = val == null || (val === 0 && !keepZero);
  const newTok = remove ? null
    : bs3 ? `col-${bp}-offset-${val}`
    : (bp === 'xs' ? `offset-${val}` : `offset-${bp}-${val}`);
  const out = tokens.filter(t => !isO(t));
  if(newTok != null){
    if(idx >= 0) out.splice(Math.min(idx, out.length), 0, newTok);
    else out.push(newTok);
  }
  return out;
}

/* effective value at breakpoint bp with mobile-first cascade; null if none */
function effectiveAt(map, bp){
  for(let i = BPS.indexOf(bp); i >= 0; i--){
    if(map[BPS[i]] !== undefined) return map[BPS[i]];
  }
  return null;
}

/* which breakpoint's token produces the effective value at bp (null if none) */
function definingBp(map, bp){
  for(let i = BPS.indexOf(bp); i >= 0; i--){
    if(map[BPS[i]] !== undefined) return BPS[i];
  }
  return null;
}

/* Halve one numeric width token, preserving its exact format/dialect:
   col-sm-6 → col-sm-3, col-xs-8 → col-xs-4. Non-numeric (col, col-md,
   col-auto) returned unchanged. mode: 'ceil' (first half) | 'floor'. */
function halveWidthTokenStr(t, mode){
  const m = /^(.*-)(\d{1,2})$/.exec(t);
  if(!m) return t;
  const v = parseInt(m[2],10);
  const h = Math.max(1, mode === 'ceil' ? Math.ceil(v/2) : Math.floor(v/2));
  return m[1] + h;
}

/* The width tokens of a class list, halved (offsets and other classes dropped). */
function halvedWidthTokens(tokens, mode){
  return tokens.filter(t => widthTokenBp(t) != null)
               .map(t => halveWidthTokenStr(t, mode));
}

/* ── grid model ────────────────────────────────────────────────── */

function isRowEl(el){
  return hasClass(el, 'row') || hasClass(el, 'form-row');
}

/* Collect rows whose nearest grid ancestor is `el` (stops at rows). */
function findRows(el, out){
  for(const c of el.children){
    if(isRowEl(c)) out.push(buildRow(c));
    else findRows(c, out);
  }
  return out;
}
function buildRow(el){
  const cols = el.children.map(buildCol);
  return {kind:'row', el, cols};
}
function buildCol(el){
  const tokens = classTokens(el);
  return {
    kind:'col', el,
    spec: colSpec(tokens),
    isCol: isColTokens(tokens),
    nestedRows: findRows(el, [])
  };
}
function buildModel(root){
  return findRows(root, []);
}

/* A "container" column is structural scaffolding: it leads to nested rows,
   every element child is a row, a heading (legend/h1-h6 as section title),
   a spacer (br/hr), or a wrapper whose subtree contains rows (panel
   sections, fieldsets, ng-container...), and it has no loose content text. */
function isHeadingEl(el){
  return /^(legend|h[1-6])$/i.test(el.tag);
}
function isSpacerEl(el){
  return /^(br|hr)$/i.test(el.tag);
}
function subtreeHasRow(el){
  return el.children.some(c => isRowEl(c) || subtreeHasRow(c));
}
/* The element's own text outside child elements (comments stripped). */
function looseText(src, el){
  let txt = '', pos = el.contentStart;
  for(const c of el.children){
    txt += src.slice(pos, c.start);
    pos = c.end;
  }
  txt += src.slice(pos, el.contentEnd);
  return txt.replace(/<!--[\s\S]*?-->/g, '');
}

/* Angular 17 control-flow blocks (@if/@else/@for/@switch) make a row's
   fill sum unreliable — all branches parse as simultaneous columns. */
function rowHasControlFlow(src, el){
  return /@(if|else|for|switch)\b/.test(looseText(src, el));
}

function isContainerCol(src, el){
  if(!el.children.length) return false;
  if(!el.children.some(c => isRowEl(c) || subtreeHasRow(c))) return false;
  if(!el.children.every(c =>
      isRowEl(c) || isHeadingEl(c) || isSpacerEl(c) || subtreeHasRow(c))) return false;
  return looseText(src, el).trim() === '';
}

/* ── titles & content hints from the markup itself ─────────────── */

function i18nKey(el){
  const a = el.attrs.find(x => {
    const n = x.name.toLowerCase();
    return n === 'app-i18n' || n === 'lc-l10n' || n.includes('i18n');
  });
  return a && a.value ? a.value : null;
}
function lastKeySegment(key){
  const p = key.split('.');
  return p[p.length - 1] || key;
}

/* Label of one heading element: its text, else its i18n key's last segment. */
function headingLabel(src, h){
  const txt = src.slice(h.contentStart, h.contentEnd)
    .replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
  if(txt) return {text: txt, full: txt};
  const k = i18nKey(h);
  if(k) return {text: lastKeySegment(k), full: k};
  return null;
}

/* Title from the column's first heading child. */
function headingTitle(src, el){
  const h = el.children.find(isHeadingEl);
  if(!h) return null;
  return headingLabel(src, h);
}

/* sectionTitle="demo.editor.sectionF" on wrapper components (panel-section). */
function sectionTitleAttr(el){
  const a = el.attrs.find(x => {
    const n = x.name.toLowerCase();
    return n === 'sectiontitle' || n === '[sectiontitle]';
  });
  if(!a || !a.value) return null;
  return {text: lastKeySegment(a.value), full: a.value};
}

/* Ordered walk of a column's inner structure: rows interleaved with the
   headings and titled wrappers between them. Row tokens appear in exactly
   the order findRows collects them. Direct headings are marked so the one
   consumed as the column's title can be skipped by the renderer. */
function colSequence(src, el, out, direct){
  if(out === undefined){ out = []; direct = true; }
  for(const c of el.children){
    if(isRowEl(c)){
      out.push({kind:'row', el:c});
    }else if(isHeadingEl(c)){
      const lab = headingLabel(src, c);
      if(lab) out.push({kind:'sep', text:lab.text, full:lab.full, direct: !!direct});
    }else if(isSpacerEl(c)){
      continue;
    }else if(subtreeHasRow(c)){
      const t = sectionTitleAttr(c);
      if(t) out.push({kind:'sep', text:t.text, full:t.full, direct:false});
      colSequence(src, c, out, false);
    }
  }
  return out;
}

/* Small stable hash for identity tracking. */
function hashStr(s){
  let h = 0;
  for(let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/* Deepest row/col in the model whose source span contains offset pos.
   Returns {path, kind:'row'|'col'} or null. */
function nodeAtOffset(model, pos){
  let best = null;
  (function walk(rlist, base){
    rlist.forEach((r, i) => {
      const p = base.concat(i);
      if(pos >= r.el.start && pos < r.el.end){
        best = {path: p, kind:'row'};
        r.cols.forEach((c, ci) => {
          if(pos >= c.el.start && pos < c.el.end){
            best = {path: p.concat(ci), kind:'col'};
            walk(c.nestedRows, p.concat(ci));
          }
        });
      }
    });
  })(model, []);
  return best;
}

/* Everything a column is findable by: its title (short and full), its
   content hint (name + providing tag), and the section separators inside
   it — so searching "sectionM" finds the container that holds it. */
function colSearchText(src, el){
  const parts = [];
  const t = colTitle(src, el);
  if(t){ parts.push(t.text); if(t.full !== t.text) parts.push(t.full); }
  const h = contentHint(src, el);
  if(h){ parts.push(h.text); if(h.tag) parts.push(h.tag); }
  for(const item of colSequence(src, el)){
    if(item.kind === 'sep'){
      parts.push(item.text);
      if(item.full && item.full !== item.text) parts.push(item.full);
    }
  }
  return parts.join(' ').toLowerCase();
}

/* Combined title: explicit comment wins, then the heading. */
function colTitle(src, el){
  const c = elementTitle(src, el);
  if(c) return {text: c, full: c};
  return headingTitle(src, el);
}

function controlName(el){
  const a = el.attrs.find(x => {
    const n = x.name.toLowerCase();
    return n === 'formcontrolname' || n === '[formcontrol]' || n === 'formcontrol';
  });
  return a && a.value ? a.value : null;
}

/* Best content hint for a column, searched shallowly (depth 3) among
   non-row descendants: a form control's name beats an i18n key beats
   the first tag name. `tag` says which element type supplied the name.
   Returns {text, kind:'control'|'i18n'|'tag', tag?} or null. */
function contentHint(src, el){
  const q = el.children.filter(c => !isRowEl(c) && !isSpacerEl(c)).map(c => ({e:c, d:1}));
  let firstTag = null, firstI18n = null, firstI18nTag = null;
  while(q.length){
    const {e, d} = q.shift();
    const cn = controlName(e);
    if(cn) return {text: cn, kind:'control', tag: e.tag};
    if(!firstI18n){
      const k = i18nKey(e);
      if(k){ firstI18n = lastKeySegment(k); firstI18nTag = e.tag; }
    }
    if(!firstTag && !isHeadingEl(e)) firstTag = '<' + e.tag + '>';
    if(d < 3) e.children.forEach(c => { if(!isRowEl(c) && !isSpacerEl(c)) q.push({e:c, d:d+1}); });
  }
  if(firstI18n) return {text: firstI18n, kind:'i18n', tag: firstI18nTag};
  if(firstTag) return {text: firstTag, kind:'tag'};
  return null;
}

/* ── text splicing ─────────────────────────────────────────────── */

function splice(src, start, end, text){
  return src.slice(0, start) + text + src.slice(end);
}

/* Replace the class attribute value of el (adds the attribute if missing). */
function writeClass(src, el, newTokens){
  const val = newTokens.join(' ');
  const a = getAttr(el, 'class');
  if(a && a.valueStart >= 0){
    if(a.quote === ''){
      return splice(src, a.valueStart, a.valueEnd, '"' + val + '"');
    }
    return splice(src, a.valueStart, a.valueEnd, val);
  }
  // no class attribute — insert before '>' (or '/>')
  let pos = el.openEnd - 1;                    // at '>'
  if(src[el.openEnd - 2] === '/') pos = el.openEnd - 2;
  const lead = /\s/.test(src[pos-1]) ? '' : ' ';
  return splice(src, pos, pos, `${lead}class="${val}"`);
}

/* ── title comments ────────────────────────────────────────────── */

/* A comment directly above `pos` (only whitespace between), e.g.
   <!--COL3-->  →  {open, text:'COL3'}. Commented-out markup is ignored. */
function precedingCommentRange(src, pos){
  let i = pos;
  // walk back over whitespace, but stop if there's a blank line between the
  // comment and the element — a blank-line-separated comment describes a
  // section, not this element, so it isn't adopted as a title / carried on move
  let newlines = 0;
  while(i > 0 && /\s/.test(src[i-1])){
    if(src[i-1] === '\n' && ++newlines >= 2) return null;
    i--;
  }
  if(src.slice(i-3, i) !== '-->') return null;
  const open = src.lastIndexOf('<!--', i-3);
  if(open < 0) return null;
  const text = src.slice(open+4, i-3).trim();
  if(!text || text.includes('<')) return null;
  return {open, text};
}

/* Title of an element: comment above it, else first comment inside it. */
function elementTitle(src, el){
  const pre = precedingCommentRange(src, el.start);
  if(pre) return pre.text;
  let i = el.contentStart;
  while(i < el.contentEnd && /\s/.test(src[i])) i++;
  if(src.startsWith('<!--', i)){
    const e = src.indexOf('-->', i);
    if(e >= 0 && e < el.contentEnd){
      const text = src.slice(i+4, e).trim();
      if(text && !text.includes('<')) return text;
    }
  }
  return null;
}

/* Range of el including its leading indentation, plus any title comments
   directly above it (so moves/deletes carry the label along).
   Returns {cutStart, cutEnd, textStart, indent}:
   - cutStart..cutEnd  → remove for delete/move (swallows preceding newline)
   - textStart..el.end → the text to re-insert when moving */
function elementCutRange(src, el){
  let s = el.start;
  while(s > 0 && (src[s-1] === ' ' || src[s-1] === '\t')) s--;
  const indent = src.slice(s, el.start);

  let anchor = el.start, c;
  while((c = precedingCommentRange(src, anchor))) anchor = c.open;

  let cs = anchor;
  while(cs > 0 && (src[cs-1] === ' ' || src[cs-1] === '\t')) cs--;
  let cutStart = cs;
  if(cs > 0 && src[cs-1] === '\n') cutStart = cs - 1;
  return {cutStart, cutEnd: el.end, textStart: anchor, indent};
}

/* Indent used for children of a row (from first element child, else +2). */
function rowChildIndent(src, rowEl){
  const first = rowEl.children[0];
  if(first) return elementCutRange(src, first).indent;
  return elementCutRange(src, rowEl).indent + '  ';
}
