import type { BrowserWindowConstructorOptions } from 'electron';

export interface MainWindowOptionsInput {
  icon: BrowserWindowConstructorOptions['icon'];
  preloadPath: string;
  platform: NodeJS.Platform;
}

export const createMainWindowOptions = ({
  icon,
  preloadPath,
  platform,
}: MainWindowOptionsInput): BrowserWindowConstructorOptions => {
  return {
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
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
};
