/* The webview's theme sheet has to keep up with the editor's tokens.

   The editor's stylesheet defines the colour tokens (standalone values);
   vscode-theme.css re-points each at a VS Code theme variable. A token added
   to the editor and forgotten here would silently keep its standalone value
   in VS Code — a light-theme colour showing up inside a dark theme — and no
   other test would notice. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const editorCss = read('../../../editor/src/styles.css');
const themeCss = read('./vscode-theme.css');

/** Custom properties declared (not merely used) in the first `sel{…}` block. */
function declared(css: string, sel: string): Set<string> {
  const start = css.indexOf(sel + '{');
  expect(start, `no "${sel}{" block`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf('}', start));
  return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
}

describe('the VS Code theme mapping', () => {
  const tokens = declared(editorCss, ':root');
  const mapped = declared(themeCss, 'body.vscode-high-contrast, body.vscode-high-contrast-light');
  const all = declared(themeCss, 'body.vscode-light, body.vscode-dark,\nbody.vscode-high-contrast, body.vscode-high-contrast-light');

  it('finds the editor\'s tokens', () => {
    expect(tokens.size).toBeGreaterThan(20);
    expect(mapped.size).toBeGreaterThan(0);
  });

  it('maps every token the editor defines', () => {
    const missing = [...tokens].filter(t => !all.has(t));
    expect(missing).toEqual([]);
  });

  it('maps nothing the editor does not define', () => {
    const stray = [...all].filter(t => !tokens.has(t));
    expect(stray).toEqual([]);
  });

  it('points every colour at the theme, never at a literal', () => {
    const start = themeCss.indexOf('{');
    const block = themeCss.slice(start, themeCss.indexOf('}', start));
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
