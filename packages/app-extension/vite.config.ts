import { defineConfig } from 'vite';

/* Builds the webview bundle: the shared editor + the webview host, into
   fixed-name assets the extension references with a CSP nonce. Not an HTML
   entry — the host generates the page (getWebviewHtml). */
export default defineConfig({
  build: {
    outDir: 'dist/webview',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,   // for the webview devtools (Developer: Open Webview Developer Tools)
    rollupOptions: {
      input: 'src/webview/main.ts',
      output: {
        entryFileNames: 'webview.js',
        assetFileNames: 'webview.[ext]',
      },
    },
  },
});
