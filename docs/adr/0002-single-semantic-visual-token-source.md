# Use One Semantic Visual Token Source

TestBuddy will keep one authoritative semantic token source for color, material, spacing, radius, typography, and motion. Components consume those tokens and may own local layout; a second global final-cascade stylesheet must not redefine the same visual contracts.

## Considered Options

- Consolidate the existing token definitions and component overrides into one source of truth.
- Continue to layer a second global stylesheet over the first one.
- Let each feature page define its own visual rules.

## Consequences

Theme changes, especially `#0066ff` primary and Native Glass Rail materials, become predictable across all pages. The migration must preserve current behavior page by page while deleting duplicate declarations only after their consumers move.
