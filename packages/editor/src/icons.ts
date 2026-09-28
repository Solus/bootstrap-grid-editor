/* The inspector's action icons, and the toolbar's: small line drawings on a 16×16 grid, stroked
   in `currentColor` so they follow the button's text colour (and its danger
   red) in either theme. Drawn rather than typed: the ◀ ▶ ▲ ▼ characters they
   replace rendered differently per font — some as emoji on Windows — and no
   character says "split" or "add a row inside". Where an action changes the
   grid, the icon draws the change: a box with a divider, a column with one
   added beside it, a band inside a column. */

export type IconName =
  | 'split' | 'addColAfter' | 'addRowInside' | 'addRow' | 'addColToRow'
  | 'moveLeft' | 'moveRight' | 'moveUp' | 'moveDown' | 'delete'
  | 'undo' | 'redo' | 'open' | 'sample' | 'download' | 'copy' | 'resync'
  | 'plus' | 'minus' | 'panelOpen' | 'panelClose' | 'lock';

/** Each icon as its shapes, in SVG path syntax. */
const PATHS: Record<IconName, string[]> = {
  // a column with a divider down its middle
  split: ['M3.5 3h9a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7A1.5 1.5 0 0 1 3.5 3z', 'M8 3v10'],
  // a column, and a new one arriving to its right
  addColAfter: ['M2.5 3h4A1 1 0 0 1 7.5 4v8a1 1 0 0 1-1 1h-4A1 1 0 0 1 1.5 12V4a1 1 0 0 1 1-1z', 'M12 5.5v5', 'M9.5 8h5'],
  // a column holding a row band
  addRowInside: ['M4 1.5h8A1.5 1.5 0 0 1 13.5 3v10a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 13V3A1.5 1.5 0 0 1 4 1.5z', 'M5 6.5h6v3H5z'],
  // a row, and a new one arriving below it
  addRow: ['M3 2.5h10A1.5 1.5 0 0 1 14.5 4v2A1.5 1.5 0 0 1 13 7.5H3A1.5 1.5 0 0 1 1.5 6V4A1.5 1.5 0 0 1 3 2.5z', 'M8 9.5v5', 'M5.5 12h5'],
  // a row of two columns, and a third arriving at its end
  addColToRow: ['M2.5 4h7A1 1 0 0 1 10.5 5v6a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M6 4v8', 'M13 5.75v4.5', 'M10.75 8h4.5'],
  moveLeft: ['M13 8H3', 'M7 4L3 8l4 4'],
  moveRight: ['M3 8h10', 'M9 4l4 4-4 4'],
  moveUp: ['M8 13V3', 'M4 7l4-4 4 4'],
  moveDown: ['M8 3v10', 'M4 9l4 4 4-4'],
  // a bin: lid, handle, body, two ribs
  delete: ['M2.5 4h11', 'M6 4V2.5h4V4', 'M3.75 4l.75 9.5h7l.75-9.5', 'M6.5 6.5v4.5', 'M9.5 6.5v4.5'],
  // toolbar: an arrow hooking back / forward
  undo: ['M4 6.5h6.5a3 3 0 0 1 0 6H8', 'M6.5 4L4 6.5 6.5 9'],
  redo: ['M12 6.5H5.5a3 3 0 0 0 0 6H8', 'M9.5 4L12 6.5 9.5 9'],
  // a folder
  open: ['M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z'],
  // a page with a folded corner and two lines of text
  sample: ['M4 1.5h5.5l3 3V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z', 'M9.5 1.5v3h3', 'M5.5 8h5', 'M5.5 10.5h5'],
  // an arrow down onto a line
  download: ['M8 2.5v8', 'M4.5 7L8 10.5 11.5 7', 'M3 13.5h10'],
  // two overlapping sheets
  copy: ['M6.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z', 'M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2'],
  // two arrows chasing round a circle
  resync: ['M13 8a5 5 0 0 1-8.5 3.5', 'M3 8a5 5 0 0 1 8.5-3.5', 'M11.5 2v2.5H9', 'M4.5 14v-2.5H7'],
  // the collapsed inspector's steppers
  plus: ['M8 3.5v9', 'M3.5 8h9'],
  minus: ['M3.5 8h9'],
  // a window with its right-hand panel; the chevron says which way it goes
  panelOpen: ['M2.5 3h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M10.5 3v10', 'M7 6L5 8l2 2'],
  panelClose: ['M2.5 3h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M10.5 3v10', 'M5 6l2 2-2 2'],
  // a padlock: read-only
  lock: ['M4.5 7h7a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z', 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2'],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A fresh icon element. Decorative: the button's label names the action. */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  for (const d of PATHS[name]) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}
