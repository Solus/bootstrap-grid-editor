import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/* Two build shapes from one source (PLAN.md):
     vite build                → a normal static site in dist/
     vite build --mode single  → one self-contained HTML file you can
                                 double-click, everything inlined. */
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
}));
