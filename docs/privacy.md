# Privacy statement

Thunderbird Rich Text runs locally in Thunderbird. It has no analytics, network
requests, remote scripts, third-party services, or external accounts.

The **compose** permission lets the extension inspect message format and edit
the selected text in a compose window. Selected text and link details are passed
between the compose script and the popup only to display and apply formatting.
They are not persisted by the extension.

The **storage** permission saves custom color choices and a list of recently used
emoji in `browser.storage.local`. It does not use cloud-synced storage. No message
body, selected text, address, link, subject, or recipient is saved there.

Thunderbird continues to store drafts and send messages according to your own
account settings. This extension does not request permission to send messages,
read received mail, or access accounts. Uninstalling it does not remove formatting
already applied to your messages.
