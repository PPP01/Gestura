# gestura.eu Integration — R3 (Sync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship release stage R3: end-to-end encrypted settings sync between browsers over gestura.eu — an extension-generated secret, named states, explicit upload and download, a "changed since last upload" reminder, secret backup — plus the shared settings validator and the full-content preview that Issue #1's transparency promise requires and that the file export/import inherits.

**Architecture:** Five new classic scripts, each with one job: `eu-sync-code.js` turns the 32-byte secret into the human-copyable `GS1-…` code and back; `eu-sync-crypto.js` derives locator and key from it via HKDF and does the AES-GCM envelope; `eu-settings-schema.js` is the one validator for every settings blob that enters the extension, wherever it came from; `eu-sync-local.js` owns the `euSync` storage key and the tier-2 consent invariant; `eu-sync.js` speaks the four HTTP endpoints with an injected `fetch`. Two new Lit components sit on top: a preview dialog that renders the complete JSON before anything is written or transferred, and the sync panel under the tier-1 switch. Everything runs in the options page only — no content script, no service worker, no new gesture action.

**Tech Stack:** Manifest V3, plain JS classic scripts (IIFE + `root.X = api`), Lit (vendored `js/lib/lit-all.min.js`), WebCrypto (`crypto.subtle`: HKDF-SHA-256, AES-256-GCM, SHA-256), `fetch` + `AbortController`, vitest (`npm test`, Node 24).

**Spec:** [docs/superpowers/specs/2026-09-02-gestura-eu-integration-design.md](../specs/2026-09-02-gestura-eu-integration-design.md) — section 5 (sync in full), 6 (privacy/store/i18n obligations), 7 (error handling) and the sync/validator/crypto bullets of section 9 (test list) are R3. The plan argues from the spec; read both.

**Predecessors:** [R1](2026-09-02-gestura-eu-integration-r1.md) (`d0219ce`) and [R2](2026-09-02-gestura-eu-integration-r2.md) (`29c7e92` on `main`, 601 tests green). R3 builds on `FlowMouseEuIntegration`, `GesturaEuLocal` and `GesturaEuUpdates` exactly as R2 left them.

**Contract:** [docs/gestura-eu-api.md](../../gestura-eu-api.md) — Task 1 raises it to `apiLevel: 3` and adds the sync half. It is copied into `gestura-index`, so it is written before any code depends on it.

## Global Constraints

- **No build step.** The repo folder *is* the unpacked extension. All five new `js/*.js` files are classic scripts (IIFE, `root.GesturaX = api`, `module.exports` for vitest); components under `js/components/` stay ES modules. Never mix the two worlds.
- **Indentation is tabs**, throughout, in JS, JSON, CSS and Markdown code blocks alike.
- **Internal `FlowMouse*` identifiers stay.** R1's pure core is `window.FlowMouseEuIntegration`; do not rename it. New R3 globals use the `Gestura*` prefix R1/R2 established: `GesturaSyncCode`, `GesturaSyncCrypto`, `GesturaSettingsSchema`, `GesturaSyncLocal`, `GesturaSync`.
- **i18n: en and de only, and every new key goes into `PENDING_TRANSLATION`** in `tests/site-menu-locales.test.mjs`. This is the mechanism [CLAUDE.md](../../../CLAUDE.md) documents for text still being drafted, and it is how R2 shipped. New keys use the prefixes `euSync*` and `settingsPreview*`; **both must be added to `NEW_KEY_PREFIXES`** — the list currently ends at `euIntegration` and would silently cover nothing.
- **R3 is not releasable while any key is still in `PENDING_TRANSLATION`.** The owner's decision of 2026-09-03 is that **R2 and R3 release together**, in one version, once the texts of both are final and translated into all 39 locales. Task 10 carries that gate.
- **Never put an undeclared `$WORD$` in a message.** `chrome.i18n` reads it as a placeholder and the extension fails to load entirely. Use `{token}` plus `.replace()`; `tests/locale-placeholders.test.mjs` guards it.
- **Copy rule from the owner:** lead with what the service does for the user, not with warnings. Keep claims factual. R3's consent text has one hard requirement of its own — it must be honest that *content* now leaves the browser, encrypted, and that whoever holds the code holds the data.
- **`version_name` in `manifest.json` is generated** — a clean filter and the hooks in `.githooks/` own it. Never edit it; do not bump `version` in this plan either (that is a release step).
- **Crypto parameters are contract, not implementation detail.** Every constant in Task 1's "Sync crypto" section — salt, info strings, IV length, AAD composition, code alphabet, checksum width — is pinned by test vectors. Changing one silently strands every state already uploaded. If a change is ever needed, it is a new `v2` info string and a new code prefix, not an edit.

---

## Decisions taken in this plan (2026-09-03)

The spec leaves five things open. Decided here, with the reasoning, so a reviewer can disagree with the reason rather than guess the intent:

1. **Tier-1 consent stays at version 2.** `js/eu-integration.js` currently says *"R3 raises it again"* — it does not. Tier 1's scope is unchanged by R3: no new bridge answer, no new automatic request. Sync is behind **its own** tier-2 consent (`CURRENT_SYNC_CONSENT = 1`), which is exactly what the spec's two-tier composition is for. Raising tier 1 would log every existing user out of the integration for a feature they may never enable. Task 5 corrects that comment.

2. **Sync talks to exactly one origin — the developer origin when one is configured, otherwise `https://gestura.eu`.** Unlike the update check, which asks every origin an entry came from, there is one secret and one blob store; two of them would mean two sets of states under one code and a UI that has to explain which server a state lives on. The consequence is deliberate and stated in the panel: **while a developer origin is set, sync uses it and does not touch production.**

3. **No QR code in R3.** The spec lists QR alongside copy and file for pairing a second device. Gestura is a **desktop browser extension** — there is no mobile Gestura to scan the code into, so the QR would be a picture the user photographs in order to type it in by hand somewhere else. Copy and "save as file" cover every real path (password manager, second machine). Vendoring a QR library or hand-writing a GF(256) encoder is real work and real review surface for a flow that does not exist. The `GS1-` code is deliberately kept inside the QR alphanumeric charset (uppercase Crockford base32 plus `-`), so adding it later costs nothing but the generator. **Flagged for the owner in "Open for the owner".**

4. **`lastSyncTime` leaves the export.** It is a local artifact — the moment *this browser* last wrote to `chrome.storage.sync` — and it changes on every save. Carrying it would make the "changed since last upload" reminder fire after any write at all, including one that changed nothing, and importing a foreign browser's timestamp means nothing. It is dropped from the export allowlist and listed among the dropped keys in the preview.

5. **The legacy migration moves out of the options page.** `#importSettings` in [js/components/options-page.js](../../../js/components/options-page.js) currently carries the `customGestures`/`gestures` → `mouseGestures` migration inline. The shared validator needs the same migration for the same files, so it moves into `js/eu-settings-schema.js` and the options page calls it. One copy, tested directly, instead of a second one growing next to it.

## What R1 and R2 constrain

- **`effectiveEnabled()` is the tier-1 gate and it composes.** Tier 2 can never authorize anything on its own: `syncEnabled = EU.effectiveEnabled(local) && sync.enabled && sync.consent.version === CURRENT_SYNC_CONSENT`. Turning tier 1 off turns sync off in the same instant, without touching `euSync`.
- **State that must not travel over browser sync lives in `chrome.storage.local`.** `euIntegration` (R1), `euUpdates` (R2), `euSync` (R3). The secret in particular must never reach `storage.sync` — that would hand every paired browser's key to the browser vendor's sync and defeat the whole design.
- **Re-check the live state across every `await`.** R2's `persist()` exists because a revoke can land between a read and a write; `tests/eu-updates-persist.test.mjs` reproduces it. Every R3 write follows the same shape: read the live state again immediately before the write, and once more after it.
- **The options page is the only context.** No new entry in `content_scripts`, `importScripts` or `background.scripts`, so R3 incurs **no Firefox-manifest mirror** beyond the `pages/options.html` script tags, which both branches share.
- **`EU.canonicalize` is the stable stringifier**, `EU.hash64` the 64-bit digest. Reuse both; do not introduce a second hashing convention.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `js/eu-sync-code.js` | The `GS1-…` code: secret generation, Crockford base32 encode, forgiving parse, checksum. Nothing else knows the alphabet. |
| `js/eu-sync-crypto.js` | HKDF derivation of locator and key, the AES-GCM envelope with its AAD binding, state ids, blob hashing. Nothing else calls `crypto.subtle`. |
| `js/eu-settings-schema.js` | The one settings validator: export projection, format version, allowlist, forbidden keys, size cap, legacy migration, the reminder hash. |
| `js/eu-sync-local.js` | The `euSync` storage key: tier-2 consent invariant, the secret, the local state map, `API_LEVEL`-independent constants. |
| `js/eu-sync.js` | The four endpoints with injected `fetch`, and the four orchestrators that re-check the gate around them. |
| `js/components/settings-preview-dialog.js` | The "what is transferred / what will be written" dialog. Shared by export, file import and sync download. |
| `js/components/eu-sync-panel.js` | The tier-2 switch, its consent overlay, the state list, upload/download/delete, the reminder, secret backup. |
| `tests/eu-sync-code.test.mjs` | Code format against the fixed vectors, forgiveness, rejections. |
| `tests/eu-sync-crypto.test.mjs` | Derivation vectors, envelope roundtrip, IV freshness, AAD binding failures. |
| `tests/eu-settings-schema.test.mjs` | Allowlist, forbidden keys, size cap, format version, legacy path, hash stability. |
| `tests/eu-sync-local.test.mjs` | The tier-2 invariant, the state map, storage stubs. |
| `tests/eu-sync.test.mjs` | Request bodies, response validation, quota errors, the gating re-checks. |

**Modified**

| File | Change |
|---|---|
| `docs/gestura-eu-api.md` | `apiLevel` 3; the sync half: code format, crypto parameters, test vectors, four endpoints, quotas, retention, the settings schema, consent table row. |
| `js/eu-integration.js` | `API_LEVEL` 2 → 3, and the comment claiming R3 raises the consent version. Nothing else. |
| `js/settings-store.js` | Dispatch `gestura:settings-saved` on a successful local save, so the reminder can react to it. |
| `js/components/options-page.js` | Export and file import go through the schema and the preview dialog; the two `confirm()` calls and the inline migration go away. |
| `pages/options.html` | Load the five new classic scripts and the two new modules. |
| `css/common.css` | `.preview-json`, `.sync-state-row`, `.secret-code`, `.sync-hint`. |
| `_locales/en/messages.json`, `_locales/de/messages.json` | ~50 new `euSync*` / `settingsPreview*` keys. |
| `tests/site-menu-locales.test.mjs` | `euSync` and `settingsPreview` into `NEW_KEY_PREFIXES`; the new keys into `PENDING_TRANSLATION`. |
| `tests/eu-integration.test.mjs` | `apiLevel` 3. |
| `PRIVACY.md` | Encrypted user content now leaves the browser after a second, separate opt-in. |
| `docs/store/chrome-web-store-submission.md`, `docs/store/firefox-amo-submission.md` | Data-disclosure lines: user content, encrypted, optional. |
| `CHANGELOG.md` | Entry under `### Unreleased`. |

**Deliberately not touched:** `manifest.json` on either branch, `js/background.js`, every content script. R3 adds no permission — the sync origin is already covered by `host_permissions: ["<all_urls>"]`, and the secret backup file is written with a blob URL and `<a download>`, which needs no `downloads` permission.

---

## Task 1: Pin the sync half of the contract

Nothing else in R3 can be written first. Five constants — the code alphabet, the HKDF salt and info strings, the IV length, the AAD composition — are load-bearing in a way ordinary code is not: get one wrong after states exist and every uploaded state becomes permanently unreadable, because the key is derived, not stored. They are pinned here with **test vectors computed from a real WebCrypto implementation**, and Tasks 2 and 3 are written to reproduce those exact bytes.

`gestura-index` implements the server side from this file, so it is finished and handed over before any client code claims anything.

**Files:**
- Modify: `docs/gestura-eu-api.md`

**Interfaces:**
- Consumes: nothing.
- Produces: every constant and field name Tasks 2–6 encode — `GS1`, the Crockford alphabet, `gestura-sync-locator-v1`, `gestura-sync-key-v1`, `gestura-sync-v1`, the four endpoint paths, the request/response bodies, the quota names, `gesturaSettings: 1`.

- [ ] **Step 1: Raise the level line**

Replace the `apiLevel: 2` paragraph near the top of `docs/gestura-eu-api.md`:

````markdown
**apiLevel: 3** (R3). The index must tolerate every older extension: no answer
is indistinguishable from "not installed" and must be handled as such, an
extension at level 1 never calls `/api/v1/updates`, and one below level 3 never
calls any `/api/v1/sync/*` endpoint. Levels are additive — nothing that
answered at level 2 changes shape at level 3.
````

- [ ] **Step 2: Add the sync sections**

Insert after the "Update check" section, before "Provenance":

````markdown
## Sync — the secret code

The user's whole sync identity is **32 random bytes**, generated in the
extension by `crypto.getRandomValues`. It is shown to the user as one string:

```text
GS1-000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFG-CC6W
```

- **Prefix** `GS1`, then the payload in groups of four separated by `-`. The
  prefix is a version, not decoration: a future format is `GS2` and an old
  extension must reject it rather than mis-decode it.
- **Alphabet:** Crockford base32, `0123456789ABCDEFGHJKMNPQRSTVWXYZ` — no
  `I`, `L`, `O`, `U`.
- **Payload:** 56 characters. The first **52** are the 32 secret bytes,
  big-endian, five bits per character; 52 x 5 = 260 bits, so the final four
  bits are padding and **must be zero**. The last **4** characters are the
  checksum.
- **Checksum:** the top 20 bits of `SHA-256(secret)` as four base32
  characters. Formally `v = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4)`, then the
  characters for `(v >> 15) & 31`, `(v >> 10) & 31`, `(v >> 5) & 31`, `v & 31`.

**Parsing is forgiving, verification is not.** Input is uppercased; whitespace
and `-` are ignored; `I` and `L` read as `1` and `O` as `0` (Crockford's own
aliases). `U` is not in the alphabet and is an error, never an alias. Whatever
survives that must still be exactly 56 characters, have zero padding bits and
match its checksum — a single mistyped character is **rejected with an error**,
never accepted as a different secret that would silently address an empty blob
store.

The prefix is matched explicitly before the noise is stripped, because `G`, `S`
and `1` are themselves alphabet characters and would otherwise be eaten as
payload.

### Code test vectors

| Secret (hex) | Code |
|---|---|
| `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f` | `GS1-000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFG-CC6W` |
| `6e31aaf7266804808840320a2a6550b0b8fe93f7b88bcc96e016452a69840aa8` | `GS1-DRRT-NXS6-D028-1220-6852-MSAG-P2WF-X4ZQ-Q25W-S5Q0-2S2J-MTC4-1AM0-56KY` |

All of these parse to the first secret: the code itself, the same in lower
case, the same without separators, the same with spaces instead of `-`, and the
same with `0M30` written `OM3O`. The code ending `CC6X` (checksum typo) and the
one ending `CC6U` (`U`) are rejected.

## Sync — key derivation and the envelope

Because the secret carries full entropy, **HKDF-SHA-256** is enough; there is no
passphrase and therefore no password hash. Fixed parameters:

- **salt:** 32 zero bytes.
- **info:** `"gestura-sync-locator-v1"` for the locator, `"gestura-sync-key-v1"`
  for the encryption key. UTF-8, exactly as written.
- **length:** 256 bits each.

The **locator** is those 32 bytes as **base64url without padding**. It
identifies the blob store and is the only thing the server sees. It is a bearer
capability: whoever derives it can list, replace and delete the states. It
travels in the request **body**, never in the URL, so it stays out of ordinary
access logs — *the deployment must not log request bodies.*

The **key** is an AES-256-GCM key and never leaves the client. The server cannot
reach it from the locator.

### Derivation test vectors

Secret `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`:

```text
locator (base64url) : zoogXw2lwmt_ZqFnRu-lFOWYxyJaU2kpxfunpy3Umsk
key (hex)           : ca25c2f6d9e2392b270755cf04b75ff545fa536a387a4c4d4d16fcfeb2e7cba3
```

Secret `6e31aaf7266804808840320a2a6550b0b8fe93f7b88bcc96e016452a69840aa8`:

```text
locator (base64url) : 3qzyS44KqXaBNzKvFSontDE8CfLPp8lwOUVHroaeg7M
key (hex)           : 0f61cd1a7a59f8da90654cb9e2e94aca58af066c15e9ac12e0b0dc4f066d30e6
```

### Envelope

Every ciphertext on the wire is one base64 string over `iv[12]` followed by the
ciphertext and its 16-byte tag.

- **IV:** 12 fresh random bytes per encryption, from `crypto.getRandomValues`.
  GCM is completely broken by IV reuse under the same key, and both blobs of
  every state share one key — so this is not a preference.
- **Tag:** 128 bits, WebCrypto's default; it is part of the `ciphertext` output
  of `crypto.subtle.encrypt` and needs no field of its own.
- **AAD:** `"gestura-sync-v1" + stateId + role`, UTF-8, where `role` is `"meta"`
  or `"payload"`. `stateId` is fixed-length hex, so the concatenation is
  unambiguous. This is what stops the server from moving a valid blob to a
  different state or a different role: authentication fails before anything
  decrypts.

### Envelope test vector

Key = the key derived above from secret `0001…1f`, `stateId =
0123456789abcdef0123456789abcdef`, `role = meta`, `iv =
0102030405060708090a0b0c` (fixed for the vector only — real IVs are random),
plaintext `{"name":"Work"}`:

```text
aad      : gestura-sync-v10123456789abcdef0123456789abcdefmeta
envelope : AQIDBAUGBwgJCgsMhBezK2ZidsR4vw2Le+JA1vfSdGXw0lkopKj0PjhL9A==
sha256(envelope bytes), base64url : wTZSj7yLdniic9fTzg1YQgD4WVynX3BgPTYosChka2c
```

## Sync — states

A **state** is one saved settings snapshot under one locator, stored as **two
ciphertexts under the same key**:

- **meta** — a few hundred bytes:
  `{ name, createdAt, updatedAt, extVersion, payloadHash }`. `payloadHash` is
  `SHA-256` over the payload envelope's **raw bytes** (what the base64 decodes
  to), as base64url without padding. It binds the two blobs of a state
  together.
- **payload** — the settings export (see "Settings exchange format" below).

The split exists for a second browser that has only the code: it lists the
states, decrypts just the meta blobs to show *"Work — updated 3 September"*, and
downloads a payload only when the user picks one.

`stateId` is generated **client-side** at creation: 16 random bytes as
lower-case hex, 32 characters, `^[0-9a-f]{32}$`. It never changes. Names live
inside the meta blob and are labels only — duplicates are possible, and the
client warns rather than refuses.

**Rollback is outside the threat model.** A server that serves an older but
authentic version of a state is not detected: uploads are explicit, states are
few, and the preview before writing shows what actually arrived. What the
`payloadHash` in the meta blob does prevent is a *mismatched pair* — this
meta with a different state's or an older upload's payload.

## Sync — endpoints

All under `/api/v1`, all anonymous, all with the locator in the body. Request
bodies always carry `apiLevel`.

| Endpoint | Body | Answer |
|---|---|---|
| `POST /api/v1/sync/list` | `{ apiLevel, locator }` | `{ states: [{ stateId, size, updatedAt, meta }] }` |
| `PUT /api/v1/sync/state` | `{ apiLevel, locator, stateId, meta, payload }` | `{ stateId, updatedAt, size }` |
| `POST /api/v1/sync/get` | `{ apiLevel, locator, stateId }` | `{ stateId, updatedAt, payload }` |
| `POST /api/v1/sync/delete` | `{ apiLevel, locator, stateId }` — `stateId` omitted deletes every state under the locator | `{ deleted: <count> }` |

`size` is the payload envelope's length in bytes as transmitted; `updatedAt` is
an ISO-8601 UTC timestamp. `meta` and `payload` are the base64 envelope strings.

**Errors** answer with an HTTP status and `{ "error": "<code>" }`:

| Code | Status | Meaning |
|---|---|---|
| `bad-request` | 400 | Malformed body, unknown `apiLevel`, bad `stateId` or locator shape. |
| `not-found` | 404 | No such state under this locator. |
| `too-large` | 413 | A single blob exceeds its limit. |
| `quota-states` | 409 | The locator already holds the maximum number of states. |
| `rate-limited` | 429 | Per-IP rate limit (the July design's RateLimiter). |

**Limits**, enforced server-side and mirrored client-side so the user sees the
number before the request rather than after it:

| Limit | Value |
|---|---|
| `meta` envelope | 8 KiB as transmitted |
| `payload` envelope | 512 KiB as transmitted |
| states per locator | 10 |
| total per locator | 4 MiB |

**Retention:** a state that is neither read nor written for **12 months** is
deleted. This is the only way blobs under a lost secret can ever go away — the
user cannot derive their locator any more, so neither the extension nor the user
can address them. The retention period is named in `PRIVACY.md` and shown in the
extension when a new secret replaces a lost one.

**CORS:** `Access-Control-Allow-Origin: *`, methods `POST, PUT, OPTIONS`, header
`Content-Type`. The preflight must be answered — Firefox sends one for these
requests even from an extension page, where Chromium exempts them.

## Settings exchange format

The format every settings blob must satisfy — the file export, the file import,
and both directions of sync. One validator implements it
(`js/eu-settings-schema.js`); nothing writes settings that did not pass it.

```json
{
	"gesturaSettings": 1,
	"_version": "2.8.0",
	"theme": "auto"
}
```

- **`gesturaSettings`** is the **format** version and drives validation and
  migration. `_version` is the *extension* version and is informational only —
  it is what today's exports carry, and it never decided anything.
- A file **without** `gesturaSettings` is a legacy export and goes through the
  legacy path: the same rules, plus the `customGestures` / `gestures` /
  `customGestureUrls` migration into `mouseGestures`.
- An **unknown** `gesturaSettings` (anything but `1`) is refused with a clear
  message. It is not guessed at.
- **Allowlist:** the top-level keys of `DEFAULT_SETTINGS`, minus `lastSyncTime`.
  Unknown keys are **dropped and listed in the preview**, never written. Values
  are type-checked against the shape of their default.
- **Forbidden anywhere in the tree:** a property named `__proto__`,
  `constructor` or `prototype`. Such a file is rejected outright, before any
  object is merged.
- **`euIntegration`, `euSync` and the secret are never exported and never
  imported.** They live in `chrome.storage.local`; a crafted file must not be
  able to flip a switch or plant a secret.
- **Maximum size:** 512 KiB of JSON text.
- The import is **atomic and replacing**: one validated write of the whole
  settings object, never a partial application, never a merge.
````

- [ ] **Step 3: Add the consent row**

The "Consent versions" table keeps its two rows for tier 1. Add beneath it:

````markdown
The **Sync** switch has a consent of its own, and tier 1 must be enabled with a
current consent for tier 2 to authorize anything:

| Sync version | Scope |
|---|---|
| 1 | Encrypted settings states are stored on gestura.eu under a locator derived from a secret only this browser holds. The server sees ciphertext, sizes and timestamps — not the state names, not the settings. Upload and download are explicit clicks; before every upload the complete content is shown. |
````

- [ ] **Step 4: Read the finished file as one contract**

Run: `npm test`
Expected: PASS, unchanged count — no test reads this file, so this step only
proves nothing else broke.

Then read `docs/gestura-eu-api.md` top to bottom once. Every constant Tasks 2–6
need must be findable here without opening the spec.

- [ ] **Step 5: Commit**

```bash
git add docs/gestura-eu-api.md
git commit -m "docs(api): the sync half of the contract, with its test vectors"
```

---

## Task 2: The secret code — `js/eu-sync-code.js`

The one file that knows the alphabet. Everything else deals in `Uint8Array(32)` and never sees a character of the code.

**Files:**
- Create: `js/eu-sync-code.js`
- Test: `tests/eu-sync-code.test.mjs`

**Interfaces:**
- Consumes: nothing (no `FlowMouseEuIntegration`, no storage — `crypto` only).
- Produces: `window.GesturaSyncCode` with
  `PREFIX: 'GS1'`, `ALPHABET`, `SECRET_BYTES: 32`, `CODE_CHARS: 56`,
  `generateSecret() -> Uint8Array(32)`,
  `encode(Uint8Array(32)) -> Promise<string>`,
  `parse(string) -> Promise<{ secret: Uint8Array } | { error: 'prefix' | 'charset' | 'length' | 'padding' | 'checksum' }>`,
  `checksum(Uint8Array(32)) -> Promise<string>` (4 chars),
  and `toHex(bytes)` / `fromHex(string)` for the tests and the vectors.

- [ ] **Step 1: Write the failing test**

Create `tests/eu-sync-code.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import '../js/eu-sync-code.js';
const C = globalThis.GesturaSyncCode;

// The two vectors from docs/gestura-eu-api.md. They are the contract: if one of
// these ever changes, every code a user wrote down stops working.
const VECTORS = [
	{
		hex: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
		code: 'GS1-000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFG-CC6W',
	},
	{
		hex: '6e31aaf7266804808840320a2a6550b0b8fe93f7b88bcc96e016452a69840aa8',
		code: 'GS1-DRRT-NXS6-D028-1220-6852-MSAG-P2WF-X4ZQ-Q25W-S5Q0-2S2J-MTC4-1AM0-56KY',
	},
];
const CODE = VECTORS[0].code;

describe('secret code', () => {
	it('encodes both vectors exactly', async () => {
		for (const v of VECTORS) {
			expect(await C.encode(C.fromHex(v.hex))).toBe(v.code);
		}
	});

	it('parses both vectors back to their bytes', async () => {
		for (const v of VECTORS) {
			const out = await C.parse(v.code);
			expect(C.toHex(out.secret)).toBe(v.hex);
		}
	});

	// Forgiving input: a code is read off a screen, out of a password manager or
	// off a piece of paper, and none of those preserve case or separators.
	it.each([
		['lower case', CODE.toLowerCase()],
		['no separators', CODE.replace(/-/g, '')],
		['spaces instead of dashes', CODE.replace(/-/g, ' ')],
		['surrounding whitespace', `\n  ${CODE}  \n`],
		['Crockford aliases I, L and O', CODE.replace('0M30', 'OM3O')],
	])('accepts %s', async (_label, input) => {
		const out = await C.parse(input);
		expect(C.toHex(out.secret)).toBe(VECTORS[0].hex);
	});

	// A typo must be an error. The alternative - decoding to a different secret -
	// derives a different locator, which addresses an empty blob store: the user
	// would be told their states are gone rather than that they mistyped.
	it.each([
		['a checksum typo', CODE.replace('CC6W', 'CC6X'), 'checksum'],
		['a body typo', CODE.replace('40R4', '40R5'), 'checksum'],
		['the excluded letter U', CODE.replace('CC6W', 'CC6U'), 'charset'],
		['a stray character', CODE + '.', 'charset'],
		['a truncated code', CODE.slice(0, 40), 'length'],
		['a code without the prefix', CODE.slice(4), 'prefix'],
		['a future prefix', CODE.replace('GS1', 'GS2'), 'prefix'],
		['non-zero padding bits', CODE.replace('3RFG', '3RFH'), 'padding'],
	])('rejects %s', async (_label, input, code) => {
		expect(await C.parse(input)).toEqual({ error: code });
	});

	it('rejects a non-string', async () => {
		expect(await C.parse(null)).toEqual({ error: 'prefix' });
	});

	it('generates 32 fresh bytes', () => {
		const a = C.generateSecret();
		const b = C.generateSecret();
		expect(a).toHaveLength(32);
		expect(C.toHex(a)).not.toBe(C.toHex(b));
	});

	it('round-trips a generated secret', async () => {
		const secret = C.generateSecret();
		const out = await C.parse(await C.encode(secret));
		expect(C.toHex(out.secret)).toBe(C.toHex(secret));
	});
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/eu-sync-code.test.mjs`
Expected: FAIL — `Cannot find module '../js/eu-sync-code.js'`.

- [ ] **Step 3: Write the implementation**

Create `js/eu-sync-code.js`:

```js
// The sync secret in the form a human can carry: 32 random bytes as one
// GS1- code, and back. Nothing else in the extension knows the alphabet, and
// nothing here knows what the secret is for - it is a byte string with a
// checksum, and the derivation lives in js/eu-sync-crypto.js.
//
// The format is contract (docs/gestura-eu-api.md) with fixed test vectors:
// prefix, alphabet, the 20-bit checksum and the zero padding bits are all
// pinned. A code the user wrote down last year has to keep working.
(function (root) {
	'use strict';

	const PREFIX = 'GS1';
	// Crockford base32: no I, L, O, U. The first three are ambiguous when read
	// aloud or off a screen and are accepted as aliases below; U is excluded so
	// that no accidental word can form.
	const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
	const SECRET_BYTES = 32;
	const BODY_CHARS = 52;   // 32 bytes = 256 bits, 52 * 5 = 260, 4 bits padding
	const CHECK_CHARS = 4;   // the top 20 bits of SHA-256(secret)
	const CODE_CHARS = BODY_CHARS + CHECK_CHARS;

	const VALUE = new Map();
	for (let i = 0; i < ALPHABET.length; i++) VALUE.set(ALPHABET[i], i);
	// Read, never written: encode() only ever emits canonical characters.
	VALUE.set('I', 1);
	VALUE.set('L', 1);
	VALUE.set('O', 0);

	function generateSecret() {
		return crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
	}

	// Big-endian bit stream. acc never holds more than 12 bits, so the 32-bit
	// shifts are safe.
	function encodeBody(bytes) {
		let out = '';
		let acc = 0;
		let bits = 0;
		for (const b of bytes) {
			acc = (acc << 8) | b;
			bits += 8;
			while (bits >= 5) {
				bits -= 5;
				out += ALPHABET[(acc >> bits) & 31];
			}
		}
		if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
		return out;
	}

	// null when the trailing padding bits are not zero. That is not pedantry: two
	// different final characters would otherwise decode to the same secret, and a
	// code would stop having exactly one spelling.
	function decodeBody(chars) {
		const out = [];
		let acc = 0;
		let bits = 0;
		for (const c of chars) {
			acc = (acc << 5) | VALUE.get(c);
			bits += 5;
			if (bits >= 8) {
				bits -= 8;
				out.push((acc >> bits) & 255);
			}
		}
		if ((acc & ((1 << bits) - 1)) !== 0) return null;
		return new Uint8Array(out);
	}

	async function checksum(secret) {
		const d = new Uint8Array(await crypto.subtle.digest('SHA-256', secret));
		const v = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4);
		let out = '';
		for (let i = 3; i >= 0; i--) out += ALPHABET[(v >>> (i * 5)) & 31];
		return out;
	}

	async function encode(secret) {
		const chars = encodeBody(secret) + await checksum(secret);
		return PREFIX + '-' + chars.match(/.{1,4}/g).join('-');
	}

	// The prefix is matched BEFORE anything is stripped: G, S and 1 are alphabet
	// characters themselves, so a blanket "keep only alphabet characters" would
	// swallow the prefix into the payload and turn a wrong version into a length
	// error - or worse, into a decodable but different secret.
	async function parse(input) {
		if (typeof input !== 'string') return { error: 'prefix' };
		const upper = input.trim().toUpperCase();
		if (!upper.startsWith(PREFIX)) return { error: 'prefix' };

		const chars = [];
		for (const c of upper.slice(PREFIX.length)) {
			if (c === '-' || /\s/.test(c)) continue;
			// Anything else that is not a character of the alphabet is an error, not
			// noise to skip. Skipping would let "GS1-...-CC6W." and a genuinely
			// corrupted code fail in different ways for the same reason.
			if (!VALUE.has(c)) return { error: 'charset' };
			chars.push(ALPHABET[VALUE.get(c)]);
		}
		if (chars.length !== CODE_CHARS) return { error: 'length' };

		const secret = decodeBody(chars.slice(0, BODY_CHARS));
		if (!secret) return { error: 'padding' };
		if (await checksum(secret) !== chars.slice(BODY_CHARS).join('')) return { error: 'checksum' };
		return { secret };
	}

	const toHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
	const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map(h => parseInt(h, 16)));

	const api = {
		PREFIX, ALPHABET, SECRET_BYTES, BODY_CHARS, CHECK_CHARS, CODE_CHARS,
		generateSecret, encode, parse, checksum, toHex, fromHex,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSyncCode = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/eu-sync-code.test.mjs`
Expected: PASS, all cases.

Then run the whole suite so a stray global cannot break another file:

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/eu-sync-code.js tests/eu-sync-code.test.mjs
git commit -m "feat(sync): the secret as a code a person can carry"
```

---

## Task 3: Derivation and envelope — `js/eu-sync-crypto.js`

The only file that calls `crypto.subtle` for sync. Everything above it deals in
plain objects and base64 strings and never handles a key.

**Files:**
- Create: `js/eu-sync-crypto.js`
- Test: `tests/eu-sync-crypto.test.mjs`

**Interfaces:**
- Consumes: `GesturaSyncCode.toHex` / `fromHex` in the tests only; the module itself consumes nothing.
- Produces: `window.GesturaSyncCrypto` with
  `INFO_LOCATOR`, `INFO_KEY`, `AAD_PREFIX`, `IV_BYTES: 12`,
  `deriveLocator(secret) -> Promise<string>` (base64url, unpadded),
  `deriveKey(secret) -> Promise<CryptoKey>`,
  `newStateId() -> string` (32 hex chars),
  `STATE_ID_RE`,
  `encryptBlob(key, stateId, role, value) -> Promise<string>` (base64 envelope; `value` is any JSON-serialisable object),
  `decryptBlob(key, stateId, role, envelope) -> Promise<object>` (throws `Error('decrypt')` on any failure),
  `blobHash(envelope) -> Promise<string>` (base64url SHA-256 over the envelope's raw bytes),
  `aad(stateId, role) -> Uint8Array`.

- [ ] **Step 1: Write the failing test**

Create `tests/eu-sync-crypto.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import '../js/eu-sync-code.js';
import '../js/eu-sync-crypto.js';
const C = globalThis.GesturaSyncCode;
const X = globalThis.GesturaSyncCrypto;

const SECRET_A = C.fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
const SECRET_B = C.fromHex('6e31aaf7266804808840320a2a6550b0b8fe93f7b88bcc96e016452a69840aa8');
const STATE = '0123456789abcdef0123456789abcdef';

describe('key derivation', () => {
	// The contract's vectors. A change here strands every uploaded state, because
	// the key is derived on every use and never stored.
	it('matches the locator vectors', async () => {
		expect(await X.deriveLocator(SECRET_A)).toBe('zoogXw2lwmt_ZqFnRu-lFOWYxyJaU2kpxfunpy3Umsk');
		expect(await X.deriveLocator(SECRET_B)).toBe('3qzyS44KqXaBNzKvFSontDE8CfLPp8lwOUVHroaeg7M');
	});

	it('matches the key vectors', async () => {
		const raw = await crypto.subtle.exportKey('raw', await X.deriveKey(SECRET_A));
		expect(C.toHex(new Uint8Array(raw)))
			.toBe('ca25c2f6d9e2392b270755cf04b75ff545fa536a387a4c4d4d16fcfeb2e7cba3');
	});

	it('derives a locator that is not the key', async () => {
		const raw = await crypto.subtle.exportKey('raw', await X.deriveKey(SECRET_A));
		const locatorBytes = Buffer.from(await X.deriveLocator(SECRET_A), 'base64url');
		expect(C.toHex(new Uint8Array(raw))).not.toBe(C.toHex(new Uint8Array(locatorBytes)));
	});

	it('produces a base64url locator without padding', async () => {
		expect(await X.deriveLocator(SECRET_A)).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});
});

describe('state ids', () => {
	it('are 32 hex characters and fresh each time', () => {
		const a = X.newStateId();
		expect(a).toMatch(X.STATE_ID_RE);
		expect(a).not.toBe(X.newStateId());
	});
});

describe('envelope', () => {
	it('round-trips an object', async () => {
		const key = await X.deriveKey(SECRET_A);
		const env = await X.encryptBlob(key, STATE, 'payload', { theme: 'dark', n: 1 });
		expect(await X.decryptBlob(key, STATE, 'payload', env)).toEqual({ theme: 'dark', n: 1 });
	});

	// Two encryptions of the same value under the same key must differ, or the IV
	// was reused - which breaks GCM outright, not gradually.
	it('uses a fresh IV every time', async () => {
		const key = await X.deriveKey(SECRET_A);
		const a = await X.encryptBlob(key, STATE, 'meta', { name: 'Work' });
		const b = await X.encryptBlob(key, STATE, 'meta', { name: 'Work' });
		expect(a).not.toBe(b);
		expect(a.slice(0, 16)).not.toBe(b.slice(0, 16));
	});

	it('fails on the wrong secret', async () => {
		const env = await X.encryptBlob(await X.deriveKey(SECRET_A), STATE, 'meta', { name: 'Work' });
		await expect(X.decryptBlob(await X.deriveKey(SECRET_B), STATE, 'meta', env)).rejects.toThrow('decrypt');
	});

	// The AAD binding. Without it the server could serve a valid meta blob as a
	// payload, or one state's blob under another state's id, and the client would
	// decrypt it happily.
	it('fails when the role is swapped', async () => {
		const key = await X.deriveKey(SECRET_A);
		const env = await X.encryptBlob(key, STATE, 'meta', { name: 'Work' });
		await expect(X.decryptBlob(key, STATE, 'payload', env)).rejects.toThrow('decrypt');
	});

	it('fails when the state id is swapped', async () => {
		const key = await X.deriveKey(SECRET_A);
		const env = await X.encryptBlob(key, STATE, 'meta', { name: 'Work' });
		await expect(X.decryptBlob(key, 'ffffffffffffffffffffffffffffffff', 'meta', env)).rejects.toThrow('decrypt');
	});

	it.each([
		['garbage', 'not base64 at all!'],
		['an empty string', ''],
		['a truncated envelope', 'AQIDBAUGBwgJCgsM'],
	])('rejects %s', async (_label, env) => {
		await expect(X.decryptBlob(await X.deriveKey(SECRET_A), STATE, 'meta', env)).rejects.toThrow('decrypt');
	});

	it('matches the envelope vector when the IV is fixed', async () => {
		const key = await X.deriveKey(SECRET_A);
		const iv = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const env = await X.encryptBlob(key, STATE, 'meta', { name: 'Work' }, iv);
		expect(env).toBe('AQIDBAUGBwgJCgsMhBezK2ZidsR4vw2Le+JA1vfSdGXw0lkopKj0PjhL9A==');
		expect(await X.blobHash(env)).toBe('wTZSj7yLdniic9fTzg1YQgD4WVynX3BgPTYosChka2c');
	});

	it('composes the AAD exactly as the contract says', () => {
		expect(new TextDecoder().decode(X.aad(STATE, 'meta')))
			.toBe('gestura-sync-v10123456789abcdef0123456789abcdefmeta');
	});
});
```

> The envelope vector encrypts `{ name: 'Work' }`, whose `JSON.stringify` is
> exactly `{"name":"Work"}` — the plaintext the contract's vector was computed
> from. Key order in an object literal is insertion order, so a single-property
> object is unambiguous.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/eu-sync-crypto.test.mjs`
Expected: FAIL — `Cannot find module '../js/eu-sync-crypto.js'`.

- [ ] **Step 3: Write the implementation**

Create `js/eu-sync-crypto.js`:

```js
// Everything the sync does with crypto.subtle: HKDF from the secret to a server
// locator and an AES-256-GCM key, and the envelope that carries a JSON object
// as one base64 string.
//
// The parameters are contract (docs/gestura-eu-api.md), pinned by test vectors:
// the zero salt, the two info strings, the 12-byte IV and the AAD composition.
// The key is derived on every use and stored nowhere - so a changed parameter
// does not break a running feature, it strands data that is already uploaded.
(function (root) {
	'use strict';

	const INFO_LOCATOR = 'gestura-sync-locator-v1';
	const INFO_KEY = 'gestura-sync-key-v1';
	const AAD_PREFIX = 'gestura-sync-v1';
	const IV_BYTES = 12;
	const STATE_ID_RE = /^[0-9a-f]{32}$/;

	// The secret carries the full 256 bits of entropy, so the salt has no work to
	// do; HKDF requires one, and a fixed zero salt is the standard answer when the
	// input keying material is already uniform.
	const SALT = new Uint8Array(32);
	const enc = new TextEncoder();

	function bytesToB64(bytes) {
		let s = '';
		for (const b of bytes) s += String.fromCharCode(b);
		return btoa(s);
	}

	function b64ToBytes(b64) {
		const s = atob(b64);
		const out = new Uint8Array(s.length);
		for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
		return out;
	}

	const b64url = (bytes) => bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

	async function deriveBits(secret, info) {
		const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
		return new Uint8Array(await crypto.subtle.deriveBits(
			{ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode(info) }, key, 256));
	}

	async function deriveLocator(secret) {
		return b64url(await deriveBits(secret, INFO_LOCATOR));
	}

	async function deriveKey(secret) {
		const raw = await deriveBits(secret, INFO_KEY);
		return crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
	}

	function newStateId() {
		return Array.from(crypto.getRandomValues(new Uint8Array(16)))
			.map(b => b.toString(16).padStart(2, '0')).join('');
	}

	// stateId is fixed-length hex and role is one of two fixed words, so plain
	// concatenation cannot be ambiguous - no separator is needed and adding one
	// later would be a format change.
	function aad(stateId, role) {
		return enc.encode(AAD_PREFIX + stateId + role);
	}

	// `iv` is an argument for one reason only: the contract's test vector needs a
	// fixed one. Every caller in the extension omits it and gets a fresh random
	// IV, which is what GCM requires - reusing one under the same key discloses
	// the key stream, and both blobs of a state share a key.
	async function encryptBlob(key, stateId, role, value, iv) {
		const nonce = iv || crypto.getRandomValues(new Uint8Array(IV_BYTES));
		const ct = new Uint8Array(await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: nonce, additionalData: aad(stateId, role), tagLength: 128 },
			key, enc.encode(JSON.stringify(value))));
		const out = new Uint8Array(nonce.length + ct.length);
		out.set(nonce, 0);
		out.set(ct, nonce.length);
		return bytesToB64(out);
	}

	// One error for every failure: a wrong secret, a swapped blob, a corrupted
	// byte and a truncated envelope are indistinguishable to the receiver, and
	// telling them apart would only ever help an attacker. The panel turns this
	// into "wrong code or damaged data".
	async function decryptBlob(key, stateId, role, envelope) {
		try {
			if (typeof envelope !== 'string' || !envelope) throw new Error('decrypt');
			const bytes = b64ToBytes(envelope);
			if (bytes.length <= IV_BYTES + 16) throw new Error('decrypt');
			const pt = await crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES), additionalData: aad(stateId, role), tagLength: 128 },
				key, bytes.slice(IV_BYTES));
			return JSON.parse(new TextDecoder().decode(pt));
		} catch {
			throw new Error('decrypt');
		}
	}

	// Over the envelope's raw bytes, not over its base64 spelling: base64 has
	// more than one encoding of the same bytes, and the server may normalise.
	async function blobHash(envelope) {
		const digest = await crypto.subtle.digest('SHA-256', b64ToBytes(envelope));
		return b64url(new Uint8Array(digest));
	}

	const api = {
		INFO_LOCATOR, INFO_KEY, AAD_PREFIX, IV_BYTES, STATE_ID_RE,
		deriveLocator, deriveKey, newStateId, aad,
		encryptBlob, decryptBlob, blobHash, bytesToB64, b64ToBytes,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSyncCrypto = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/eu-sync-crypto.test.mjs`
Expected: PASS. If the two derivation vectors fail, **stop** — a parameter is
wrong, and no amount of downstream code will make the states readable later.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/eu-sync-crypto.js tests/eu-sync-crypto.test.mjs
git commit -m "feat(sync): derive locator and key, seal the envelope"
```

---

## Task 4: The settings schema — `js/eu-settings-schema.js`

One validator for every settings blob that enters the extension, whatever door it came through: a file the user picked, a state downloaded from gestura.eu, and — the same code read backwards — the export. Today there are two half-validators: `#importSettings` checks that `enableGesture` exists and then merges the file over `DEFAULT_SETTINGS`, and the sync has none at all. This task replaces the first and supplies the second.

**Files:**
- Create: `js/eu-settings-schema.js`
- Test: `tests/eu-settings-schema.test.mjs`

**Interfaces:**
- Consumes: `window.GestureConstants.DEFAULT_SETTINGS`, `window.FlowMouseEuIntegration.canonicalize` / `hash64`.
- Produces: `window.GesturaSettingsSchema` with
  `FORMAT_FIELD: 'gesturaSettings'`, `FORMAT_VERSION: 1`, `MAX_BYTES`, `FORBIDDEN`, `NEVER`,
  `allowedKeys() -> string[]`,
  `buildExport(settings, extVersion) -> object`,
  `exportText(settings, extVersion) -> string`,
  `validate(input) -> Result` where `input` is the export **text** or an already-parsed object,
  `hashOf(exportObj) -> Promise<string>`.

  `Result` is always the same shape:

  ```js
  {
  	ok: boolean,
  	error: null | 'too-large' | 'not-json' | 'not-object' | 'not-settings' | 'unknown-format' | 'forbidden-key',
  	legacy: boolean,        // the file carried no gesturaSettings field
  	settings: object|null,  // complete, ready for SettingsStore.save()
  	dropped: string[],      // top-level keys that were not written
  	retyped: string[],      // allowlisted keys whose value had the wrong shape
  	json: string,           // pretty-printed, exactly what would be written
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/eu-settings-schema.test.mjs`:

```js
import { describe, it, expect, beforeAll } from 'vitest';

let S, DEFAULTS;

beforeAll(async () => {
	// constants.js is a browser IIFE that assigns to window.GestureConstants -
	// the same shim tests/settings-defaults.test.mjs uses.
	globalThis.window = globalThis;
	await import('../js/constants.js');
	await import('../js/eu-integration.js');
	await import('../js/eu-settings-schema.js');
	S = globalThis.GesturaSettingsSchema;
	DEFAULTS = globalThis.GestureConstants.DEFAULT_SETTINGS;
});

const settings = () => ({ ...structuredClone(DEFAULTS), theme: 'dark', trailWidth: 9 });

describe('export', () => {
	it('carries the format version and the extension version', () => {
		const out = S.buildExport(settings(), '2.8.0');
		expect(out.gesturaSettings).toBe(1);
		expect(out._version).toBe('2.8.0');
	});

	it('never exports the local-only keys', () => {
		const out = S.buildExport({ ...settings(), euIntegration: { enabled: true }, euSync: { secret: 'x' } }, '2.8.0');
		expect(out).not.toHaveProperty('euIntegration');
		expect(out).not.toHaveProperty('euSync');
	});

	// It changes on every save and means nothing in another browser. Carrying it
	// would also make the "changed since last upload" hint fire after a save that
	// changed nothing else.
	it('does not export lastSyncTime', () => {
		expect(S.buildExport({ ...settings(), lastSyncTime: '2026-09-03T00:00:00Z' }, '2.8.0'))
			.not.toHaveProperty('lastSyncTime');
	});

	it('round-trips through the validator unchanged', () => {
		const before = settings();
		const res = S.validate(S.exportText(before, '2.8.0'));
		expect(res.ok).toBe(true);
		expect(res.dropped).toEqual([]);
		expect(res.settings.theme).toBe('dark');
		expect(res.settings.trailWidth).toBe(9);
	});
});

describe('validation', () => {
	it('accepts the current format', () => {
		const res = S.validate({ gesturaSettings: 1, theme: 'dark' });
		expect(res.ok).toBe(true);
		expect(res.legacy).toBe(false);
		expect(res.settings.theme).toBe('dark');
	});

	it('fills every key it was not given from the defaults', () => {
		const res = S.validate({ gesturaSettings: 1, theme: 'dark' });
		expect(res.settings.trailWidth).toBe(DEFAULTS.trailWidth);
		expect(Object.keys(res.settings).sort()).toEqual(Object.keys(DEFAULTS).sort());
	});

	it('refuses an unknown format version instead of guessing', () => {
		expect(S.validate({ gesturaSettings: 2, theme: 'dark' }))
			.toMatchObject({ ok: false, error: 'unknown-format' });
	});

	it('refuses text that is not JSON', () => {
		expect(S.validate('{ not json')).toMatchObject({ ok: false, error: 'not-json' });
	});

	it.each([['an array', '[]'], ['a number', '42'], ['null', 'null']])
		('refuses %s at the top level', (_label, text) => {
			expect(S.validate(text)).toMatchObject({ ok: false, error: 'not-object' });
		});

	it('refuses a file that holds no settings at all', () => {
		expect(S.validate({ gesturaSettings: 1, nothing: 'here' }))
			.toMatchObject({ ok: false, error: 'not-settings' });
	});

	it('refuses text above the size cap', () => {
		const big = JSON.stringify({ gesturaSettings: 1, theme: 'x'.repeat(S.MAX_BYTES) });
		expect(S.validate(big)).toMatchObject({ ok: false, error: 'too-large' });
	});

	it('drops unknown top-level keys and names them', () => {
		const res = S.validate({ gesturaSettings: 1, theme: 'dark', evil: 1, alsoEvil: 2 });
		expect(res.ok).toBe(true);
		expect(res.settings).not.toHaveProperty('evil');
		expect(res.dropped).toEqual(['evil', 'alsoEvil']);
	});

	// A crafted file must not be able to turn the integration on, plant a secret,
	// or hand this browser somebody else's locator.
	it('drops euIntegration and euSync out of a crafted file', () => {
		const res = S.validate({ gesturaSettings: 1, theme: 'dark', euIntegration: { enabled: true }, euSync: { secret: 'GS1-…' } });
		expect(res.settings).not.toHaveProperty('euIntegration');
		expect(res.settings).not.toHaveProperty('euSync');
		expect(res.dropped).toEqual(['euIntegration', 'euSync']);
	});

	it('falls back to the default when an allowlisted value has the wrong shape', () => {
		const res = S.validate({ gesturaSettings: 1, siteMenus: 'not an object', trailWidth: 7 });
		expect(res.ok).toBe(true);
		expect(res.settings.siteMenus).toEqual(DEFAULTS.siteMenus);
		expect(res.retyped).toEqual(['siteMenus']);
		expect(res.settings.trailWidth).toBe(7);
	});

	// Written as TEXT, not as object literals: `__proto__:` in a literal sets the
	// prototype instead of creating a property, so JSON.stringify would silently
	// drop the very thing under test. This is also the form the attack arrives in.
	it.each([
		['at the top level', '{"gesturaSettings":1,"theme":"dark","__proto__":{"polluted":1}}'],
		['nested in an object', '{"gesturaSettings":1,"siteMenus":{"custom":{"m1":{"constructor":1}}}}'],
		['nested in an array', '{"gesturaSettings":1,"blacklist":[{"prototype":1}]}'],
		['deeply nested', '{"gesturaSettings":1,"siteMenus":{"custom":{"m1":{"items":[{"__proto__":{"x":1}}]}}}}'],
	])('refuses a forbidden key %s', (_label, text) => {
		expect(S.validate(text)).toMatchObject({ ok: false, error: 'forbidden-key' });
	});

	it('is not polluted by a rejected file', () => {
		S.validate('{"gesturaSettings":1,"theme":"dark","__proto__":{"polluted":1}}');
		expect({}.polluted).toBeUndefined();
	});
});

describe('legacy files', () => {
	it('are recognised by the missing format field', () => {
		const res = S.validate({ _version: '2.3.1', enableGesture: true, theme: 'dark' });
		expect(res.ok).toBe(true);
		expect(res.legacy).toBe(true);
	});

	it('migrate the pre-2.4 gesture keys into mouseGestures', () => {
		const res = S.validate({
			enableGesture: true,
			gestures: { '→': 'forward' },
			customGestures: { '←': 'openUrl' },
			customGestureUrls: { '←': 'https://example.org' },
		});
		expect(res.settings.mouseGestures['→']).toEqual({ action: 'forward' });
		expect(res.settings.mouseGestures['←']).toEqual({ action: 'openUrl', customUrl: 'https://example.org' });
		expect(res.dropped).not.toContain('gestures');
	});

	it('drop a gesture the old file had switched off', () => {
		const res = S.validate({ enableGesture: true, gestures: { '→': 'forward' }, customGestures: { '→': null } });
		expect(res.settings.mouseGestures).not.toHaveProperty('→');
	});

	it('leave mouseGestures alone when the file already has it', () => {
		const res = S.validate({ enableGesture: true, mouseGestures: { '↑': { action: 'top' } }, gestures: { '→': 'forward' } });
		expect(res.settings.mouseGestures).toEqual({ '↑': { action: 'top' } });
	});
});

describe('the upload hash', () => {
	it('ignores key order', async () => {
		const a = await S.hashOf({ gesturaSettings: 1, theme: 'dark', trailWidth: 5 });
		const b = await S.hashOf({ trailWidth: 5, gesturaSettings: 1, theme: 'dark' });
		expect(a).toBe(b);
	});

	// The reminder answers "did I change anything since I uploaded", and updating
	// the extension is not a change to the settings.
	it('ignores the extension version', async () => {
		const a = await S.hashOf({ gesturaSettings: 1, _version: '2.8.0', theme: 'dark' });
		const b = await S.hashOf({ gesturaSettings: 1, _version: '2.9.0', theme: 'dark' });
		expect(a).toBe(b);
	});

	it('changes when a value changes', async () => {
		const a = await S.hashOf({ gesturaSettings: 1, theme: 'dark' });
		const b = await S.hashOf({ gesturaSettings: 1, theme: 'light' });
		expect(a).not.toBe(b);
	});
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/eu-settings-schema.test.mjs`
Expected: FAIL — `Cannot find module '../js/eu-settings-schema.js'`.

- [ ] **Step 3: Write the implementation**

Create `js/eu-settings-schema.js`:

```js
// The one shape a settings blob has to have to get into this extension - and
// the one place that decides it. Three doors lead in: a file the user picked, a
// state downloaded from gestura.eu, and the export read backwards. They used to
// have one and a half validators between them (#importSettings checked that
// enableGesture existed; the sync had nothing), which is exactly the kind of
// asymmetry a crafted file looks for.
//
// The rules are contract, not preference - docs/gestura-eu-api.md, "Settings
// exchange format".
(function (root) {
	'use strict';

	const FORMAT_FIELD = 'gesturaSettings';
	const FORMAT_VERSION = 1;
	const MAX_BYTES = 512 * 1024;

	// Rejected anywhere in the tree, at any depth. A settings entry the user
	// literally named "constructor" cannot travel through a file as a result -
	// that is the right side to be wrong on, and R1's bridge already treats such
	// an id as hostile-but-harmless for the same reason.
	const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

	// Never exported, never imported. The first two live in chrome.storage.local
	// and hold the consent and the sync secret: a file that could set them could
	// turn the integration on or hand this browser a foreign locator. The third is
	// a local timestamp that changes on every save.
	const NEVER = new Set(['euIntegration', 'euSync', 'lastSyncTime']);

	const defaults = () => root.GestureConstants.DEFAULT_SETTINGS;

	function allowedKeys() {
		return Object.keys(defaults()).filter(k => !NEVER.has(k));
	}

	// Top level only, against the shape of the key's own default. Deeper
	// normalisation is not repeated here: SettingsStore.normalizeSetting() runs
	// over mouseGestures, wheelGestures, specialGestures and siteMenus on every
	// load, and an import reloads the page - so a malformed inner value is
	// repaired by the code that already owns that job, instead of by a second
	// copy of it that could drift.
	function sameShape(value, def) {
		if (Array.isArray(def)) return Array.isArray(value);
		if (def === null) return true;
		if (def !== null && typeof def === 'object') {
			return value !== null && typeof value === 'object' && !Array.isArray(value);
		}
		return typeof value === typeof def;
	}

	function hasForbiddenKey(value) {
		if (!value || typeof value !== 'object') return false;
		if (Array.isArray(value)) return value.some(hasForbiddenKey);
		for (const key of Object.keys(value)) {
			if (FORBIDDEN.has(key)) return true;
			if (hasForbiddenKey(value[key])) return true;
		}
		return false;
	}

	function buildExport(settings, extVersion) {
		const out = { [FORMAT_FIELD]: FORMAT_VERSION, _version: extVersion || '' };
		for (const key of allowedKeys()) {
			if (settings && settings[key] !== undefined) out[key] = settings[key];
		}
		return out;
	}

	function exportText(settings, extVersion) {
		return JSON.stringify(buildExport(settings, extVersion), null, 2);
	}

	// Pre-2.4 exports carried `gestures` + `customGestures` + `customGestureUrls`
	// instead of `mouseGestures`. Lifted out of options-page.js's #importSettings
	// unchanged: the sync download needs the same migration for the same files,
	// and two copies of a migration are one copy too many.
	function migrateLegacy(obj) {
		if (!(obj.customGestures || obj.gestures) || obj.mouseGestures) return obj;
		const { DEFAULT_GESTURES } = root.GestureConstants;
		const merged = { ...(obj.gestures || DEFAULT_GESTURES), ...(obj.customGestures || {}) };
		const urls = obj.customGestureUrls || {};
		const mouseGestures = {};
		for (const [pattern, action] of Object.entries(merged)) {
			if (action === null) continue;
			mouseGestures[pattern] = urls[pattern] ? { action, customUrl: urls[pattern] } : { action };
		}
		const out = { ...obj, mouseGestures };
		delete out.gestures;
		delete out.customGestures;
		delete out.customGestureUrls;
		return out;
	}

	const fail = (error) => ({ ok: false, error, legacy: false, settings: null, dropped: [], retyped: [], json: '' });

	function validate(input) {
		let raw = input;
		if (typeof input === 'string') {
			if (new TextEncoder().encode(input).length > MAX_BYTES) return fail('too-large');
			try { raw = JSON.parse(input); } catch { return fail('not-json'); }
		}
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('not-object');

		// Before anything is copied, spread or merged.
		if (hasForbiddenKey(raw)) return fail('forbidden-key');

		const legacy = !Object.prototype.hasOwnProperty.call(raw, FORMAT_FIELD);
		if (!legacy && raw[FORMAT_FIELD] !== FORMAT_VERSION) return fail('unknown-format');

		const source = legacy ? migrateLegacy(raw) : raw;
		const allowed = new Set(allowedKeys());
		const settings = structuredClone(defaults());
		const dropped = [];
		const retyped = [];
		let kept = 0;

		for (const [key, value] of Object.entries(source)) {
			if (key === FORMAT_FIELD || key === '_version') continue;
			if (!allowed.has(key)) { dropped.push(key); continue; }
			if (!sameShape(value, defaults()[key])) { retyped.push(key); continue; }
			settings[key] = value;
			kept++;
		}

		// A file that contributed nothing is not a settings file - it is a JSON
		// document that happened to parse. Saying so beats writing the defaults
		// over the user's settings and calling it an import.
		if (!kept) return fail('not-settings');

		return {
			ok: true,
			error: null,
			legacy,
			settings,
			dropped,
			retyped,
			json: JSON.stringify(buildExport(settings, raw._version), null, 2),
		};
	}

	// What the "changed since last upload" hint compares. The extension version
	// is excluded deliberately: updating Gestura is not a change to the settings,
	// and including it would make the hint appear for everybody after every
	// update.
	async function hashOf(exportObj) {
		const EU = root.FlowMouseEuIntegration;
		const copy = { ...exportObj };
		delete copy._version;
		return EU.hash64(EU.canonicalize(copy));
	}

	const api = {
		FORMAT_FIELD, FORMAT_VERSION, MAX_BYTES, FORBIDDEN, NEVER,
		allowedKeys, buildExport, exportText, validate, hashOf, migrateLegacy,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSettingsSchema = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/eu-settings-schema.test.mjs`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/eu-settings-schema.js tests/eu-settings-schema.test.mjs
git commit -m "feat(settings): one validator for every door settings come in by"
```

---

## Task 5: The tier-2 state — `js/eu-sync-local.js`, and `apiLevel` 3

The `euSync` key: the switch, its own consent, the secret, and this browser's map of the states it has uploaded to. Modelled on `js/eu-local.js` — the same live cache, the same `storage.onChanged` feed — because the same rule applies: whoever asks whether sync may act must get today's answer, not the one from page load.

This task also raises `API_LEVEL` and corrects the comment in `js/eu-integration.js` that promises a tier-1 consent bump R3 does not make.

**Files:**
- Create: `js/eu-sync-local.js`
- Modify: `js/eu-integration.js` (two lines)
- Modify: `tests/eu-integration.test.mjs` (the `apiLevel` expectation)
- Test: `tests/eu-sync-local.test.mjs`

**Interfaces:**
- Consumes: `FlowMouseEuIntegration.effectiveEnabled` / `allowedOrigins` / `normalizeLocal`, `GesturaSyncCrypto.STATE_ID_RE`, `GesturaEuLocal.read` / `onChange`.
- Produces: `window.GesturaSyncLocal` with
  `KEY: 'euSync'`, `CURRENT_SYNC_CONSENT: 1`, `STATES_MAX: 10`, `CHANGED_EVENT`,
  `normalizeSync(raw) -> { euSync: { enabled, consent, secret, states } }`,
  `syncEnabled(local, sync) -> boolean`,
  `syncOrigin(local) -> string`,
  `read()`, `current()`, `write(patch)`, `onChange(fn)`,
  `setState(stateId, patch)`, `removeState(stateId)`.

  `states` is `{ [stateId]: { name, lastUploadHash, lastUploadDate } }`. The
  secret is stored as its **code string** — one representation, displayable
  without conversion, and a corrupted store fails its own checksum instead of
  deriving a locator nobody owns.

- [ ] **Step 1: Write the failing test**

Create `tests/eu-sync-local.test.mjs`:

```js
import { describe, it, expect, beforeEach } from 'vitest';

// Storage and GesturaEuLocal stubs before the import, the way
// tests/eu-updates-persist.test.mjs establishes.
const store = new Map();
let onChangedListener = null;

globalThis.chrome = {
	storage: {
		local: {
			get: async (key) => (store.has(key) ? { [key]: store.get(key) } : {}),
			set: async (obj) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
			remove: async (key) => { store.delete(key); },
		},
		onChanged: { addListener: (fn) => { onChangedListener = fn; } },
	},
};

let tier1;
const tier1Listeners = [];
globalThis.GesturaEuLocal = {
	read: async () => tier1,
	current: () => tier1,
	onChange: (fn) => { tier1Listeners.push(fn); return () => {}; },
};

await import('../js/eu-integration.js');
await import('../js/eu-sync-code.js');
await import('../js/eu-sync-crypto.js');
await import('../js/eu-sync-local.js');
const EU = globalThis.FlowMouseEuIntegration;
const L = globalThis.GesturaSyncLocal;

const integration = (over = {}) => ({
	euIntegration: {
		enabled: true,
		consent: { version: EU.CURRENT_INTEGRATION_CONSENT, date: '2026-09-03T00:00:00Z' },
		devOrigin: '',
		...over,
	},
});
const sync = (over = {}) => ({
	euSync: {
		enabled: true,
		consent: { version: L.CURRENT_SYNC_CONSENT, date: '2026-09-03T00:00:00Z' },
		secret: 'GS1-000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFG-CC6W',
		states: {},
		...over,
	},
});
const ID = '0123456789abcdef0123456789abcdef';

beforeEach(async () => {
	store.clear();
	tier1 = integration();
	// The module keeps a live cache, so emptying the store is not the same as
	// resetting the state - write the defaults THROUGH the module so the cache
	// goes back too. Without this the tests leak into each other.
	await L.write({ enabled: false, consent: null, secret: '', states: {} });
});

describe('normalizeSync', () => {
	it('answers the defaults for an empty store', () => {
		expect(L.normalizeSync({}).euSync).toEqual({ enabled: false, consent: null, secret: '', states: {} });
	});

	it('drops a consent without a numeric version', () => {
		expect(L.normalizeSync({ euSync: { consent: { date: 'x' } } }).euSync.consent).toBe(null);
	});

	it('drops a state whose id is not a state id', () => {
		const out = L.normalizeSync({ euSync: { states: { [ID]: { name: 'Work' }, 'nope': { name: 'X' } } } });
		expect(Object.keys(out.euSync.states)).toEqual([ID]);
		expect(out.euSync.states[ID]).toEqual({ name: 'Work', lastUploadHash: '', lastUploadDate: '' });
	});
});

describe('the tier-2 invariant', () => {
	it('holds when both tiers are current', () => {
		expect(L.syncEnabled(integration(), sync())).toBe(true);
	});

	// The whole point of two tiers: tier 2 can never authorise anything on its own.
	it.each([
		['tier 1 is off', integration({ enabled: false }), sync()],
		['tier 1 has a stale consent', integration({ consent: { version: 0, date: 'x' } }), sync()],
		['tier 1 has no consent', integration({ consent: null }), sync()],
		['tier 2 is off', integration(), sync({ enabled: false })],
		['tier 2 has a stale consent', integration(), sync({ consent: { version: 0, date: 'x' } })],
		['tier 2 has no consent', integration(), sync({ consent: null })],
	])('fails when %s', (_label, local, s) => {
		expect(L.syncEnabled(local, s)).toBe(false);
	});
});

describe('syncOrigin', () => {
	it('is production by default', () => {
		expect(L.syncOrigin(integration())).toBe('https://gestura.eu');
	});

	// One secret, one blob store. A developer testing against a local index must
	// not push states into production, and the panel says so.
	it('is the developer origin when one is configured', () => {
		expect(L.syncOrigin(integration({ devOrigin: 'http://localhost:8199' }))).toBe('http://localhost:8199');
	});

	it('ignores an invalid developer origin', () => {
		expect(L.syncOrigin(integration({ devOrigin: 'not an origin' }))).toBe('https://gestura.eu');
	});
});

describe('storage', () => {
	it('writes and reads back a patch', async () => {
		await L.write({ enabled: true, secret: 'GS1-X' });
		expect((await L.read()).euSync.enabled).toBe(true);
		expect((await L.read()).euSync.secret).toBe('GS1-X');
	});

	it('records a state and removes it again', async () => {
		await L.setState(ID, { name: 'Work', lastUploadHash: 'abc', lastUploadDate: '2026-09-03T10:00:00Z' });
		expect((await L.read()).euSync.states[ID].name).toBe('Work');
		await L.removeState(ID);
		expect((await L.read()).euSync.states).toEqual({});
	});

	it('merges into an existing state instead of replacing it', async () => {
		await L.setState(ID, { name: 'Work' });
		await L.setState(ID, { lastUploadHash: 'abc' });
		expect((await L.read()).euSync.states[ID]).toEqual({ name: 'Work', lastUploadHash: 'abc', lastUploadDate: '' });
	});
});

describe('when tier 1 goes away', () => {
	// A tier-2 consent that springs back to life the moment tier 1 is re-enabled
	// would be an authorisation nobody gave twice. The secret and the states stay -
	// they are local data and re-pairing should not cost the user their states.
	it('clears the tier-2 switch and consent but keeps the secret', async () => {
		await L.write(sync().euSync);
		tier1 = integration({ enabled: false, consent: null });
		for (const fn of tier1Listeners) await fn(tier1);
		const after = (await L.read()).euSync;
		expect(after.enabled).toBe(false);
		expect(after.consent).toBe(null);
		expect(after.secret).toMatch(/^GS1-/);
	});

	it('leaves everything alone while tier 1 is fine', async () => {
		await L.write(sync().euSync);
		for (const fn of tier1Listeners) await fn(integration());
		expect((await L.read()).euSync.enabled).toBe(true);
	});
});
```

Add to `tests/eu-integration.test.mjs`, wherever `apiLevel` is asserted, the new
value — `expect(...apiLevel).toBe(3)`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/eu-sync-local.test.mjs tests/eu-integration.test.mjs`
Expected: FAIL — `Cannot find module '../js/eu-sync-local.js'`, and the
`apiLevel` expectation fails at 2.

- [ ] **Step 3: Raise the API level**

In `js/eu-integration.js`, replace the constant and the comment above it:

```js
	// Bumping this re-prompts every user: effectiveEnabled() is false until the
	// stored consent carries the current number. R1 = 1. R2 = 2 (the update
	// check sends a request the user did not click). R3 does NOT raise it: sync
	// is a second switch with a consent of its own (GesturaSyncLocal), and tier 1
	// discloses nothing in R3 that it did not disclose in R2. Raising it here
	// would sign every existing user out of the integration over a feature they
	// may never turn on.
	const CURRENT_INTEGRATION_CONSENT = 2;
	const API_LEVEL = 3;
```

- [ ] **Step 4: Write `js/eu-sync-local.js`**

```js
// The only reader/writer of the sync state in chrome.storage.local: the tier-2
// switch, its own consent, the secret, and this browser's map of the states it
// has uploaded to.
//
// Shaped like js/eu-local.js - live cache, fed by storage.onChanged - for the
// same reason: every gated path must be able to ask "may I, right now" and get
// today's answer. It is a separate key and a separate file because tier 2 has a
// separate lifetime: revoking tier 1 must not touch the secret, and no content
// script or service worker ever loads this file.
(function (root) {
	'use strict';

	const EU = root.FlowMouseEuIntegration;
	const KEY = 'euSync';
	// Tier 2's own consent, independent of the integration's. R3 = 1.
	const CURRENT_SYNC_CONSENT = 1;
	const STATES_MAX = 10;
	const CHANGED_EVENT = 'gestura:eu-sync-changed';

	const DEFAULTS = { enabled: false, consent: null, secret: '', states: {} };

	function normalizeSync(raw) {
		const src = (raw && raw[KEY] && typeof raw[KEY] === 'object') ? raw[KEY] : {};
		const consent = (src.consent && typeof src.consent === 'object' && typeof src.consent.version === 'number')
			? { version: src.consent.version, date: typeof src.consent.date === 'string' ? src.consent.date : '' }
			: null;
		const states = {};
		const stored = (src.states && typeof src.states === 'object') ? src.states : {};
		for (const [id, st] of Object.entries(stored)) {
			// Ids come from storage, which means they could be anything. Checking the
			// shape here keeps every consumer from having to.
			if (!root.GesturaSyncCrypto.STATE_ID_RE.test(id) || !st || typeof st !== 'object') continue;
			states[id] = {
				name: typeof st.name === 'string' ? st.name : '',
				lastUploadHash: typeof st.lastUploadHash === 'string' ? st.lastUploadHash : '',
				lastUploadDate: typeof st.lastUploadDate === 'string' ? st.lastUploadDate : '',
			};
		}
		return {
			euSync: {
				enabled: src.enabled === true,
				consent,
				secret: typeof src.secret === 'string' ? src.secret : '',
				states,
			},
		};
	}

	// The composed invariant from the design: tier 2 rides on tier 1 and can
	// never authorise anything by itself. Both halves are checked against their
	// own current consent version, so either one going stale stops sync.
	function syncEnabled(local, sync) {
		const s = normalizeSync(sync).euSync;
		return EU.effectiveEnabled(local)
			&& s.enabled === true
			&& s.consent !== null
			&& s.consent.version === CURRENT_SYNC_CONSENT;
	}

	// Sync talks to exactly one server, unlike the update check which asks every
	// origin an entry came from. There is one secret and one blob store; a state
	// that lived on two servers would need a UI explaining which one it is on.
	// allowedOrigins() answers [production] or [production, dev].
	function syncOrigin(local) {
		const origins = EU.allowedOrigins(local);
		return origins.length > 1 ? origins[1] : origins[0];
	}

	let cache = normalizeSync({});
	let loaded = false;
	let loading = null;
	const listeners = new Set();

	function absorb(raw) {
		cache = normalizeSync(raw);
		loaded = true;
		return cache;
	}

	function load() {
		if (!loading) {
			let promise;
			try {
				promise = chrome.storage.local.get(KEY);
			} catch (e) {
				promise = Promise.reject(e);
			}
			loading = promise.then(absorb).catch(() => {
				// Same reasoning as js/eu-local.js: a failed read must not become this
				// context's answer for good. Drop the memo, answer the defaults - and
				// the defaults say "off", so every gated path fails closed.
				loading = null;
				return cache;
			});
		}
		return loading;
	}

	async function read() {
		return loaded ? cache : load();
	}

	function current() {
		return cache;
	}

	async function write(patch) {
		const next = { ...(await read()).euSync, ...(patch || {}) };
		await chrome.storage.local.set({ [KEY]: next });
		return absorb({ [KEY]: next });
	}

	// Merges into the state rather than replacing it: the name is written when the
	// state is created, the hash and date on every upload, and those are separate
	// moments.
	async function setState(stateId, patch) {
		const states = { ...(await read()).euSync.states };
		states[stateId] = { name: '', lastUploadHash: '', lastUploadDate: '', ...(states[stateId] || {}), ...(patch || {}) };
		return write({ states });
	}

	async function removeState(stateId) {
		const states = { ...(await read()).euSync.states };
		delete states[stateId];
		return write({ states });
	}

	function onChange(fn) {
		listeners.add(fn);
		return () => listeners.delete(fn);
	}

	if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area !== 'local' || !changes[KEY]) return;
			absorb({ [KEY]: changes[KEY].newValue });
			for (const fn of listeners) { try { fn(cache); } catch { /* one listener must not break the others */ } }
			if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED_EVENT));
		});
	}

	// Withdrawing the website integration takes the sync consent with it. Sync is
	// already dead by composition at that moment - this is about what happens
	// NEXT time: a tier-2 consent left standing would silently authorise uploads
	// again the moment tier 1 is switched back on, and nobody agreed to that
	// twice. The secret and the states stay: they are local data, and re-pairing
	// should not cost the user the states they already have.
	if (root.GesturaEuLocal && root.GesturaEuLocal.onChange) {
		root.GesturaEuLocal.onChange(async (local) => {
			if (EU.effectiveEnabled(local)) return;
			const cur = (await read()).euSync;
			if (!cur.enabled && cur.consent === null) return;
			await write({ enabled: false, consent: null });
		});
	}

	load();

	const api = {
		KEY, CURRENT_SYNC_CONSENT, STATES_MAX, CHANGED_EVENT,
		normalizeSync, syncEnabled, syncOrigin,
		read, current, write, setState, removeState, onChange,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSyncLocal = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/eu-sync-local.test.mjs tests/eu-integration.test.mjs`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/eu-sync-local.js js/eu-integration.js tests/eu-sync-local.test.mjs tests/eu-integration.test.mjs
git commit -m "feat(sync): the second switch, with a consent of its own"
```

---

## Task 6: The endpoints — `js/eu-sync.js`

Four requests and the gate around them. The gate is the reason this is not four `fetch` calls in the panel: every operation re-reads the live state before it acts and again after the answer arrives, so a withdrawal during a request cannot leave its result on the screen or in storage. R2's `persist()` and `tests/eu-updates-persist.test.mjs` are where that shape comes from.

**Files:**
- Create: `js/eu-sync.js`
- Test: `tests/eu-sync.test.mjs`

**Interfaces:**
- Consumes: `GesturaSyncCode.parse`, `GesturaSyncCrypto.*`, `GesturaSyncLocal.*`, `GesturaEuLocal.read`, `FlowMouseEuIntegration.API_LEVEL`.
- Produces: `window.GesturaSync` with
  `PATHS`, `LIMITS`,
  `syncError(code) -> Error` (an `Error` carrying `.code`),
  `request({ origin, path, method, body, fetchImpl }) -> Promise<object>`,
  `listStates({ secret, origin, fetchImpl })`,
  `uploadState({ secret, origin, stateId, name, createdAt, exportObj, extVersion, fetchImpl })`,
  `downloadState({ secret, origin, stateId, expectPayloadHash, fetchImpl })`,
  `deleteStates({ secret, origin, stateId, fetchImpl })`,
  and the four gated wrappers `list()`, `upload(opts)`, `download(opts)`, `remove(stateId)`.

  Every failure is an `Error` whose `.code` is one of
  `disabled | no-secret | network | bad-request | not-found | too-large | quota-states | rate-limited | server | malformed | decrypt`.

- [ ] **Step 1: Write the failing test**

Create `tests/eu-sync.test.mjs`:

```js
import { describe, it, expect, beforeEach } from 'vitest';

const store = new Map();
globalThis.chrome = {
	storage: {
		local: {
			get: async (key) => (store.has(key) ? { [key]: store.get(key) } : {}),
			set: async (obj) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
			remove: async (key) => { store.delete(key); },
		},
		onChanged: { addListener: () => {} },
	},
};

const CODE = 'GS1-000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFG-CC6W';
const LOCATOR = 'zoogXw2lwmt_ZqFnRu-lFOWYxyJaU2kpxfunpy3Umsk';
const ID = '0123456789abcdef0123456789abcdef';

let tier1, tier2;
globalThis.GesturaEuLocal = { read: async () => tier1, current: () => tier1, onChange: () => () => {} };

await import('../js/eu-integration.js');
await import('../js/eu-sync-code.js');
await import('../js/eu-sync-crypto.js');
await import('../js/eu-sync-local.js');
await import('../js/eu-sync.js');
const EU = globalThis.FlowMouseEuIntegration;
const C = globalThis.GesturaSyncCode;
const X = globalThis.GesturaSyncCrypto;
const L = globalThis.GesturaSyncLocal;
const S = globalThis.GesturaSync;

const integration = (over = {}) => ({
	euIntegration: { enabled: true, consent: { version: EU.CURRENT_INTEGRATION_CONSENT, date: 'x' }, devOrigin: '', ...over },
});
const syncState = (over = {}) => ({
	enabled: true, consent: { version: L.CURRENT_SYNC_CONSENT, date: 'x' }, secret: CODE, states: {}, ...over,
});

// Every call records what was asked, so a test can assert on the body that
// actually went out rather than on what the code meant to send.
let calls;
const fetchOk = (payload) => async (url, init) => {
	calls.push({ url, init, body: JSON.parse(init.body) });
	return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(payload) };
};
const fetchStatus = (status, body) => async (url, init) => {
	calls.push({ url, init, body: JSON.parse(init.body) });
	return { ok: false, status, headers: { get: () => null }, text: async () => JSON.stringify(body || {}) };
};

const secretBytes = async () => (await C.parse(CODE)).secret;

beforeEach(async () => {
	store.clear();
	calls = [];
	tier1 = integration();
	// Through the module, not into the store: GesturaSyncLocal caches, so a
	// direct store write would leave the cache holding the previous test's state.
	await L.write(syncState());
});

describe('the request body', () => {
	it('carries the api level and the locator, and never the secret', async () => {
		await S.listStates({ secret: await secretBytes(), origin: 'https://gestura.eu', fetchImpl: fetchOk({ states: [] }) });
		expect(calls[0].url).toBe('https://gestura.eu/api/v1/sync/list');
		expect(calls[0].body).toEqual({ apiLevel: 3, locator: LOCATOR });
		expect(calls[0].init.body).not.toContain('GS1');
	});

	// The server must not learn the state's name. It is inside the encrypted meta
	// blob, and this is the assertion that keeps it there.
	it('never sends a state name in the clear', async () => {
		await S.uploadState({
			secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
			name: 'Arbeitsrechner', createdAt: '2026-09-03T00:00:00Z',
			exportObj: { gesturaSettings: 1, theme: 'dark' }, extVersion: '2.8.0',
			fetchImpl: fetchOk({ stateId: ID, updatedAt: 'x', size: 1 }),
		});
		expect(calls[0].init.body).not.toContain('Arbeitsrechner');
		expect(calls[0].init.method).toBe('PUT');
		expect(Object.keys(calls[0].body).sort()).toEqual(['apiLevel', 'locator', 'meta', 'payload', 'stateId']);
	});

	it('binds the meta blob to the payload it was uploaded with', async () => {
		await S.uploadState({
			secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
			name: 'Work', createdAt: 'x', exportObj: { gesturaSettings: 1 }, extVersion: '2.8.0',
			fetchImpl: fetchOk({ stateId: ID, updatedAt: 'x', size: 1 }),
		});
		const key = await X.deriveKey(await secretBytes());
		const meta = await X.decryptBlob(key, ID, 'meta', calls[0].body.meta);
		expect(meta.name).toBe('Work');
		expect(meta.payloadHash).toBe(await X.blobHash(calls[0].body.payload));
	});
});

describe('reading a list', () => {
	it('decrypts the meta blobs', async () => {
		const key = await X.deriveKey(await secretBytes());
		const meta = await X.encryptBlob(key, ID, 'meta', { name: 'Work', updatedAt: 'x' });
		const out = await S.listStates({
			secret: await secretBytes(), origin: 'https://gestura.eu',
			fetchImpl: fetchOk({ states: [{ stateId: ID, size: 10, updatedAt: 'x', meta }] }),
		});
		expect(out[0].meta.name).toBe('Work');
		expect(out[0].broken).toBe(false);
	});

	// One damaged blob must not hide the other states - that would turn a single
	// corrupted upload into "all your states are gone".
	it('marks a meta blob it cannot read and keeps the rest', async () => {
		const key = await X.deriveKey(await secretBytes());
		const good = await X.encryptBlob(key, ID, 'meta', { name: 'Work' });
		const other = 'ffffffffffffffffffffffffffffffff';
		const out = await S.listStates({
			secret: await secretBytes(), origin: 'https://gestura.eu',
			fetchImpl: fetchOk({ states: [{ stateId: other, size: 1, updatedAt: 'x', meta: 'bm90aGluZw==' }, { stateId: ID, size: 10, updatedAt: 'x', meta: good }] }),
		});
		expect(out).toHaveLength(2);
		expect(out[0].broken).toBe(true);
		expect(out[0].meta).toBe(null);
		expect(out[1].meta.name).toBe('Work');
	});

	it.each([
		['a non-object answer', '[]'],
		['a missing states array', '{"ok":true}'],
		['a state with a bad id', '{"states":[{"stateId":"nope","size":1,"updatedAt":"x","meta":"AA=="}]}'],
	])('rejects %s', async (_label, text) => {
		const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => text });
		await expect(S.listStates({ secret: await secretBytes(), origin: 'https://gestura.eu', fetchImpl }))
			.rejects.toMatchObject({ code: 'malformed' });
	});
});

describe('downloading', () => {
	it('returns the decrypted export', async () => {
		const key = await X.deriveKey(await secretBytes());
		const payload = await X.encryptBlob(key, ID, 'payload', { gesturaSettings: 1, theme: 'dark' });
		const out = await S.downloadState({
			secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
			expectPayloadHash: await X.blobHash(payload),
			fetchImpl: fetchOk({ stateId: ID, updatedAt: 'x', payload }),
		});
		expect(out).toEqual({ gesturaSettings: 1, theme: 'dark' });
	});

	// The AAD already stops a blob from moving between states and roles. This
	// stops the server from pairing an OLD payload with a NEW meta.
	it('refuses a payload the meta did not describe', async () => {
		const key = await X.deriveKey(await secretBytes());
		const payload = await X.encryptBlob(key, ID, 'payload', { gesturaSettings: 1 });
		await expect(S.downloadState({
			secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
			expectPayloadHash: 'a-hash-of-something-else',
			fetchImpl: fetchOk({ stateId: ID, updatedAt: 'x', payload }),
		})).rejects.toMatchObject({ code: 'decrypt' });
	});
});

describe('errors', () => {
	it.each([
		[400, 'bad-request'],
		[404, 'not-found'],
		[409, 'quota-states'],
		[413, 'too-large'],
		[429, 'rate-limited'],
		[500, 'server'],
	])('maps HTTP %i', async (status, code) => {
		await expect(S.listStates({ secret: await secretBytes(), origin: 'https://gestura.eu', fetchImpl: fetchStatus(status) }))
			.rejects.toMatchObject({ code });
	});

	it('maps a throwing fetch to network', async () => {
		const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
		await expect(S.listStates({ secret: await secretBytes(), origin: 'https://gestura.eu', fetchImpl }))
			.rejects.toMatchObject({ code: 'network' });
	});

	// Checked before the request, so the user is told the limit instead of
	// watching half a megabyte go out and come back as a 413.
	it('refuses an oversized payload without asking the server', async () => {
		const big = { gesturaSettings: 1, customCss: 'x'.repeat(S.LIMITS.payloadMaxBytes) };
		await expect(S.uploadState({
			secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
			name: 'Work', createdAt: 'x', exportObj: big, extVersion: '2.8.0',
			fetchImpl: fetchOk({}),
		})).rejects.toMatchObject({ code: 'too-large' });
		expect(calls).toHaveLength(0);
	});
});

describe('the gate', () => {
	it('refuses to act while tier 2 is off', async () => {
		await L.write({ enabled: false });
		await expect(S.list()).rejects.toMatchObject({ code: 'disabled' });
	});

	it('refuses to act while tier 1 is off', async () => {
		tier1 = integration({ enabled: false });
		await expect(S.list()).rejects.toMatchObject({ code: 'disabled' });
	});

	it('refuses to act without a usable secret', async () => {
		await L.write({ secret: 'GS1-nonsense' });
		await expect(S.list()).rejects.toMatchObject({ code: 'no-secret' });
	});

	// The request has already gone out and come back. Its answer must still not
	// be used - the same rule R2's persist() follows for the update cache.
	it('discards an answer that arrived after the switch went off', async () => {
		const original = globalThis.fetch;
		globalThis.fetch = async (url, init) => {
			await L.write({ enabled: false });
			return fetchOk({ states: [] })(url, init);
		};
		await expect(S.list()).rejects.toMatchObject({ code: 'disabled' });
		globalThis.fetch = original;
	});
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/eu-sync.test.mjs`
Expected: FAIL — `Cannot find module '../js/eu-sync.js'`.

- [ ] **Step 3: Write the implementation**

Create `js/eu-sync.js`:

```js
// The four sync endpoints, and the gate around them.
//
// The gate is why this is a file rather than four fetch calls in the panel:
// every operation re-reads the live state immediately before it acts and again
// after the answer arrives. A request can be in flight for fifteen seconds -
// long enough for the user to hit "Withdraw" in the panel right beside it, or
// for a second options tab to do it. R2's persist() is where this shape comes
// from, and tests/eu-updates-persist.test.mjs is why it exists at all.
//
// Everything below the gate takes its fetch as an argument, so the whole
// protocol is testable without a network.
(function (root) {
	'use strict';

	const EU = root.FlowMouseEuIntegration;
	const BASE = '/api/v1/sync';
	const PATHS = { list: BASE + '/list', state: BASE + '/state', get: BASE + '/get', del: BASE + '/delete' };

	// Mirrors docs/gestura-eu-api.md. Checked client-side too, so an oversized
	// state is refused with the number rather than with a 413.
	const LIMITS = {
		metaMaxBytes: 8 * 1024,
		payloadMaxBytes: 512 * 1024,
		statesMax: 10,
		responseMaxBytes: 1024 * 1024,
		timeoutMs: 15000,
	};

	const STATUS = {
		400: 'bad-request', 404: 'not-found', 409: 'quota-states',
		413: 'too-large', 429: 'rate-limited',
	};

	function syncError(code) {
		const e = new Error(code);
		e.code = code;
		return e;
	}

	async function request(opts) {
		const { origin, path, method, body, fetchImpl } = opts;
		const ctl = new AbortController();
		const timer = setTimeout(() => ctl.abort(), LIMITS.timeoutMs);
		let res;
		try {
			res = await fetchImpl(origin + path, {
				method,
				credentials: 'omit',
				cache: 'no-store',
				// A JSON API has no business redirecting, and a redirect is how a
				// same-origin promise quietly stops being one. Same rule as the update
				// check.
				redirect: 'error',
				signal: ctl.signal,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
		} catch {
			clearTimeout(timer);
			throw syncError('network');
		}
		try {
			if (!res.ok) throw syncError(STATUS[res.status] || 'server');
			const declared = Number(res.headers?.get?.('content-length'));
			if (Number.isFinite(declared) && declared > LIMITS.responseMaxBytes) throw syncError('too-large');
			const text = await res.text();
			if (new TextEncoder().encode(text).length > LIMITS.responseMaxBytes) throw syncError('too-large');
			let parsed;
			try { parsed = JSON.parse(text); } catch { throw syncError('malformed'); }
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw syncError('malformed');
			return parsed;
		} finally {
			// Cleared here, not around the fetch: fetch() resolves on the response
			// HEADERS, so a body that keeps arriving slowly would otherwise be
			// unbounded.
			clearTimeout(timer);
		}
	}

	const isEnvelope = (v) => typeof v === 'string' && v.length > 0;

	async function listStates(opts) {
		const { secret, origin, fetchImpl } = opts;
		const X = root.GesturaSyncCrypto;
		const answer = await request({
			origin, path: PATHS.list, method: 'POST', fetchImpl,
			body: { apiLevel: EU.API_LEVEL, locator: await X.deriveLocator(secret) },
		});
		if (!Array.isArray(answer.states)) throw syncError('malformed');
		const key = await X.deriveKey(secret);
		const out = [];
		for (const s of answer.states) {
			if (!s || typeof s !== 'object') throw syncError('malformed');
			if (!X.STATE_ID_RE.test(s.stateId) || !isEnvelope(s.meta)) throw syncError('malformed');
			let meta = null;
			// A blob that will not decrypt is reported, not thrown: one damaged
			// upload must not read as "all your states are gone".
			try { meta = await X.decryptBlob(key, s.stateId, 'meta', s.meta); } catch { /* broken below */ }
			out.push({
				stateId: s.stateId,
				size: Number(s.size) || 0,
				updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : '',
				meta,
				broken: meta === null,
			});
		}
		return out;
	}

	async function uploadState(opts) {
		const { secret, origin, stateId, name, createdAt, exportObj, extVersion, fetchImpl } = opts;
		const X = root.GesturaSyncCrypto;
		const key = await X.deriveKey(secret);
		const payload = await X.encryptBlob(key, stateId, 'payload', exportObj);
		if (payload.length > LIMITS.payloadMaxBytes) throw syncError('too-large');
		const meta = await X.encryptBlob(key, stateId, 'meta', {
			name,
			createdAt: createdAt || new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			extVersion,
			// Binds the two blobs of this state to each other, so the server cannot
			// pair this meta with an older payload.
			payloadHash: await X.blobHash(payload),
		});
		if (meta.length > LIMITS.metaMaxBytes) throw syncError('too-large');
		return request({
			origin, path: PATHS.state, method: 'PUT', fetchImpl,
			body: { apiLevel: EU.API_LEVEL, locator: await X.deriveLocator(secret), stateId, meta, payload },
		});
	}

	async function downloadState(opts) {
		const { secret, origin, stateId, expectPayloadHash, fetchImpl } = opts;
		const X = root.GesturaSyncCrypto;
		const answer = await request({
			origin, path: PATHS.get, method: 'POST', fetchImpl,
			body: { apiLevel: EU.API_LEVEL, locator: await X.deriveLocator(secret), stateId },
		});
		if (!isEnvelope(answer.payload)) throw syncError('malformed');
		if (expectPayloadHash && await X.blobHash(answer.payload) !== expectPayloadHash) throw syncError('decrypt');
		const key = await X.deriveKey(secret);
		try {
			return await X.decryptBlob(key, stateId, 'payload', answer.payload);
		} catch {
			throw syncError('decrypt');
		}
	}

	async function deleteStates(opts) {
		const { secret, origin, stateId, fetchImpl } = opts;
		const X = root.GesturaSyncCrypto;
		const body = { apiLevel: EU.API_LEVEL, locator: await X.deriveLocator(secret) };
		if (stateId) body.stateId = stateId;
		return request({ origin, path: PATHS.del, method: 'POST', fetchImpl, body });
	}

	// The gate. Read the live state, act, read it again - and throw 'disabled'
	// rather than return, so no caller can mistake a discarded answer for an
	// empty one.
	async function gated(fn) {
		const L = root.GesturaSyncLocal;
		const local = await root.GesturaEuLocal.read();
		const sync = await L.read();
		if (!L.syncEnabled(local, sync)) throw syncError('disabled');
		const parsed = await root.GesturaSyncCode.parse(sync.euSync.secret);
		if (!parsed.secret) throw syncError('no-secret');

		const result = await fn({
			secret: parsed.secret,
			origin: L.syncOrigin(local),
			fetchImpl: (url, init) => fetch(url, init),
		});

		if (!L.syncEnabled(await root.GesturaEuLocal.read(), await L.read())) throw syncError('disabled');
		return result;
	}

	const list = () => gated(ctx => listStates(ctx));
	const upload = (opts) => gated(ctx => uploadState({ ...opts, ...ctx }));
	const download = (opts) => gated(ctx => downloadState({ ...opts, ...ctx }));
	const remove = (stateId) => gated(ctx => deleteStates({ ...ctx, stateId }));

	const api = {
		PATHS, LIMITS, syncError, request,
		listStates, uploadState, downloadState, deleteStates,
		list, upload, download, remove,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSync = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/eu-sync.test.mjs`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/eu-sync.js tests/eu-sync.test.mjs
git commit -m "feat(sync): four endpoints, and the gate that outlives the request"
```

---

## Task 7: The preview — `js/components/settings-preview-dialog.js`

Issue #1's promise in one component: *the user must always be able to see the complete export/import.* It has three callers and one shape — export (before the file is written), file import (before the settings are replaced) and sync upload (before anything leaves the browser). Building it once means the file export/import gets the transparency for free, which is the reason it is a separate task from the sync panel that needs it.

**Files:**
- Create: `js/components/settings-preview-dialog.js`
- Modify: `css/common.css`
- Modify: `pages/options.html`
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json`
- Modify: `tests/site-menu-locales.test.mjs`

**Interfaces:**
- Consumes: `GesturaSettingsSchema` result fields (`json`, `dropped`, `retyped`, `legacy`, `error`), `window.i18n`.
- Produces: the element `<settings-preview-dialog>` with the properties
  `open`, `mode` (`'export' | 'import' | 'upload'`), `json`, `dropped`, `retyped`, `legacy`, `note`,
  the events `preview-confirm` and `preview-cancel`,
  and the named export `settingsErrorMessage(i18n, code) -> string` that turns a
  validator error code into a sentence.

- [ ] **Step 1: Add the messages**

Into `_locales/en/messages.json`:

```json
	"settingsPreviewExportTitle": { "message": "This is what will be saved" },
	"settingsPreviewImportTitle": { "message": "This is what will be written" },
	"settingsPreviewUploadTitle": { "message": "This is what will be transferred" },
	"settingsPreviewSize": { "message": "{bytes} bytes" },
	"settingsPreviewReplaces": { "message": "Your current settings will be replaced by this." },
	"settingsPreviewDropped": { "message": "Not written — Gestura does not know these entries: {keys}" },
	"settingsPreviewRetyped": { "message": "Reset to the default — the value had the wrong form: {keys}" },
	"settingsPreviewLegacy": { "message": "An export from an older version. It is converted as it is written." },
	"settingsPreviewConfirmExport": { "message": "Save file" },
	"settingsPreviewConfirmImport": { "message": "Write settings" },
	"settingsPreviewConfirmUpload": { "message": "Upload" },
	"settingsPreviewCancel": { "message": "Cancel" },
	"settingsPreviewErrorTooLarge": { "message": "This file is too large for a settings file." },
	"settingsPreviewErrorNotJson": { "message": "This file is not readable JSON." },
	"settingsPreviewErrorNotObject": { "message": "This file does not contain a settings object." },
	"settingsPreviewErrorNotSettings": { "message": "This file contains no Gestura settings." },
	"settingsPreviewErrorUnknownFormat": { "message": "This file was written by a newer version of Gestura." },
	"settingsPreviewErrorForbiddenKey": { "message": "This file contains entries Gestura refuses to read." },
```

Into `_locales/de/messages.json`:

```json
	"settingsPreviewExportTitle": { "message": "Das wird gespeichert" },
	"settingsPreviewImportTitle": { "message": "Das wird geschrieben" },
	"settingsPreviewUploadTitle": { "message": "Das wird übertragen" },
	"settingsPreviewSize": { "message": "{bytes} Bytes" },
	"settingsPreviewReplaces": { "message": "Deine jetzigen Einstellungen werden dadurch ersetzt." },
	"settingsPreviewDropped": { "message": "Wird nicht geschrieben — Gestura kennt diese Einträge nicht: {keys}" },
	"settingsPreviewRetyped": { "message": "Auf die Vorgabe zurückgesetzt — der Wert hatte die falsche Form: {keys}" },
	"settingsPreviewLegacy": { "message": "Ein Export einer älteren Version. Er wird beim Schreiben umgewandelt." },
	"settingsPreviewConfirmExport": { "message": "Datei speichern" },
	"settingsPreviewConfirmImport": { "message": "Einstellungen schreiben" },
	"settingsPreviewConfirmUpload": { "message": "Hochladen" },
	"settingsPreviewCancel": { "message": "Abbrechen" },
	"settingsPreviewErrorTooLarge": { "message": "Diese Datei ist zu groß für eine Einstellungsdatei." },
	"settingsPreviewErrorNotJson": { "message": "Diese Datei ist kein lesbares JSON." },
	"settingsPreviewErrorNotObject": { "message": "Diese Datei enthält kein Einstellungsobjekt." },
	"settingsPreviewErrorNotSettings": { "message": "Diese Datei enthält keine Gestura-Einstellungen." },
	"settingsPreviewErrorUnknownFormat": { "message": "Diese Datei stammt aus einer neueren Version von Gestura." },
	"settingsPreviewErrorForbiddenKey": { "message": "Diese Datei enthält Einträge, die Gestura nicht liest." },
```

Note the `{bytes}` and `{keys}` tokens: braces, never `$WORD$` —
`tests/locale-placeholders.test.mjs` fails on the latter and the extension does
not load at all with an undeclared one.

- [ ] **Step 2: Register the prefix and the pending keys**

In `tests/site-menu-locales.test.mjs`, extend the prefix list:

```js
const NEW_KEY_PREFIXES = ['siteMenuItem', 'siteMenu', 'iconPicker', 'menuMode', 'fork', 'storage', 'euIntegration', 'euSync', 'settingsPreview'];
```

and append all eighteen `settingsPreview*` keys above to `PENDING_TRANSLATION`.

Run: `npx vitest run tests/site-menu-locales.test.mjs tests/locale-placeholders.test.mjs`
Expected: PASS. Both are guards; if the completeness test fails now, a key was
added to `en` without being listed as pending.

- [ ] **Step 3: Write the component**

Create `js/components/settings-preview-dialog.js`:

```js
import { LitElement, html, css, unsafeHTML } from '../../js/lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { icons } from '../icons.js';

// "Du siehst vorher vollständig, was übertragen wird" - Issue #1, als Bauteil.
// Drei Aufrufer, eine Form: Export (bevor die Datei geschrieben wird), Datei-
// Import (bevor die Einstellungen ersetzt werden) und Sync-Upload (bevor etwas
// den Browser verlässt). Genau ein Bauteil, weil drei Fassungen desselben
// Versprechens früher oder später drei verschiedene Sachen zeigen würden.
//
// Der Dialog entscheidet nichts. Er zeigt, was der Validator ausgerechnet hat,
// und meldet Zustimmung oder Abbruch - das Schreiben macht der Aufrufer.

const TITLES = { export: 'settingsPreviewExportTitle', import: 'settingsPreviewImportTitle', upload: 'settingsPreviewUploadTitle' };
const CONFIRMS = { export: 'settingsPreviewConfirmExport', import: 'settingsPreviewConfirmImport', upload: 'settingsPreviewConfirmUpload' };

// Fehlercode -> Satz. Exportiert, weil auch das Sync-Panel Validierungsfehler
// meldet und beide dieselbe Sprache sprechen sollen.
//
// Eine Tabelle und keine Namensrechnung aus dem Code: ein zusammengesetzter
// Schlüssel ist nicht auffindbar. Wer "settingsPreviewErrorNotJson" sucht, soll
// ihn hier stehen sehen - und ein Tippfehler soll auffallen, statt still auf die
// allgemeine Meldung zurückzufallen.
const ERROR_KEYS = {
	'too-large': 'settingsPreviewErrorTooLarge',
	'not-json': 'settingsPreviewErrorNotJson',
	'not-object': 'settingsPreviewErrorNotObject',
	'not-settings': 'settingsPreviewErrorNotSettings',
	'unknown-format': 'settingsPreviewErrorUnknownFormat',
	'forbidden-key': 'settingsPreviewErrorForbiddenKey',
};

export function settingsErrorMessage(i18n, code) {
	return i18n.getMessage(ERROR_KEYS[code] || 'importFailed');
}

class SettingsPreviewDialog extends LitElement {
	static properties = {
		open: { type: Boolean },
		mode: { type: String },
		json: { type: String },
		dropped: { type: Array },
		retyped: { type: Array },
		legacy: { type: Boolean },
		note: { type: String },
	};

	static styles = [commonStyles, optionStyles, css`
		:host { display: contents; }
		.modal-overlay {
			position: fixed; inset: 0; z-index: 10000;
			background: rgba(0, 0, 0, 0.35);
			display: flex; align-items: center; justify-content: center;
			animation: sp-fadeIn 0.12s ease;
		}
		@keyframes sp-fadeIn { from { opacity: 0; } to { opacity: 1; } }
		.modal-panel {
			width: min(760px, 94vw); max-height: 88vh;
			display: flex; flex-direction: column;
			background: var(--card-bg); border-radius: 14px;
			box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--border-color);
		}
		.modal-panel:focus { outline: none; }
		.modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border-color); }
		.modal-header h3 { margin: 0; font-size: 17px; font-weight: 600; }
		.modal-body { padding: 16px 20px; overflow-y: auto; }
		.modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--border-color); }
		.notes { margin: 0 0 12px; display: flex; flex-direction: column; gap: 6px; }
		.notes p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
		.notes p.warn { color: var(--warning-color); }
		.size { font-size: 12px; color: var(--text-secondary); margin: 0 0 8px; }
		/* Vollständig heißt vollständig: kein Ausschnitt, keine Zusammenfassung.
		   Nur die Höhe ist begrenzt, und was nicht hineinpasst, wird gescrollt. */
		pre.preview-json {
			margin: 0; padding: 12px; max-height: 46vh; overflow: auto;
			background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 8px;
			font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
			font-size: 12px; line-height: 1.5; white-space: pre; tab-size: 2;
		}
	`];

	constructor() {
		super();
		this.open = false;
		this.mode = 'export';
		this.json = '';
		this.dropped = [];
		this.retyped = [];
		this.legacy = false;
		this.note = '';
		this._onKeydown = (e) => {
			if (e.key === 'Escape' && this.open) { e.stopPropagation(); this.#cancel(); }
		};
	}

	connectedCallback() {
		super.connectedCallback();
		document.addEventListener('keydown', this._onKeydown, true);
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		document.removeEventListener('keydown', this._onKeydown, true);
		this.#lockScroll(false);
	}

	#lockScroll(on) {
		document.documentElement.style.overflow = on ? 'hidden' : '';
	}

	#cancel() {
		this.open = false;
		this.#lockScroll(false);
		this.dispatchEvent(new CustomEvent('preview-cancel'));
	}

	#confirm() {
		this.open = false;
		this.#lockScroll(false);
		this.dispatchEvent(new CustomEvent('preview-confirm'));
	}

	updated(changed) {
		if (changed.has('open')) {
			this.#lockScroll(this.open);
			// Auf die Fläche, nicht auf einen Knopf: Escape wirkt, und Enter kann
			// nicht versehentlich schreiben.
			if (this.open) this.renderRoot.querySelector('.modal-panel')?.focus();
		}
	}

	render() {
		if (!this.open) return html``;
		const i18n = window.i18n;
		const bytes = new TextEncoder().encode(this.json || '').length;
		return html`
			<div class="modal-overlay" @mousedown=${this.#cancel}>
				<div class="modal-panel" tabindex="-1" @mousedown=${e => e.stopPropagation()}>
					<div class="modal-header">
						<h3>${i18n.getMessage(TITLES[this.mode] || TITLES.export)}</h3>
						<button type="button" class="modal-close" @click=${this.#cancel}
							aria-label=${i18n.getMessage('settingsPreviewCancel')}>${unsafeHTML(icons.x)}</button>
					</div>
					<div class="modal-body">
						<div class="notes">
							${this.note ? html`<p>${this.note}</p>` : ''}
							${this.mode === 'import' ? html`<p class="warn">${i18n.getMessage('settingsPreviewReplaces')}</p>` : ''}
							${this.legacy ? html`<p>${i18n.getMessage('settingsPreviewLegacy')}</p>` : ''}
							${this.dropped && this.dropped.length ? html`
								<p class="warn">${i18n.getMessage('settingsPreviewDropped').replace('{keys}', this.dropped.join(', '))}</p>` : ''}
							${this.retyped && this.retyped.length ? html`
								<p class="warn">${i18n.getMessage('settingsPreviewRetyped').replace('{keys}', this.retyped.join(', '))}</p>` : ''}
						</div>
						<p class="size">${i18n.getMessage('settingsPreviewSize').replace('{bytes}', String(bytes))}</p>
						<pre class="preview-json">${this.json}</pre>
					</div>
					<div class="modal-footer">
						<button class="btn btn-secondary" @click=${this.#cancel}>${i18n.getMessage('settingsPreviewCancel')}</button>
						<button class="btn btn-primary" @click=${this.#confirm}>${i18n.getMessage(CONFIRMS[this.mode] || CONFIRMS.export)}</button>
					</div>
				</div>
			</div>`;
	}
}

customElements.define('settings-preview-dialog', SettingsPreviewDialog);
```

- [ ] **Step 4: Load it**

In `pages/options.html`, after the five classic scripts (which Task 8 adds) and
among the module scripts, before `options-page.js`:

```html
	<script type="module" src="../js/components/settings-preview-dialog.js"></script>
```

- [ ] **Step 5: Check it renders**

Load the unpacked extension, open the options page, and in the page console:

```js
const d = document.createElement('settings-preview-dialog');
document.querySelector('options-page').shadowRoot.append(d);
Object.assign(d, { mode: 'import', json: '{\n\t"a": 1\n}', dropped: ['evil'], legacy: true, open: true });
```

Expected: the overlay appears, shows both notes and the JSON, Escape closes it.
Remove the element afterwards.

- [ ] **Step 6: Commit**

```bash
git add js/components/settings-preview-dialog.js pages/options.html css/common.css \
	_locales/en/messages.json _locales/de/messages.json tests/site-menu-locales.test.mjs
git commit -m "feat(settings): show the whole thing before writing any of it"
```

---

## Task 8: Export and file import go through the schema

The two paths that exist today get the validator and the preview. This is worth doing before the sync panel: it is the smaller of the two consumers, it is testable by hand in a minute, and it means the sync panel arrives at an options page that already knows how to preview and how to write.

**Files:**
- Modify: `js/components/options-page.js` (`#exportSettings`, `#importSettings`, the render, one new state field)
- Modify: `js/settings-store.js` (one dispatch)
- Modify: `pages/options.html` (the five classic scripts)

**Interfaces:**
- Consumes: `GesturaSettingsSchema.exportText` / `validate`, `settingsErrorMessage`, `<settings-preview-dialog>`.
- Produces: the window event `gestura:settings-saved`, which Task 10's reminder listens for.

- [ ] **Step 1: Load the classic scripts**

In `pages/options.html`, after the existing `js/eu-updates.js` line:

```html
	<script src="../js/eu-sync-code.js"></script>
	<script src="../js/eu-sync-crypto.js"></script>
	<script src="../js/eu-settings-schema.js"></script>
	<script src="../js/eu-sync-local.js"></script>
	<script src="../js/eu-sync.js"></script>
```

The order is the dependency order: `eu-sync-local.js` reads
`GesturaSyncCrypto.STATE_ID_RE` at normalize time and `eu-sync.js` uses all of
them. `eu-settings-schema.js` needs `constants.js` and `eu-integration.js`,
which are already above.

- [ ] **Step 2: Announce a local save**

In `js/settings-store.js`, at the end of the successful branch of `save()`:

```js
		try {
			await chrome.storage.sync.set(this.#current);
			// onChange() fires for EXTERNAL changes only - by design, so a component
			// does not react to its own write. The sync panel needs the other half:
			// its "changed since last upload" hint has to notice a save made on this
			// very page. A window event carries that without changing what onChange
			// means to its existing listeners.
			if (typeof window !== 'undefined') window.dispatchEvent(new Event('gestura:settings-saved'));
			return true;
		} catch (e) {
```

- [ ] **Step 3: Rewrite the two handlers**

In `js/components/options-page.js`, add the import at the top:

```js
import { settingsErrorMessage } from './settings-preview-dialog.js';
```

Add `_preview: { state: true }` to `static properties`, and `this._preview = null;`
to the constructor. Then replace `#exportSettings` and `#importSettings`:

```js
	// Beide Wege - Datei schreiben und Datei lesen - laufen jetzt über denselben
	// Validator und dieselbe Vorschau wie der Sync. Vorher prüfte der Import, ob
	// `enableGesture` existiert, und legte den Rest der Datei über die Vorgaben;
	// exportiert wurde ungefragt und ungesehen.
	#openPreview(preview) {
		this._preview = preview;
	}

	#onPreviewCancel() {
		this._preview = null;
	}

	async #onPreviewConfirm() {
		const preview = this._preview;
		this._preview = null;
		if (preview) await preview.commit();
	}

	#exportSettings() {
		const text = window.GesturaSettingsSchema.exportText(this._store.current, window.i18n.version);
		this.#openPreview({
			mode: 'export',
			json: text,
			dropped: [],
			retyped: [],
			legacy: false,
			commit: () => {
				const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
				const a = document.createElement('a');
				a.href = url;
				a.download = 'Gestura-settings.json';
				a.click();
				setTimeout(() => URL.revokeObjectURL(url), 10000);
				this.#showStatus(window.i18n.getMessage('exportDone'));
			},
		});
	}

	#triggerImport() {
		this.shadowRoot.getElementById('importFile').click();
	}

	async #importSettings(e) {
		const file = e.target.files[0];
		e.target.value = '';
		if (!file) return;
		let text;
		try {
			text = await file.text();
		} catch {
			this.#showStatus(window.i18n.getMessage('importFailed'), 'error');
			return;
		}
		const result = window.GesturaSettingsSchema.validate(text);
		if (!result.ok) {
			// Kein confirm() mehr: die Frage "wirklich?" stand vor der Prüfung und
			// beantwortete sich aus dem Dateinamen. Jetzt steht der Grund da.
			this.#showStatus(settingsErrorMessage(window.i18n, result.error), 'error');
			return;
		}
		this.#openPreview({
			mode: 'import',
			json: result.json,
			dropped: result.dropped,
			retyped: result.retyped,
			legacy: result.legacy,
			commit: () => this.#applySettings(result.settings),
		});
	}

	// Der eine Schreibvorgang, den Datei-Import und Sync-Download teilen: ein
	// validiertes Objekt, vollständig, atomar - und danach ein Reload, weil
	// settingsStore.save() #current vor dem Schreiben aktualisiert und
	// handleExternalChange deshalb keine Änderung meldet. Die Unterkomponenten
	// behielten sonst ihren alten Stand.
	async #applySettings(settings) {
		if (this._debounceTimer) clearTimeout(this._debounceTimer);
		this._debounceTimer = null;
		this._pendingPatch = null;
		const ok = await this._store.save(settings);
		if (!ok) {
			this.#showStatus(window.i18n.getMessage('importFailedSyncError'), 'error');
			return false;
		}
		sessionStorage.setItem(IMPORT_RELOAD_KEY, '1');
		window.location.reload();
		return true;
	}
```

In `render()`, beside the existing `<input type="file" …>`:

```js
			<settings-preview-dialog
				?open=${!!this._preview}
				mode=${this._preview ? this._preview.mode : 'export'}
				.json=${this._preview ? this._preview.json : ''}
				.dropped=${this._preview ? this._preview.dropped : []}
				.retyped=${this._preview ? this._preview.retyped : []}
				?legacy=${!!(this._preview && this._preview.legacy)}
				@preview-confirm=${this.#onPreviewConfirm}
				@preview-cancel=${this.#onPreviewCancel}></settings-preview-dialog>
```

- [ ] **Step 4: Verify the old code is gone**

Run:

```bash
grep -n "importConfirm\|customGestureUrls\|FileReader" js/components/options-page.js
```

Expected: no matches. The `confirm()` before the import, the inline migration and
the `FileReader` are all replaced. `importConfirm` stays in the locale files —
deleting one key out of 39 catalogues buys nothing and risks a typo in each.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Verify by hand**

Load the unpacked extension and open the settings:

1. **Export** → the dialog shows the complete JSON with `"gesturaSettings": 1`
   at the top and no `lastSyncTime`. Confirm → the file is written.
2. **Import that file** → the dialog shows it again, with no dropped keys.
   Confirm → the page reloads and the settings are unchanged.
3. Add `"evil": 1` to the file by hand and import → `evil` is listed as not
   written, and after the reload it is nowhere in `chrome.storage.sync`.
4. Import a file containing `{"__proto__": {"x": 1}, "theme": "dark"}` → the
   error line appears and nothing is written.
5. Import an export from 2.3.x if one is at hand → the "older version" note
   appears and the gestures arrive under `mouseGestures`.

- [ ] **Step 6: Commit**

```bash
git add js/components/options-page.js js/settings-store.js pages/options.html
git commit -m "feat(settings): the file paths go through the validator and the preview"
```

---

## Task 9: The sync panel — switch, consent, secret

The tier-2 switch and everything that belongs to the secret. It lives inside the website-integration section, below the tier-1 panel, and renders **nothing at all** while tier 1 is not effectively enabled — the spec's "only visible while tier 1 is on", implemented as absence rather than as a disabled control.

The states come in Task 10. This task ends with a panel that can be switched on, that generates and shows a secret, and that can adopt one from another browser — which is exactly the half worth reviewing on its own.

**Files:**
- Create: `js/components/eu-sync-panel.js`
- Modify: `js/components/options-page.js` (one element in the section)
- Modify: `pages/options.html`
- Modify: `css/common.css`
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json`
- Modify: `tests/site-menu-locales.test.mjs`

**Interfaces:**
- Consumes: `GesturaEuLocal`, `GesturaSyncLocal`, `GesturaSyncCode`, `FlowMouseEuIntegration`, `window.i18n`.
- Produces: the element `<eu-sync-panel>`, and the private methods Task 10 extends (`#refreshStates`, `#renderStates`).

- [ ] **Step 1: Add the messages**

Into `_locales/en/messages.json`:

```json
	"euSyncHeading": { "message": "Sync between browsers" },
	"euSyncToggle": { "message": "Sync settings" },
	"euSyncToggleDesc": { "message": "Encrypted, without an account. Off until you turn it on." },
	"euSyncConsentTitle": { "message": "Turn on sync" },
	"euSyncConsentLead": { "message": "Sync carries your Gestura settings to your other browsers — encrypted, without an account and without a password." },
	"euSyncConsentPoint1Label": { "message": "What it does." },
	"euSyncConsentPoint1": { "message": "You save your settings as a named state and open it in another browser. Upload and download are always your own click; nothing happens by itself." },
	"euSyncConsentPoint2Label": { "message": "Encrypted before it leaves." },
	"euSyncConsentPoint2": { "message": "gestura.eu stores nothing but ciphertext, its size and its date. The key is derived in this browser and never sent — the name you give a state is encrypted too." },
	"euSyncConsentPoint3Label": { "message": "You see it in full beforehand." },
	"euSyncConsentPoint3": { "message": "Before every upload the complete content is shown, exactly as it will be transferred." },
	"euSyncConsentPoint4Label": { "message": "The code is the key." },
	"euSyncConsentPoint4": { "message": "Gestura generates a code for this browser. Whoever has it can read, replace and delete your states — keep it somewhere safe. Without it the old states can no longer be reached, not even to delete them; gestura.eu removes states untouched for 12 months." },
	"euSyncConsentAccept": { "message": "Turn on sync" },
	"euSyncConsentCancel": { "message": "Cancel" },
	"euSyncConsentGranted": { "message": "Sync is on" },
	"euSyncConsentDate": { "message": "Agreed on {date}" },
	"euSyncConsentRevoke": { "message": "Turn off" },
	"euSyncReconfirmTitle": { "message": "Sync needs your confirmation again" },
	"euSyncReconfirmDesc": { "message": "The text you agreed to has changed. Sync stays off until you read it." },
	"euSyncSecretTitle": { "message": "Your sync code" },
	"euSyncSecretDesc": { "message": "This code is the key to your states. Put it in your password manager — and into the second browser to pair it." },
	"euSyncSecretCopy": { "message": "Copy" },
	"euSyncSecretCopied": { "message": "Copied" },
	"euSyncSecretSave": { "message": "Save as file" },
	"euSyncSecretNew": { "message": "New code" },
	"euSyncSecretNewConfirm": { "message": "Generate a new code? The states saved under the old one can no longer be opened or deleted — gestura.eu removes them after 12 months." },
	"euSyncSecretPair": { "message": "Use an existing code" },
	"euSyncSecretPairDesc": { "message": "Paste the code from your other browser here to see its states." },
	"euSyncSecretPairApply": { "message": "Use this code" },
	"euSyncSecretFileHeader": { "message": "Gestura sync code. Whoever has this code can read, replace and delete your synced settings. Move it into your password manager and delete this file. Created: {date}" },
	"euSyncDevOriginNotice": { "message": "Sync is using your developer index at {origin} — not gestura.eu." },
	"euSyncCodeErrorPrefix": { "message": "This does not look like a Gestura code." },
	"euSyncCodeErrorCharset": { "message": "This code contains characters a Gestura code never has." },
	"euSyncCodeErrorLength": { "message": "This code is incomplete." },
	"euSyncCodeErrorPadding": { "message": "This code is damaged." },
	"euSyncCodeErrorChecksum": { "message": "This code has a typo in it." },
```

Into `_locales/de/messages.json`:

```json
	"euSyncHeading": { "message": "Abgleich zwischen Browsern" },
	"euSyncToggle": { "message": "Einstellungen abgleichen" },
	"euSyncToggleDesc": { "message": "Verschlüsselt, ohne Konto. Aus, bis du es einschaltest." },
	"euSyncConsentTitle": { "message": "Abgleich einschalten" },
	"euSyncConsentLead": { "message": "Der Abgleich bringt deine Gestura-Einstellungen in deine anderen Browser — verschlüsselt, ohne Konto und ohne Passwort." },
	"euSyncConsentPoint1Label": { "message": "Was er tut." },
	"euSyncConsentPoint1": { "message": "Du sicherst deine Einstellungen als benannten Stand und öffnest ihn in einem anderen Browser. Hochladen und Herunterladen ist immer dein eigener Klick; von allein passiert nichts." },
	"euSyncConsentPoint2Label": { "message": "Verschlüsselt, bevor es den Browser verlässt." },
	"euSyncConsentPoint2": { "message": "gestura.eu speichert nichts als Geheimtext, seine Größe und sein Datum. Der Schlüssel entsteht in diesem Browser und wird nie gesendet — auch der Name, den du einem Stand gibst, ist verschlüsselt." },
	"euSyncConsentPoint3Label": { "message": "Du siehst vorher alles." },
	"euSyncConsentPoint3": { "message": "Vor jedem Hochladen steht der vollständige Inhalt da, genau so, wie er übertragen wird." },
	"euSyncConsentPoint4Label": { "message": "Der Code ist der Schlüssel." },
	"euSyncConsentPoint4": { "message": "Gestura erzeugt einen Code für diesen Browser. Wer ihn hat, kann deine Stände lesen, ersetzen und löschen — bewahre ihn sicher auf. Ohne ihn sind die alten Stände nicht mehr erreichbar, auch nicht zum Löschen; gestura.eu entfernt Stände, die 12 Monate lang unberührt bleiben." },
	"euSyncConsentAccept": { "message": "Abgleich einschalten" },
	"euSyncConsentCancel": { "message": "Abbrechen" },
	"euSyncConsentGranted": { "message": "Der Abgleich ist an" },
	"euSyncConsentDate": { "message": "Zugestimmt am {date}" },
	"euSyncConsentRevoke": { "message": "Ausschalten" },
	"euSyncReconfirmTitle": { "message": "Der Abgleich braucht deine Zustimmung erneut" },
	"euSyncReconfirmDesc": { "message": "Der Text, dem du zugestimmt hast, hat sich geändert. Der Abgleich bleibt aus, bis du ihn gelesen hast." },
	"euSyncSecretTitle": { "message": "Dein Abgleich-Code" },
	"euSyncSecretDesc": { "message": "Dieser Code ist der Schlüssel zu deinen Ständen. Leg ihn in deinen Passwortspeicher — und in den zweiten Browser, um ihn zu verbinden." },
	"euSyncSecretCopy": { "message": "Kopieren" },
	"euSyncSecretCopied": { "message": "Kopiert" },
	"euSyncSecretSave": { "message": "Als Datei sichern" },
	"euSyncSecretNew": { "message": "Neuer Code" },
	"euSyncSecretNewConfirm": { "message": "Einen neuen Code erzeugen? Die Stände unter dem alten Code lassen sich dann weder öffnen noch löschen — gestura.eu entfernt sie nach 12 Monaten." },
	"euSyncSecretPair": { "message": "Vorhandenen Code verwenden" },
	"euSyncSecretPairDesc": { "message": "Füge hier den Code aus deinem anderen Browser ein, um dessen Stände zu sehen." },
	"euSyncSecretPairApply": { "message": "Diesen Code verwenden" },
	"euSyncSecretFileHeader": { "message": "Gestura-Abgleich-Code. Wer diesen Code hat, kann deine abgeglichenen Einstellungen lesen, ersetzen und löschen. Leg ihn in deinen Passwortspeicher und lösche diese Datei. Erstellt: {date}" },
	"euSyncDevOriginNotice": { "message": "Der Abgleich nutzt deinen Entwicklungs-Index unter {origin} — nicht gestura.eu." },
	"euSyncCodeErrorPrefix": { "message": "Das sieht nicht nach einem Gestura-Code aus." },
	"euSyncCodeErrorCharset": { "message": "Dieser Code enthält Zeichen, die ein Gestura-Code nie hat." },
	"euSyncCodeErrorLength": { "message": "Dieser Code ist unvollständig." },
	"euSyncCodeErrorPadding": { "message": "Dieser Code ist beschädigt." },
	"euSyncCodeErrorChecksum": { "message": "In diesem Code steckt ein Tippfehler." },
```

Add every one of these keys to `PENDING_TRANSLATION` in
`tests/site-menu-locales.test.mjs`.

Run: `npx vitest run tests/site-menu-locales.test.mjs tests/locale-placeholders.test.mjs`
Expected: PASS.

- [ ] **Step 2: Add the styles**

Into `css/common.css`, beside the existing badge rules:

```css
.secret-code {
	display: block;
	padding: 10px 12px;
	background: var(--input-bg);
	border: 1px solid var(--border-color);
	border-radius: 8px;
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	font-size: 13px;
	line-height: 1.7;
	word-break: break-all;
	user-select: all;
}
.sync-hint { font-size: 12px; color: var(--warning-color); }
```

- [ ] **Step 3: Write the panel**

Create `js/components/eu-sync-panel.js`:

```js
import { LitElement, html, css, unsafeHTML } from '../../js/lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';
import { icons } from '../icons.js';

// Der zweite Schalter. Er liegt unter dem ersten und ist nicht da, solange der
// erste nicht wirksam ist - nicht ausgegraut, nicht deaktiviert, sondern
// abwesend: ein sichtbarer, funktionsloser Schalter war genau das, was der
// Entwurf für R1 und R2 ausgeschlossen hat.
//
// Der Zustand liegt in chrome.storage.local (GesturaSyncLocal), nicht im
// SettingsStore: die Zustimmung gilt je Browser, und das Geheimnis darf den
// Browser-Sync unter keinen Umständen erreichen - dort läge der Schlüssel beim
// Hersteller des Browsers, und der ganze Entwurf wäre hinfällig.
class EuSyncPanel extends LitElement {
	// Ausgeschrieben und nicht aus dem Fehlercode zusammengesetzt: ein gerechneter
	// Schlüssel ist nicht auffindbar, und ein Tippfehler darin fiele erst dem
	// Nutzer auf - als leere Meldung neben einem Eingabefeld.
	static CODE_ERRORS = {
		prefix: 'euSyncCodeErrorPrefix',
		charset: 'euSyncCodeErrorCharset',
		length: 'euSyncCodeErrorLength',
		padding: 'euSyncCodeErrorPadding',
		checksum: 'euSyncCodeErrorChecksum',
	};

	static properties = {
		_local: { state: true },
		_sync: { state: true },
		_consentOpen: { state: true },
		_codeDraft: { state: true },
		_codeError: { state: true },
		_copied: { state: true },
		_busy: { state: true },
		_error: { state: true },
	};

	static styles = [commonStyles, optionStyles, css`
		:host { display: block; }
		h3 { margin: 22px 0 0; font-size: 15px; font-weight: 600; }
		.secret-row { display: block; padding: 12px 0; }
		.secret-row .actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
		.pair { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
		.pair input { flex: 1 1 320px; min-width: 0; }
		.pair input.invalid { box-shadow: 0 0 0 1.5px var(--danger-color); }
		.error { margin-top: 8px; color: var(--danger-color); font-size: 12px; }
		.notice { margin-top: 8px; color: var(--warning-color); font-size: 12px; }
		.granted .setting-label span:first-child { display: inline-flex; align-items: center; gap: 8px; }
		.granted .setting-label span.granted-icon { display: inline-flex; color: var(--success-color); }
		.granted-icon svg { width: 18px; height: 18px; }
		.reconfirm { color: var(--warning-color); }
		.row-actions { display: flex; gap: 8px; flex: none; }
		.modal-overlay { position: fixed; inset: 0; z-index: 10000; background: rgba(0, 0, 0, 0.35); display: flex; align-items: center; justify-content: center; }
		.modal-panel { width: min(620px, 92vw); max-height: 88vh; display: flex; flex-direction: column; background: var(--card-bg); border-radius: 14px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--border-color); }
		.modal-panel:focus { outline: none; }
		.modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border-color); }
		.modal-header h3 { margin: 0; font-size: 17px; font-weight: 600; }
		.modal-body { padding: 18px 20px; overflow-y: auto; }
		.modal-body .lead { margin: 0 0 14px; font-size: 14px; line-height: 1.6; }
		.modal-body ul { margin: 0; padding-inline-start: 20px; }
		.modal-body li { margin: 10px 0; font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
		.modal-body li strong { color: var(--text-primary); font-weight: 600; }
		.modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--border-color); }
	`];

	constructor() {
		super();
		this._local = null;
		this._sync = null;
		this._consentOpen = false;
		this._codeDraft = '';
		this._codeError = '';
		this._copied = false;
		this._busy = false;
		this._error = '';
		this._offLocal = null;
		this._offSync = null;
		this._onKeydown = (e) => {
			if (e.key === 'Escape' && this._consentOpen) { e.stopPropagation(); this.#decline(); }
		};
	}

	connectedCallback() {
		super.connectedCallback();
		// Zwei Abonnements, weil zwei Zustände entscheiden, was hier zu sehen ist.
		// Ohne das erste bliebe das Panel stehen, wenn der Nutzer die Integration
		// im Panel darüber widerruft - und stünde dann über einem Schalter, der
		// nichts mehr darf.
		window.GesturaEuLocal.read().then(local => { this._local = local; });
		window.GesturaSyncLocal.read().then(sync => { this._sync = sync; });
		this._offLocal = window.GesturaEuLocal.onChange(local => { this._local = local; });
		this._offSync = window.GesturaSyncLocal.onChange(sync => { this._sync = sync; });
		document.addEventListener('keydown', this._onKeydown, true);
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		if (this._offLocal) this._offLocal();
		if (this._offSync) this._offSync();
		document.removeEventListener('keydown', this._onKeydown, true);
		this.#lockScroll(false);
	}

	get #tier1() { return this._local ? window.FlowMouseEuIntegration.effectiveEnabled(this._local) : false; }
	get #state() { return this._sync ? this._sync.euSync : null; }
	get #effective() {
		return !!(this._local && this._sync && window.GesturaSyncLocal.syncEnabled(this._local, this._sync));
	}
	get #stale() {
		const s = this.#state;
		return !!(s && s.enabled && s.consent && s.consent.version !== window.GesturaSyncLocal.CURRENT_SYNC_CONSENT);
	}

	#lockScroll(on) { document.documentElement.style.overflow = on ? 'hidden' : ''; }

	#open() { this._consentOpen = true; this.#lockScroll(true); }
	#decline() { this._consentOpen = false; this.#lockScroll(false); }

	#onToggle(e) {
		if (e.target.checked) {
			// Nichts wird hier gespeichert - das entscheidet der Dialog. Sofort
			// zurücksetzen, damit der Schalter nicht kurz "an" aufblitzt.
			e.target.checked = false;
			this.#open();
			return;
		}
		this.#revoke();
	}

	// Erzeugt beim ersten Einschalten das Geheimnis gleich mit: ein eingeschalteter
	// Abgleich ohne Code wäre ein Zustand, in dem nichts geht und nichts erklärt,
	// warum. Ein vorhandener Code bleibt - Aus- und Wiedereinschalten darf die
	// Stände nicht verwaisen lassen.
	async #accept() {
		const patch = {
			enabled: true,
			consent: { version: window.GesturaSyncLocal.CURRENT_SYNC_CONSENT, date: new Date().toISOString() },
		};
		if (!this.#state || !this.#state.secret) {
			patch.secret = await window.GesturaSyncCode.encode(window.GesturaSyncCode.generateSecret());
		}
		try {
			await window.GesturaSyncLocal.write(patch);
		} catch {
			// Nicht gespeichert, also auch nicht geschlossen: der Dialog bleibt
			// stehen, statt eine Entscheidung zu behaupten, die nirgends steht.
			return;
		}
		this._consentOpen = false;
		this.#lockScroll(false);
	}

	// Aus und Zustimmung gelöscht in einem Schritt, wie beim Schalter darüber:
	// "aus" heißt dann immer "keine Zustimmung hinterlegt", und Wiedereinschalten
	// geht immer durch den Text. Der Code und die Stände bleiben - sie sind lokale
	// Daten, und der Nutzer hat sie nicht widerrufen.
	async #revoke() {
		this._consentOpen = false;
		this.#lockScroll(false);
		this._error = '';
		try { await window.GesturaSyncLocal.write({ enabled: false, consent: null }); } catch { /* nichts geändert */ }
	}

	async #copyCode() {
		try {
			await navigator.clipboard.writeText(this.#state.secret);
			this._copied = true;
			setTimeout(() => { this._copied = false; }, 2000);
		} catch {
			// Zwischenablage verweigert (Fokus, Berechtigung): der Code steht
			// vollständig da und ist mit user-select: all mit einem Klick markiert.
			this._error = window.i18n.getMessage('euSyncSecretCopy');
		}
	}

	// Ein Blob und ein <a download> - keine downloads-Berechtigung. Die
	// Kopfzeile steht mit in der Datei, weil eine Datei mit nur einem Code darin
	// in einem Jahr niemandem mehr sagt, was sie ist.
	#saveCode() {
		const i18n = window.i18n;
		const header = i18n.getMessage('euSyncSecretFileHeader').replace('{date}', new Date().toISOString().slice(0, 10));
		const blob = new Blob([header + '\n\n' + this.#state.secret + '\n'], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'gestura-sync-secret.txt';
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 10000);
	}

	// Ein anderer Code heißt: ein anderer Locator, andere Stand-Kennungen, andere
	// Hashes. Die lokale Karte gehört zum alten Code und wird mitgelöscht, sonst
	// stünden Namen und "seit dem Hochladen geändert" zu Ständen, die es unter
	// diesem Code nicht gibt.
	async #useCode() {
		const parsed = await window.GesturaSyncCode.parse(this._codeDraft);
		if (!parsed.secret) {
			this._codeError = window.i18n.getMessage(EuSyncPanel.CODE_ERRORS[parsed.error]);
			return;
		}
		this._codeError = '';
		this._codeDraft = '';
		await window.GesturaSyncLocal.write({ secret: await window.GesturaSyncCode.encode(parsed.secret), states: {} });
		await this.#refreshStates();
	}

	async #newCode() {
		if (!confirm(window.i18n.getMessage('euSyncSecretNewConfirm'))) return;
		await window.GesturaSyncLocal.write({
			secret: await window.GesturaSyncCode.encode(window.GesturaSyncCode.generateSecret()),
			states: {},
		});
		await this.#refreshStates();
	}

	// Task 10 füllt das. Hier, damit die beiden Aufrufer oben schon stehen können.
	async #refreshStates() { /* Task 10 */ }
	#renderStates() { return ''; }

	#consentDate() {
		const iso = this.#state && this.#state.consent && this.#state.consent.date;
		if (!iso) return '';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		try {
			return d.toLocaleDateString(window.i18n.getHtmlLang(), { year: 'numeric', month: 'long', day: 'numeric' });
		} catch {
			return d.toISOString().slice(0, 10);
		}
	}

	#renderOverlay() {
		const i18n = window.i18n;
		const points = [1, 2, 3, 4].map(n => [`euSyncConsentPoint${n}Label`, `euSyncConsentPoint${n}`]);
		return html`
			<div class="modal-overlay" @mousedown=${this.#decline}>
				<div class="modal-panel" tabindex="-1" @mousedown=${e => e.stopPropagation()}>
					<div class="modal-header">
						<h3>${i18n.getMessage('euSyncConsentTitle')}</h3>
						<button type="button" class="modal-close" @click=${this.#decline}
							aria-label=${i18n.getMessage('euSyncConsentCancel')}>${unsafeHTML(icons.x)}</button>
					</div>
					<div class="modal-body">
						<p class="lead">${i18n.getMessage('euSyncConsentLead')}</p>
						<ul>${points.map(([label, body]) => html`
							<li><strong>${i18n.getMessage(label)}</strong> ${i18n.getMessage(body)}</li>`)}</ul>
					</div>
					<div class="modal-footer">
						<button class="btn btn-secondary" @click=${this.#decline}>${i18n.getMessage('euSyncConsentCancel')}</button>
						<button class="btn btn-primary" @click=${this.#accept}>${i18n.getMessage('euSyncConsentAccept')}</button>
					</div>
				</div>
			</div>`;
	}

	#renderSecret() {
		const i18n = window.i18n;
		const origin = window.GesturaSyncLocal.syncOrigin(this._local);
		return html`
			<div class="setting-row secret-row">
				<div class="setting-label">
					<span>${i18n.getMessage('euSyncSecretTitle')}</span>
					<span>${i18n.getMessage('euSyncSecretDesc')}</span>
				</div>
				<code class="secret-code">${this.#state.secret}</code>
				<div class="actions">
					<button class="btn btn-secondary" @click=${this.#copyCode}>
						${this._copied ? i18n.getMessage('euSyncSecretCopied') : i18n.getMessage('euSyncSecretCopy')}
					</button>
					<button class="btn btn-secondary" @click=${this.#saveCode}>${i18n.getMessage('euSyncSecretSave')}</button>
					<button class="btn btn-secondary" @click=${this.#newCode}>${i18n.getMessage('euSyncSecretNew')}</button>
				</div>
				<div class="setting-label" style="margin-top:14px">
					<span>${i18n.getMessage('euSyncSecretPair')}</span>
					<span>${i18n.getMessage('euSyncSecretPairDesc')}</span>
				</div>
				<div class="pair">
					<input type="text" class="input-lg ${this._codeError ? 'invalid' : ''}" placeholder="GS1-…"
						.value=${this._codeDraft}
						@input=${e => { this._codeDraft = e.target.value; this._codeError = ''; }}
						@keydown=${e => { if (e.key === 'Enter') this.#useCode(); }}>
					<button class="btn btn-secondary" @click=${this.#useCode}>${i18n.getMessage('euSyncSecretPairApply')}</button>
				</div>
				${this._codeError ? html`<div class="error">${this._codeError}</div>` : ''}
				${origin !== window.FlowMouseEuIntegration.PRODUCTION_ORIGIN ? html`
					<div class="notice">${i18n.getMessage('euSyncDevOriginNotice').replace('{origin}', origin)}</div>` : ''}
			</div>`;
	}

	updated() {
		if (this._consentOpen) this.renderRoot.querySelector('.modal-panel')?.focus();
	}

	render() {
		const i18n = window.i18n;
		// Kein Schalter, solange die Integration nicht wirksam ist. Abwesend, nicht
		// ausgegraut: es gibt nichts zu erklären, was der Nutzer nicht eine Zeile
		// weiter oben selbst sieht.
		if (!this.#tier1 || !this._sync) return html``;
		return html`
			<h3>${i18n.getMessage('euSyncHeading')}</h3>
			<div class="setting-row">
				<div class="setting-label">
					<span>${i18n.getMessage('euSyncToggle')}</span>
					<span>${i18n.getMessage('euSyncToggleDesc')}</span>
				</div>
				<label class="toggle">
					<input type="checkbox" .checked=${this.#effective} @change=${this.#onToggle}>
					<span class="slider"></span>
				</label>
			</div>
			${this.#effective ? html`
				<div class="setting-row granted">
					<div class="setting-label">
						<span><span class="granted-icon">${unsafeHTML(icons.circleCheck)}</span>${i18n.getMessage('euSyncConsentGranted')}</span>
						<span>${i18n.getMessage('euSyncConsentDate').replace('{date}', this.#consentDate())}</span>
					</div>
					<div class="row-actions">
						<button class="btn btn-secondary" @click=${this.#revoke}>${i18n.getMessage('euSyncConsentRevoke')}</button>
					</div>
				</div>` : ''}
			${this.#stale ? html`
				<div class="setting-row">
					<div class="setting-label reconfirm">
						<span>${i18n.getMessage('euSyncReconfirmTitle')}</span>
						<span>${i18n.getMessage('euSyncReconfirmDesc')}</span>
					</div>
					<div class="row-actions">
						<button class="btn btn-secondary" @click=${this.#revoke}>${i18n.getMessage('euSyncConsentRevoke')}</button>
						<button class="btn btn-primary" @click=${this.#open}>${i18n.getMessage('tutorialContinue')}</button>
					</div>
				</div>` : ''}
			${this.#effective && this.#state.secret ? this.#renderSecret() : ''}
			${this.#effective ? this.#renderStates() : ''}
			${this._error ? html`<div class="error">${this._error}</div>` : ''}
			${this._consentOpen ? this.#renderOverlay() : ''}
		`;
	}
}

customElements.define('eu-sync-panel', EuSyncPanel);
```

- [ ] **Step 4: Put it on the page**

In `pages/options.html`, before `options-page.js`:

```html
	<script type="module" src="../js/components/eu-sync-panel.js"></script>
```

In `js/components/options-page.js`, inside the `websiteIntegration` section, right
after `<eu-integration-panel …>`:

```js
						<eu-sync-panel></eu-sync-panel>
```

- [ ] **Step 5: Verify by hand**

Load the unpacked extension, open the settings, go to the website-integration
section:

1. With the integration **off**, no sync heading appears anywhere.
2. Turn the integration on → the sync heading and its switch appear.
3. Turn sync on → the consent dialog opens; **Escape** and **Cancel** both leave
   the switch off and write nothing (check `chrome.storage.local` in the console:
   `await chrome.storage.local.get('euSync')`).
4. Agree → the switch stays on, the date is shown, and a `GS1-…` code appears.
   The stored `euSync.secret` is that code.
5. **Copy** puts it on the clipboard; **Save as file** writes
   `gestura-sync-secret.txt` with the header line and the code.
6. Paste the code back into "use an existing code" → accepted, nothing changes.
   Change one character → the typo message appears and the stored secret is
   untouched.
7. Turn the **integration** (tier 1) off → the whole sync block disappears, and
   `euSync` reads `enabled: false, consent: null` while `secret` is still there.
   Turn tier 1 back on → sync is off and asks for consent again.

- [ ] **Step 6: Commit**

```bash
git add js/components/eu-sync-panel.js js/components/options-page.js pages/options.html \
	css/common.css _locales/en/messages.json _locales/de/messages.json tests/site-menu-locales.test.mjs
git commit -m "feat(sync): the second switch, and the code behind it"
```

---

## Task 10: The states — upload, open, delete, and the reminder

The half of the panel that talks to the server. Everything here goes through `GesturaSync`, so the gate and the crypto are already settled; what is left is the list, the two buttons per row, the preview before each of them, and the hint that says the settings have moved on since the last upload.

**Files:**
- Modify: `js/components/eu-sync-panel.js`
- Modify: `js/components/options-page.js` (one listener)
- Modify: `css/common.css`
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json`
- Modify: `tests/site-menu-locales.test.mjs`

**Interfaces:**
- Consumes: `GesturaSync.list` / `upload` / `download` / `remove`, `GesturaSettingsSchema.buildExport` / `validate` / `hashOf`, `GesturaSyncCrypto.newStateId`, `settingsErrorMessage`, `<settings-preview-dialog>`.
- Produces: the window event `gestura:settings-apply` (detail = a validated settings object), which `options-page.js` turns into a save and a reload.

- [ ] **Step 1: Add the messages**

Into `_locales/en/messages.json`:

```json
	"euSyncStatesTitle": { "message": "Your states" },
	"euSyncStatesEmpty": { "message": "Nothing saved under this code yet." },
	"euSyncStateNamePlaceholder": { "message": "Name, for example: Work" },
	"euSyncCreate": { "message": "Upload as a new state" },
	"euSyncUpload": { "message": "Overwrite" },
	"euSyncDownload": { "message": "Open here" },
	"euSyncDelete": { "message": "Delete" },
	"euSyncDeleteAll": { "message": "Delete everything under this code" },
	"euSyncDeleteConfirm": { "message": "Delete the state {name} from gestura.eu?" },
	"euSyncDeleteAllConfirm": { "message": "Delete every state saved under this code from gestura.eu? Your settings in this browser stay as they are." },
	"euSyncRefresh": { "message": "Refresh" },
	"euSyncChanged": { "message": "Your settings have changed since this upload." },
	"euSyncUploadedAt": { "message": "Uploaded {date}" },
	"euSyncNeverUploadedHere": { "message": "Not uploaded from this browser." },
	"euSyncStateBroken": { "message": "This state cannot be read with the current code." },
	"euSyncDuplicateName": { "message": "A state with this name already exists. Names may repeat — the states stay separate." },
	"euSyncQuotaReached": { "message": "You have reached the maximum of {max} states. Delete one to save another." },
	"euSyncErrorNetwork": { "message": "gestura.eu could not be reached." },
	"euSyncErrorBadRequest": { "message": "gestura.eu did not understand the request." },
	"euSyncErrorNotFound": { "message": "This state no longer exists on gestura.eu." },
	"euSyncErrorTooLarge": { "message": "These settings are too large to upload." },
	"euSyncErrorQuotaStates": { "message": "There is no room for another state under this code." },
	"euSyncErrorRateLimited": { "message": "Too many requests. Try again in a few minutes." },
	"euSyncErrorServer": { "message": "gestura.eu answered with an error." },
	"euSyncErrorMalformed": { "message": "The answer from gestura.eu was unreadable." },
	"euSyncErrorDecrypt": { "message": "Wrong code, or the data is damaged." },
	"euSyncErrorDisabled": { "message": "Sync is switched off." },
	"euSyncErrorNoSecret": { "message": "This browser has no usable sync code." },
```

Into `_locales/de/messages.json`:

```json
	"euSyncStatesTitle": { "message": "Deine Stände" },
	"euSyncStatesEmpty": { "message": "Unter diesem Code ist noch nichts gesichert." },
	"euSyncStateNamePlaceholder": { "message": "Name, zum Beispiel: Arbeit" },
	"euSyncCreate": { "message": "Als neuen Stand hochladen" },
	"euSyncUpload": { "message": "Überschreiben" },
	"euSyncDownload": { "message": "Hier öffnen" },
	"euSyncDelete": { "message": "Löschen" },
	"euSyncDeleteAll": { "message": "Alles unter diesem Code löschen" },
	"euSyncDeleteConfirm": { "message": "Den Stand {name} auf gestura.eu löschen?" },
	"euSyncDeleteAllConfirm": { "message": "Alle unter diesem Code gesicherten Stände auf gestura.eu löschen? Deine Einstellungen in diesem Browser bleiben, wie sie sind." },
	"euSyncRefresh": { "message": "Aktualisieren" },
	"euSyncChanged": { "message": "Deine Einstellungen haben sich seit diesem Hochladen geändert." },
	"euSyncUploadedAt": { "message": "Hochgeladen {date}" },
	"euSyncNeverUploadedHere": { "message": "Nicht aus diesem Browser hochgeladen." },
	"euSyncStateBroken": { "message": "Dieser Stand lässt sich mit dem aktuellen Code nicht lesen." },
	"euSyncDuplicateName": { "message": "Ein Stand mit diesem Namen besteht bereits. Namen dürfen sich wiederholen — die Stände bleiben getrennt." },
	"euSyncQuotaReached": { "message": "Du hast das Höchstmaß von {max} Ständen erreicht. Lösche einen, um einen weiteren zu sichern." },
	"euSyncErrorNetwork": { "message": "gestura.eu war nicht erreichbar." },
	"euSyncErrorBadRequest": { "message": "gestura.eu hat die Anfrage nicht verstanden." },
	"euSyncErrorNotFound": { "message": "Diesen Stand gibt es auf gestura.eu nicht mehr." },
	"euSyncErrorTooLarge": { "message": "Diese Einstellungen sind zu groß zum Hochladen." },
	"euSyncErrorQuotaStates": { "message": "Unter diesem Code ist kein Platz für einen weiteren Stand." },
	"euSyncErrorRateLimited": { "message": "Zu viele Anfragen. Versuch es in ein paar Minuten noch einmal." },
	"euSyncErrorServer": { "message": "gestura.eu hat mit einem Fehler geantwortet." },
	"euSyncErrorMalformed": { "message": "Die Antwort von gestura.eu war nicht lesbar." },
	"euSyncErrorDecrypt": { "message": "Falscher Code, oder die Daten sind beschädigt." },
	"euSyncErrorDisabled": { "message": "Der Abgleich ist ausgeschaltet." },
	"euSyncErrorNoSecret": { "message": "Dieser Browser hat keinen brauchbaren Abgleich-Code." },
```

Add all of them to `PENDING_TRANSLATION`.

- [ ] **Step 2: Add the row styles**

Into `css/common.css`:

```css
.sync-state-row {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 10px 0;
	border-top: 1px solid var(--border-color);
}
.sync-state-row .name { font-weight: 600; }
.sync-state-row .meta { font-size: 12px; color: var(--text-secondary); }
.sync-state-row .grow { flex: 1 1 auto; min-width: 0; }
.sync-state-row .row-actions { display: flex; gap: 8px; flex: none; }
```

- [ ] **Step 3: Let the options page apply a downloaded state**

In `js/components/options-page.js`, at the end of `#init()`:

```js
		// Der Sync-Panel liegt in einem eigenen Schattenbaum und kann #applySettings
		// nicht aufrufen. Es schickt das geprüfte Objekt hierher, damit Datei-Import
		// und Sync-Download denselben einen Schreibweg nehmen - samt Reload, ohne
		// den die Unterkomponenten ihren alten Stand behielten.
		window.addEventListener('gestura:settings-apply', (e) => this.#applySettings(e.detail));
```

- [ ] **Step 4: Fill in the states half of the panel**

In `js/components/eu-sync-panel.js`, add the imports:

```js
import { settingsStore } from '../settings-store.js';
import { settingsErrorMessage } from './settings-preview-dialog.js';
```

Extend `static properties` with:

```js
		_states: { state: true },
		_newName: { state: true },
		_currentHash: { state: true },
		_preview: { state: true },
```

and the constructor with:

```js
		this._states = null;      // null = noch nicht gelesen, [] = gelesen und leer
		this._newName = '';
		this._currentHash = '';
		this._preview = null;
		this._onSaved = () => this.#recomputeHash();
```

Add the error table beside `CODE_ERRORS`:

```js
	static SYNC_ERRORS = {
		network: 'euSyncErrorNetwork',
		'bad-request': 'euSyncErrorBadRequest',
		'not-found': 'euSyncErrorNotFound',
		'too-large': 'euSyncErrorTooLarge',
		'quota-states': 'euSyncErrorQuotaStates',
		'rate-limited': 'euSyncErrorRateLimited',
		server: 'euSyncErrorServer',
		malformed: 'euSyncErrorMalformed',
		decrypt: 'euSyncErrorDecrypt',
		disabled: 'euSyncErrorDisabled',
		'no-secret': 'euSyncErrorNoSecret',
	};
```

In `connectedCallback`, after the two subscriptions:

```js
		this.#recomputeHash();
		// settingsStore.onChange() meldet nur FREMDE Änderungen - absichtlich, damit
		// eine Komponente nicht auf ihren eigenen Schreibvorgang reagiert. Der
		// Hinweis "seit dem Hochladen geändert" braucht aber genau die andere
		// Hälfte: eine Änderung, die auf DIESER Seite gemacht wurde. Dafür gibt es
		// gestura:settings-saved (js/settings-store.js).
		window.addEventListener('gestura:settings-saved', this._onSaved);
		this._offStore = settingsStore.onChange(() => this.#recomputeHash());
```

and in `disconnectedCallback`:

```js
		window.removeEventListener('gestura:settings-saved', this._onSaved);
		if (this._offStore) this._offStore();
```

Then the methods, replacing the two stubs from Task 9:

```js
	#exportNow() {
		return window.GesturaSettingsSchema.buildExport(settingsStore.current, window.i18n.version);
	}

	async #recomputeHash() {
		try {
			this._currentHash = await window.GesturaSettingsSchema.hashOf(this.#exportNow());
		} catch {
			this._currentHash = '';
		}
	}

	#fail(e) {
		this._error = window.i18n.getMessage(EuSyncPanel.SYNC_ERRORS[e && e.code] || 'euSyncErrorServer');
	}

	// Jeder Server-Zugriff läuft hier durch: ein Fehler landet in einer Zeile, nie
	// in einem Dialog, und `_busy` sperrt die Knöpfe so lange. Ein fehlgeschlagener
	// Abruf lässt die zuletzt gelesene Liste stehen - sie ist immer noch die beste
	// Auskunft, die es gibt.
	async #run(fn) {
		this._busy = true;
		this._error = '';
		try {
			return await fn();
		} catch (e) {
			this.#fail(e);
			return null;
		} finally {
			this._busy = false;
		}
	}

	async #refreshStates() {
		if (!this.#effective) return;
		const list = await this.#run(() => window.GesturaSync.list());
		if (list) this._states = list;
	}

	// Der Name kommt aus dem entschlüsselten Meta-Blob und nicht aus der lokalen
	// Karte: ein frisch verbundener zweiter Browser hat die Karte nicht, und der
	// Meta-Blob ist die Auskunft, die zum Stand selbst gehört.
	#nameOf(state) {
		if (state.meta && typeof state.meta.name === 'string' && state.meta.name) return state.meta.name;
		const local = this.#state.states[state.stateId];
		return (local && local.name) || state.stateId.slice(0, 8);
	}

	#openPreview(preview) { this._preview = preview; }

	async #onPreviewConfirm() {
		const preview = this._preview;
		this._preview = null;
		if (preview) await preview.commit();
	}

	// Hochladen und Überschreiben sind derselbe Weg mit verschiedenen Kennungen -
	// das Vorschaubild davor ist beide Male dasselbe und ist nicht abkürzbar: es
	// IST die Zusage aus dem Zustimmungstext.
	#uploadTo(stateId, name) {
		const exportObj = this.#exportNow();
		const json = JSON.stringify(exportObj, null, 2);
		this.#openPreview({
			mode: 'upload',
			json,
			dropped: [],
			retyped: [],
			legacy: false,
			commit: async () => {
				const id = stateId || window.GesturaSyncCrypto.newStateId();
				const existing = this.#state.states[id];
				const done = await this.#run(() => window.GesturaSync.upload({
					stateId: id,
					name,
					createdAt: (existing && existing.lastUploadDate) || new Date().toISOString(),
					exportObj,
					extVersion: window.i18n.version,
				}));
				if (!done) return;
				await window.GesturaSyncLocal.setState(id, {
					name,
					lastUploadHash: await window.GesturaSettingsSchema.hashOf(exportObj),
					lastUploadDate: new Date().toISOString(),
				});
				this._newName = '';
				await this.#refreshStates();
			},
		});
	}

	// Herunterladen heißt: entschlüsseln, prüfen, zeigen - und erst dann schreiben.
	// Der Validator ist derselbe wie beim Datei-Import, also kann ein Stand aus
	// einer neueren Gestura-Version hier auch dieselbe klare Absage bekommen.
	async #downloadState(state) {
		const payload = await this.#run(() => window.GesturaSync.download({
			stateId: state.stateId,
			expectPayloadHash: state.meta ? state.meta.payloadHash : '',
		}));
		if (!payload) return;
		const result = window.GesturaSettingsSchema.validate(payload);
		if (!result.ok) {
			this._error = settingsErrorMessage(window.i18n, result.error);
			return;
		}
		this.#openPreview({
			mode: 'import',
			json: result.json,
			dropped: result.dropped,
			retyped: result.retyped,
			legacy: result.legacy,
			commit: () => window.dispatchEvent(new CustomEvent('gestura:settings-apply', { detail: result.settings })),
		});
	}

	async #deleteState(state) {
		if (!confirm(window.i18n.getMessage('euSyncDeleteConfirm').replace('{name}', this.#nameOf(state)))) return;
		const done = await this.#run(() => window.GesturaSync.remove(state.stateId));
		if (!done) return;
		await window.GesturaSyncLocal.removeState(state.stateId);
		await this.#refreshStates();
	}

	async #deleteAll() {
		if (!confirm(window.i18n.getMessage('euSyncDeleteAllConfirm'))) return;
		// Ohne stateId: das löscht alles unter diesem Locator.
		const done = await this.#run(() => window.GesturaSync.remove());
		if (!done) return;
		await window.GesturaSyncLocal.write({ states: {} });
		this._states = [];
	}

	#formatDate(iso) {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		try {
			return d.toLocaleString(window.i18n.getHtmlLang(), { dateStyle: 'medium', timeStyle: 'short' });
		} catch {
			return d.toISOString().slice(0, 16).replace('T', ' ');
		}
	}

	#renderStateRow(state) {
		const i18n = window.i18n;
		const local = this.#state.states[state.stateId];
		// Der Hinweis gilt je Stand und nur für Stände, in die DIESER Browser
		// hochgeladen hat: für einen fremden Stand gibt es hier keinen Vergleich,
		// und ein "geändert" wäre dort eine Behauptung ohne Grundlage.
		const changed = !!(local && local.lastUploadHash && this._currentHash && local.lastUploadHash !== this._currentHash);
		return html`
			<div class="sync-state-row">
				<div class="grow">
					<div class="name">${this.#nameOf(state)}</div>
					<div class="meta">
						${state.updatedAt ? i18n.getMessage('euSyncUploadedAt').replace('{date}', this.#formatDate(state.updatedAt)) : ''}
						${state.broken ? html`<span class="sync-hint"> — ${i18n.getMessage('euSyncStateBroken')}</span>` : ''}
						${!local ? html`<span> — ${i18n.getMessage('euSyncNeverUploadedHere')}</span>` : ''}
					</div>
					${changed ? html`<div class="sync-hint">${i18n.getMessage('euSyncChanged')}</div>` : ''}
				</div>
				<div class="row-actions">
					<button class="btn btn-secondary" ?disabled=${this._busy || state.broken}
						@click=${() => this.#downloadState(state)}>${i18n.getMessage('euSyncDownload')}</button>
					<button class="btn btn-secondary" ?disabled=${this._busy}
						@click=${() => this.#uploadTo(state.stateId, this.#nameOf(state))}>${i18n.getMessage('euSyncUpload')}</button>
					<button class="btn btn-danger" ?disabled=${this._busy}
						@click=${() => this.#deleteState(state)}>${i18n.getMessage('euSyncDelete')}</button>
				</div>
			</div>`;
	}

	#renderStates() {
		const i18n = window.i18n;
		const states = this._states || [];
		const full = states.length >= window.GesturaSync.LIMITS.statesMax;
		const duplicate = states.some(s => this.#nameOf(s) === this._newName.trim());
		return html`
			<div class="setting-row">
				<div class="setting-label">
					<span>${i18n.getMessage('euSyncStatesTitle')}</span>
					<span>${this._states === null || states.length ? '' : i18n.getMessage('euSyncStatesEmpty')}</span>
				</div>
				<div class="row-actions">
					<button class="btn btn-secondary" ?disabled=${this._busy}
						@click=${this.#refreshStates}>${i18n.getMessage('euSyncRefresh')}</button>
					${states.length ? html`
						<button class="btn btn-danger" ?disabled=${this._busy}
							@click=${this.#deleteAll}>${i18n.getMessage('euSyncDeleteAll')}</button>` : ''}
				</div>
			</div>
			${states.map(s => this.#renderStateRow(s))}
			${full ? html`
				<div class="notice">${i18n.getMessage('euSyncQuotaReached').replace('{max}', String(window.GesturaSync.LIMITS.statesMax))}</div>` : html`
				<div class="pair">
					<input type="text" class="input-lg" placeholder=${i18n.getMessage('euSyncStateNamePlaceholder')}
						.value=${this._newName}
						@input=${e => { this._newName = e.target.value; }}
						@keydown=${e => { if (e.key === 'Enter' && this._newName.trim()) this.#uploadTo(null, this._newName.trim()); }}>
					<button class="btn btn-primary" ?disabled=${this._busy || !this._newName.trim()}
						@click=${() => this.#uploadTo(null, this._newName.trim())}>${i18n.getMessage('euSyncCreate')}</button>
				</div>
				${duplicate ? html`<div class="notice">${i18n.getMessage('euSyncDuplicateName')}</div>` : ''}`}
			<settings-preview-dialog
				?open=${!!this._preview}
				mode=${this._preview ? this._preview.mode : 'upload'}
				.json=${this._preview ? this._preview.json : ''}
				.dropped=${this._preview ? this._preview.dropped : []}
				.retyped=${this._preview ? this._preview.retyped : []}
				?legacy=${!!(this._preview && this._preview.legacy)}
				@preview-confirm=${this.#onPreviewConfirm}
				@preview-cancel=${() => { this._preview = null; }}></settings-preview-dialog>`;
	}
```

Finally, fetch the list once the switch is on. In `render()`, before the return
is the wrong place (it would fetch on every render); do it in `updated()`
instead, beside the existing focus line:

```js
	updated() {
		if (this._consentOpen) this.renderRoot.querySelector('.modal-panel')?.focus();
		// Einmal je Einschaltvorgang, nicht je Renderdurchlauf: _states bleibt null,
		// bis eine Antwort da war, und genau dieses null ist die Bedingung.
		if (this.#effective && this._states === null && !this._busy) this.#refreshStates();
	}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS. The panel has no unit test of its own — its logic lives in
`eu-sync.js` and `eu-settings-schema.js`, which do. What the locale tests check
here is that every new key exists in `en` and `de` and is listed as pending.

- [ ] **Step 6: Verify against a mock**

The endpoint does not exist yet, so this runs against a local mock on the
developer origin. The harness from R2 is outside the repo at
`~/.claude/projects/c--Programme-alt-Gestura/browser-verify/`; extend
`updates-mock.mjs` with the four sync routes (an in-memory `Map` keyed by
locator is enough) and set the developer origin in the panel to it.

1. Enter a name, press **Upload as a new state** → the preview shows the
   complete export. Cancel → **no request is made** (check the mock's log).
2. Confirm → the state appears in the list with its date. In the mock's stored
   blob, neither the name nor any settings value is readable.
3. Change a setting → within a second the row shows "your settings have
   changed since this upload".
4. **Overwrite** → the preview shows the new content; after confirming, the
   hint is gone.
5. **Open here** → the preview shows what will be written; confirm → the page
   reloads with the state's settings.
6. In a second browser profile: turn the integration and sync on, paste the
   code, refresh → the state appears with its name, and **Open here** brings
   the settings across.
7. Stop the mock and press **Refresh** → the error line says gestura.eu could
   not be reached, and the list stays as it was.
8. Turn sync off while a request is in flight (throttle the mock) → the answer
   is discarded and the error line says sync is off.

- [ ] **Step 7: Commit**

```bash
git add js/components/eu-sync-panel.js js/components/options-page.js css/common.css \
	_locales/en/messages.json _locales/de/messages.json tests/site-menu-locales.test.mjs
git commit -m "feat(sync): named states, and the preview before every transfer"
```

---

## Task 11: Privacy, the stores, the changelog, and the hand-over

R3 changes what the extension can send in a way no earlier release did: with tier 2 on, **user content** leaves the browser. That is a data-disclosure change for both stores and a new section in `PRIVACY.md`, and it is part of this release rather than something to remember later.

**Files:**
- Modify: `PRIVACY.md`
- Modify: `docs/store/chrome-web-store-submission.md`, `docs/store/firefox-amo-submission.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-09-03-gestura-eu-integration-r3.md` (this file — the execution record)
- Copy: `docs/gestura-eu-api.md` into the `gestura-index` exchange folder

- [ ] **Step 1: The privacy text**

In `PRIVACY.md`, the summary paragraph currently ends with the update check. Add
the sync to it in one clause, then add a section directly after *"gestura.eu
integration (optional, off by default)"*:

```markdown
## Sync between browsers (optional, off by default, a second switch)

Sync is a separate switch underneath the integration, with its own consent. It
is off until you turn it on, and it cannot be on while the integration is off.

When it is on, and only when you click **Upload**:

- Gestura encrypts your settings **in your browser** and sends the ciphertext to
  gestura.eu. The key is derived from a code this browser generated; the code is
  never sent. gestura.eu stores the ciphertext, its size and the date — it can
  read neither your settings nor the name you gave the state, because that name
  is inside the encrypted part.
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
```

- [ ] **Step 2: The store declarations**

In `docs/store/chrome-web-store-submission.md` and
`docs/store/firefox-amo-submission.md`, the data-disclosure sections gain one
line each, worded for that store's form. The substance in both:

```markdown
**Personal communications / user content:** No. **Website content:** No.
**User settings, optional and encrypted:** With the optional *Sync* switch on
(off by default, behind its own consent), the user's own extension settings are
uploaded to gestura.eu **encrypted in the browser**, on an explicit click. The
service stores ciphertext only and holds no key. No account, no identifier.
```

Check both files for a sentence claiming the extension transmits nothing — R2
already corrected one such claim, and R3 makes any survivor wrong for a second
reason.

- [ ] **Step 3: The changelog**

Under `### Unreleased` in `CHANGELOG.md`:

```markdown
- Sync: settings can be saved as named states on gestura.eu and opened in
  another browser. End-to-end encrypted with a code this browser generates —
  gestura.eu stores ciphertext and never sees a key, a name or a setting. Off by
  default, behind its own consent underneath the website integration.
- Export and import now show you the complete content before anything is written,
  and check it against a real schema: unknown entries are listed and dropped
  instead of being written, and a file cannot smuggle in switches or a sync code.
```

- [ ] **Step 4: Hand the contract over**

`docs/gestura-eu-api.md` is the source; `gestura-index` gets a byte-identical
copy in its `exchange/` folder, the way R2's was handed over. Note in the
hand-over which parts are new (the sync half, `apiLevel` 3) and that the crypto
constants are pinned by the test vectors in the same document.

Nothing in `exchange/` is committed here — [CLAUDE.md](../../../CLAUDE.md) is
explicit that the folder crosses the WSL2/Windows boundary and stays out of git.

- [ ] **Step 5: The release gate**

Run: `npm test`
Expected: PASS, every suite.

Then confirm the two conditions that keep R3 from being released:

```bash
grep -c "euSync\|settingsPreview" tests/site-menu-locales.test.mjs
```

**R2 and R3 release together, in one version** (the owner's decision of
2026-09-03), and neither is releasable while any of its keys is still in
`PENDING_TRANSLATION`. Consent copy is the one text a user must be able to read
in their own language. The release therefore needs, in this order:

1. the `/api/v1/updates` endpoint live (R2) and the four `/api/v1/sync/*`
   endpoints live (R3);
2. all `euIntegration*`, `euSync*` and `settingsPreview*` keys translated into
   all 39 locales and deleted from `PENDING_TRANSLATION`;
3. `manifest.json`'s `version` bumped and `CHANGELOG.md`'s `### Unreleased`
   renamed — one tag, one release, both browsers' packages on it.

- [ ] **Step 6: Record the state and commit**

Add an "Execution status" section to the end of this plan: what landed, what was
verified by hand and against what, what deviates from the plan and why.

```bash
git add PRIVACY.md docs/store/ CHANGELOG.md docs/superpowers/plans/2026-09-03-gestura-eu-integration-r3.md
git commit -m "docs(privacy): encrypted settings can now leave the browser, by a second consent"
```

---

## Self-review

Checked against the spec after the plan was written.

**Spec coverage.** Section 5 is covered task by task: secret generation and the
code format (2), HKDF and the envelope with its AAD binding (3), the settings
validator with every ground rule the spec lists (4), the `euSync` key with the
composed tier-2 invariant (5), the four endpoints and their quota errors (6),
the full-content preview that Issue #1 asks for (7), the file paths that inherit
it (8), the switch, consent and secret backup (9), named states with the
upload/overwrite distinction, the per-state reminder and the delete-everything
button (10), privacy and stores (11). Sections 6 and 7 are folded into the tasks
they concern.

**Two deliberate gaps, both named where they are made:**

1. **No QR code** (Decision 3). The spec lists it as one of three backup forms.
   Gestura is desktop-only, so there is nothing to scan it into; copy and file
   cover every real path. The code stays inside the QR alphanumeric charset so
   this is additive later, not a rewrite.
2. **Type checking is top-level, not deep** (Task 4). The spec says "nested
   value types checked against the expected shapes". The validator checks the
   top-level shape of every allowlisted key and rejects forbidden property names
   at every depth; deeper repair is left to `SettingsStore.normalizeSetting()`,
   which already runs over the four structured keys on every load — and an import
   reloads the page. A second normaliser would be a copy that drifts. If the
   owner wants the schema to own deep validation too, that is a task of its own
   and should be one.

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N".
Every code step carries the code. Task 1's constants are not invented: the
vectors in it were computed with Node's WebCrypto, and the implementations in
Tasks 2, 3, 4, 5 and 6 were executed against every assertion their test steps
make — the only assertion that failed was `apiLevel: 3`, which Task 5 is what
raises.

**Type consistency.** `parse()` answers `{ secret }` or `{ error }` in Tasks 2,
6 and 9 alike. `validate()` answers the same `Result` in Tasks 4, 8 and 10.
`GesturaSync` errors carry `.code`, and both consumers map it through an
explicit table. `stateId` is 32 lower-case hex everywhere, checked by
`STATE_ID_RE` in Tasks 3, 5 and 6. `hashOf()` takes an **export object**, not a
settings object, in Tasks 4 and 10.

**What R3 deliberately does not do**, so a reviewer does not look for it: no
auto-sync, no conflict resolution, no merging (a download replaces), no account,
no server-side rollback protection beyond the meta/payload binding — the spec
puts rollback outside the threat model, because uploads are explicit, states are
few, and the preview shows what actually arrived.

## Open for the owner

1. **QR code — dropped from R3, or postponed?** Decision 3 argues it has no
   destination on a desktop-only extension. If it should ship anyway, it is one
   task: a vendored MIT generator in `js/lib/`, an entry in
   `THIRD_PARTY_LICENSES.md`, and a canvas in the secret block.
2. **Ten states and 512 KiB per payload** are this plan's numbers, not the
   spec's — the spec says "quota" without a figure. They are in the contract, so
   `gestura-index` implements exactly these; changing them later means changing
   both sides at once.
3. **Sync uses the developer origin when one is set** (Decision 2). That means a
   configured developer origin silently redirects sync away from production. The
   panel says so in a line under the code; if that is too quiet, the alternative
   is refusing to sync at all while a developer origin is configured.
4. **Deep validation** — see the self-review's second gap.
