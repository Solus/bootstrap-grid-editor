/* DOM helpers and the canvas element references shared by both frontends.
   The host HTML (standalone index.html / the extension webview) must provide
   #rowsHost, #inspector, #sheet, #toast and the header controls. Leaf module
   — imports nothing from the editor.

   The source textarea (#src) is standalone-only and lives in that frontend's
   own dom module. */

export const $ = <T extends Element = HTMLElement>(s: string): T =>
  document.querySelector(s) as T;

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
