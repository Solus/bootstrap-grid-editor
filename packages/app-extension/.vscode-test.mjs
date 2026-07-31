import { defineConfig } from '@vscode/test-cli';

/* Runs the integration suite inside a real VS Code (downloaded on first run,
   cached under .vscode-test/). The suite drives the extension's own
   `createSessionPorts` against a real TextDocument — see
   test-integration/buffer-seam.test.ts for why that layer needs a real editor.

   The tests are bundled to CJS first (`npm run build:tests`), because Mocha
   loads them from disk here and the sources are ESM TypeScript across three
   workspace packages. */
export default defineConfig({
  files: 'dist/test-integration/**/*.test.cjs',
  // A clean, isolated profile: no user extensions, no user settings, so a
  // formatter or a stray setting on the developer's machine can't change what
  // the buffer settles on.
  launchArgs: ['--disable-extensions', '--disable-gpu'],
  mocha: {
    ui: 'tdd',
    timeout: 20_000,
  },
});
