import type { DesktopApi } from '../shared/studio.js';

declare global {
  interface Window {
    desktopApi?: DesktopApi;
  }
}

export {};

