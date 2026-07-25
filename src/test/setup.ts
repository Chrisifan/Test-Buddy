import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

Object.defineProperty(window, 'matchMedia', {
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
  writable: true,
});

const localStorageStore = new Map<string, string>();

Object.defineProperty(window, 'localStorage', {
  value: {
    clear: () => localStorageStore.clear(),
    getItem: (key: string) => localStorageStore.get(key) ?? null,
    key: (index: number) => Array.from(localStorageStore.keys())[index] ?? null,
    removeItem: (key: string) => localStorageStore.delete(key),
    setItem: (key: string, value: string) => localStorageStore.set(key, value),
    get length() {
      return localStorageStore.size;
    },
  },
  writable: true,
});
