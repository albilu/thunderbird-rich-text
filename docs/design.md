# Design

## Native editor, small formatting panel

The add-on enhances Thunderbird's own composer. A public `compose_action` opens
the panel from the main compose toolbar. A `composeScripts` registration installs
the formatting bridge in new compose bodies; `tabs.executeScript` initializes
already open bodies on startup or on first use. Injection is idempotent and
deduplicated per tab. UI elements never enter the email DOM.

```text
Compose toolbar → popup → background → compose script → native editing engine
                           ↓                  ↓
                    verify tab/mode      save/restore selection
```

- `extension/shared.js`: allowlisted commands, input validation, link escaping,
  fonts, palettes, and emoji. Shared verbatim by all three script contexts.
- `extension/background.js`: registration, existing-window injection, message
  routing, tab validation, and plain-text checks.
- `extension/editor.js`: live selection tracking, native editing commands, and
  reporting of current selection/format state.
- `extension/popup/`: local HTML/CSS/JavaScript UI; storage contains only color
  preferences and recent emoji.

The popup obtains the active compose tab once. Subsequent requests use that tab
ID, even if the user activates a different compose window. A closed or non-compose
tab produces an error instead of redirecting an edit to another draft. The
background only accepts requests from this extension's popup, and checks message
format before every command. A second allowlist check runs inside the editor.

## Selection and editing history

Selection ranges are remembered while the message body has focus and when it
loses focus. The range is restored before commands, so focusing popup inputs does
not lose the selected words. Disconnected ranges are discarded. A fresh message
with no remembered cursor uses the start of the body. State queries restore the
range without focusing the editor or closing the popup.

Formatting uses Gecko's `document.execCommand`, including `insertText` for emoji.
Although deprecated on the general web, this is deliberately confined to the
Thunderbird adapter: it edits using Gecko's native transactions and preserves
Thunderbird's undo history. Replacing `body.innerHTML` or round-tripping the whole
message through `compose.setComposeDetails` on every operation would disrupt
selection and editing history. The add-on does neither. CSS formatting mode is
temporarily enabled and restored after each command.

Links use `createLink` when preserving an existing selection. A new label uses
`insertHTML` with a validated URL and escaped label and attribute. No user-supplied
HTML, arbitrary CSS, or arbitrary command is accepted. Supported URL schemes are
HTTP, HTTPS, mailto, and tel. Emoji are inserted as Unicode text.

## Scope and compatibility

Manifest V2 and public APIs keep packaging simple and avoid full-access
experiments or private XUL hooks. Thunderbird 128 is the declared minimum; tested
versions are recorded separately. The same package works across architectures
without a native component. Linux-specific font families are included alongside
common generic/web-safe families; unavailable fonts fall back through the native
editor and recipient mail client.

The editor never converts plain text to HTML, changes account preferences, handles
attachments, intercepts sending, or adds send-time transformations. Emoji and
history remain available in plain-text mode. Rich message rendering still depends
on Thunderbird's send format and the recipient's mail client.

The UI uses system fonts and native controls, labels and focus indicators, proper
tab semantics, `aria-pressed` for toggle state, status/error announcements, and
light/dark theme variables. Network resources and runtime dependencies are absent.

## API references

- [Compose actions](https://webextension-api.thunderbird.net/en/mv2/composeAction.html)
- [Compose scripts and injection into existing windows](https://webextension-api.thunderbird.net/en/mv2/composeScripts.html)
- [Permissions for Thunderbird APIs](https://developer.thunderbird.net/add-ons/mailextensions/supported-webextension-api)
- [Native editing command behavior and undo limitations](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand)
