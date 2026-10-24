# AGENTS.md

Dependency-free Thunderbird MailExtension (MV2). No `npm install` step, no node_modules, no bundler. Extension runs as plain scripts, not ES modules.

## Commands

- `npm run check` — JS syntax, manifest consistency, HTML/CSP rules, resource references.
- `npm test` — Node's built-in runner over `tests/*.test.mjs`. Run one file with `node --test tests/shared.test.mjs`.
- `npm run build` — `check` + `test` + `python3 scripts/package.py`. Required order; do not reorder.
- `python3 scripts/package.py` — package XPI without checks (faster iteration).
- `npm run test:thunderbird` — real Thunderbird Marionette suite. Linux-only, needs `Xvfb` + `xfwm4`, uses a disposable offline profile. NOT run in CI. Override binary with `THUNDERBIRD_BINARY`. Artifacts go to `test-results/` (gitignored).

Requires Node 20+ and Python 3.9+; there are no packages to install.

## Layout

- `extension/` — the only files shipped in the XPI. Anything outside is dev-only.
  - `shared.js` exposes `globalThis.RichText` (allowlists, validation, palettes). Loaded verbatim by both extension pages and isolated compose scripts — keep it dependency-free and side-effect-safe.
  - `background.js` — registers compose scripts, validates tab/message origin, routes commands.
  - `editor.js` — injected into compose bodies; uses `document.execCommand` deliberately (preserves Gecko undo). Do not replace with `innerHTML`/`setComposeDetails` round-trips.
  - `toolbar/`, `options/`, `experiments/compose-toolbar/` — persistent toolbar UI, settings page, Experiment API adapter.
  - `popup/` is intentionally empty; the package test asserts no `popup/*` ships.
- `scripts/check.mjs`, `scripts/package.py` — validation and reproducible packaging.
- `docs/design.md` — architecture and threat model; read before non-trivial changes.
- `docs/testing.md` — native-suite coverage and the manual release checklist.

## Hard constraints enforced by `scripts/check.mjs`

Violating any of these fails `npm run check`:

- `extension/manifest.json` `version` must equal `package.json` `version`.
- Manifest permissions must be exactly `["compose", "storage"]` (deepEqual). Adding a permission means editing both files.
- HTML files: no inline `<script>` bodies, no `on*=` event handler attributes, unique `id`s. CSP is `script-src 'self'`.
- All `src`/`href` in HTML, manifest resources, icons, and experiment scripts must resolve to files inside `extension/`. No remote URLs.
- XPI contents: only `.json`, `.js`, `.html`, `.css`, `.svg` under `extension/`. Symlinks rejected. Build is deterministic (fixed timestamps, sorted order, sha256 checksum written next to the XPI).

## Conventions that differ from defaults

- MV2 with `background.scripts`, not modules — no `import`/`export` in extension code; communicate via `globalThis.RichText` and `browser.*`.
- The Experiment API (`experiments/compose-toolbar/api.js`) is the privileged boundary; it validates typography inputs independently of the unprivileged side. Defense in depth: keep both validations when editing.
- Toolbar ↔ background messages must carry a `tabId` matching the compose tab bound in the toolbar page URL. The background rejects mismatches; do not relax this.
- Plain-text compose mode: only emoji and undo/redo are allowed; rich formatting commands must be rejected (see `isPlainTextCommand` in `shared.js`).
- Don't touch Thunderbird's persisted toolbar visibility pref; the experiment hides the native bar via a temporary CSS attribute only after the new toolbar connects.

## Release

1. Bump `extension/manifest.json` and `package.json` together, add `docs/releases/<version>.md`.
2. `npm run build`, then push `master`; tag `v<version>` (must match manifest exactly or the workflow rejects it).
3. Native suite (`npm run test:thunderbird`) is a manual pre-release step — CI runs only check/test/package.

Manifest targets Thunderbird 128+, but the native suite has only been verified on Thunderbird 153.4.0 ESR Linux. Don't claim compatibility with untested versions.
