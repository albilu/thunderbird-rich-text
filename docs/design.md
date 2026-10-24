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
Numeric typography → background → Experiment API → native editor transactions
```

- `extension/shared.js`: allowlisted commands, input validation, link escaping,
  fonts, palettes, emoji, and toolbar defaults. Shared verbatim by the extension
  pages and isolated compose scripts.
- `extension/background.js`: registration, existing-window injection, message
  routing, tab validation, and plain-text checks.
- `extension/editor.js`: live selection tracking, native editing commands, and
  reporting of current selection/format state.
- `extension/toolbar/`: persistent formatting UI, floating tools, and a bound
  compose tab ID. A ResizeObserver fits the embedded page to wrapped controls.
  The font selector opens a searchable combobox and listbox, with active-option
  keyboard navigation and Escape cancellation. Font, style, line-spacing, emoji,
  link, and both color dropdowns use a separate packaged page in native Thunderbird panels, anchored to
  their toolbar controls. They overlap the message without changing toolbar or
  editor geometry. Thunderbird handles popup sizing, focus, screen-edge placement,
  outside-click dismissal, and destruction on close.
  Paragraph styles show previews and the current selection. Colors and recent
  emoji are saved before closing destroys the popup's script context.
- `extension/theme.css` and `theme.js`: shared system-color defaults and the
  active Thunderbird palette, applied to the toolbar, dropdowns, and settings.
- `extension/options/`: accessible, automatically saved toolbar settings, opened
  from Add-ons Manager. Storage contains only color preferences, recent emoji,
  and toolbar visibility choices.
- `extension/experiments/compose-toolbar/`: the typed adapter that mounts/removes
  the toolbar browser, sizes it, returns focus to the editor, and controls native
  toolbar visibility. It also enumerates installed fonts and applies a bounded
  set of typography operations through the native editor transaction APIs.

The adapter binds each toolbar to its host compose tab ID in the page URL.
The background accepts commands only from the packaged toolbar and formatting dropdown pages, and every
request must match that ID, even if the user activates a different compose window.
A closed or non-compose tab produces an error instead of redirecting an edit to
another draft. The former full-editor popup, compose-action button, and shortcut are removed.
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

Point sizes and paragraph spacing use `nsIHTMLEditor` / `nsIEditor` transactions.
The background restores the compose script's saved selection, applies a validated
typography operation, then records the native editor's resulting selection. Font
sizes use inline `font-size: Npt` styling. Each selected text run retains its own
existing font styles; ordinary character styling and links remain in place.
Collapsed selections use the native editor's pending typing style without inserting
placeholder text. Paragraph spacing updates only affected blocks' `line-height`,
`margin-top`, and `margin-bottom`. Bare body text is given a paragraph with the
native format-block command rather than changing the whole body's style.
The paragraph spacing buttons send a direction, not a replacement margin value.
The adapter reads each selected block's own margins and increments/decrements
both in 2.85 pt steps, preserving mixed spacing. Decrease stops at zero; increase
stops at 200 pt and does not reduce pre-existing larger margins. The old numeric
paragraph form is removed.

All mutations for one typography command are bracketed by `beginTransaction` /
`endTransaction`, so native undo/redo handles them as one operation. Selection
state reports computed point sizes, line-height multiples, and paragraph spacing,
leaving fields blank for mixed values. At the caret, native pending font-size
state takes precedence over the preceding character's computed size.

The line-spacing dropdown follows LibreOffice's four quick presets (1, 1.15, 1.5,
2) and a custom-value section. Custom proportional percentages map to email-safe
unitless CSS line height. Fixed, leading, and minimum-height layout modes from
the full LibreOffice paragraph dialog are not offered in this toolbar.

Links use `createLink` when preserving an existing selection. A new label uses
`insertHTML` with a validated URL and escaped label and attribute. No user-supplied
HTML, arbitrary CSS, or arbitrary command is accepted. Supported URL schemes are
HTTP, HTTPS, mailto, and tel. Emoji are inserted as Unicode text.

## Scope and compatibility

Manifest V2 and a small Experiment API keep the toolbar in the actual compose UI.
The Experiment exposes `configure`, `setHeight` (bounded to 36–360 pixels),
`focusEditor`, `getFonts`, `getTypography`, and `applyTypography`, plus
`openDropdown`, `closeDropdown`, and the `onDropdownClosed` event. Dropdown kinds
are limited to font, style, line spacing, text/background colors, links, and emoji;
their URLs are fixed packaged pages
bound to a compose tab. Popup browsers are disposed on close, toolbar removal,
or add-on shutdown. `applyTypography`
only accepts font sizes (1–200 pt), line spacing (0.5–5 or normal), and paragraph
spacing (0–200 pt); the privileged boundary validates these independently.
Its embedded page URL is fixed to packaged extension content. There is no API
for arbitrary scripts, HTML, file access, or native commands. Thunderbird nevertheless grants Experiments full access and
shows that permission prompt, so this adapter must be included in security review.

Thunderbird 128 is the declared minimum; tested versions are recorded separately.
The same package works across architectures
without a native component. Font suggestions come from Thunderbird's
`nsIFontEnumerator.EnumerateAllFonts`, supplemented by generic families. The font
field also accepts typed names, so it has no hard-coded family allowlist. No font
files are read or embedded by the add-on. Unavailable families fall back through
the native editor and recipient mail client.

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
system colors. The `getTheme` adapter samples resolved Thunderbird colors, including
the compose toolbar background/text, panel and field colors, borders, and accent.
It accepts no CSS input. Root theme-attribute changes and system color-scheme
changes publish `onThemeChanged` to existing views; listeners are removed with
the toolbar. Native CSS variables have system-color fallbacks for older versions.
The logo retains its original green. Message color palettes are separate from UI
theming. Network resources and runtime dependencies are absent.

## API references

- [Compose scripts and injection into existing windows](https://webextension-api.thunderbird.net/en/mv2/composeScripts.html)
- [Permissions for Thunderbird APIs](https://developer.thunderbird.net/add-ons/mailextensions/supported-webextension-api)
- [Native editing command behavior and undo limitations](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand)
- [Thunderbird Experiments and their full-access permission](https://developer.thunderbird.net/add-ons/mailextensions/experiments)
- [Native HTML editor interface](https://raw.githubusercontent.com/mozilla/gecko-dev/master/editor/nsIHTMLEditor.idl)
- [Native editor transaction interface](https://raw.githubusercontent.com/mozilla/gecko-dev/master/editor/nsIEditor.idl)
- [LibreOffice spacing commands](https://help.libreoffice.org/latest/en-US/text/shared/menu/submenu_spacing.html)
- [LibreOffice line-spacing popup](https://raw.githubusercontent.com/LibreOffice/core/master/svx/source/sidebar/paragraph/ParaLineSpacingControl.cxx)
- [CSS system colors](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/system-color)
