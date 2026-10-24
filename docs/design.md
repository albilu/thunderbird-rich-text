# Design

## Native editor and persistent toolbar

The add-on enhances Thunderbird's own composer. The persistent toolbar is an
unprivileged extension page embedded below `FormatToolbar`, within `FormatToolbox`. This keeps
it in Thunderbird's existing compose grid area, including with contacts and
attachment sidebars open. It never becomes part of the message body.

A `composeScripts` registration installs
the formatting bridge in new compose bodies; `tabs.executeScript` initializes
already open bodies on startup or on first use. Injection is idempotent and
deduplicated per tab. UI elements never enter the email DOM.

```text
Persistent toolbar → background → compose script → native editing engine
                                ↓                ↓
                         verify tab/mode     save/restore selection
Persistent toolbar ← background ← transient selection / formatting state

Toolbar preferences → small Experiment API → compose UI host and visibility
```

- `extension/shared.js`: allowlisted commands, input validation, link escaping,
  fonts, palettes, emoji, and toolbar defaults. Shared verbatim by the extension
  pages and isolated compose scripts.
- `extension/background.js`: registration, existing-window injection, message
  routing, tab validation, and plain-text checks.
- `extension/editor.js`: live selection tracking, native editing commands, and
  reporting of current selection/format state.
- `extension/toolbar/`: persistent formatting UI, expandable tools, and a bound
  compose tab ID. A ResizeObserver fits the embedded page to wrapped controls.
- `extension/options/`: accessible, automatically saved toolbar settings, opened
  from Add-ons Manager. Storage contains only color preferences, recent emoji,
  and toolbar visibility choices.
- `extension/experiments/compose-toolbar/`: the typed adapter that mounts/removes
  the toolbar browser, sizes it, returns focus to the editor, and controls native
  toolbar visibility. It performs no message editing.

The adapter binds each toolbar to its host compose tab ID in the page URL.
The background accepts commands only from the packaged toolbar page, and every
request must match that ID, even if the user activates a different compose window.
A closed or non-compose tab produces an error instead of redirecting an edit to
another draft. The former popup, compose-action button, and shortcut are removed.
Message format is checked before every command. A second
allowlist check runs inside the editor. Compose scripts may publish debounced
formatting state; those messages cannot invoke commands or alter preferences.

## Selection and editing history

Selection ranges are remembered while the message body has focus and when it
loses focus. The range is restored before commands, so focusing toolbar inputs does
not lose the selected words. Disconnected ranges are discarded. A fresh message
with no remembered cursor uses the start of the body. State queries restore the
range without moving focus out of toolbar inputs. Identical ranges are not
replaced, avoiding selection-change feedback loops during live toolbar updates.

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

Manifest V2 and a small Experiment API keep the toolbar in the actual compose UI.
The Experiment exposes three typed functions: `configure`, `setHeight` (bounded
to 36–360 pixels), and `focusEditor`. Its embedded page URL is fixed to packaged
extension content. There is no API for arbitrary scripts, HTML, file access, or
native commands. Thunderbird nevertheless grants Experiments full access and
shows that permission prompt, so this adapter must be included in security review.

Thunderbird 128 is the declared minimum; tested versions are recorded separately.
The same package works across architectures
without a native component. Linux-specific font families are included alongside
common generic/web-safe families; unavailable fonts fall back through the native
editor and recipient mail client.

`ExtensionSupport` observes existing and newly opened compose windows. The adapter
waits for the compose editor before mounting and for a successful toolbar
connection before hiding Thunderbird's bar. It uses a temporary CSS attribute,
not the native toolbar's persisted `collapsed` setting. Preference changes are
serialized and applied to all windows. Disabling the toolbar or add-on removes
the injected nodes, style, listeners, and visibility attribute. Reloading creates
one fresh host per window and reapplies locally saved preferences. Thunderbird's
toolbar is hidden by default; an explicit saved choice takes precedence. If a
future Thunderbird layout has no supported anchor, the native toolbar is left intact.

The editor never converts plain text to HTML, changes account preferences, handles
attachments, intercepts sending, or adds send-time transformations. Emoji and
history remain available in plain-text mode. Rich message rendering still depends
on Thunderbird's send format and the recipient's mail client.

The UI uses system fonts and native controls, labels and focus indicators, proper
toolbar groups, `aria-pressed` for toggle state, status/error announcements, and
light/dark theme variables. Network resources and runtime dependencies are absent.

## API references

- [Compose scripts and injection into existing windows](https://webextension-api.thunderbird.net/en/mv2/composeScripts.html)
- [Permissions for Thunderbird APIs](https://developer.thunderbird.net/add-ons/mailextensions/supported-webextension-api)
- [Native editing command behavior and undo limitations](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand)
- [Thunderbird Experiments and their full-access permission](https://developer.thunderbird.net/add-ons/mailextensions/experiments)
