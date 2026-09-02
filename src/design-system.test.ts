import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readLuminousPrecisionCss } from './styles/luminous-precision.test-utils.js';

const tokenStylesheetPath = path.resolve(process.cwd(), 'src/styles/design-tokens.css');
const stylesheet = readLuminousPrecisionCss();
const tokenStylesheet = existsSync(tokenStylesheetPath) ? readFileSync(tokenStylesheetPath, 'utf8') : '';

const normalizeCss = (value: string): string => {
  return value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim().toLowerCase();
};

const ruleFor = (selector: string): string => {
  return ruleForIn(stylesheet, selector);
};

const ruleForIn = (source: string, selector: string): string => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = normalizeCss(source).match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`));

  return match?.[1] ?? '';
};

const canonicalValue = (value: string): string => {
  const compactValue = normalizeCss(value)
    .replace(/\s*!important$/, '')
    .replace(/\s+/g, '')
    .replace(/([(:,])0\.(?=\d)/g, '$1.');

  return compactValue === '#fff' ? '#ffffff' : compactValue;
};

const expectDeclaration = (rule: string, property: string, value: string): void => {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = rule.match(new RegExp(`(?:^|;)\\s*${escapedProperty}\\s*:\\s*([^;]+)`));

  expect(canonicalValue(declaration?.[1] ?? ''), `Expected ${property} to be ${value}.`).toBe(
    canonicalValue(value),
  );
};

describe('Luminous Precision design system', () => {
  it('keeps semantic tokens in the dedicated stylesheet', () => {
    expect(tokenStylesheet).not.toBe('');
    expect(tokenStylesheet.match(/:root\s*\{/g)).toHaveLength(1);
    expect(tokenStylesheet.match(/\.dark\s*\{/g)).toHaveLength(1);
    expect(stylesheet.match(/:root\s*\{/g) ?? []).toHaveLength(0);
    expect(stylesheet.match(/\.dark\s*\{/g) ?? []).toHaveLength(0);
  });

  it('provides the dedicated final-cascade stylesheet', () => {
    expect(
      stylesheet,
      'Expected src/styles/luminous-precision.css to define the Figma design contract.',
    ).not.toBe('');
  });

  it('defines the Figma color, geometry, and radius tokens', () => {
    const root = ruleForIn(tokenStylesheet, ':root');

    expectDeclaration(root, '--primary', '#0066ff');
    expectDeclaration(root, '--workspace-background', '#ffffff');
    expectDeclaration(root, '--sidebar-background', 'rgba(255, 255, 255, 0.2)');
    expectDeclaration(root, '--sidebar-width', '224px');
    expectDeclaration(root, '--topbar-height', '56px');
    expectDeclaration(root, '--runtimebar-height', '40px');
    expectDeclaration(root, '--control-radius', '4px');
    expectDeclaration(root, '--panel-radius', '8px');
    expectDeclaration(root, '--control-height', '32px');
    expectDeclaration(root, '--font-size-control', '13px');
    expectDeclaration(root, '--density-control-height-sm', '26px');
    expectDeclaration(root, '--density-control-height-lg', '36px');
    expectDeclaration(root, '--density-panel-padding', '12px');
  });

  it('uses the shared primary blue in both color schemes', () => {
    const dark = ruleForIn(tokenStylesheet, '.dark');

    expectDeclaration(dark, '--primary', '#0066ff');
    expectDeclaration(dark, '--ring', '#0066ff');
  });

  it('keeps the rail glass layers translucent instead of panel-like', () => {
    const root = ruleForIn(tokenStylesheet, ':root');
    const dark = ruleForIn(tokenStylesheet, '.dark');

    expectDeclaration(root, '--sidebar-glass-highlight', 'rgba(255, 255, 255, 0.18)');
    expectDeclaration(root, '--sidebar-glass-shade', 'rgba(189, 196, 207, 0.1)');
    expectDeclaration(dark, '--sidebar-background', 'rgba(17, 19, 24, 0.88)');
    expectDeclaration(dark, '--sidebar-glass-highlight', 'rgba(150, 170, 210, 0.06)');
    expectDeclaration(dark, '--sidebar-glass-shade', 'rgba(0, 0, 0, 0.18)');
  });

  it('applies the shell tokens and the required frosted-glass navigation', () => {
    const rail = ruleFor('.app-rail');
    const workspace = ruleFor('.app-main');
    const topbar = ruleFor('.app-topbar');
    const runtimebar = ruleFor('.app-runtimebar');

    expectDeclaration(rail, 'width', 'var(--sidebar-width)');
    expectDeclaration(rail, 'background', 'color-mix(in srgb, var(--sidebar-background) 32%, transparent)');
    expectDeclaration(rail, '-webkit-backdrop-filter', 'blur(32px) saturate(160%)');
    expectDeclaration(rail, 'backdrop-filter', 'blur(32px) saturate(160%)');
    expectDeclaration(rail, 'border-radius', '0');
    expectDeclaration(workspace, 'background', 'var(--workspace-background)');
    expectDeclaration(topbar, 'height', 'var(--topbar-height)');
    expectDeclaration(runtimebar, 'height', 'var(--runtimebar-height)');
  });

  it('keeps shared controls compact and panels softly framed', () => {
    const controls = ruleFor("[data-slot='button'], [data-slot='input'], [data-slot='select-trigger']");
    const panels = ruleFor('.tech-panel, .designer-panel, .home-stat-card');

    expectDeclaration(controls, 'border-radius', 'var(--control-radius)');
    expectDeclaration(panels, 'border-radius', 'var(--panel-radius)');
  });
});
