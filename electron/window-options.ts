import type { BrowserWindowConstructorOptions } from 'electron';

export interface MainWindowOptionsInput {
  icon: BrowserWindowConstructorOptions['icon'];
  preloadPath: string;
  platform: NodeJS.Platform;
}

export function createMainWindowOptions({
  icon,
  preloadPath,
  platform,
}: MainWindowOptionsInput): BrowserWindowConstructorOptions {
  return {
    width: 1200,
    height: 760,
    minWidth: 1200,
    minHeight: 760,
    title: 'TestBuddy',
    icon,
    backgroundColor: platform === 'darwin' ? '#00000000' : '#050505',
    autoHideMenuBar: true,
    ...(platform === 'darwin'
      ? {
          titleBarStyle: 'hidden',
          transparent: true,
          vibrancy: 'under-window',
          visualEffectState: 'active',
        }
      : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
}
