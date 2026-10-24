# Verification

## Automated checks

`npm run build` runs JavaScript syntax/resource checks and Node's built-in test
runner, then packages the add-on. Unit tests exercise URL/command/color validation,
HTML escaping, emoji sequences, plain-text restrictions, toolbar-origin checks,
tab targeting, existing-window injection, numeric typography bounds, native-operation
routing, and deterministic archive contents.

`npm run test:thunderbird` builds and installs the actual XPI into a real Linux
Thunderbird instance in an isolated offline profile. It requires Xvfb
and xfwm4, and uses the built-in Marionette test protocol with Python's standard
library. The test driver operates only inside that disposable test process. The
shipped extension's small Experiment API is exercised through real toolbar hosts.

The native suite exercises selection preservation through the real toolbar, inline
styles, fonts, sizes, colors and clearing, alignment, lists, indentation, block
styles, dividers, safe links, emoji, native undo/redo, plain-text restrictions, and
local preferences. It also checks persistent-toolbar placement and interactions,
live state, narrow-window wrapping, isolation between drafts, the settings page,
preference synchronization across windows, reload, and complete UI cleanup on
disable. Thunderbird's toolbar must be hidden by default, and the former popup
and launcher buttons must be absent. Toolbar controls must wrap without horizontal overflow.
Screenshot capture is optional and uses ImageMagick's `import` tool.

Typography coverage compares the font field with the real system font enumerator,
checks exact point sizing on links and mixed-style selections, subsequent typing
at the caret, and line/paragraph spacing. Native undo/redo must restore the previous
HTML without touching unrelated paragraphs.
The searchable font dropdown is exercised with filtering and keyboard selection.
All seven dropdowns must open as native floating panels without changing the toolbar's
height/width or the message editor's position/height. Escape dismisses the font
popup without changing message content.
Style previews apply the selected block style and undo correctly. Color popups
apply text/background colors, remember custom colors, and clear highlights. Link
and emoji popups retain native selections; emoji also work in plain text.
Popup placement must overlap the triggering button horizontally, including near
screen edges. Tests switch Thunderbird's built-in light and dark themes and compare
the toolbar and popup colors with the native palette.
Line-spacing tests cover quick presets and a custom percentage; paragraph buttons
must preserve differing margins across a selection, stop at zero, and undo together.

Logs, screenshots, and a machine-readable success result go to `test-results/`.
The test terminates its Thunderbird, window manager, and Xvfb processes and removes
its temporary profile, including on test failure.

Verified during implementation on **Thunderbird 153.4.0 ESR, Linux**, with Node.js
24.21.0 and Python 3.14.8. Thunderbird 128 is the declared API minimum, not a claim
that the native suite has been run against that version.

## Release checklist

Repeat on the oldest supported Thunderbird version and the current ESR before
publishing. Do not infer support for an untested version from the minimum manifest
version alone.

- Install the XPI from file, restart Thunderbird, and verify the persistent toolbar
  with no popup launcher or toolbar settings gear. Verify temporary load/reload during development.
- Open two compose windows before enabling the add-on. Format a selection in each;
  make sure the other draft remains untouched. Close a targeted window and confirm
  stale commands never reach another draft.
- In HTML new messages, replies, forwards, and reopened drafts, format whole words,
  partial words, multiline selections, and a collapsed cursor. Check native undo
  and redo from both the toolbar and Thunderbird's keyboard shortcuts.
- Exercise every font, size, block style, inline toggle, alignment, list, and
  indentation control. Verify text background colors and highlight clearing.
- Choose an installed font outside the previous subset and enter point sizes such
  as 9, 12, and 10.5. Check mixed sizes, selections crossing links, and caret typing.
- Apply single, 1.15, 1.5, double, and custom proportional line spacing. Use both
  paragraph-spacing buttons repeatedly. Check selections spanning paragraphs, list items,
  empty paragraphs, and bare body text. Verify each operation undoes in one step.
- Open the font dropdown, filter its choices, use arrows/Enter, and cancel with
  Escape. Check every dropdown in narrow compose windows for clipping or overflow,
  including buttons near the screen edge.
- Apply custom colors, reopen the color tools, and check the remembered palette choice.
- Insert/edit/remove web, email, and phone links. Test a quoted label and reject
  `javascript:`/`data:` links. Preserve formatting of an existing linked selection.
- Search and insert emoji, including variation selectors and recent emoji. Verify
  emoji insertion in plain-text compose mode without HTML artifacts.
- Save a draft normally, reopen it, and inspect the formatting. Verify that
  signatures, quoted replies, and attachments survive; no toolbar markup should
  appear in the message source. Send only to a controlled test mailbox when
  doing manual end-to-end delivery checks.
- Check live light/dark theme changes, keyboard-only navigation, focus visibility, screen reader
  names, and display scaling. Verify the toolbar remains usable on small displays.
- Inspect the XPI and checksum; ensure only extension assets are distributed.
- Verify only Rich Text's toolbar is visible initially. Toggle the default-toolbar
  setting and hide/show Rich Text from its Add-ons Manager preferences. Check that
  previously saved visibility choices survive an upgrade. Disable/uninstall the add-on with multiple
  drafts open and verify restoration without changing their content or
  Thunderbird's persisted toolbar visibility. Check the full-access permission
  prompt when upgrading from 1.0.
