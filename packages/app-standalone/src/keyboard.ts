/* Keyboard navigation over the canvas, plus the global shortcuts.

   Arrows move the selection through the model tree; Shift+arrows move the
   selected block itself. Nothing fires while focus is in a text field. */

import type { NodePath, RowNode } from '@bootstrap-visualizer/core';
import { $, rowsHost, srcTA } from './dom.js';
import { redo, resolvePath, state, undo } from './state.js';
import { render } from './render.js';
import { clearSelection, select } from './selection.js';
import { expandAncestors, findGo } from './find.js';
import { deleteEl, nudgeCol, nudgeRow, quickWidth } from './edits.js';

export function wireKeyboard(): void {
  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);

  document.addEventListener('keydown', e => {
    if (e.target === srcTA) return;                 // don't hijack textarea undo
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault(); undo();
    }
    if ((e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault(); redo();
    }
  });

  wireFindBox();
  document.addEventListener('keydown', kbNav);
}

function wireFindBox(): void {
  const findBox = $<HTMLInputElement>('#findBox');
  findBox.addEventListener('input', () => {
    state.find = findBox.value;
    state.findIdx = null;
    render();
  });
  findBox.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); findGo(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') {
      findBox.value = ''; state.find = ''; state.findIdx = null;
      render(); findBox.blur();
    }
    e.stopPropagation();
  });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = e.target as HTMLElement;
      if (t !== srcTA && t !== findBox && t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') {
        e.preventDefault();
        findBox.focus();
        findBox.select();
      }
    }
  });
}

function kbNav(e: KeyboardEvent): void {
  const t = e.target as HTMLElement;
  if (t === srcTA || t.id === 'findBox' || t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key;
  const sel = state.sel;
  const node = sel && resolvePath(sel.path);

  const setSel = (path: NodePath, kind: 'row' | 'col') => {
    expandAncestors(path);
    select({ path, kind });
    const el = rowsHost.querySelector('[data-path="' + path.join(',') + '"]');
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  if (key === 'Escape') {
    if (sel) {
      clearSelection();
      e.preventDefault();
    }
    return;
  }
  if (!sel || !node) {
    if ((key === 'ArrowDown' || key === 'ArrowRight') && state.model.length) {
      setSel([0], 'row');
      e.preventDefault();
    }
    return;
  }
  if (key.startsWith('Arrow')) e.preventDefault();   // navigation owns arrows while something is selected

  if (e.shiftKey && key.startsWith('Arrow')) {       // ── move the selected item ──
    if (sel.kind === 'col' && node.kind === 'col') {
      if (key === 'ArrowLeft') nudgeCol(-1);
      else if (key === 'ArrowRight') nudgeCol(+1);
    } else if (node.kind === 'row') {
      if (key === 'ArrowUp') nudgeRow(-1);
      else if (key === 'ArrowDown') nudgeRow(+1);
    }
    return;
  }

  if (sel.kind === 'col' && node.kind === 'col') {
    const rowPath = sel.path.slice(0, -1);
    const idx = sel.path[sel.path.length - 1]!;
    const row = resolvePath(rowPath);
    if (key === 'ArrowLeft' && idx > 0) setSel(rowPath.concat(idx - 1), 'col');
    else if (key === 'ArrowRight' && row && row.kind === 'row' && idx < row.cols.length - 1) {
      setSel(rowPath.concat(idx + 1), 'col');
    }
    else if (key === 'ArrowUp') setSel(rowPath, 'row');
    else if (key === 'ArrowDown' && node.nestedRows.length) setSel(sel.path.concat(0), 'row');
    else if (key === 'Delete') { e.preventDefault(); deleteEl(node); }
    else if (key === '+' || key === '=') { e.preventDefault(); quickWidth(node, +1); }
    else if (key === '-') { e.preventDefault(); quickWidth(node, -1); }
  } else if (node.kind === 'row') {
    const parent = sel.path.slice(0, -1);
    const idx = sel.path[sel.path.length - 1]!;
    const parentNode = parent.length ? resolvePath(parent) : null;
    const siblings: RowNode[] = parent.length
      ? (parentNode && parentNode.kind === 'col' ? parentNode.nestedRows : [])
      : state.model;
    if (key === 'ArrowUp' && idx > 0) setSel(parent.concat(idx - 1), 'row');
    else if (key === 'ArrowDown' && idx < siblings.length - 1) setSel(parent.concat(idx + 1), 'row');
    else if (key === 'ArrowRight' || key === 'Enter') {
      if (node.cols.length) {
        const rowKey = state._rowIds.get(sel.path.join(','));
        if (rowKey && state.collapsed.has(rowKey)) state.collapsed.delete(rowKey);
        setSel(sel.path.concat(0), 'col');
        if (key === 'Enter') e.preventDefault();
      }
    }
    else if (key === 'ArrowLeft' && parent.length) setSel(parent, 'col');
    else if (key === 'Delete') { e.preventDefault(); deleteEl(node); }
  }
}
