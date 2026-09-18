/* The webview host's own strings.

   The empty-canvas hint is here rather than in the shared renderer because
   the shared one used to print the standalone's wording — "paste a template
   on the left", "Apply changes", "Load sample" — into a panel that has none
   of those controls (the webview's HTML, in host/extension.ts, is a header,
   a canvas and an inspector). Any hint this host returns has to name
   something the webview actually offers. */
import { describe, expect, it } from 'vitest';
import { createWebviewHost } from './webview-host.js';

const host = () => createWebviewHost(() => {}, { diverged: false });

describe('the webview\'s empty-canvas hint', () => {
  it('offers the way in that this frontend has', () => {
    // "Add row" is the inspector's own button, present in both frontends;
    // reopening the command is the extension's way to point at another file.
    expect(host().emptyCanvasHint?.()).toContain('Add row');
    expect(host().emptyCanvasHint?.()).toContain('Open Grid Editor');
  });

  it('names nothing that only the standalone has', () => {
    const hint = host().emptyCanvasHint?.() ?? '';
    expect(hint).not.toMatch(/Apply changes|Load sample|on the left/);
  });
});
