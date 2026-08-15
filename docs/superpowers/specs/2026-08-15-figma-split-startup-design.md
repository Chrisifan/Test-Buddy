# Figma Split Startup Design

## Goal

Replace the current first-run startup screen with the two-column onboarding screen from Figma frame `1:3`. The screen must make TestBuddy's testing workflow immediately recognizable while preserving the existing MidScene configuration, startup-guide state, localization, and navigation callbacks.

## Reference

Figma: `https://www.figma.com/design/9B4Kq15l1MDGTXx23J2vmT/Untitled?node-id=1-3`

The reference establishes a deep-blue branded panel on the left and a white configuration workspace on the right. It uses a horizontal three-step progress indicator, three capability summaries, a bounded MidScene form, and a small security note.

## Layout

### Desktop

- The startup shell fills the viewport and uses a stable two-column grid. The brand panel occupies approximately 44% of the width; the configuration workspace occupies the remainder and scrolls independently when the form cannot fit vertically.
- The left panel uses the existing theme-resolved TestBuddy hammer-bot asset, product name, a short localized welcome message, and three concise proof points.
- In place of the static robot illustration, the left panel renders a code-native, decorative test-flow animation: a browser surface, three linked test-action nodes, a moving progress pulse, and a resolved assertion. It is marked `aria-hidden` and is disabled by the global reduced-motion preference.
- The right workspace starts with the existing localized three-step progress model. Below it, the existing three startup capabilities are shown as compact cards. The MidScene configuration follows inside one bordered form surface with its existing labels, validation state, field bindings, and actions.
- The skip action stays available without requiring MidScene configuration. The save action remains disabled until the existing `midsceneReady` condition is true.

### Responsive Behavior

- At widths below the desktop breakpoint, the shell becomes a vertically scrolling page. The brand panel remains first but changes into a compact introduction; configuration follows it in document order.
- At phone widths, the proof points and decorative flow animation are hidden. The three-step progress indicator stacks so every localized label remains readable.
- No breakpoint may create overlapping cards, a clipped form, or horizontal overflow.

## Component Boundaries

- `StartupPage` continues to own the startup step state, localized capability data, MidScene field callbacks, and startup actions.
- A small presentational `StartupFlowVisual` component is colocated with `StartupPage`. It contains only semantic-free markup for the decorative animation and no application state.
- `App` continues to provide the already-resolved TestBuddy brand asset; no persistence, IPC, or startup-guide contract changes are required.

## Visual Rules

- Use the Figma panel hierarchy: deep blue on the left, white workspace on the right, restrained borders, and a single strong blue primary action.
- Use the current TestBuddy logo asset rather than substituting a generic icon.
- Use Lucide icons for the capability and workflow indicators. The animation communicates a real testing sequence instead of generic decorative shapes.
- Keep all user-facing copy localized through the existing translation system.

## Verification

- Add a failing component test for the split startup landmark structure, supplied brand asset, workflow visual, and existing MidScene controls.
- Add a failing CSS contract test for the desktop split layout and mobile single-column fallback.
- Run the focused startup test before and after the implementation, then run the full test suite.
- Inspect the rendered startup page at the Figma desktop proportion, a short desktop viewport, and a phone viewport. Verify the right workspace scrolls instead of overlapping, the animation is contained in the left panel, and all actions remain reachable.
