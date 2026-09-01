import { describe, expect, it } from 'vitest';

import { readLuminousPrecisionCss } from './luminous-precision.test-utils.js';

describe('application shell navigation', () => {
  it('uses a themed frosted-glass surface for the main navigation rail', () => {
    const styles = readLuminousPrecisionCss();
    const railRule = styles.match(/\.app-rail\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const darkRailRule = styles.match(/\.dark \.app-rail\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const railOverlayRule = styles.match(/\.app-rail::before\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const shellBackdropRule = styles.match(/\.app-shell::before\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const railEdgeRule = styles.match(/\.app-rail::after\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const activeNavRule = styles.match(/\.nav-button\.is-active\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const shellRule = styles.match(/\.app-shell\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const workspaceRule = styles.match(/\.app-workspace\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const rootSurfaceRule = styles.match(/html,\s*body,\s*#root\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(rootSurfaceRule).toContain('background: transparent;');
    expect(shellRule).toContain('background: transparent;');
    expect(shellRule).toMatch(/gap:\s*0;/);
    expect(shellRule).toMatch(/padding:\s*0;/);
    expect(railRule).toContain('background: color-mix(in srgb, var(--sidebar-background) 32%, transparent);');
    expect(darkRailRule).toContain('background: color-mix(in srgb, var(--sidebar-background) 94%, transparent);');
    expect(railRule).toContain('border: 0;');
    expect(railRule).toContain('box-shadow: none;');
    expect(railRule).toContain('border-radius: 0;');
    expect(railRule).toMatch(/backdrop-filter:\s*blur\(32px\)\s*saturate\(160%\);/);
    expect(railOverlayRule).toContain("content: '';" );
    expect(railOverlayRule).toContain('background: linear-gradient(');
    expect(railOverlayRule).toContain('var(--sidebar-glass-highlight)');
    expect(railOverlayRule).toContain('var(--sidebar-glass-shade)');
    expect(railOverlayRule).toContain('z-index: 0;');
    expect(railEdgeRule).toContain('content: none;');
    expect(activeNavRule).toContain('background: transparent;');
    expect(activeNavRule).toContain('box-shadow: inset 2px 0 var(--primary);');
    expect(shellBackdropRule).toContain('content: none;');
    expect(workspaceRule).toMatch(/border-radius:\s*0;/);
    expect(workspaceRule).toContain('box-shadow: none;');
  });

  it('uses the top bar as a native drag region without disabling its controls', () => {
    const styles = readLuminousPrecisionCss();
    const topbarRule = styles.match(/\.app-topbar\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const searchRule = styles.match(/\.app-search\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const actionsRule = styles.match(/\.app-topbar-actions\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(topbarRule).toMatch(/-webkit-app-region:\s*drag;/);
    expect(searchRule).toMatch(/-webkit-app-region:\s*no-drag;/);
    expect(actionsRule).toMatch(/-webkit-app-region:\s*no-drag;/);
  });

  it('keeps planner and evidence rails reachable at intermediate widths', () => {
    const styles = readLuminousPrecisionCss();
    const responsiveStart = styles.indexOf('@media (max-width: 1120px)');
    const responsiveEnd = styles.indexOf('/* Keep modal proportions', responsiveStart);
    const responsive = styles.slice(responsiveStart, responsiveEnd);

    expect(responsive).toContain('.nl-planner-panel');
    expect(responsive).toContain('.run-evidence-rail');
    expect(responsive).toMatch(/grid-column:\s*1\s*\/\s*-1;/);
    expect(responsive).toMatch(/max-height:\s*min\(/);
    expect(responsive).not.toContain('display: none;');
  });
});
