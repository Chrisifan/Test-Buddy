import {
  hydrateStudioState,
  type RuntimeInfo,
  type StudioState,
} from '../../shared/studio.js';

const STORAGE_KEY = 'midscene-studio-state-v2';

const getDesktopApi = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.desktopApi ?? null;
};

export const loadStudioState = async (): Promise<StudioState> => {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return hydrateStudioState(await desktopApi.loadStudioState());
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return hydrateStudioState(null);
  }

  try {
    return hydrateStudioState(JSON.parse(raw) as StudioState);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return hydrateStudioState(null);
  }
};

export const saveStudioState = async (state: StudioState): Promise<void> => {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    await desktopApi.saveStudioState(state);
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export const getRuntimeInfo = async (): Promise<RuntimeInfo> => {
  const desktopApi = getDesktopApi();
  if (desktopApi) {
    return desktopApi.getRuntimeInfo();
  }

  return {
    platform: 'browser',
    persistence: 'localStorage',
  };
};
