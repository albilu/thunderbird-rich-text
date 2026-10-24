# Privacy statement

Thunderbird Rich Text runs locally in Thunderbird. It has no analytics, network
requests, remote scripts, third-party services, or external accounts.

The compose bridge lets the extension inspect message format and edit
the selected text in a compose window. Selected text and link details are passed
between the compose script and the toolbar only to display and apply formatting.
They are not persisted by the extension.

Local storage saves toolbar visibility settings, custom color choices, and a list
of recently used emoji in `browser.storage.local`. It does not use cloud-synced storage. No message
body, selected text, address, link, subject, or recipient is saved there.

Versions 1.1+ include a Thunderbird Experiment API to place the persistent toolbar
in the compose window and optionally hide the default formatting toolbar.
Thunderbird grants Experiment APIs **full, unrestricted access to Thunderbird and
your computer**, rather than enforcing individual WebExtension permissions.
The adapter manages the toolbar host, floating formatting popups, editor focus, and a temporary
native-toolbar visibility override. It also reads installed font family names to
populate the font field, and reads/applies numeric typography using native editor
transactions. It reads the active UI colors to match Thunderbird's theme; these
colors are not stored or transmitted. The font list is kept in memory, not stored or transmitted. Font
files are not embedded in messages. The extension does not
read received mail, enumerate accounts, send messages, or access arbitrary files.

Thunderbird continues to store drafts and send messages according to your own
account settings. Disabling or uninstalling the extension removes its toolbar and
restores Thunderbird's own toolbar visibility. It does not remove formatting
already applied to your messages.
