# Native Glass Rail Has An Explicit Theme Contract

TestBuddy keeps the macOS Native Glass Rail in both light and dark themes because it supports the desktop-workbench character. Electron vibrancy supplies the blur, while renderer-owned semantic tokens must supply a light or dark glass overlay, edge, and text contrast; a transparent rail that depends only on whatever sits behind the window is not an accepted implementation.

## Considered Options

- Preserve glass with theme-owned overlay, border, and contrast rules.
- Keep the current fully transparent rail and rely on operating-system vibrancy.
- Use a solid dark rail only in dark mode.

## Consequences

The renderer owns stable visual contrast and Electron owns the native material effect. Both themes must be checked in the packaged desktop app, rather than only in browser screenshots.
