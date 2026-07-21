/* Ambient types for the non-TS imports Vite resolves. */

declare module '*.css';

declare module '*?raw' {
  const content: string;
  export default content;
}
