# Startup Top Stepper Design

## Goal

Restore the first-run startup screen as a top-oriented onboarding flow. The stepper belongs above the configuration content, and the screen uses the same TestBuddy hammer-bot asset and theme selection as the workbench navigation.

## Scope

- Modify only the startup screen component, its tests, the application call site required to supply the active brand asset, and its final-cascade styles.
- Keep the MidScene form fields, validation, step-state calculation, localized strings, callbacks, help destination, and footer behavior unchanged.
- Do not change persisted startup-guide state, navigation behavior, or the shared application navigation logo.

## Chosen Layout

The startup shell has three rows on desktop:

1. A full-width header containing the TestBuddy brand, horizontal three-step progress indicator, and documentation link.
2. The existing hero, feature summary, and MidScene configuration content in the primary scrollable area.
3. The existing compact status footer.

The brand mark is an `img`, not a Lucide `Bot` glyph. `App` supplies the already-resolved light or dark hammer-bot asset to `StartupPage`, so the startup screen stays consistent with the active theme.

At narrow widths, the header and content become a normal vertically scrolling page. The progress items remain ordered before the configuration content; they may wrap without being converted into a left navigation rail. The help card is reduced to the existing documentation link in the header.

## Component and Data Flow

`App` continues to derive `brandLogo` from `effectiveTheme`. In the startup branch it passes this URL as a new `brandLogo` prop to `StartupPage`.

`StartupPage` keeps ownership of the localized `startupSteps` array and its existing `midsceneReady` state calculation. It renders the supplied logo in the header and preserves all existing `onComplete`, `onSkip`, and `onUpdateMidsceneConfig` callback wiring. No persistence model or public IPC contract changes.

## Style Rules

- Replace the final-cascade 224px side-rail grid with a single-column, three-row startup shell.
- Give the header a stable height, a bottom divider, and a responsive three-part grid: brand, step list, documentation link.
- Render the step list horizontally on desktop, with connectors between adjacent items and visible active/done treatments.
- Use semantic theme tokens only; do not hard-code a second palette for the startup page.
- Reserve fixed logo dimensions and use `object-fit: contain` to avoid cropped or stretched branding.
- Retain reduced-motion support supplied by the global stylesheet.

## Verification

- Extend `StartupPage.test.tsx` to assert that the startup header contains an image whose source is the supplied brand asset and that all three step labels remain available.
- Run the focused component test before and after implementation as a red-green regression test.
- Run type checking and the full test suite after implementation.
- Inspect the startup screen at desktop and narrow viewport widths in the browser, checking the top stepper order, readable layout, and theme-appropriate logo.
