/* Records media/demo.gif — the animation at the top of the README — from a
   real VS Code, the same way screenshots.mjs takes the stills.

   Run with `npm run demo-gif -w bootstrap-grid-editor` (it builds the extension
   first). The script plays a short storyboard on the dashboard example —
   select, resize, split, drag-and-drop, switch breakpoint, fold the
   inspector — screenshotting the editor area as it goes, then encodes the
   frames with
   gifenc: one shared palette, and each frame storing only the pixels that
   changed — which keeps a full-size recording to a few hundred KB.

   The pointer isn't in the picture (screenshots never include it); the hover
   states the real mouse moves trigger are. The edits are never saved — the
   example file on disk is untouched. */

import gifenc from 'gifenc';         // CommonJS: no named exports under ESM
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import { DARK, MEDIA, session } from './vscode-session.mjs';

const { GIFEncoder, applyPalette, quantize } = gifenc;

const FRAME_MS = 100;     // target capture interval
const SCALE = 1;          // full size: the frame diffs keep it small, and text stays sharp
const HOLD_END_MS = 2000; // the last frame lingers before the loop restarts

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Films the editor area. Frames are taken between the storyboard's own steps
    — after each small mouse move, and repeatedly while it holds still — never
    concurrently with them: a capture running in parallel broke the resize
    drag. Each frame keeps its real timestamp, so playback speed is true. */
function recorder(win, clip) {
  const frames = [];
  let at = { x: 0, y: 0 };
  const snap = async () => { frames.push({ buf: await win.screenshot({ clip }), t: Date.now() }); };
  return {
    frames,
    /** Hold still for `ms`, filming. */
    async hold(ms) {
      const end = Date.now() + ms;
      do {
        const t = Date.now();
        await snap();
        const wait = Math.min(FRAME_MS - (Date.now() - t), end - Date.now());
        if (wait > 0) await sleep(wait);
      } while (Date.now() < end);
    },
    /** Move the real mouse to (x, y) in `steps`, a frame after each. */
    async glide(x, y, steps = 12) {
      const from = at;
      for (let i = 1; i <= steps; i++) {
        const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;  // ease in-out
        await win.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
        await snap();
      }
      at = { x, y };
    },
  };
}

/** Area-average downscale of an RGBA image. */
function downscale(src, w, h, scale) {
  const tw = Math.round(w * scale), th = Math.round(h * scale);
  const out = new Uint8Array(tw * th * 4);
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor(ty / scale), y1 = Math.max(y0 + 1, Math.floor((ty + 1) / scale));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor(tx / scale), x1 = Math.max(x0 + 1, Math.floor((tx + 1) / scale));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1 && y < h; y++) {
        for (let x = x0; x < x1 && x < w; x++) {
          const i = (y * w + x) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; n++;
        }
      }
      const o = (ty * tw + tx) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { data: out, width: tw, height: th };
}

function encode(frames, file) {
  const imgs = frames.map(f => {
    const png = PNG.sync.read(f.buf);
    return downscale(png.data, png.width, png.height, SCALE);
  });
  const { width, height } = imgs[0];

  // one palette for the whole animation (no per-frame colour flicker). It is
  // built from every frame — a spread of pixels from each — so colours seen
  // only briefly (the drop slots mid-drag) get an entry of their own instead
  // of snapping to the nearest greyish one. The last index is kept free to
  // mean "unchanged".
  const STRIDE = 5;
  const per = Math.ceil(width * height / STRIDE);
  const sample = new Uint8Array(imgs.length * per * 4);
  let off = 0;
  for (const img of imgs) {
    for (let p = 0; p < width * height; p += STRIDE, off += 4) sample.set(img.data.subarray(p * 4, p * 4 + 4), off);
  }
  const palette = quantize(sample.subarray(0, off), 255);
  const clear = palette.length;
  palette.push([0, 0, 0]);

  const gif = GIFEncoder();
  let shown = null;     // palette indices currently on screen
  let pending = null;   // a frame waiting to learn how long it stays up
  const flush = (delay) => {
    gif.writeFrame(pending.index, width, height, {
      ...(pending.first ? { palette } : {}),
      delay, transparent: true, transparentIndex: clear, dispose: 1,
    });
  };
  for (let i = 0; i < imgs.length; i++) {
    const idx = applyPalette(imgs[i].data, palette);
    const until = i + 1 < frames.length ? frames[i + 1].t : frames[i].t + HOLD_END_MS;
    const dur = until - frames[i].t;
    if (!shown) {
      shown = idx;
      pending = { index: idx, first: true, dur };
      continue;
    }
    // only what changed; everything else stays as the previous frame left it
    const delta = new Uint8Array(idx.length);
    let changed = false;
    for (let p = 0; p < idx.length; p++) {
      if (idx[p] === shown[p]) delta[p] = clear;
      else { delta[p] = idx[p]; shown[p] = idx[p]; changed = true; }
    }
    if (!changed) { pending.dur += dur; continue; }   // identical: hold the last one longer
    flush(pending.dur);
    pending = { index: delta, first: false, dur };
  }
  flush(pending.dur + HOLD_END_MS);
  gif.finish();
  fs.writeFileSync(file, gif.bytes());
  return { width, height };
}

const centre = async (loc) => {
  const b = await loc.boundingBox();
  if (!b) throw new Error('nothing to point at');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
};

console.log('recording the demo on the dashboard, dark');
let frames = [];
await session({ file: 'dashboard.component.html', theme: DARK }, async ({ win, canvas }) => {
  await win.mouse.move(0, 0);
  const rec = recorder(win, await win.locator('.part.editor').boundingBox());
  frames = rec.frames;
  const clickOn = async (loc) => {
    const c = await centre(loc);
    await rec.glide(c.x, c.y);
    await rec.hold(250);
    await win.mouse.down();
    await win.mouse.up();
  };

  await rec.hold(1200);

  // select a KPI card: its source is revealed and highlighted
  const card = canvas.locator('.g-col:not(.container)').nth(3);
  await clickOn(card);
  await rec.hold(1400);

  // drag its right edge one grid column to the left: 6 → 5
  const row = await card.locator('xpath=ancestor::div[contains(@class,"g-row")][1]').boundingBox();
  const h = await centre(card.locator('.col-resize'));
  await rec.glide(h.x, h.y, 10);
  await rec.hold(400);
  await win.mouse.down();
  await rec.glide(h.x - row.width / 12, h.y, 16);
  await rec.hold(200);
  await win.mouse.up();
  await rec.hold(1400);

  // split it in two
  await clickOn(canvas.getByRole('button', { name: 'Split in two' }));
  await rec.hold(1600);

  // drag the sidebar in front of the chart: the source moves with it
  const feed = canvas.locator('.g-col:not(.container)', { hasText: 'activity-feed' });
  const f = await feed.boundingBox();
  await rec.glide(f.x + 40, f.y + 14);
  await rec.hold(300);
  await win.mouse.down();
  await rec.glide(f.x + 46, f.y + 4, 3);          // start the drag: the slots appear
  const slot = await centre(canvas.locator('.g-col:not(.container)', { hasText: 'revenue-chart' })
    .locator('.dropzone.left'));
  await rec.glide(slot.x, slot.y, 16);
  await rec.hold(600);                             // over the slot: it lights up
  await win.mouse.up();
  await rec.hold(1600);

  // the same layout at lg
  await clickOn(canvas.locator('#bpSwitch button[data-bp="lg"]'));
  await rec.hold(1600);

  // fold the inspector away for more canvas, and back
  await clickOn(canvas.locator('[aria-label="Collapse inspector"]'));
  await rec.hold(1600);
  await clickOn(canvas.locator('[aria-label="Expand inspector"]'));
  await rec.hold(1200);
});

const out = path.join(MEDIA, 'demo.gif');
const { width, height } = encode(frames, out);
const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`  saved demo.gif — ${frames.length} frames, ${width}×${height}, ${mb} MB`);
