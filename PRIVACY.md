# Gestura – Privacy Policy

_Last updated: 2026-09-02_

Gestura is a privacy-focused, open-source mouse gesture extension. Protecting your
privacy is a core design goal.

## Summary

**Gestura does not collect, transmit, or sell any personal data.** There are no
analytics, no tracking, no advertising, and no remote servers operated by Gestura.
The optional website integration (below) is off by default and, when enabled,
only answers questions from gestura.eu about entries you imported from there.

## What data Gestura processes and where it stays

- **Your settings** (gestures, menus, search engines, appearance options) are stored
  **locally** through the browser's extension storage API (`storage.sync` /
  `storage.local`). If you have browser sync enabled (e.g. Chrome Sync, Firefox
  Sync), your browser — not Gestura — syncs these settings across your signed-in
  devices, under your browser's own privacy and encryption controls.
- **Page interaction** (detecting gestures, drags, and menus) happens **on your
  device, in the page**. Gestura does not send the pages you visit, their content,
  or your browsing history anywhere.
- **Searches and "open link" actions** navigate your browser to the destination you
  chose (e.g. a search engine you configured). This is a normal browser navigation to
  a third party you selected; that third party's own privacy policy then applies.
  Gestura adds no identifiers of its own.

## Website integration (optional, off by default)

Gestura ships with its website integration switched off. In that state the
extension ignores every hand-off a website tries to start and has no contact
with gestura.eu.

If you enable *Website integration* in the settings, and only then:

- Websites can hand menus and search engines to Gestura's import dialog after
  you click a button on their page. Nothing is imported without your
  confirmation in that dialog.
- Pages on **gestura.eu** (and one developer origin you may configure yourself)
  can ask Gestura which of *their* entries you have installed, in which version,
  and whether you changed them locally. Gestura answers only about entries you
  imported from that very origin, only to that origin, and never about anything
  else in your settings. Gestura also tells such pages its own version number.
- Nothing is sent while you are not on such a page. There is no account, no
  identifier, and no request Gestura makes on its own.

The switch and your consent are stored only on the device where you enabled
them (`chrome.storage.local`); they are never synced, exported or imported.
Turning the switch off stops all of the above immediately. Entries you imported
stay on your device.

## Permissions

Gestura requests only what its features need. Broad host access (`<all_urls>`) is
required because mouse gestures must work on every page you visit; it is **not** used
to read or exfiltrate page content. Sensitive capabilities (bookmarks, clipboard
read, downloads, page capture) are **optional** and requested only on demand when you
use a feature that needs them. See
[docs/store/permission-justifications.md](docs/store/permission-justifications.md)
for a per-permission explanation.

## Third parties

Gestura includes no third-party analytics or advertising SDKs. Search-engine and
site favicons may be fetched by the browser to display icons; navigations you trigger
go directly to the destination you configured.

## Open source

Gestura is licensed under GPL-3.0 and its full source is public at
<https://github.com/PPP01/Gestura>. You are welcome to inspect exactly what it does.
Gestura is a fork of [FlowMouse](https://github.com/Hmily-LCG/FlowMouse).

## Contact

Questions about privacy? Contact **contact@gestura.eu** or open an issue at
<https://github.com/PPP01/Gestura/issues>.
