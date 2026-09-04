# Gestura – Privacy Policy

_Last updated: 2026-09-03_

Gestura is a privacy-focused, open-source mouse gesture extension. Protecting your
privacy is a core design goal.

## Summary

**Gestura does not collect, sell or profile any personal data.** There are no
analytics, no tracking and no advertising, and there is no account. Two optional
switches, both off by default, are the only reason Gestura ever contacts a
server at all — gestura.eu, which is run by Gestura's author.

The **gestura.eu integration** (below), when you enable it,
answers questions from gestura.eu about entries you imported from there and asks
that index — at most once a day, when you open the settings — whether newer
versions of those entries exist. Underneath it sits a second switch, *Sync*,
also off by default: with it on, your own settings can be saved to gestura.eu on
an explicit click — encrypted in your browser, under a key that never leaves it.

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

## gestura.eu integration (optional, off by default)

Gestura ships with its gestura.eu integration switched off. In that state the
extension communicates with neither gestura.eu nor any other website: it ignores
every hand-off a website tries to start.

If you enable *gestura.eu integration* in the settings, and only then:

- Pages on **gestura.eu** (and one developer origin you may configure yourself)
  can hand menus and search engines to Gestura's import dialog after you click a
  button there. Nothing is imported without your confirmation in that dialog, and
  no other website can hand anything over — the origin is checked in the page and
  again in the extension's own trusted context.
- Pages on **gestura.eu** (and one developer origin you may configure yourself)
  can ask Gestura which of *their* entries you have installed, in which version,
  and whether you changed them locally. Gestura answers only about entries you
  imported from that very origin, only to that origin, and never about anything
  else in your settings. Gestura also tells such pages its own version number.
- When you open Gestura's settings, the extension asks gestura.eu — at most once
  a day, and separately per index — whether newer versions exist for the entries
  you imported from there. Of those entries the request contains nothing but
  their ids and version numbers, plus which version of the interface Gestura
  speaks. Entries you imported from a file are never included,
  because Gestura cannot verify where they came from. The answer is stored on
  your device and shown as a badge on the entries it concerns. The check itself
  only reports what exists — it downloads no menus and changes nothing. When you
  then ask for an update, that entry's file is fetched so the import dialog can
  show you what it contains, and nothing is adopted or changed until you confirm
  it there. There is no account and no identifier, and the check is the only
  request Gestura makes without a click of yours.
- Nothing else is sent while you are not on such a page.

The switch and your consent are stored only on the device where you enabled
them (`chrome.storage.local`); they are never synced, exported or imported. The
settings section shows the date you agreed and offers a *Withdraw* button, which
clears the consent and switches the integration off in one step; turning the
switch off does the same. Either way everything above stops immediately, the
stored update notices are deleted, and entries you imported stay on your device.

## Sync between browsers (optional, off by default, a second switch)

Sync is a separate switch underneath the integration, with its own consent. It
is off until you turn it on, and it cannot be on while the integration is off.

When it is on, and only when you click **Upload**:

- Gestura encrypts your settings **in your browser** and sends the ciphertext to
  gestura.eu. The key is derived from a code this browser generated; the code is
  never sent. gestura.eu stores the ciphertext, its size and the date — it can
  read neither your settings nor the name you gave the state, because that name
  is inside the encrypted part. Your states are filed under a hash of the
  locator your browser derives from the code, not under the locator itself, so
  access to the server's database does not amount to the right to list or
  delete them.
- Before every upload Gestura shows you the complete content, exactly as it will
  be transferred.
- The code is the only key. Anyone who has it can read, replace and delete your
  states, so keep it as you would a password. If you lose it, the states saved
  under it can no longer be reached — not even to delete them; gestura.eu
  removes states that are neither read nor written for **12 months**.
- Downloading a state decrypts it in your browser, checks it, and shows it to
  you in full before anything is written.

The code, the switch and the consent live only on this device
(`chrome.storage.local`). They are never part of an export, never part of an
import, and never travel over your browser's own sync. Turning the integration
off turns sync off with it and clears the sync consent; the code and your states
stay, so switching it back on does not orphan what you already uploaded. *Delete
everything under this code* removes your states from gestura.eu.

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
