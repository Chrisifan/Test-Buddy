import { expect, test } from 'vitest';
import { enUS } from './locales/en-US.js';
import { zhCN } from './locales/zh-CN.js';

test('locale dictionaries retain the shared settings translation keys', () => {
  expect(zhCN['settings.title']).toBe('应用设置');
  expect(enUS['settings.title']).toBe('Application Settings');
});
