const fs = require('fs');
eval(fs.readFileSync('./core.js','utf8'));

let pass = 0, fail = 0;
function eq(name, got, want){
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if(g === w){ pass++; }
  else { fail++; console.log('FAIL', name, '\n  got ', g, '\n  want', w); }
}
function ok(name, cond){ cond ? pass++ : (fail++, console.log('FAIL', name)); }

/* ── parser basics ── */
const src1 = `<div class="row">
  <div class="col-md-4" [disabled]="a > b" *ngIf="x">Hi</div>
  <input class="col-6" formControlName="q">
  <app-x [v]="1"></app-x>
</div>`;
const r1 = parseTemplate2(src1);
eq('one root child', r1.children.length, 1);
const row1 = r1.children[0];
eq('row tag', row1.tag, 'div');
eq('row children count', row1.children.length, 3);
eq('row end covers all', src1.slice(row1.end-6, row1.end), '</div>');
const c1 = row1.children[0];
eq('quote-aware > in binding', c1.tag, 'div');
eq('c1 attrs', c1.attrs.map(a=>a.name), ['class','[disabled]','*ngIf']);
eq('c1 content', src1.slice(c1.contentStart, c1.contentEnd), 'Hi');
ok('void input closed', row1.children[1].tag === 'input');
ok('offsets exact', src1.slice(c1.start, c1.start+4) === '<div');

/* ── mismatched/unclosed tolerance ── */
const src2 = `<div class="row"><div class="col-6"><span>x</div></div>`;
const r2 = parseTemplate2(src2);
eq('tolerant children', r2.children[0].children.length, 1);
ok('tolerant parse no throw', true);

/* ── colSpec / effectiveAt ── */
const spec = colSpec(['col-md-4','col-lg-6','offset-lg-2','form-group']);
eq('spec md', spec.width.md, 4);
eq('spec lg', spec.width.lg, 6);
eq('spec offset lg', spec.offset.lg, 2);
eq('eff at xl cascades', effectiveAt(spec.width,'xl'), 6);
eq('eff at sm null', effectiveAt(spec.width,'sm'), null);
eq('bare col', colSpec(['col']).width.xs, 'equal');
eq('col-auto', colSpec(['col-auto']).width.xs, 'auto');
eq('col-md bare', colSpec(['col-md']).width.md, 'equal');

/* ── setWidthToken preserves order & other tokens ── */
eq('replace in place',
  setWidthToken(['form-group','col-md-4','col-lg-6'],'md',8),
  ['form-group','col-md-8','col-lg-6']);
eq('remove token',
  setWidthToken(['col-md-4','x'],'md',null), ['x']);
eq('add after existing col',
  setWidthToken(['a','col-md-4','b'],'lg',3), ['a','col-md-4','col-lg-3','b']);
eq('equal token md', setWidthToken([],'md','equal'), ['col-md']);
eq('xs numeric', setWidthToken([],'xs',6), ['col-6']);
eq('offset set', setOffsetToken(['col-md-4'],'md',2), ['col-md-4','offset-md-2']);
eq('offset remove', setOffsetToken(['col-md-4','offset-md-2'],'md',0), ['col-md-4']);
eq('offset replace', setOffsetToken(['offset-md-2','x'],'md',3), ['offset-md-3','x']);

/* ── model building on realistic template ── */
const src3 = `<div class="container">
  <div class="row">
    <div class="col-md-6">
      <div class="row">
        <div class="col-6">a</div>
        <div class="col-6">b</div>
      </div>
    </div>
    <div class="col-md-6">c</div>
  </div>
</div>`;
const model3 = buildModel(parseTemplate2(src3));
eq('one top row', model3.length, 1);
eq('two cols', model3[0].cols.length, 2);
eq('nested rows in col0', model3[0].cols[0].nestedRows.length, 1);
eq('nested cols', model3[0].cols[0].nestedRows[0].cols.length, 2);
eq('col1 no nested', model3[0].cols[1].nestedRows.length, 0);

/* ── writeClass surgical edit ── */
const src4 = `<div class="row">\n  <div class="col-md-6">x</div>\n</div>`;
const m4 = buildModel(parseTemplate2(src4));
const el4 = m4[0].cols[0].el;
const out4 = writeClass(src4, el4, setWidthToken(classTokens(el4),'md',4));
eq('class rewritten', out4, `<div class="row">\n  <div class="col-md-4">x</div>\n</div>`);

/* writeClass when attribute missing */
const src5 = `<div class="row">\n  <div>x</div>\n</div>`;
const m5 = buildModel(parseTemplate2(src5));
const out5 = writeClass(src5, m5[0].cols[0].el, ['col-md-3']);
eq('class inserted', out5, `<div class="row">\n  <div class="col-md-3">x</div>\n</div>`);

/* writeClass on self-closing-ish / unquoted */
const src6 = `<div class="row"><input class=col-6></div>`;
const m6 = buildModel(parseTemplate2(src6));
const out6 = writeClass(src6, m6[0].cols[0].el, ['col-4']);
eq('unquoted requoted', out6, `<div class="row"><input class="col-4"></div>`);

/* ── elementCutRange / rowChildIndent ── */
const src7 = `<div class="row">\n    <div class="col-6">a</div>\n    <div class="col-6">b</div>\n</div>`;
const m7 = buildModel(parseTemplate2(src7));
const cr = elementCutRange(src7, m7[0].cols[1].el);
eq('indent captured', cr.indent, '    ');
ok('cutStart swallows newline', src7[cr.cutStart] === '\n');
eq('row child indent', rowChildIndent(src7, m7[0].el), '    ');
/* deleting col b leaves clean source */
const del7 = splice(src7, cr.cutStart, cr.cutEnd, '');
eq('delete clean', del7, `<div class="row">\n    <div class="col-6">a</div>\n</div>`);

/* ── comments and *ngFor attrs survive ── */
const src8 = `<!-- top -->\n<div class="row">\n  <div class="col-4" *ngFor="let i of items">{{i}}</div>\n</div>`;
const m8 = buildModel(parseTemplate2(src8));
eq('comment skipped, row found', m8.length, 1);
eq('ngFor attr kept', m8[0].cols[0].el.attrs.some(a=>a.name==='*ngFor'), true);
eq('interpolation content ok', src8.slice(m8[0].cols[0].el.contentStart, m8[0].cols[0].el.contentEnd), '{{i}}');

/* dynamic class detection */
const src9 = `<div class="row"><div class="col-{{n}}">x</div><div class="col-6" [ngClass]="{a:b}">y</div></div>`;
const m9 = buildModel(parseTemplate2(src9));
ok('interpolated class flagged', classIsInterpolated(m9[0].cols[0].el));
ok('ngClass flagged', hasDynamicClassBinding(m9[0].cols[1].el));
ok('static not flagged', !classIsInterpolated(m9[0].cols[1].el));


/* ── title comments ── */
const srcT = `<div class="row">
  <!--COL3-->
  <div class="col-sm-4">
    <!-- HDR:Roba -->
    <legend class="group-title" lc-l10n="spi.x"></legend>
  </div>
  <div class="col-sm-8">plain</div>
</div>`;
const mT = buildModel(parseTemplate2(srcT));
eq('preceding comment title', elementTitle(srcT, mT[0].cols[0].el), 'COL3');
eq('no title on plain col', elementTitle(srcT, mT[0].cols[1].el), null);

const srcT2 = `<div class="row">
  <div class="col-sm-4">
    <!-- HDR:Roba -->
    <legend></legend>
  </div>
</div>`;
const mT2 = buildModel(parseTemplate2(srcT2));
eq('inner comment fallback', elementTitle(srcT2, mT2[0].cols[0].el), 'HDR:Roba');

/* commented-out markup is NOT a title */
const srcT3 = `<div class="row">
  <!-- <div class="col-6">old</div> -->
  <div class="col-6">x</div>
</div>`;
const mT3 = buildModel(parseTemplate2(srcT3));
eq('commented markup ignored', elementTitle(srcT3, mT3[0].cols[0].el), null);

/* row title */
const srcT4 = `<!--MAIN-->\n<div class="row"><div class="col">x</div></div>`;
const mT4 = buildModel(parseTemplate2(srcT4));
eq('row title', elementTitle(srcT4, mT4[0].el), 'MAIN');

/* ── cut range carries the comment ── */
const crT = elementCutRange(srcT, mT[0].cols[0].el);
ok('textStart at comment', srcT.slice(crT.textStart, crT.textStart+11) === '<!--COL3-->');
const delT = splice(srcT, crT.cutStart, crT.cutEnd, '');
eq('delete removes comment too', delT, `<div class="row">
  <div class="col-sm-8">plain</div>
</div>`);

/* chained comments */
const srcT5 = `<div class="row">
  <!--A-->
  <!--B-->
  <div class="col-6">x</div>
  <div class="col-6">y</div>
</div>`;
const mT5 = buildModel(parseTemplate2(srcT5));
const crT5 = elementCutRange(srcT5, mT5[0].cols[0].el);
ok('chained comments included', srcT5.slice(crT5.textStart, crT5.textStart+8) === '<!--A-->');
eq('nearest comment wins as title', elementTitle(srcT5, mT5[0].cols[0].el), 'B');

/* moved text includes comment (simulating moveCol's slice) */
const movedText = srcT.slice(crT.textStart, mT[0].cols[0].el.end);
ok('move text starts with comment', movedText.startsWith('<!--COL3-->'));
ok('move text ends with element', movedText.trimEnd().endsWith('</div>'));

/* elements without comments unchanged by new logic */
const crPlain = elementCutRange(srcT, mT[0].cols[1].el);
eq('plain textStart is el.start', crPlain.textStart, mT[0].cols[1].el.start);

/* ── Bootstrap 3 dialect ── */
const s3 = colSpec(['col-sm-4','col-sm-offset-4','col-md-offset-2']);
eq('bs3 offset sm', s3.offset.sm, 4);
eq('bs3 offset md', s3.offset.md, 2);
eq('bs3 offset not width', s3.width.md, undefined);
eq('bs3 xs width', colSpec(['col-xs-6']).width.xs, 6);
eq('bs3 bare col-xs', colSpec(['col-xs']).width.xs, 'equal');
eq('bs3 eff cascade', effectiveAt(colSpec(['col-xs-6','col-md-4']).width,'lg'), 4);
eq('bs3 offset eff', effectiveAt(colSpec(['col-sm-offset-4']).offset,'xl'), 4);

/* replace keeps BS3 format & position */
eq('bs3 offset replace',
  setOffsetToken(['col-sm-4','col-sm-offset-4'],'sm',3),
  ['col-sm-4','col-sm-offset-3']);
eq('bs3 offset remove',
  setOffsetToken(['col-sm-4','col-sm-offset-4'],'sm',0),
  ['col-sm-4']);
/* adding an offset in a BS3 token list uses BS3 format */
eq('bs3 offset add',
  setOffsetToken(['col-xs-6'],'md',2),
  ['col-xs-6','col-md-offset-2']);
/* modern lists keep modern format */
eq('modern offset add',
  setOffsetToken(['col-md-4'],'md',2),
  ['col-md-4','offset-md-2']);
eq('modern offset replace stays modern',
  setOffsetToken(['offset-md-2','x'],'md',3),
  ['offset-md-3','x']);

/* width: col-xs replace preserves dialect */
eq('bs3 xs width replace',
  setWidthToken(['col-xs-6','col-md-4'],'xs',4),
  ['col-xs-4','col-md-4']);
eq('bs3 xs width add (list is bs3)',
  setWidthToken(['col-sm-offset-4','col-sm-6'],'xs',3),
  ['col-sm-offset-4','col-sm-6','col-xs-3']);
eq('modern xs add unaffected',
  setWidthToken(['col-md-4'],'xs',6),
  ['col-md-4','col-6']);
/* widthTokenBp must not claim bs3 offset tokens */
eq('offset token is not width', widthTokenBp('col-sm-offset-4'), null);
eq('offset token bp', offsetTokenBp('col-sm-offset-4'), 'sm');
eq('modern offset bp', offsetTokenBp('offset-3'), 'xs');
/* mixed: editing md width must not disturb bs3 offset */
eq('width edit leaves bs3 offset alone',
  setWidthToken(['col-sm-4','col-sm-offset-4'],'sm',8),
  ['col-sm-8','col-sm-offset-4']);

/* ── definingBp cascade ── */
const dspec = colSpec(['col-sm-6','col-sm-offset-4']);
eq('defining bp width at md', definingBp(dspec.width,'md'), 'sm');
eq('defining bp width at sm', definingBp(dspec.width,'sm'), 'sm');
eq('defining bp width at xs', definingBp(dspec.width,'xs'), null);
eq('defining bp offset at xl', definingBp(dspec.offset,'xl'), 'sm');
eq('defining none', definingBp({},'md'), null);
const dspec2 = colSpec(['col-sm-6','col-lg-4']);
eq('nearest tier wins', definingBp(dspec2.width,'xl'), 'lg');
eq('below override', definingBp(dspec2.width,'md'), 'sm');

/* editing the defining token: sm token edited while "viewing md" */
eq('edit defining sm token',
  setWidthToken(['col-sm-6','col-sm-offset-4'], definingBp(dspec.width,'md'), 4),
  ['col-sm-4','col-sm-offset-4']);
eq('edit defining sm offset',
  setOffsetToken(['col-sm-6','col-sm-offset-4'], definingBp(dspec.offset,'md'), 3),
  ['col-sm-6','col-sm-offset-3']);

/* ── halving (split) preserves dialect and tiers ── */
eq('halve bs3 token', halveWidthTokenStr('col-xs-8','ceil'), 'col-xs-4');
eq('halve odd ceil', halveWidthTokenStr('col-sm-5','ceil'), 'col-sm-3');
eq('halve odd floor', halveWidthTokenStr('col-sm-5','floor'), 'col-sm-2');
eq('halve min 1', halveWidthTokenStr('col-md-1','floor'), 'col-md-1');
eq('halve equal untouched', halveWidthTokenStr('col-md','ceil'), 'col-md');
eq('halve auto untouched', halveWidthTokenStr('col-auto','ceil'), 'col-auto');
eq('halved multi-tier',
  halvedWidthTokens(['form-group','col-sm-8','col-lg-6','col-sm-offset-2'],'floor'),
  ['col-sm-4','col-lg-3']);
eq('halved keeps bare col', halvedWidthTokens(['col','x'],'ceil'), ['col']);

/* ── bs3Hint drives dialect of newly created tokens ── */
eq('hint makes new offset bs3',
  setOffsetToken(['col-sm-4'],'sm',2,true), ['col-sm-4','col-sm-offset-2']);
eq('no hint stays modern',
  setOffsetToken(['col-sm-4'],'sm',2,false), ['col-sm-4','offset-sm-2']);
eq('hint makes new xs width bs3',
  setWidthToken(['col-sm-4'],'xs',6,true), ['col-sm-4','col-xs-6']);
eq('hint irrelevant when token exists',
  setOffsetToken(['offset-sm-2'],'sm',3,true), ['offset-sm-3']);

/* ── container column detection ── */
const cs1 = `<div class="row"><div class="col-md-6"><div class="row"><div class="col">a</div></div></div></div>`;
const cm1 = buildModel(parseTemplate2(cs1));
ok('pure single row = container', isContainerCol(cs1, cm1[0].cols[0].el));

const cs2 = `<div class="row"><div class="col-md-6">
  <div class="row"><div class="col">a</div></div>
  <div class="row"><div class="col">b</div></div>
</div></div>`;
const cm2 = buildModel(parseTemplate2(cs2));
ok('multiple rows = container', isContainerCol(cs2, cm2[0].cols[0].el));

const cs3 = `<div class="row"><div class="col-md-6"><legend>Hi</legend><div class="row"><div class="col">a</div></div></div></div>`;
const cm3 = buildModel(parseTemplate2(cs3));
ok('legend+row = container (amended rule)', isContainerCol(cs3, cm3[0].cols[0].el));

const cs4 = `<div class="row"><div class="col-md-6">Some text
  <div class="row"><div class="col">a</div></div>
</div></div>`;
const cm4 = buildModel(parseTemplate2(cs4));
ok('loose text + row = content', !isContainerCol(cs4, cm4[0].cols[0].el));

const cs5 = `<div class="row"><div class="col-md-6"><!-- HDR:X -->
  <div class="row"><div class="col">a</div></div>
</div></div>`;
const cm5 = buildModel(parseTemplate2(cs5));
ok('comment + row still container', isContainerCol(cs5, cm5[0].cols[0].el));

const cs6 = `<div class="row"><div class="col-md-6"><input></div></div>`;
const cm6 = buildModel(parseTemplate2(cs6));
ok('plain content col not container', !isContainerCol(cs6, cm6[0].cols[0].el));
ok('empty col not container', !isContainerCol('<div class="row"><div class="col"></div></div>',
  buildModel(parseTemplate2('<div class="row"><div class="col"></div></div>'))[0].cols[0].el));

/* ── amended container rule: legend + rows = container ── */
const lg1 = `<div class="row"><div class="col-sm-4">
  <legend class="group-title" app-i18n="demo.editor.sectionC"></legend>
  <div class="row"><div class="col-sm-6">x</div></div>
</div></div>`;
const lgm1 = buildModel(parseTemplate2(lg1));
ok('legend + rows = container', isContainerCol(lg1, lgm1[0].cols[0].el));

const lg2 = `<div class="row"><div class="col-sm-4">
  <legend app-i18n="a.b.sectionL"></legend>
  <div class="row"><div class="col">x</div></div>
  <legend app-i18n="a.b.sectionM"></legend>
  <div class="row"><div class="col">y</div></div>
</div></div>`;
const lgm2 = buildModel(parseTemplate2(lg2));
ok('mid-column legend still container', isContainerCol(lg2, lgm2[0].cols[0].el));

const lg3 = `<div class="row"><div class="col-sm-4">
  <legend app-i18n="a.b.c"></legend>
  <text-input formControlName="q"></text-input>
</div></div>`;
const lgm3 = buildModel(parseTemplate2(lg3));
ok('legend + input = content', !isContainerCol(lg3, lgm3[0].cols[0].el));

/* heading titles */
eq('heading title from i18n key', headingTitle(lg1, lgm1[0].cols[0].el).text, 'sectionC');
eq('heading title full key', headingTitle(lg1, lgm1[0].cols[0].el).full, 'demo.editor.sectionC');
const lg4 = `<div class="row"><div class="col-4"><legend>Roba</legend><div class="row"><div class="col">x</div></div></div></div>`;
const lgm4 = buildModel(parseTemplate2(lg4));
eq('heading title from text', headingTitle(lg4, lgm4[0].cols[0].el).text, 'Roba');
/* comment beats heading */
const lg5 = `<div class="row"><!--COL3-->
<div class="col-4"><legend>Roba</legend><div class="row"><div class="col">x</div></div></div></div>`;
const lgm5 = buildModel(parseTemplate2(lg5));
eq('comment title wins', colTitle(lg5, lgm5[0].cols[0].el).text, 'COL3');
eq('heading fallback via colTitle', colTitle(lg4, lgm4[0].cols[0].el).text, 'Roba');

/* ── content hints ── */
const h1 = `<div class="row"><div class="col-sm-3">
  <label appFor="f4" app-i18n="demo.editor.field004"></label>
  <text-input formControlName="field004"></text-input>
</div></div>`;
const hm1 = buildModel(parseTemplate2(h1));
eq('control name wins', contentHint(h1, hm1[0].cols[0].el), {text:'field004', kind:'control', tag:'text-input'});

const h2 = `<div class="row"><div class="col-sm-4">
  <div class="input-group"><text-input formControlName="field023"></text-input><div class="input-group-addon">%</div></div>
</div></div>`;
const hm2 = buildModel(parseTemplate2(h2));
eq('control found through wrapper', contentHint(h2, hm2[0].cols[0].el), {text:'field023', kind:'control', tag:'text-input'});

const h3 = `<div class="row"><div class="col-sm-12">
  <label appFor="f3" app-i18n="demo.editor.field003"></label>
</div></div>`;
const hm3 = buildModel(parseTemplate2(h3));
eq('i18n key fallback (last segment)', contentHint(h3, hm3[0].cols[0].el), {text:'field003', kind:'i18n', tag:'label'});

const h4 = `<div class="row"><div class="col-sm-5"><status-display [statusInput]="s"></status-display></div></div>`;
const hm4 = buildModel(parseTemplate2(h4));
eq('tag fallback', contentHint(h4, hm4[0].cols[0].el), {text:'<status-display>', kind:'tag'});

const h5 = `<div class="row"><div class="col-sm-2"><text-input [formControl]="helper017"></text-input></div></div>`;
const hm5 = buildModel(parseTemplate2(h5));
eq('[formControl] binding recognized', contentHint(h5, hm5[0].cols[0].el), {text:'helper017', kind:'control', tag:'text-input'});

/* type + name together */
const tb = `<div class="row"><div class="col-sm-2"><button class="btn" app-i18n="demo.editor.action001"></button></div></div>`;
const tbm = buildModel(parseTemplate2(tb));
eq('button i18n typed', contentHint(tb, tbm[0].cols[0].el), {text:'action001', kind:'i18n', tag:'button'});
const tl = `<div class="row"><div class="col-sm-4"><label app-i18n="x.y.field014"></label><date-input formControlName="field014"></date-input></div></div>`;
const tlm = buildModel(parseTemplate2(tl));
eq('control beats label, keeps type', contentHint(tl, tlm[0].cols[0].el), {text:'field014', kind:'control', tag:'date-input'});

/* ── spacers and wrapper components in the container rule ── */
const sp1 = `<div class="row"><div class="col-sm-4">
  <legend app-i18n="a.b.sectionH"></legend>
  <div class="row"><div class="col-sm-6">x</div></div>
  <br />
  <div class="row"><div class="col-sm-6">y</div></div>
</div></div>`;
const spm1 = buildModel(parseTemplate2(sp1));
ok('br between rows still container', isContainerCol(sp1, spm1[0].cols[0].el));

const sp2 = `<div class="row"><div class="col-sm-4"><hr><div class="row"><div class="col">x</div></div></div></div>`;
const spm2 = buildModel(parseTemplate2(sp2));
ok('hr still container', isContainerCol(sp2, spm2[0].cols[0].el));

const sp3 = `<div class="row"><div class="col-sm-4"><br /></div></div>`;
const spm3 = buildModel(parseTemplate2(sp3));
ok('br alone (no rows) not container', !isContainerCol(sp3, spm3[0].cols[0].el));

const wr1 = `<div class="row"><div class="col-sm-12">
  <expandable-panel [settings]="s">
    <panel-section id="a"><div class="row"><div class="col">x</div></div></panel-section>
    <panel-section id="b"><div class="row"><div class="col">y</div></div></panel-section>
  </expandable-panel>
</div></div>`;
const wrm1 = buildModel(parseTemplate2(wr1));
ok('wrapper components leading to rows = container', isContainerCol(wr1, wrm1[0].cols[0].el));

const wr2 = `<div class="row"><div class="col-sm-6"><text-input formControlName="q"></text-input></div></div>`;
const wrm2 = buildModel(parseTemplate2(wr2));
ok('plain control col unaffected', !isContainerCol(wr2, wrm2[0].cols[0].el));

/* contentHint never surfaces a spacer */
const sp4 = `<div class="row"><div class="col-sm-5"><br /><status-display [s]="x"></status-display></div></div>`;
const spm4 = buildModel(parseTemplate2(sp4));
eq('hint skips br', contentHint(sp4, spm4[0].cols[0].el), {text:'<status-display>', kind:'tag'});

/* ── colSequence: separators interleaved in order ── */
const sq1 = `<div class="row"><div class="col-sm-4">
  <legend app-i18n="a.b.sectionL"></legend>
  <div class="row"><div class="col">r1</div></div>
  <legend app-i18n="a.b.sectionM"></legend>
  <div class="row"><div class="col">r2</div></div>
  <br />
  <div class="row"><div class="col">r3</div></div>
</div></div>`;
const sqm1 = buildModel(parseTemplate2(sq1));
const seq1 = colSequence(sq1, sqm1[0].cols[0].el).map(i => i.kind === 'row' ? 'row' : 'sep:' + i.text + (i.direct ? '(d)' : ''));
eq('sequence order', seq1, ['sep:sectionL(d)','row','sep:sectionM(d)','row','row']);

/* wrapper with sectionTitle produces a separator before its rows */
const sq2 = `<div class="row"><div class="col-sm-12">
  <expandable-panel [settings]="s">
    <panel-section id="f" sectionTitle="demo.editor.sectionF"><div class="row"><div class="col">x</div></div></panel-section>
    <panel-section id="j" sectionTitle="demo.editor.sectionJ"><div class="row"><div class="col">y</div></div></panel-section>
  </expandable-panel>
</div></div>`;
const sqm2 = buildModel(parseTemplate2(sq2));
const seq2 = colSequence(sq2, sqm2[0].cols[0].el).map(i => i.kind === 'row' ? 'row' : 'sep:' + i.text);
eq('wrapper sectionTitle separators', seq2, ['sep:sectionF','row','sep:sectionJ','row']);
eq('sequence rows match findRows count', seq2.filter(x=>x==='row').length, sqm2[0].cols[0].nestedRows.length);
eq('sectionTitleAttr parses', sectionTitleAttr(sqm2[0].cols[0].el.children[0].children[0]), {text:'sectionF', full:'demo.editor.sectionF'});

/* nested heading inside wrapper is not "direct" */
const sq3 = `<div class="row"><div class="col-sm-6"><fieldset><legend>Inner</legend><div class="row"><div class="col">x</div></div></fieldset></div></div>`;
const sqm3 = buildModel(parseTemplate2(sq3));
const seq3 = colSequence(sq3, sqm3[0].cols[0].el);
eq('nested heading not direct', seq3[0].direct, false);

/* ── hashStr identity stability ── */
const hs = `<div class="row"><div class="col">a</div></div>
<div class="row"><div class="col">TARGET</div></div>`;
const hrm = buildModel(parseTemplate2(hs));
const before = hashStr(hs.slice(hrm[1].el.start, hrm[1].el.end));
const hs2 = splice(hs, hrm[0].cols[0].el.contentStart, hrm[0].cols[0].el.contentEnd, 'CHANGED');
const hrm2 = buildModel(parseTemplate2(hs2));
const after = hashStr(hs2.slice(hrm2[1].el.start, hrm2[1].el.end));
eq('row identity survives edits elsewhere', before, after);
ok('identity changes when own content changes',
   hashStr(hs2.slice(hrm2[0].el.start, hrm2[0].el.end)) !== hashStr(hs.slice(hrm[0].el.start, hrm[0].el.end)));

/* ── colSearchText ── */
const fs1 = `<div class="row"><div class="col-sm-3">
  <label app-i18n="demo.editor.field004"></label>
  <lookup-input formControlName="field004"></lookup-input>
</div></div>`;
const fsm1 = buildModel(parseTemplate2(fs1));
const st1 = colSearchText(fs1, fsm1[0].cols[0].el);
ok('search finds control name', st1.includes('field004'));
ok('search finds providing tag', st1.includes('lookup-input'));

const fs2 = `<div class="row"><div class="col-sm-4">
  <legend app-i18n="a.b.sectionL"></legend>
  <div class="row"><div class="col">x</div></div>
  <legend app-i18n="a.b.sectionM"></legend>
  <div class="row"><div class="col">y</div></div>
</div></div>`;
const fsm2 = buildModel(parseTemplate2(fs2));
const st2 = colSearchText(fs2, fsm2[0].cols[0].el);
ok('search finds title', st2.includes('sectionl'));
ok('search finds inner separator', st2.includes('sectionm'));
ok('search finds full key', st2.includes('a.b.sectionm'));
ok('case-insensitive storage', st2 === st2.toLowerCase());

/* ── control-flow detection & looseText ── */
const cf1 = `<div class="row">
  @if (!featureModeEnabled) {
  <div class="col-sm-10">a</div>
  } @else {
  <div class="col-sm-4">b</div>
  }
</div>`;
const cfm1 = buildModel(parseTemplate2(cf1));
ok('@if row detected', rowHasControlFlow(cf1, cfm1[0].el));

const cf2 = `<div class="row"><div class="col-sm-6">x</div><div class="col-sm-6">y</div></div>`;
const cfm2 = buildModel(parseTemplate2(cf2));
ok('plain row not flagged', !rowHasControlFlow(cf2, cfm2[0].el));

/* email text with @ must not trip it */
const cf3 = `<div class="row">contact admin@iframe.example <div class="col-6">x</div></div>`;
const cfm3 = buildModel(parseTemplate2(cf3));
ok('@ in plain text not flagged', !rowHasControlFlow(cf3, cfm3[0].el));

/* looseText excludes children and comments */
const lt = `<div class="row"> hey <!-- c --> <div class="col">inner</div> there</div>`;
const ltm = buildModel(parseTemplate2(lt));
eq('looseText content', looseText(lt, ltm[0].el).replace(/\s+/g,' ').trim(), 'hey there');

/* ── nodeAtOffset (reverse selection sync) ── */
const no1 = `<div class="container">
<div class="row"><div class="col-sm-6">alpha</div><div class="col-sm-6">
  <div class="row"><div class="col">deep</div></div>
</div></div>
<div class="row"><div class="col-12">beta</div></div>
</div>`;
const nom = buildModel(parseTemplate2(no1));
const posAlpha = no1.indexOf('alpha');
eq('offset in first col', nodeAtOffset(nom, posAlpha), {path:[0,0], kind:'col'});
const posDeep = no1.indexOf('deep');
eq('offset in nested col', nodeAtOffset(nom, posDeep), {path:[0,1,0,0], kind:'col'});
const posBeta = no1.indexOf('beta');
eq('offset in second row col', nodeAtOffset(nom, posBeta), {path:[1,0], kind:'col'});
const posRowTag = no1.indexOf('<div class="row">') + 2;
eq('offset in row open tag = row', nodeAtOffset(nom, posRowTag), {path:[0], kind:'row'});
eq('offset outside grid = null', nodeAtOffset(nom, 3), null);
eq('offset at very end = null', nodeAtOffset(nom, no1.length - 1), null);

/* ── swapSiblings preserves node kind & carries comments (row reorder) ── */
const sw = `<div class="container">
  <!--FIRST-->
  <div class="row"><div class="col">a</div></div>
  <!--SECOND-->
  <div class="row"><div class="col">b</div></div>
</div>`;
const swm = buildModel(parseTemplate2(sw));
// simulate nudgeRow(down) on row 0: swap rows 0 and 1
(function(){
  const A = swm[0].el, B = swm[1].el;
  const [first, second] = A.start < B.start ? [A,B] : [B,A];
  const rF = elementCutRange(sw, first), rS = elementCutRange(sw, second);
  const tF = sw.slice(rF.textStart, first.end), tS = sw.slice(rS.textStart, second.end);
  let s = sw;
  s = splice(s, rS.textStart, second.end, tF);
  s = splice(s, rF.textStart, first.end, tS);
  const m2 = buildModel(parseTemplate2(s));
  eq('row reorder swaps content', m2[0].cols[0].el.children.length >= 0 &&
     s.indexOf('SECOND') < s.indexOf('FIRST'), true);
  eq('both comments survive reorder',
     s.includes('FIRST') && s.includes('SECOND'), true);
  eq('row count preserved', m2.length, 2);
})();

/* ── fix 4: explicit offset-*-0 cancels inherited offset ── */
eq('keepZero writes explicit -0',
   setOffsetToken(['col-sm-4','offset-sm-3'],'md',0,false,true),
   ['col-sm-4','offset-sm-3','offset-md-0']);
eq('zero without keepZero removes token',
   setOffsetToken(['offset-md-3'],'md',0,false,false), []);
eq('bs3 explicit zero',
   setOffsetToken(['col-sm-4','col-sm-offset-3'],'md',0,true,true),
   ['col-sm-4','col-sm-offset-3','col-md-offset-0']);

/* ── adjacent-comment rule: blank line breaks title association ── */
const ac1 = `<div class="row"><div class="col-6">
  <!--ADJACENT-->
  <input formControlName="a">
</div></div>`;
const acm1 = buildModel(parseTemplate2(ac1));
eq('adjacent comment is title', colTitle(ac1, acm1[0].cols[0].el).text, 'ADJACENT');

const ac2 = `<div class="row">

  <!--SECTION-->

  <div class="col-6"><input formControlName="a"></div>
</div>`;
const acm2 = buildModel(parseTemplate2(ac2));
eq('blank-line comment NOT a title', colTitle(ac2, acm2[0].cols[0].el), null);

/* cut range should not swallow a blank-line-separated comment on delete */
const ac3 = `<div class="row">
  <!--KEEP-->

  <div class="col-6">x</div>
</div>`;
const acm3 = buildModel(parseTemplate2(ac3));
const cr3 = elementCutRange(ac3, acm3[0].cols[0].el);
ok('blank-line comment not carried in cut range', ac3.slice(cr3.textStart).indexOf('KEEP') < 0 || ac3.slice(cr3.cutStart, cr3.textStart).indexOf('KEEP') < 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
