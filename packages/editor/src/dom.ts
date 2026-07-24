/* DOM helpers and the canvas element references shared by both frontends.
   The host HTML (standalone index.html / the extension webview) must provide
   #rowsHost, #inspector, #sheet, #toast and the header controls. Leaf module
   — imports nothing from the editor.

   The source textarea (#src) is standalone-only and lives in that frontend's
   own dom module. */

export const $ = <T extends Element = HTMLElement>(s: string): T =>
  document.querySelector(s) as T;

/** Element ids the shared editor resolves from the host HTML. Both frontends
    must provide every one. Optional chrome (`#undoBtn`/`#redoBtn`, guarded in
    renderHeader because the extension omits them) is deliberately excluded. */
export const REQUIRED_EDITOR_IDS = [
  'sheet', 'rowsHost', 'inspector', 'ruler', 'toast',
  'bpSwitch', 'bpNote', 'findBox', 'findCount',
] as const;

/** Fail loud and early if the host HTML is missing an element the code will
    later look up by id. Without this a `$()` silently returns null and blows
    up cryptically on first use; here you get one message naming exactly what's
    missing (FOLLOW-UPS §4.2). Call once at boot, before the first render. */
export function assertRequiredIds(ids: readonly string[]): void {
  const missing = ids.filter(id => !document.getElementById(id));
  if (missing.length) {
    throw new Error(
      'Host HTML is missing required element(s): ' + missing.map(id => '#' + id).join(', '));
  }
}

export const rowsHost = $('#rowsHost');
export const inspector = $('#inspector');
export const sheet = $('#sheet');

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function mkBadge(text: string, cls: string): HTMLElement {
  const b = document.createElement('span');
  b.className = 'badge ' + cls;
  b.textContent = text;
  return b;
}

export function mkTypeBadge(text: string): HTMLElement {
  const b = document.createElement('span');
  b.className = 'type-badge';
  b.textContent = text;
  return b;
}

let toastTimer: ReturnType<typeof setTimeout>;

export function toast(msg: string, cls?: string): void {
  const t = $('#toast');
  t.className = 'toast show' + (cls ? ' ' + cls : '');
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
