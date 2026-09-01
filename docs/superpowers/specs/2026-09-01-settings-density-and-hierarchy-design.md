# Settings Density And Hierarchy

## Goal

Make the settings dialog scan as a compact configuration tool rather than a
guided sequence, while keeping all existing settings behavior intact.

## Structure

Remove the numbered section eyebrows (`01 / 02 / 03 / 04`) because the left
navigation already establishes the active settings category. Retain each page
title. Remove the entire MidScene "Available after configuration" feature-card
section; it does not help the user complete the current configuration task.

Keep the model-connection row and its result feedback. Replace the test button's
wireless icon with Lucide's `PlugZap` icon to communicate an active connection
probe rather than Wi-Fi status.

## Controls

The stored-key row uses the same desktop control height as standard text inputs.
Its buttons remain usable at that height and the row is allowed to grow only on
narrow screens where controls must wrap.

Inside the settings dialog only, form labels use a smaller, muted foreground
color and have a larger vertical gap before their control. Input values keep the
stronger foreground color so labels and values are immediately distinguishable.
The shared application form styles remain unchanged.

## Verification

Update the settings component tests to assert that the removed introductory
content and section numbers are absent, and that connection testing continues to
call the same handler. Run the settings and app tests, typecheck, production
build, and visual inspection at desktop and narrow widths.
