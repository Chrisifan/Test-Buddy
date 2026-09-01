# Model Secret Saved State

## Goal

Make a successfully stored model key unambiguous without exposing or retaining
the key in renderer state.

## Interaction

Each model key control has two modes:

1. **No stored key**: show a password input and a disabled-until-filled Save
   button.
2. **Stored key**: replace the empty password input with a prominent success
   state, including a check icon and the text "Key saved securely". Provide a
   Replace key action and an adjacent Clear action.

Selecting Replace key returns the control to a fresh password input. Saving the
replacement immediately returns it to the stored state. The submitted value is
cleared from the DOM input after a successful save and is never rendered,
persisted, or held in React state.

## Scope

Apply the behavior to the MidScene key and each independent agent-model key.
Keep the existing save, clear, error, and busy-state behavior unchanged.

## Verification

Add component tests proving that a saved key shows the stored state rather than
an empty password input, and that Replace key restores the password input.
Run the settings and app tests, typecheck, and the Electron build.
