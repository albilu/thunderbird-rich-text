# thunderbird-rich-text

Thunderbird Rich text editor plugin.

## Features

- Font selection
- Policy
- Text alignment
- Text color
- Text background color
- Highlight
- strikethrough
- Emojis
- List 
- Formatting
- etc ...

## Hard Requirements

- Straight forward packaging and distribution
- Provide advanced text editor 
- Integrate smoothly in the Thunderbird editor
- Compatible with the thunderbird linux build

## Brainstorming

The default editor in Thunderbird is very minimal and don't provide user friendly editing options(highlights, custom formatting). Goal is to solve this pain point by implementing a rich alternative which provides users with an advanced mail editor for their emails

## Ressources

- [Thunderbird compose actions](https://webextension-api.thunderbird.net/en/mv2/composeAction.html)
- [Thunderbird compose scripts](https://webextension-api.thunderbird.net/en/mv2/composeScripts.html)

## Implementation

Rich Text is a dependency-free MailExtension that adds a **Rich Text** button to
Thunderbird's compose toolbar. Its formatting panel works on the selection in the
existing message editor. Thunderbird continues to handle typing, spell checking,
signatures, attachments, drafts, and sending.

Implemented tools:

- Font family and seven relative font sizes, including Linux font choices.
- Paragraphs, three heading levels, quotations, and preformatted text.
- Bold, italic, underline, strikethrough, superscript, and subscript.
- Left, center, right, and justified alignment; numbered and bulleted lists;
  indentation and horizontal dividers.
- Text color, text background/highlighting, preset palettes,
  and custom hex colors.
- Add, edit, and remove links; searchable emoji with locally stored recents.
- Clear inline formatting; native undo and redo.
- Light/dark appearance, labeled controls, keyboard navigation, and a shortcut.

The README's “Policy” item is interpreted as typography/font styling. No remote
editor, account, external service, or privileged experiment API is required.

## Build and install

Requires **Node.js 20+** and **Python 3.9+**. There are no npm or Python packages to
install. Run from the repository root:

```sh
npm run build
```

This checks the source, runs the automated tests, and produces:

```text
dist/thunderbird-rich-text-1.0.0.xpi
dist/thunderbird-rich-text-1.0.0.xpi.sha256
```

In Thunderbird, open **Add-ons and Themes**, choose the gear menu, then
**Install Add-on From File…**, and select the `.xpi`. Accept the compose and local
storage permissions. Open a Write, Reply, or Forward window and click **Rich Text**
in the main compose toolbar. If the button is hidden, use the toolbar's Customize
menu to restore it. The panel is also available with **Alt+Shift+R**; Thunderbird's
extension shortcut settings can change that binding if it conflicts.

Select text in the message before opening the panel. Inline tools apply to that
selection; at a collapsed cursor, styles apply to subsequent typing. Paragraph
tools affect the current paragraph or selected paragraphs. Emoji and links insert
at the cursor or replace the selection. **Done** (or Escape) closes the panel.

Plain-text messages support emoji and undo/redo. They cannot carry rich
formatting, so the panel explains how to open an HTML compose window rather than
silently changing the message format. Hold **Shift** while clicking Write to use
the opposite of the account's default compose format.

The manifest targets **Thunderbird 128+**, including Linux builds. The native suite
has been verified on **Thunderbird 153.4.0 ESR on Linux**; compatibility with other
versions should be verified before publishing. Font availability and the recipient's mail
client determine the final rendering. Font sizes are relative HTML sizes, not
fixed point sizes.

## Development and verification

For quick development, open **Tools → Developer Tools → Debug Add-ons**, choose
**Load Temporary Add-on…**, and select `extension/manifest.json`. Reload the add-on
after edits and reopen its popup. Existing compose windows are supported.

```sh
npm run check              # Syntax, manifest, resource, and permission checks
npm test                   # Command safety, routing, plain text, reproducible XPI
npm run test:thunderbird    # Real Linux Thunderbird integration
```

The native test requires **Xvfb**, **xdotool**, and **xfwm4** (a window manager for
the virtual display). ImageMagick's `import` command enables optional screenshots.
It creates a disposable, offline profile and a virtual display. It
never opens your normal profile, connects a mail account, or sends a message.
Set `THUNDERBIRD_BINARY` to test another Thunderbird binary. Diagnostic output is
written under `test-results/` and excluded from the add-on package.

The XPI contains only `extension/` files, with deterministic ordering, timestamps,
and permissions. For a package without running checks, use
`python3 scripts/package.py`. Share the XPI for direct installation, or submit it
and this readable source to [Thunderbird Add-ons](https://addons.thunderbird.net/)
for review and distribution. No publishing or account configuration is performed
by the build.

See [the design notes](docs/design.md) for architecture and tradeoffs, and
[the verification checklist](docs/testing.md) for release testing.

## Privacy

All formatting happens locally. The `compose` permission provides access to the
message being edited, and `storage` remembers color choices and recent emoji.
Message text, links, and recipients are never stored by this add-on or transmitted
to a service. There is no telemetry, remote code, network permission, account
access, message-reading permission, or permission to send mail. See
[the privacy statement](docs/privacy.md).
