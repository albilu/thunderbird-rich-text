# Verification

## Automated checks

`npm run build` runs JavaScript syntax/resource checks and Node's built-in test
runner, then packages the add-on. Unit tests exercise URL/command/color validation,
HTML escaping, emoji sequences, plain-text restrictions, popup-origin checks,
tab targeting, existing-window injection, and deterministic archive contents.

`npm run test:thunderbird` builds and installs the actual XPI into a real Linux
Thunderbird instance in an isolated offline profile. It requires Xvfb, xdotool,
and xfwm4, and uses the built-in Marionette test protocol with Python's standard
library. The test driver has elevated access only inside
that disposable test process; the shipped extension has no experiment APIs.

The native suite exercises selection preservation through the real popup, inline
styles, fonts, sizes, colors and clearing, alignment, lists, indentation, block
styles, dividers, safe links, emoji, native undo/redo, plain-text restrictions, and
local preferences. It also checks that the footer is visible without horizontal
overflow. Screenshot capture is optional and uses ImageMagick's `import` tool.

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

- Install the XPI from file, restart Thunderbird, and verify the compose toolbar
  button and Alt+Shift+R shortcut. Verify temporary load/reload during development.
- Open two compose windows before enabling the add-on. Format a selection in each;
  make sure the other draft remains untouched. Close a targeted window while its
  panel is open and confirm the error is clear.
- In HTML new messages, replies, forwards, and reopened drafts, format whole words,
  partial words, multiline selections, and a collapsed cursor. Check native undo
  and redo from both the popup and Thunderbird's keyboard shortcuts.
- Exercise every font, size, block style, inline toggle, alignment, list, and
  indentation control. Verify text background colors and highlight clearing.
- Apply custom colors, reopen the panel, and check the remembered palette choice.
- Insert/edit/remove web, email, and phone links. Test a quoted label and reject
  `javascript:`/`data:` links. Preserve formatting of an existing linked selection.
- Search and insert emoji, including variation selectors and recent emoji. Verify
  emoji insertion in plain-text compose mode without HTML artifacts.
- Save a draft normally, reopen it, and inspect the formatting. Verify that
  signatures, quoted replies, and attachments survive; no toolbar markup should
  appear in the message source. Send only to a controlled test mailbox when
  doing manual end-to-end delivery checks.
- Check dark mode, keyboard-only navigation, focus visibility, screen reader
  names, and display scaling. Verify the popup remains usable on small displays.
- Inspect the XPI and checksum; ensure only extension assets are distributed.
