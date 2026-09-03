# Idea: an alternative sync backend, hosted by the user

- **Date:** 2026-09-03
- **Status:** **idea — not decided, not planned.** Unlike the documents beside
  it, nothing here has been approved. It exists so that a later release does not
  have to re-derive the reasoning, and so that R3 can be built without closing
  the door.
- **Parent:** [2026-09-02-gestura-eu-integration-design.md](2026-09-02-gestura-eu-integration-design.md) §5 (Sync)
- **Follows:** [R3](../plans/2026-09-03-gestura-eu-integration-r3.md), which ships sync against gestura.eu only

## Why

gestura.eu will exist, but its owner does not promise it will exist forever.
Sync is the one feature where that matters: menus and search engines are local
data that survive the service disappearing, but a sync backend going away takes
the feature with it.

So the idea is a **second, complete alternative**: the user points Gestura at
storage they control — their own web space, a WebDAV share, a small service they
run — and sync works there instead. Not a fallback that kicks in automatically,
and not a per-request setting. **Two mutually exclusive modes:**

- **gestura.eu** — one switch, on or off, nothing to configure. The common case
  stays as simple as the design's goal demands.
- **Your own storage** — configured, with whatever that backend needs (a path,
  credentials, a connection test).

The owner decided on 2026-09-03 that R3 ships **mode A only**, with its texts
naming gestura.eu concretely rather than being written server-neutrally in
advance. That decision is sound, and the reason is worth recording because it
was initially argued the other way: a *separate mode* brings its own consent
text and its own i18n keys, so R3's keys stay true forever and are never
re-translated into 39 locales. Neutral wording would only have paid off if both
modes shared one text — which they should not, because they disclose different
things to different parties.

## Why this is cheap: the server is untrusted by construction

The whole idea rests on a property R3 already has. A sync backend sees:

- the **locator** (32 bytes derived from the secret via HKDF, base64url),
- two **ciphertexts** per state, their sizes and timestamps,
- the requesting **IP**.

It never sees a key, a state name, or a setting. The key is derived in the
browser from a secret that is never transmitted. That means *where* the
ciphertext sits is a question of availability, not of trust — and swapping the
backend changes nothing about the threat model.

## What R3 already provides

These are the seams. All three are already true; none of them needs work now.

- **The crypto is server-agnostic.** `js/eu-sync-crypto.js` derives locator and
  key from the secret alone. The AAD binds `stateId` and `role`, and the meta
  blob's `payloadHash` binds a state's two blobs to each other. A backend
  cannot participate in any of it. In particular, **a state is self-contained**,
  so a file holding many states is just a concatenation — no format change.
- **The four operations are the right boundary.** `list` / `upload` / `download`
  / `remove` map onto every candidate backend: WebDAV (`PROPFIND` or a manifest,
  `PUT`, `GET`, `DELETE`), a small service (the four HTTP endpoints from
  `docs/gestura-eu-api.md`), or a single bundle file (read, rewrite). Only the
  transport differs. A second backend is a dispatch above these four functions,
  not a rewrite of them.
- **`origin` is already a parameter** of all four endpoint functions in
  `js/eu-sync.js`; only `gated()` fills it in, from
  `GesturaSyncLocal.syncOrigin()`. A second backend hangs beside that, not
  through it.

## Two things a later release will run into

**1. The alternative backend probably does not belong under tier 1.** R3 models
sync as tier 2 under the *gestura.eu integration* switch, and for R3 that is
right — sync there **is** gestura.eu. A self-hosted backend contacts gestura.eu
at no point, so requiring the website integration to be enabled for it would be
a gate with no subject. It is likely a third, independent switch with its own
consent, sitting outside the two-tier composition rather than inside it.

**2. The local `states` map belongs to one locator.** `euSync.states` maps
`stateId` to a name, the last upload's hash and its date. Those are meaningless
under a different locator or a different store, so **changing the backend has to
clear the map** — otherwise the panel shows names and "changed since last
upload" for states that do not exist there. R3 already has exactly this rule for
a changed secret (`#useCode` and `#newCode` write `states: {}`), so a later
release inherits it instead of discovering it.

## Candidate backends, with what each costs

| Backend | Writes | Cost to the user | Notes |
|---|---|---|---|
| Small self-hosted service | yes | run a script | Implements the four endpoints from the contract. No auth of its own needed — see below. |
| WebDAV | yes | already have it | Nextcloud, ownCloud, Synology, Apache `mod_dav`. **Zero custom code**, but needs credentials in the extension. |
| Static URL, read-only bundle | no | none | One encrypted file under a URL. A second browser can read and adopt; writing happens by WebDAV, FTP or by hand. A real degradation step for "gestura.eu is gone". |

The read-only bundle is worth more than it looks: "publish once, read anywhere"
needs no service at all, and it is the only variant that works on plain static
hosting.

## Traps for whoever implements this

**CORS is the first thing that will break, and it will break asymmetrically.**
Chromium exempts extension `fetch` from CORS when `host_permissions` match —
verified against the local mock during R2. **Firefox does not**: it sends a
preflight, so a backend without `Access-Control-Allow-Origin` works in Chrome
and fails in Firefox. That is precisely the failure users report as "broken"
without mentioning which browser. Ordinary shared hosting sends no CORS headers.

**Path traversal in a self-hosted service.** The locator arrives in the request
body. Using it as a filename is the obvious hole. Validate
`^[A-Za-z0-9_-]{43}$` and prefer a hash of it as the path.

**An open storage endpoint.** The locator is a 256-bit bearer capability, so the
service needs no authentication of its own — but that also means anyone can
`PUT` under any locator and fill the disk. The simple fix: **the service's
configuration holds the owner's locator (or its hash), and everything else is
refused.** One string, copied out of the extension — which means the extension
would have to *show* the locator, and today it never does. That is a small but
necessary UI addition for this idea.

**Credentials, if WebDAV.** Basic auth means storing a password in
`chrome.storage.local`. An app password (Nextcloud) or a share token limits the
damage, but it is a genuine new secret in the extension, and the consent text
has to say so.

## Deliberately rejected: a file on the local disk

Considered and dropped, for two reasons:

- **Firefox cannot do it.** The workable route is the File System Access API —
  `showOpenFilePicker`, persist the handle in IndexedDB, `requestPermission`
  later. That is Chrome/Edge only; Firefox has OPFS, which is an
  extension-private sandbox no other browser can see. A sync path missing on one
  of three targets splits the product. *(Worth verifying before anyone commits
  to it — this is stated from knowledge, not from a test.)*
- **On your own disk, the encryption earns nothing.** It protects against
  nothing that is not already readable there — and the plain settings **export
  and import already cover that case**, with a preview and a real validator as
  of R3. The encrypted container earns its keep exactly where the file sits
  somewhere semi-public: at a web path. And there, writing needs a service
  anyway.

A folder that a cloud client synchronises (Nextcloud, Dropbox, OneDrive) is the
interesting version of "local", and it is reachable through WebDAV rather than
through the filesystem.

## Not decided

Everything. Which backend types, whether the mode is a third switch, how a
reference service is distributed (own repo, own release cycle), whether the
locator becomes visible in the UI, and whether it is worth doing at all. What
this document fixes is only that **R3 does not have to be undone for it.**
