# Design: gestura.eu Integration — Master Switch, Bridge, Status API, E2E Sync

- **Date:** 2026-09-02
- **Status:** approved by the user (brainstorming completed)
- **Extends:** [2026-07-19-menu-index-design.md](2026-07-19-menu-index-design.md) (the index design). This document adds the extension ↔ gestura.eu integration layer and refines the sync identity model; where the two disagree, this document wins (see section 8).
- **Related:** [Issue #1 — Export zu gestura](https://github.com/PPP01/Gestura/issues/1) (full transparency: the user must always be able to see the complete export/import; private data readable by no one else).

## Goals

1. A **master switch, off by default** — with it off, the extension is fully standalone: **no integration-initiated communication** with gestura.eu (bridge, update check, sync), and **every website-triggered import path is ignored** (operator `rel="gestura-menu"` links, `data-gestura-inline` hand-offs, `gestura:import` events; no `gestura:import-result` is sent). Manual imports the user starts inside the extension (file, URL — including a URL that happens to point at gestura.eu) remain available always.
2. With integration enabled, gestura.eu pages can see that Gestura is installed, its version, and — per entry they ask about — whether it is installed, which version, and whether the user modified it (status only, never the modification itself).
3. Direct import from gestura.eu by button, with the page learning the outcome (the mechanics shipped in 2.8.0; this design gates them behind the switch and adds the status display around them).
4. Update notices for imported entries, on gestura.eu and in the options page.
5. **E2E-encrypted settings sync between browsers** via gestura.eu — as simple as possible: no login, no passphrase, an extension-generated secret.

## Non-goals

- No auto-sync (explicit upload/download only; a reminder flag, nothing more).
- No account requirement anywhere. The passkey account from the July design stays a later, optional layer.
- No exposure of the user's own or non-index entries through the bridge — the page only ever learns about IDs it asked for.
- No gating of manual imports: file and URL imports started inside the extension work regardless of any switch.
- No transmission of modification *content* — only the boolean status.

## Key decisions (made during brainstorming)

| Decision | Choice |
|---|---|
| Page ↔ extension channel | **DOM-event bridge** (like the 2.8.0 hand-off), not `externally_connectable` — one code path for Chrome/Edge/Firefox. Firefox does not support `externally_connectable` toward web pages ([bug 1319168](https://bugzilla.mozilla.org/show_bug.cgi?id=1319168), still open as of 2026-09; a W3C standardization effort exists). Even if Firefox ships it later, the bridge stays the better fit: one code path everywhere, works on older Firefox, and builds on the hand-off that already shipped in 2.8.0. |
| Direction | **Pull only:** the page asks, the extension answers. The extension never announces itself. |
| Switch model | **Two tiers:** "gestura.eu integration" (bridge + update check) and, beneath it, "Sync" — each with its own consent text. |
| Switch storage | **`chrome.storage.local`** — each browser consents on its own; enabling never propagates silently via browser sync. |
| Sync identity | **Extension-generated secret** (32 random bytes). HKDF derives a server locator and the encryption key separately. No login, no passphrase. The passkey account can take over the sync later (like the edit-token transfer in the July design). |
| Sync mode | **Explicit, named states + reminder:** upload / download buttons, multiple named states, plus a local "changed since last upload" hint. No auto-sync, no conflict resolution needed. |
| Rollout | **Design everything now, ship stepwise** (R1–R3 below). Store review happens per release; sync ships only when the server side exists. No dark-launched sync code in earlier releases. |

## 1. Scope and releases

Three release stages, each shippable on its own. R1 needs no server at all; R2 and R3 each ship once their endpoints exist — no release blocks another:

- **R1 — Foundation:** the tier-1 switch + consent UI, gating of all website-triggered import paths (a deliberate behavior change to shipped 2.8.0 functionality: operator buttons and hand-offs are inert until the user enables the integration), bridge protocol (`hello`, `query-status`), source provenance + baseline hash written on import (feeds the status answers). Fully testable against the dev index.
- **R2 — Updates:** anonymous update check (`POST /updates` from the July design) + update badges in the options page. Needs the live endpoint.
- **R3 — Sync:** the tier-2 switch + its consent UI, E2E sync with named states, reminder, secret backup. Needs the sync endpoints. **Nothing of tier 2 ships before R3** — a visible but functionless sync switch in R1 would be exactly the dark-launched code this plan avoids.

The **API contract** (bridge events + HTTP endpoints + CORS requirements) is extracted into a tracked doc `docs/gestura-eu-api.md` as part of R1 and copied into the `gestura-index` repo, like the JSON schema in the July design. The contract carries an integer **`apiLevel`** (starts at 1): the website deploys in minutes, extensions sit in store review for weeks and users update late — the site must handle every old level gracefully. No answer at all is indistinguishable from "not installed", by design.

## 2. The two switches

Both live in **`chrome.storage.local`** (not `storage.sync`, not the `SettingsStore` path), both store **consent version + date** so a later scope expansion can re-prompt precisely instead of silently stretching old consent. Proposed shape:

```json
{
	"euIntegration": {
		"enabled": false,
		"consent": { "version": 1, "date": "…" },
		"devOrigin": ""
	},
	"euSync": {
		"enabled": false,
		"consent": { "version": 1, "date": "…" },
		"secret": "…",
		"states": { "<stateId>": { "name": "…", "lastUploadHash": "…", "lastUploadDate": "…" } }
	}
}
```

- **Tier 1 — "Website integration"** (default off) gates: bridge answers, **all website-triggered import paths**, the update check, and the visibility of the sync section. Consent text (informing, not warning) lists concretely: *websites can hand menus and search engines to the import dialog; the extension version and the status of entries imported from gestura.eu are disclosed to gestura.eu pages on request; update requests carry the IDs and versions of imported entries — anonymous, no account.*
- **Tier 2 — "Sync"** (default off, only visible while tier 1 is on, ships with R3) with its own consent: *encrypted settings states are transferred to gestura.eu; only you can read them; before every upload you see in full what is transferred* (Issue #1).

**The effective-enabled invariant** (one shared helper, used by every gated path):

```text
effectiveEnabled = enabled === true && consent.version === CURRENT_CONSENT_VERSION
```

A stored consent for an older version never authorizes anything — the switch shows as "needs re-confirmation" and all gated paths stay off until the user confirms the new consent text. Turning tier 1 off (or a consent version bump) takes effect immediately and concretely: content scripts watch `storage.local` for the change, the effective state is re-checked **before every bridge answer and every import hand-off** (never cached across an async gap), in-flight HTTP requests are aborted where possible and their responses are discarded in any case, and a website-triggered import still waiting in the dialog sends no `gestura:import-result` after the switch went off. Imported entries stay (they are local data). Turning tier 2 off stops sync; the secret is kept unless the user explicitly deletes it (so re-enabling does not orphan server blobs).

**Confirmed decision (reversed on 2026-09-02 after review):** when tier 1 is **off**, Gestura ignores **all import hand-offs initiated by websites** — `rel="gestura-menu"` links, `data-gestura-inline` / `gestura:import` events — and sends no `gestura:import-result`. This deliberately changes the shipped 2.8.0 behavior: operator buttons are inert until the user enables the integration. Manual file and URL imports started inside the extension remain available regardless of the switch. Unchanged either way: no import without the dialog — the import dialog stays the trust boundary for everyone, always.

## 3. The bridge (page ↔ extension)

A DOM-event protocol like the existing hand-off — one code path for Chrome, Edge and Firefox. New content script **`js/eu-bridge.js`**, inserted at the right position of the load-ordered `content_scripts` list (both manifests, see section 6).

The bridge answers **only** when tier 1 is on **and** `location.origin` is on the origin list:

- `https://gestura.eu` (hard-coded), plus
- optionally **one** dev origin from a "developer origin" text field in the integration section (default empty; accepts only `https:` origins or `http://localhost[:port]`). No shipped allowlist containing localhost.

No answer = indistinguishable from "not installed" — intended, and the anti-fingerprinting property of the design: a page that is not gestura.eu (or the switch being off) gets silence, not a refusal.

| Event (page →) | Answer event (→ page) |
|---|---|
| `gestura:hello {requestId}` | `gestura:hello-result {requestId, version, apiLevel: 1}` |
| `gestura:query-status {requestId, ids: […]}` | `gestura:query-status-result {requestId, entries: […]}` |
| `gestura:import` → `gestura:import-result` | exists since 2.8.0; now gated by tier 1 (section 2) |

Rules:

- `query-status` answers **only for the IDs asked about**, and only for entries with **qualified index provenance** (`source.indexId` *plus* `source.indexOrigin`, see section 4) — an `indexId` alone proves nothing, since 2.8.0 file imports carry the id the file claims. The extension never enumerates or reveals what else the user has (own menus, entries from other sources, file imports). One batched call per page view is the expected usage.
- **Provenance is origin-bound:** entries are matched by the **pair** `(source.indexOrigin, source.indexId)`, and a status answer requires `source.indexOrigin === location.origin` of the asking page — gestura.eu never learns about entries imported from the dev index, and vice versa.
- **Limits and types (part of the contract):** `requestId` is a string of at most 64 characters. `ids` is an array of at most 100 strings, each matching the exchange schema's ID rule (`js/exchange-schema.json`: its pattern, max 128 characters). Anything else — wrong types, over limit, malformed JSON — gets silence, like every other failure.
- `entries` in the answer is an **array** `[{id, installed, version?, modified?}]`, never a keyed object — a hostile but pattern-valid ID like `constructor` must not become an object key anywhere in the pipeline. Every asked (valid) ID appears exactly once; unknown ones as `{id, installed: false}`.
- `version` in a status answer is the *content* version of the imported entry (the SemVer from the exchange format), so the page can compute "update available" itself.
- `modified` is `true | false | 'unknown'` (see section 4).
- Events carry a `requestId` chosen by the page; answers echo it. The page must keep its own timeout (same contract as `gestura:import-result` in 2.8.0).
- **Wire contract, same as the shipped 2.8.0 hand-off:** events are dispatched on and listened to on **`document`** (not `window`), and `detail` is always the **JSON as a string**, never an object — this sidesteps Firefox's Xray/cloneInto handling for cross-realm objects and lets size checks run before parsing (see the rationale comment in `js/content.js`). The new bridge follows that contract; it does not invent a second one.
- **Dev-origin validation** is exact, never substring-based: parse with `new URL(input)`, require `url.origin === input` (rejects paths and trailing slashes), and accept only `https:` or `http:` with hostname `localhost` / `127.0.0.1` — so `http://localhost.attacker.com` never matches.

With integration on, the gestura.eu index can render per entry: *installed / update available / modified locally / not installed*, and its import button reuses the existing inline hand-off — the extension's import dialog remains the trust boundary; there is no import without it.

## 4. Modified status and update check

**Source provenance on every import mode (R1):** today only *new* custom entries persist `source` metadata — replacing a catalog menu goes through `toStandardMenu()` and overriding a built-in engine through `toEngineOverride()` ([js/menu-exchange.js](../../../js/menu-exchange.js)), and both drop the provenance. Status, version, baseline and update check would silently fail for these legitimate import modes. Therefore R1 extends **all** apply paths to persist the same `source` object (`type`, `indexId`, `indexOrigin`, `version`, `baselineHash`) — on custom entries, on edited catalog copies and on engine overrides alike; status/update lookups consult all three storage places.

**Qualified index provenance:** `source.indexId` alone does not prove the entry came from gestura.eu — file imports carry whatever id the file claims (deliberately so, for dedup, since 2.8.0). Disclosure through the bridge and inclusion in the update check therefore require the additional field **`source.indexOrigin`**, which only the extension sets, and only when the payload's origin is verifiable: a website hand-off from an allowed index origin, or a URL import the extension itself fetched from one — judged by the **final `Response.url` after redirects**, never by the URL the user typed. A file import can never prove its origin and gets no `indexOrigin` — it stays fully functional locally (dedup by `indexId` included), it is just never disclosed and never update-checked. Origin-binding rules:

- Matching is always by the pair `(indexOrigin, indexId)` — identical IDs from different indexes are different entries and must not collide.
- **Re-import dedup** for qualified entries uses that pair; file imports keep their existing ID-based dedup.
- The **production update check** includes only entries with `indexOrigin === "https://gestura.eu"`; dev-index entries are checked, if at all, against the dev origin and never leak into the production request.

**Provenance survives mutation:** it is not enough that the resolvers (`menu-model.js`, `engine-registry.js`) pass `source` through — the editors rebuild entries with fixed field lists on save (e.g. `#saveEdit` in [js/components/engine-manager.js](../../../js/components/engine-manager.js)) and would silently drop it, turning an edited import into `installed: false` instead of `modified: true`. The rule: **every mutation path preserves `source` unchanged — editors, context actions, migrations, helpers; only explicitly deleting the entry or resetting it to catalog state removes provenance.** Required test: import → edit → still `installed: true` with `modified: true`.

**Baseline hash (R1):** the hashed object is **not** the original exchange payload — import transforms it (labels reduced to one language, local IDs assigned, Firefox may strip transforms). The baseline is defined as: **the stored runtime entry exactly as the import writes it, after all import transformations, with the `source` object itself excluded**, canonicalized and hashed. `modified` recomputes the same projection later. This makes `modified === false` immediately after import a **required test for every import mode** (new, replace-custom, replace-catalog, engine override, Firefox transform-strip). Entries imported before this feature have no baseline and honestly report `'unknown'` (same migration situation as the 2.8.0 dedup change; re-importing once repairs it).

- **Canonical form** (plain `JSON.stringify` is not stable enough): recursively key-sorted objects, no whitespace, `undefined` properties dropped, `null` kept as `null` — one pure function, shared with the tests, fixed in `docs/gestura-eu-api.md`.
- **Truncation: 64 bits (16 hex characters)** — collision-safe for a local integrity check, gentle on the scarce sync quota.

**Update check (R2):** triggered when the options page opens, throttled to at most once per day — no background alarm, no traffic while settings are closed. `POST /updates` with the `{id, version}` list of entries with qualified index provenance (endpoint exactly as in the July design: answer only for entries with a newer version, including deprecation notices, no account binding). Results become badges on the affected entries; applying an update runs through the existing import dialog with diff. For `transformCode` changes the code diff is shown mandatorily with a fresh confirmation checkbox (July design, section 6, unchanged).

**CORS instead of relying on host permissions:** both manifests already carry `<all_urls>`, but Firefox MV3 does not *grant* host permissions automatically — a background `fetch` to gestura.eu would fail there unless the user has opted in at `about:addons`. Therefore the API contract requires all anonymous endpoints (`/updates`, sync) to send **open CORS headers**: the update check and sync then work on every browser **without depending on any granted host permission** — also cleaner for review. Open CORS is safe here: the endpoints are anonymous, and the sync locator protects as a capability, not the origin. Two details the contract must spell out:

- JSON `POST`/`PUT` requests are **not** CORS simple requests — the browser sends a preflight, so every endpoint must answer `OPTIONS` with `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: POST, PUT, OPTIONS` and `Access-Control-Allow-Headers: Content-Type`.
- Requests from extension contexts carry `Origin: chrome-extension://…` / `moz-extension://…` — the server/reverse proxy (Cloudflare, nginx rules) must not drop these unfamiliar schemes before they reach the API.

## 5. Sync (R3)

### Secret and key derivation

- On sync opt-in the extension generates a **32-byte random secret** (`crypto.getRandomValues`), stored in `storage.local`, displayed as a human-copyable code and as a QR code for pairing a second browser.
- **Code format (part of the API contract, with fixed test vectors):** versioned prefix `GS1-`, then the secret in **Crockford base32** (uppercase, no ambiguous characters), grouped in blocks of four, closed by a **4-character checksum** derived from the secret's SHA-256. Input is forgiving — case-insensitive, separators and whitespace ignored — but a failed checksum is rejected immediately: a typo must produce an error, never a silently different locator that just "sees no states".
- Because the secret has full entropy, **HKDF (native WebCrypto)** suffices — no Argon2, no vendored WASM (simplification over the July design, which needed Argon2 only because it derived from a human passphrase). HKDF-SHA-256 with fixed parameters (part of the API contract): salt = 32 zero bytes (the secret carries the entropy), and distinct info strings derive:
	- the **server locator** — info `"gestura-sync-locator-v1"`: 32 bytes, transmitted as **base64url without padding** (identifies the blob store, sent to the server), and
	- the **AES-256-GCM key** — info `"gestura-sync-key-v1"`: 256 bits (never leaves the client).

	Info strings are UTF-8 encoded; all of this is part of the API contract with fixed test vectors.
- **Ciphertext wire format:** every encryption uses a **fresh random 96-bit IV** (`crypto.getRandomValues`; GCM is fully compromised by IV reuse under the same key), transmitted as `base64(iv[12] ‖ ciphertext+tag)`.
- **Context binding (AAD):** both blobs share one key, so every encryption sets GCM additional authenticated data `"gestura-sync-v1" ‖ stateId ‖ role` (role = `"meta"` or `"payload"`), and the meta blob additionally carries the payload ciphertext's hash — the server cannot swap valid blobs between states or roles without decryption failing. **Server rollback** (serving an older but authentic version of a state) is accepted and outside the threat model: uploads are explicit, states are few, and the preview before import shows what actually arrived.
- The server can never reach the key from the locator. The locator acts as a **bearer capability**: only secret holders can derive it. It travels in the request **body** over TLS, never in the URL, so it stays out of ordinary URL/access logs (a server, WAF or application can of course log request bodies — the deployment must not). Rate limiting per IP applies server-side (July design's RateLimiter).

### Data model and endpoints

- A sync state is the **existing settings export format**, encrypted. Each state consists of **two ciphertexts under the same key**: a small **meta blob** (state name, creation date, extension version — a few hundred bytes) and the **payload blob** (the settings export). Stricter than the July design: the server sees only locator, ciphertexts, sizes and timestamps, not even the user-chosen name. The split exists for the paired second browser: it has no local `stateId` → name mapping, so the list endpoint returns the meta blobs and the client decrypts just those to render *"Work (updated …)"* — without blindly downloading every full payload.
- **State model:** a `stateId` is generated client-side at creation (16 random bytes, hex) and never changes; the upload UI always distinguishes **"create new state"** from **"overwrite state X"**. Names are labels inside the meta blob — duplicates are technically possible, the UI warns. Each browser keeps its local map `euSync.states` (`stateId` → name, last upload hash + date); the *"changed since last upload"* reminder is **per state this browser has uploaded to**, comparing the current settings projection against that state's `lastUploadHash`. A paired browser learns foreign states from `POST /sync/list` via the decrypted meta blobs.
- Endpoints (all anonymous, open CORS, under `/api/v1`):
	- `POST /sync/list` `{locator}` → `[{stateId, size, updatedAt, meta}]` (`meta` = the encrypted meta blob)
	- `PUT /sync/state` `{locator, stateId, meta, payload}` (server enforces per-locator quota: number of states and total size)
	- `POST /sync/get` `{locator, stateId}` → payload ciphertext
	- `POST /sync/delete` `{locator, stateId?}` — one state, or everything for the locator

### UX

- **Named states** ("Work", "Home"), explicit **Upload** / **Download & import** buttons.
- Before every upload a **"What is transferred?" view** shows the complete JSON — Issue #1's transparency requirement. **This view does not exist yet and is R3 work:** today's settings export writes the file immediately (`#exportSettings` in [js/components/options-page.js](../../../js/components/options-page.js)) and the full-settings import is a bare `confirm()` whose validation checks little more than `enableGesture`. R3 therefore explicitly includes: a full settings **export preview**, a **download/import preview**, and a real **settings validator** — one validator, shared between the file import and the sync download (and reused by the file export/import path, which inherits the preview for free). Its ground rules, to be pinned exactly in the settings schema within `docs/gestura-eu-api.md`:
	- a **maximum payload size**;
	- **allowlisted top-level keys** (derived from `DEFAULT_SETTINGS`); unknown keys are dropped and listed in the preview, never written;
	- **nested value types checked** against the expected shapes;
	- keys named `__proto__`, `constructor` or `prototype` are rejected anywhere in the tree;
	- **supported export versions** declared, unknown ones refused with a clear message;
	- the import is **atomic** — one validated write, never partially applied — and **replaces** the settings (today's semantics), no merging;
	- `euIntegration`, `euSync` and the secret are **excluded from export and import** — they live in `storage.local`, are never part of a state, and a crafted file must not be able to flip the switches or plant a secret.
- **Reminder:** hash + date of the last upload are kept locally; the sync section shows an unobtrusive *"changed since last upload"* hint when the current settings hash differs. No notifications, no automation.
- **Secret backup**, offered at generation and available any time in the sync section:
	- **Copy** — the code as a string, for KeePass and friends.
	- **Save as file** — `gestura-sync-secret.txt` via a local blob download (no `downloads` permission needed): a header explaining what the file is, the code, the creation date — next to it the advice: *move it into your password manager and delete the file; whoever holds this code can download, replace and delete your sync states.*
	- **QR** — for pairing the second browser/device. Rendered locally (a tiny vendored generator or hand-drawn matrix — no CDN, same policy as Lit).
	- The secret stays **viewable as long as it exists** — no "shown only once" theater; it lives in `storage.local` anyway, and recoverability matters more here than hiding.
- **Loss and deletion:** losing the secret loses nothing locally — generate a new one and upload the current state. But be honest about the old blobs: **without the old secret the old locator cannot be derived, so the user and the extension can neither address nor delete those blobs** — the server necessarily knows locators and state IDs and removes them itself. They are unreadable ciphertext, and the server side handles them via **retention**: states untouched (no read or write) for 12 months are garbage-collected. The retention period is part of the API contract and named in the privacy text; the UI says it plainly when a new secret is generated over a lost one. The "Delete all sync data on gestura.eu" button covers the normal case — deleting everything under the *current* secret's locator.
- **Account takeover later:** the passkey account from the July design can adopt a sync locator, analogous to the edit-token transfer. Door stays open; nothing of it ships in R3.

## 6. Privacy, stores, repo obligations

- **PRIVACY.md** and the store data declarations (Chrome Web Store data disclosure, AMO) change with R1 (version + import status disclosed to gestura.eu after opt-in) and again with R3 (encrypted user content uploaded). This is part of each release checklist, not an afterthought.
- New i18n keys use the prefixes **`euIntegration*` / `euSync*`** and must land in **all 39 locales**; `tests/site-menu-locales.test.mjs` is extended to cover the new prefixes so the rule stays enforced. No undeclared `$WORD$` in messages (guarded by `tests/locale-placeholders.test.mjs`).
- **Firefox parity:** `js/eu-bridge.js` goes into both `content_scripts` lists (Chrome manifest on `main`, Gecko manifest on `firefox-build`); every new top-level worker dependency goes into `importScripts` **and** `background.scripts`. Check after each merge into `firefox-build`.
- All new UI (integration section, sync panel, consent dialogs) is built as **Lit components**, matching the existing stack; the bridge and crypto helpers are plain classic scripts with `module.exports` where shared with tests. **No build step** — unchanged.
- `transformCode` remains Chrome-only (offscreen sandbox); Firefox imports without the transformation, as regulated in the July design.

## 7. Error handling

- Bridge: malformed events (missing `requestId`, non-array `ids`, oversized payloads) are silently ignored — silence is the uniform failure mode toward pages.
- Update check: network failure or non-200 → no badge changes, retry only on the next throttled occasion; never an error dialog for a background nicety.
- Sync: upload/download errors are shown in the sync panel with a plain retry; a downloaded envelope that fails decryption or validation (shared validator) is rejected with a clear message *before* the import preview — never partially applied. GCM authentication failure is reported as "wrong secret or corrupted data".
- Quota errors from the server (too many states, too large) surface with the concrete limit.

## 8. Relationship to the July design

This document **extends** the July design and **supersedes** it on four points:

1. **Sync identity:** extension-generated secret + HKDF instead of passkey account + sync passphrase + Argon2. The account (passkey, UUID, no email) stays as designed for submissions/ratings and can adopt the sync later.
2. **State names are encrypted** inside the envelope; the July design let the server see them.
3. **A master switch now gates the anonymous update check too** — the July design had no switch; "no contact by default" is the stricter rule and wins.
4. **The operator button is gated by the master switch as well:** all website-triggered import paths are inert while tier 1 is off. The July design (and shipped 2.8.0) had them always active; only manual file/URL imports inside the extension stay unconditional.

Everything else (exchange format, the operator button's mechanics, index, moderation, `transformCode` rules, account section, admin) remains as approved on 2026-07-19.

## 9. Testing (vitest, as in the existing suites)

Pure functions, framework-free:

- **Bridge:** origin check (gestura.eu yes, others no, dev origin only when configured), switch off = no answer **and no reaction to any website-triggered import path**, `query-status` never answers beyond the asked IDs, never for entries without qualified provenance (**a file import with a matching `indexId` is not disclosed**); origin binding (an entry imported from the dev index is invisible to gestura.eu and vice versa — matching by `(indexOrigin, indexId)` pair); `requestId` echo; limits enforced (ID count, ID pattern, `requestId` length — violations get silence); a pattern-valid hostile ID like `constructor` stays harmless (array answers); unknown IDs come back as `installed: false`.
- **Modified status:** baseline hash write on import, `true`/`false`/`'unknown'` computation, normalization stability (same entry → same hash), and **`modified === false` immediately after every import mode** (new, replace-custom, replace-catalog, engine override, Firefox transform-strip).
- **Provenance:** every import mode persists `source` (custom, edited catalog copy, engine override); `indexOrigin` is set for hand-off/URL imports from an allowed index origin and never for file imports; import → edit → still `installed: true` with `modified: true` (mutation paths preserve `source`).
- **Secret code:** encode/decode roundtrip against the fixed test vectors; checksum rejects a typo; case and separators are forgiven.
- **Crypto:** HKDF derivation is deterministic and locator ≠ key; meta and payload encrypt/decrypt roundtrip; every encryption produces a distinct IV; decryption failure on wrong secret; the state name appears only inside the encrypted meta blob; blobs swapped between roles or states fail AAD authentication.
- **Canonicalization:** key order and whitespace never change the hash; `undefined` vs. missing property is identical; `null` is preserved.
- **Consent:** version + date stored on enable; the `effectiveEnabled` invariant (`enabled` with a stale `consent.version` authorizes nothing); re-prompt logic when the consent version rises; a website-triggered import pending in the dialog sends no result after the switch goes off.
- **Update check:** request body contains exactly the `{id, version}` pairs of entries with qualified provenance — file imports never appear; throttling.
