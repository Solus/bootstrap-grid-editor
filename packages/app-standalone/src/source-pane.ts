/* The source pane: the textarea that is the document of record, its
   dirty/apply/revert cycle, and the pane divider. */

import { $, srcTA, toast } from './dom.js';
import { apply, state } from './state.js';
import { positionBand, syncSelFromCaret } from './selection.js';

export function wireSourcePane(): void {
  $('#applyBtn').addEventListener('click',
    () => apply(srcTA.value, { keepSel: false, fromSource: true }));

  $('#revertBtn').addEventListener('click', () => {
    srcTA.value = state.src;
    state.dirty = false;
    $('#srcPane').classList.remove('src-dirty');
    $<HTMLButtonElement>('#revertBtn').disabled = true;
    positionBand();          // restore the strip (dirty cleared)
    toast('Reverted to canvas state');
  });

  srcTA.addEventListener('input', () => {
    state.dirty = state.src !== srcTA.value;
    $('#srcPane').classList.toggle('src-dirty', state.dirty);
    $<HTMLButtonElement>('#revertBtn').disabled = !state.dirty;
    positionBand();          // hide the strip while dirty, restore when matched
  });
  srcTA.addEventListener('scroll', positionBand);

  srcTA.addEventListener('click', syncSelFromCaret);
  srcTA.addEventListener('keyup', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
         'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      syncSelFromCaret();
    }
  });
  srcTA.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      apply(srcTA.value, { keepSel: false, fromSource: true });
    }
  });

  wirePaneResizer();
}

function wirePaneResizer(): void {
  const paneResizer = $('#paneResizer');
  const srcPane = $('#srcPane');
  paneResizer.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    paneResizer.setPointerCapture(e.pointerId);
    paneResizer.classList.add('active');
    document.body.classList.add('pane-resizing');
    const mainEl = srcPane.parentElement!;
    const mainRect = mainEl.getBoundingClientRect();
    const minW = 260, maxW = mainRect.width * 0.7;
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(maxW, Math.max(minW, ev.clientX - mainRect.left));
      srcPane.style.flexBasis = w + 'px';
    };
    const onUp = (ev: PointerEvent) => {
      paneResizer.releasePointerCapture(ev.pointerId);
      paneResizer.removeEventListener('pointermove', onMove);
      paneResizer.removeEventListener('pointerup', onUp);
      paneResizer.removeEventListener('pointercancel', onUp);
      paneResizer.classList.remove('active');
      document.body.classList.remove('pane-resizing');
    };
    paneResizer.addEventListener('pointermove', onMove);
    paneResizer.addEventListener('pointerup', onUp);
    paneResizer.addEventListener('pointercancel', onUp);
  });
}
