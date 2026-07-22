/* Standalone-only DOM: the source textarea. The shared helpers and canvas
   refs live in @bootstrap-visualizer/editor. */

import { $ } from '@bootstrap-visualizer/editor';

export const srcTA = $<HTMLTextAreaElement>('#src');
