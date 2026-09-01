# TestBuddy UI Vocabulary

TestBuddy is a local desktop workbench for creating, executing, inspecting, and preserving web-test assets. These terms keep product, design, and implementation discussions about its interface precise.

## Workspace

**App Shell**:
The persistent desktop frame made of the Native Glass Rail, top bar, workspace, and runtime bar.
_Avoid_: page chrome, outer layout

**Native Glass Rail**:
The macOS-vibrant navigation region in the App Shell. It is a themed material with an explicit overlay and contrast contract, not an uncontrolled transparent area.
_Avoid_: transparent sidebar, blur background

**Workbench**:
The page region in which a user operates on test assets, plans, executions, or evidence. It may be a single flow or a multi-column editor.
_Avoid_: dashboard, canvas (unless referring to a concrete editing canvas)

**Surface**:
A bounded information or interaction layer in the Workbench, with one of the panel, subtle, active, evidence, stat, or plain visual roles.
_Avoid_: card, box

**Evidence Rail**:
A dedicated secondary column that keeps execution evidence available beside its source or result.
_Avoid_: right sidebar, details panel

## State And Page Families

**RunState**:
The cross-page execution vocabulary: queued, running, passed, failed, blocked, skipped, cancelled, or error. Each state has one color, icon, label, and motion rule.
_Avoid_: status, state (when the execution state is meant)

**Overview Page**:
A scan-oriented page that summarizes quality signals and points to the next relevant operation.
_Avoid_: dashboard (unless describing the implementation)

**Inventory Page**:
A page for finding, filtering, selecting, or managing test assets.
_Avoid_: list page

**Editor Page**:
A page for creating or modifying one test asset or plan, with tools and inspectors close to the current selection.
_Avoid_: form page

**Execution Page**:
A page that presents a live or historical run, its state, and its evidence.
_Avoid_: results page

## Visual Boundaries

**Product Surface**:
Any TestBuddy-owned interface surface. It must use semantic theme tokens and satisfy the light/dark contrast contract.

**Target-page Mock**:
A visual stand-in for the website being tested, such as a browser preview. It may reflect the target page rather than TestBuddy branding, but must remain legible in both themes.

**Code Log**:
A literal or structured runtime output view. It has an intentionally technical visual treatment and is not a Product Surface.
