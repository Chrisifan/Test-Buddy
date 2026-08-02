import { describe, expect, it } from 'vitest';

import { createTranslator, enUS, resolveLocale, zhCN } from './index.js';

describe('i18n', () => {
  it('translates known UI keys and returns the key for unknown messages', () => {
    const zh = createTranslator('zh-CN');
    const en = createTranslator('en-US');

    expect(zh('settings.title')).toBe('应用设置');
    expect(en('settings.title')).toBe('Application Settings');
    expect(en('settings.midscene.requiredHint')).toContain('Model service URL');
    expect(zh('settings.unknown.key')).toBe('settings.unknown.key');
  });

  it('keeps Chinese and English dictionaries in sync', () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it('resolves system locale to a supported UI locale', () => {
    expect(resolveLocale('system', 'zh-Hans-CN')).toBe('zh-CN');
    expect(resolveLocale('system', 'en-GB')).toBe('en-US');
    expect(resolveLocale('zh-CN', 'en-US')).toBe('zh-CN');
  });
});
