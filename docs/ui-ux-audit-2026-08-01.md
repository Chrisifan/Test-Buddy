# TestBuddy UI / UX Audit - 2026-08-01

## Scope

The desktop workbench was inspected with no active project selected. The review covered overview, projects, requirements analysis, case composition, run records, natural-language testing, workflow composition, recording and replay, and every settings section. Read-only navigation and local editor controls were exercised. Model connection tests and browser/agent runs were deliberately not started because they would call the user's configured external model endpoint or a target site.

## Findings And Disposition

| Priority | Area | Finding | Resolution |
| --- | --- | --- | --- |
| High | Requirements analysis | The upload and analysis form was visible without a project. Its submit handlers correctly avoided persistence, but the user could complete work that would disappear. | Replaced with a project-required state and a direct route to Projects. |
| High | Case, workflow, recording | Empty project-dependent pages left a sparse, top-aligned warning. Workflow creation controls remained available with no project but did nothing. | Standardized a centered project-required state for all four pages. The workflow creation controls are no longer rendered until a project is selected. |
| Medium | Workspace data | Run records showed historical demo runs while the project count was zero, which made the workspace appear inconsistent. | The current hydration migration already removes the legacy project's runs, details, browser state, and chat samples while preserving user-created projects. Rebuilding the desktop bundle applies it to the running application. |
| Medium | Overview | The project-free overview used a 410px hero and oversized floating icon, out of scale with the compact workbench tokens. | Reduced the empty state to a 330px surface, with smaller icon and title sizing. |
| Medium | Settings | The settings dialog could easily regress into a full-screen page. | Kept the current compact modal structure unchanged; its grouped navigation, role expander, MidScene connection form, and execution settings were all reachable. |

## Regression Coverage

Component tests now verify that each project-dependent page exposes the Projects action and that the document intake and workflow creation controls do not appear before a project is selected. Existing state-hydration tests verify that the cleanup removes only the legacy demo workspace and retains a persisted user project.

## Deferred Validation

- Validate MidScene connection success and failure feedback after the user decides to spend external-model quota.
- Validate a real controlled-browser session against a non-sensitive target environment after a project and runtime URL are configured.
- Create a real project and run an end-to-end create, edit, record, execute, and evidence-export pass.
