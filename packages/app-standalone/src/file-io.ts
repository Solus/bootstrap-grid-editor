/* Getting a template in and out: Open, file drag & drop, Download, Copy,
   and the sample. In the standalone app these are the "ends of the pipe"
   the extension replaces with the active editor document. */

import { $, srcTA, toast } from './dom.js';
import { apply, state } from './state.js';
import { SAMPLE } from './sample.js';

function confirmDiscardDirty(): boolean {
  return !state.dirty || confirm('Source pane has unapplied edits — discard them?');
}

function openText(text: string, name?: string): void {
  if (name) {
    state.fileName = name;
    $('#fileName').textContent = '— ' + name;
  }
  apply(text, { keepSel: false, fromSource: true });
}

export function wireFileIo(): void {
  const fileInput = $<HTMLInputElement>('#fileInput');

  $('#openBtn').addEventListener('click', () => {
    if (confirmDiscardDirty()) fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void f.text().then(t => openText(t, f.name));
    fileInput.value = '';
  });

  $('#downloadBtn').addEventListener('click', () => {
    if (state.dirty &&
        !confirm('Source pane has unapplied edits — download the applied (canvas) version anyway?')) {
      return;
    }
    const name = state.fileName || 'template.html';
    const blob = new Blob([state.src], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Downloaded ' + name);
  });

  $('#copyBtn').addEventListener('click', async () => {
    if (state.dirty &&
        !confirm('Source pane has unapplied edits — copy the applied (canvas) version anyway?')) {
      return;
    }
    try {
      await navigator.clipboard.writeText(state.src);
      toast('Copied to clipboard');
    } catch {
      const prev = srcTA.value;
      srcTA.value = state.src;
      srcTA.select();
      document.execCommand('copy');
      srcTA.value = prev;
      toast('Copied (fallback)');
    }
  });

  $('#sampleBtn').addEventListener('click', () => {
    if (confirmDiscardDirty()) apply(SAMPLE, { keepSel: false, fromSource: true });
  });

  wireFileDrag(openText);
}

function wireFileDrag(open: (text: string, name?: string) => void): void {
  let fileDragDepth = 0;
  const isFileDrag = (e: DragEvent) =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

  document.addEventListener('dragenter', e => {
    if (!isFileDrag(e)) return;
    fileDragDepth++;
    document.body.classList.add('filedrag');
  });
  document.addEventListener('dragleave', e => {
    if (!isFileDrag(e)) return;
    if (--fileDragDepth <= 0) {
      fileDragDepth = 0;
      document.body.classList.remove('filedrag');
    }
  });
  document.addEventListener('dragover', e => {
    if (isFileDrag(e)) e.preventDefault();
  });
  document.addEventListener('drop', e => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    fileDragDepth = 0;
    document.body.classList.remove('filedrag');
    const f = e.dataTransfer?.files[0];
    if (!f || !confirmDiscardDirty()) return;
    void f.text().then(t => open(t, f.name));
  });
}
