# thunderbird-rich-text

[![Build and release](https://github.com/albilu/thunderbird-rich-text/actions/workflows/release.yml/badge.svg)](https://github.com/albilu/thunderbird-rich-text/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/albilu/thunderbird-rich-text)](https://github.com/albilu/thunderbird-rich-text/releases/latest)

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

Rich Text is a dependency-free MailExtension with a persistent formatting toolbar
directly above the message body. It replaces Thunderbird's formatting toolbar by
default; when both are enabled, Rich Text sits below Thunderbird's toolbar. Tools
work on the selection in the existing editor. Thunderbird continues to handle
typing, spell checking, signatures, attachments, drafts, and sending. Version 1.2
removes the former popup and its launcher buttons.

Implemented tools:

- Searchable font family dropdown listing all installed fonts, plus generic families;
  custom family names are also accepted.
- Numeric font sizes in points (1–200 pt, including decimals such as 10.5 pt).
- LibreOffice-style line spacing presets and direct paragraph spacing increase/decrease buttons.
- Paragraph-style popup with previews for paragraphs, three heading levels,
  quotations, and preformatted text.
- Bold, italic, underline, strikethrough, superscript, and subscript.
- Left, center, right, and justified alignment; numbered and bulleted lists;
  indentation and horizontal dividers.
- Text color, text background/highlighting, preset palettes,
  and custom hex colors.
- Add, edit, and remove links; searchable emoji with locally stored recents.
- Clear inline formatting; native undo and redo.
- Thunderbird/system colors with live light/dark theme updates, labeled controls,
  and keyboard navigation. The Rich Text logo keeps its original color.
- Live formatting state in the persistent toolbar and settings to show it or
  replace Thunderbird's formatting toolbar.

The README's “Policy” item is interpreted as typography/font styling. No remote
editor, account, or external service is required. A small Thunderbird Experiment
API mounts the new toolbar in the compose UI and controls its visibility; this
requires Thunderbird's **full, unrestricted access** add-on permission. Formatting
goes through a validated compose-script bridge.

## Build and install

Installable XPI packages and checksums are available on the
[GitHub releases page](https://github.com/albilu/thunderbird-rich-text/releases/latest).

Requires **Node.js 20+** and **Python 3.9+**. There are no npm or Python packages to
install. Run from the repository root:

```sh
npm run build
```

This checks the source, runs the automated tests, and produces:

```text
dist/thunderbird-rich-text-1.5.0.xpi
dist/thunderbird-rich-text-1.5.0.xpi.sha256
```

In Thunderbird, open **Add-ons and Themes**, choose the gear menu, then
**Install Add-on From File…**, and select the `.xpi`. Versions 1.1+ use an Experiment
API, so Thunderbird asks for full access, including when upgrading from 1.0.
Open a Write, Reply, or Forward window to use the toolbar above the message body.

Select text in the message before using the toolbar. Inline tools apply to that
selection; at a collapsed cursor, styles apply to subsequent typing. Paragraph
tools affect the current paragraph or selected paragraphs. Emoji and links insert
at the cursor or replace the selection. Color, link, and emoji buttons open floating
panels over the message. Applying a choice returns focus to the editor.

Superscript and subscript form a separate group between strikethrough and text
color. Clear formatting is grouped with undo and redo.

Click the font family selector to open its popup, then type in the search field to filter the list.
Click a family or use the arrow keys and Enter to choose it. Escape cancels the
search without changing your message. The list comes from fonts installed on
your computer, rather than a fixed subset. If a typed family has no matches,
Enter still lets you apply that family name.
Enter a numeric size such as **9**, **12**, or **10.5** in the **pt** field. At an
empty cursor, the chosen size applies to subsequent typing; a selection keeps its
other character styles and links.

Font, paragraph style, line spacing, emoji, link, and both color selectors use
consistent floating panels without changing the toolbar's height or moving the
editor. Click outside a popup or press Escape to close it. Paragraph styles include
previews and mark the current style; use the arrow keys and Enter to select one.

The toolbar, popups, and settings use Thunderbird's active UI colors and system
fallbacks. Theme changes update open toolbars automatically. Formatting palettes
still contain explicit message colors, independent of the UI theme.

The **Set line spacing** dropdown beside alignment offers visual presets for
**1**, **1.15**, **1.5**, and **2** lines, following LibreOffice's quick-control
layout. Choose **Proportional** under **Custom value** for a percentage such as
**125%**, then Apply. Custom values run from 50% to 500%.

The adjacent **Increase paragraph spacing** and **Decrease paragraph spacing**
buttons adjust the space above and below each selected paragraph in 2.85 pt
steps. Each paragraph keeps its existing spacing differences; decreasing stops
at zero. These operations use native undo/redo and remain disabled in plain text.

### Toolbar settings

Open **Add-ons and Themes → Thunderbird Rich Text → Preferences** to configure the
toolbars. **Hide Thunderbird’s formatting toolbar** is enabled by default; turn
it off to show both toolbars. Previously saved choices are preserved on upgrade.
Settings apply to all existing and future compose windows and persist across
restarts.

The same preferences page has **Show the Rich Text toolbar**. You can turn it off
and re-enable it later through Add-ons Manager. There is no settings button in
the formatting toolbar.

The override of Thunderbird's toolbar is temporary: hiding Rich Text, disabling
the add-on, or uninstalling it removes the override and restores Thunderbird's
own toolbar visibility. Its persisted visibility preference is never changed.
The native toolbar is only hidden once the new toolbar has connected successfully.

Plain-text messages support emoji and undo/redo. Rich formatting controls are
disabled in this mode. Hold **Shift** while clicking Write to use
the opposite of the account's default compose format.

The manifest targets **Thunderbird 128+**, including Linux builds. The native suite
has been verified on **Thunderbird 153.4.0 ESR on Linux**; compatibility with other
versions should be verified before publishing. Font availability and the recipient's mail
client determine the final rendering. Font sizes and paragraph spacing are stored
as inline point values; line height uses a unitless multiplier. Fonts are not embedded
in the message, so recipients need the chosen font or their mail client will use a fallback.

## Development and verification

For quick development, open **Tools → Developer Tools → Debug Add-ons**, choose
**Load Temporary Add-on…**, and select `extension/manifest.json`. Reload the add-on
after edits. Existing compose windows are supported.

```sh
npm run check              # Syntax, manifest, resource, and permission checks
npm test                   # Command safety, routing, plain text, reproducible XPI
npm run test:thunderbird    # Real Linux Thunderbird integration
```

The native test requires **Xvfb** and **xfwm4** (a window manager for
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

### Automated releases

The [Build and release workflow](.github/workflows/release.yml) checks sources,
runs the automated tests, and packages the XPI on pushes to `master`, pull requests,
and manual runs. Successful builds retain the XPI and its SHA-256 checksum as
workflow artifacts. Native Thunderbird tests are run separately using the command
above; they are not part of the hosted workflow.

To publish a new stable version:

1. Update the versions in `extension/manifest.json` and `package.json`, update the
   package paths in this README, and add `docs/releases/<version>.md`.
2. Run the build and native checks, commit the changes, and push `master`.
3. After the branch workflow passes, create and push an annotated tag matching the
   manifest version, for example `git tag -a v1.5.0 -m 'Release 1.5.0'` followed by
   `git push origin v1.5.0`.

The tag workflow rebuilds, verifies checksums, and publishes a GitHub release with
the tested XPI, checksum, and versioned release notes. A mismatched tag is rejected.
Publishing uses GitHub's built-in token; no repository secret is required. Releases
are created once, and published assets are never overwritten by the workflow.

## Privacy

All formatting happens locally. Storage holds toolbar preferences, color choices,
and recent emoji. Message text, links, and recipients are never stored by this
add-on or transmitted to a service. There is no telemetry or remote code.

The Experiment API technically has full Thunderbird and computer access. Its
implementation mounts/removes the packaged toolbar page in compose windows,
sizes it, restores editor focus, temporarily hides the native formatting bar,
lists installed font families, and applies validated point sizes and paragraph
spacing through native editor transactions. It does not read received mail,
enumerate accounts, send mail, or access arbitrary
files. See [the privacy statement](docs/privacy.md) and [the adapter source](extension/experiments/compose-toolbar/api.js).
