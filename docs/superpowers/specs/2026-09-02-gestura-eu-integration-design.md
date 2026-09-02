# Design: gestura.eu Integration — Master Switch, Bridge, Status API, E2E Sync

- **Date:** 2026-09-02
- **Status:** approved by the user (brainstorming completed)
- **Extends:** [2026-07-19-menu-index-design.md](2026-07-19-menu-index-design.md) (the index design). This document adds the extension ↔ gestura.eu integration layer and refines the sync identity model; where the two disagree, this document wins (see section 8).
- **Related:** [Issue #1 — Export zu gestura](https://github.com/PPP01/Gestura/issues/1) (full transparency: the user must always be able to see the complete export/import; private data readable by no one else).

## Goals

1. A **master switch, off by default** — with it off, the extension is fully standalone and has zero contact with gestura.eu, exactly as before 2.8.0.
2. With integration enabled, gestura.eu pages can see that Gestura is installed, its version, and — per entry they ask about — whether it is installed, which version, and whether the user modified it (status only, never the modification itself).
3. Direct import from gestura.eu by button, with the page learning the outcome (already shipped in 2.8.0; this design adds the status display around it).
4. Update notices for imported entries, on gestura.eu and in the options page.
5. **E2E-encrypted settings sync between browsers** via gestura.eu — as simple as possible: no login, no passphrase, an extension-generated secret.

## Non-goals

- No auto-sync (explicit upload/download only; a reminder flag, nothing more).
- No account requirement anywhere. The passkey account from the July design stays a later, optional layer.
- No exposure of the user's own or non-index entries through the bridge — the page only ever learns about IDs it asked for.
- No change to the operator-button import from 2.8.0 (see the confirmed assumption in section 2).
- No transmission of modification *content* — only the boolean status.

## Key decisions (made during brainstorming)

| Decision | Choice |
|---|---|
| Page ↔ extension channel | **DOM-event bridge** (like the 2.8.0 hand-off), not `externally_connectable` — one code path for Chrome/Edge/Firefox (Firefox does not support `externally_connectable`). |
| Direction | **Pull only:** the page asks, the extension answers. The extension never announces itself. |
| Switch model | **Two tiers:** "gestura.eu integration" (bridge + update check) and, beneath it, "Sync" — each with its own consent text. |
| Switch storage | **`chrome.storage.local`** — each browser consents on its own; enabling never propagates silently via browser sync. |
| Sync identity | **Extension-generated secret** (32 random bytes). HKDF derives a server locator and the encryption key separately. No login, no passphrase. The passkey account can take over the sync later (like the edit-token transfer in the July design). |
| Sync mode | **Explicit, named states + reminder:** upload / download buttons, multiple named states, plus a local "changed since last upload" hint. No auto-sync, no conflict resolution needed. |
| Rollout | **Design everything now, ship stepwise** (R1–R3 below). Store review happens per release; sync ships only when the server side exists. No dark-launched sync code in earlier releases. |

## 1. Scope and releases

Three release stages, each shippable on its own; none waits on the server:

- **R1 — Foundation:** both switches + consent UI, bridge protocol (`hello`, `query-status`), baseline hash written on import (feeds the modified status). Fully testable against the dev index.
- **R2 — Updates:** anonymous update check (`POST /updates` from the July design) + update badges in the options page. Needs the live endpoint.
- **R3 — Sync:** E2E sync with named states, reminder, secret backup. Needs the sync endpoints.

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
		"lastUpload": { "hash": "…", "date": "…" }
	}
}
```

- **Tier 1 — "gestura.eu integration"** (default off) gates: bridge answers, the update check, and the visibility of the sync section. Consent text (informing, not warning) lists concretely: *the extension version and the status of entries imported from gestura.eu are disclosed to gestura.eu pages on request; update requests carry the IDs and versions of imported entries — anonymous, no account.*
- **Tier 2 — "Sync"** (default off, only visible while tier 1 is on) with its own consent: *encrypted settings states are transferred to gestura.eu; only you can read them; before every upload you see in full what is transferred* (Issue #1).

Turning tier 1 off stops all communication immediately; imported entries stay (they are local data). Turning tier 2 off stops sync; the secret is kept unless the user explicitly deletes it (so re-enabling does not orphan server blobs).

**Confirmed decision:** the 2.8.0 operator-button import (trusted click → import dialog, `gestura:import` / `gestura:import-result`) stays available **regardless of the switch** — it only ever contacts the operator's own origin, never gestura.eu, and is shipped behavior. The switch gates gestura.eu communication exclusively. "No direct imports" means: no import without the dialog — that holds for everyone, always, switch or no switch.

## 3. The bridge (page ↔ extension)

A DOM-event protocol like the existing hand-off — one code path for Chrome, Edge and Firefox. New content script **`js/eu-bridge.js`**, inserted at the right position of the load-ordered `content_scripts` list (both manifests, see section 6).

The bridge answers **only** when tier 1 is on **and** `location.origin` is on the origin list:

- `https://gestura.eu` (hard-coded), plus
- optionally **one** dev origin from a "developer origin" text field in the integration section (default empty; accepts only `https:` origins or `http://localhost[:port]`). No shipped allowlist containing localhost.

No answer = indistinguishable from "not installed" — intended, and the anti-fingerprinting property of the design: a page that is not gestura.eu (or the switch being off) gets silence, not a refusal.

| Event (page →) | Answer (→ page) |
|---|---|
| `gestura:hello {requestId}` | `{requestId, version, apiLevel: 1}` |
| `gestura:query-status {requestId, ids: […]}` | `{requestId, entries: {id: {installed, version, modified}}}` |
| `gestura:import` → `gestura:import-result` | exists since 2.8.0, unchanged |

Rules:

- `query-status` answers **only for the IDs asked about**, and only for entries whose `source.indexId` matches. The extension never enumerates or reveals what else the user has (own menus, entries from other sources). One batched call per page view is the expected usage.
- `version` in a status answer is the *content* version of the imported entry (the SemVer from the exchange format), so the page can compute "update available" itself.
- `modified` is `true | false | 'unknown'` (see section 4).
- Events carry a `requestId` chosen by the page; answers echo it. The page must keep its own timeout (same contract as `gestura:import-result` in 2.8.0).

With integration on, the gestura.eu index can render per entry: *installed / update available / modified locally / not installed*, and its import button reuses the existing inline hand-off — the extension's import dialog remains the trust boundary; there is no import without it.

## 4. Modified status and update check

**Baseline hash (R1):** on import, a truncated SHA-256 of the normalized payload is written into the entry's `source` metadata (short hex string — sync quota is scarce). `modified` = current entry, normalized the same way, no longer hashes to the baseline. Entries imported before this feature have no baseline and honestly report `'unknown'` (same migration situation as the 2.8.0 dedup change; re-importing once repairs it).

**Update check (R2):** triggered when the options page opens, throttled to at most once per day — no background alarm, no traffic while settings are closed. `POST /updates` with the `{id, version}` list of index-sourced entries (endpoint exactly as in the July design: answer only for entries with a newer version, including deprecation notices, no account binding). Results become badges on the affected entries; applying an update runs through the existing import dialog with diff. For `transformCode` changes the code diff is shown mandatorily with a fresh confirmation checkbox (July design, section 6, unchanged).

**CORS instead of host permissions:** Firefox MV3 does not grant host permissions automatically — a background `fetch` to gestura.eu would fail there without a user-granted permission. Therefore the API contract requires all anonymous endpoints (`/updates`, sync) to send **open CORS headers** (`Access-Control-Allow-Origin: *`). Then neither the update check nor sync needs any host permission on any browser — also cleaner for review. Open CORS is safe here: the endpoints are anonymous, and the sync locator protects as a capability, not the origin.

## 5. Sync (R3)

### Secret and key derivation

- On sync opt-in the extension generates a **32-byte random secret** (`crypto.getRandomValues`), stored in `storage.local`, displayed as a human-copyable code (base32-grouped) and as a QR code for pairing a second browser.
- Because the secret has full entropy, **HKDF (native WebCrypto)** suffices — no Argon2, no vendored WASM (simplification over the July design, which needed Argon2 only because it derived from a human passphrase). HKDF with distinct info strings derives:
	- the **server locator** (identifies the blob store, sent to the server), and
	- the **AES-256-GCM key** (never leaves the client).
- The server can never reach the key from the locator. The locator acts as a **bearer capability**: only secret holders can derive it. It travels in the request **body** over TLS, never in the URL, so it stays out of server/proxy logs. Rate limiting per IP applies server-side (July design's RateLimiter).

### Data model and endpoints

- A sync state is the **existing settings export format**, wrapped in an encrypted envelope. The envelope content includes the **state name** — stricter than the July design: the server sees only locator, ciphertext, size and timestamps, not even the user-chosen name.
- Endpoints (all anonymous, open CORS, under `/api/v1`):
	- `POST /sync/list` `{locator}` → `[{stateId, size, updatedAt}]`
	- `PUT /sync/state` `{locator, stateId, ciphertext}` (server enforces per-locator quota: number of states and total size)
	- `POST /sync/get` `{locator, stateId}` → ciphertext
	- `POST /sync/delete` `{locator, stateId?}` — one state, or everything for the locator

### UX

- **Named states** ("Work", "Home"), explicit **Upload** / **Download & import** buttons.
- Before every upload a **"What is transferred?" view** shows the complete JSON (reuses the export preview) — Issue #1's transparency requirement. Downloads run through the existing import path with preview.
- **Reminder:** hash + date of the last upload are kept locally; the sync section shows an unobtrusive *"changed since last upload"* hint when the current settings hash differs. No notifications, no automation.
- **Secret backup**, offered at generation and available any time in the sync section:
	- **Copy** — the code as a string, for KeePass and friends.
	- **Save as file** — `gestura-sync-secret.txt` via a local blob download (no `downloads` permission needed): a header explaining what the file is, the code, the creation date — next to it the advice: *move it into your password manager and delete the file; whoever holds this code can download your sync states.*
	- **QR** — for pairing the second browser/device. Rendered locally (a tiny vendored generator or hand-drawn matrix — no CDN, same policy as Lit).
	- The secret stays **viewable as long as it exists** — no "shown only once" theater; it lives in `storage.local` anyway, and recoverability matters more here than hiding.
- **Loss and deletion:** losing the secret loses nothing locally — generate a new one, upload the current state, delete the old blobs ("Delete all sync data on gestura.eu" button; the old ciphertext is unreadable to everyone anyway).
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

This document **extends** the July design and **supersedes** it on three points:

1. **Sync identity:** extension-generated secret + HKDF instead of passkey account + sync passphrase + Argon2. The account (passkey, UUID, no email) stays as designed for submissions/ratings and can adopt the sync later.
2. **State names are encrypted** inside the envelope; the July design let the server see them.
3. **A master switch now gates the anonymous update check too** — the July design had no switch; "no contact by default" is the stricter rule and wins.

Everything else (exchange format, operator button, index, moderation, `transformCode` rules, account section, admin) remains as approved on 2026-07-19.

## 9. Testing (vitest, as in the existing suites)

Pure functions, framework-free:

- **Bridge:** origin check (gestura.eu yes, others no, dev origin only when configured), switch off = no answer, `query-status` never answers beyond the asked IDs, never for non-index entries; `requestId` echo.
- **Modified status:** baseline hash write on import, `true`/`false`/`'unknown'` computation, normalization stability (same entry → same hash).
- **Crypto:** HKDF derivation is deterministic and locator ≠ key; envelope encrypt/decrypt roundtrip; decryption failure on wrong secret; state name is inside the ciphertext.
- **Consent:** version + date stored on enable; re-prompt logic when the consent version rises.
- **Update check:** request body contains exactly the index-sourced `{id, version}` pairs; throttling.
