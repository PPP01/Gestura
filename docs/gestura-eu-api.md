# gestura.eu ↔ Gestura API contract

This file is the versioned contract between the Gestura extension and the
gestura.eu index. It is copied into the `gestura-index` repository; changes are
made here first. Design rationale lives in
[the integration design](superpowers/specs/2026-09-02-gestura-eu-integration-design.md).

**apiLevel: 1** (R1). The index must tolerate every older extension: no answer
is indistinguishable from "not installed" and must be handled as such. R2 adds
the update endpoint and R3 the sync endpoints to this file.

## Bridge (page → extension, DOM events)

- Events are dispatched on and listened to on `document`.
- `detail` is always the request as a **JSON string** (never an object).
- The extension answers **only** when the user has enabled *gestura.eu
  integration* with a current consent, **and** `location.origin` of the frame is
  `https://gestura.eu` or the user's single configured developer origin.
  Everything else — off, wrong origin, malformed request, over limit — is
  silence. There is no error event.

| Request event | Answer event | Answer body |
|---|---|---|
| `gestura:hello` `{ requestId }` | `gestura:hello-result` | `{ requestId, version, apiLevel }` |
| `gestura:query-status` `{ requestId, ids }` | `gestura:query-status-result` | `{ requestId, entries }` |
| `gestura:import` (hand-off, since 2.8.0) | `gestura:import-result` | `{ status, menus, engines }` |

Limits (violations → silence): `detail` ≤ 32 KiB UTF-8, checked before parsing;
`requestId` string ≤ 64 chars; `ids` array ≤ 100 strings, each matching
`^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$` and ≤ 128 chars.

`entries` is an **array**: `[{ id, installed: true, version, modified }, { id, installed: false }]`.
Every asked id appears exactly once (duplicates collapsed); `version` is the
content version the entry was imported with (may be `null`); `modified` is
`true | false | "unknown"` (`"unknown"` = imported before baselines existed).
Only entries imported from **the asking origin** are ever reported; file
imports and other origins' entries answer `installed: false`.

Example:

```js
document.addEventListener('gestura:query-status-result', (e) => {
	const { requestId, entries } = JSON.parse(e.detail);
});
document.dispatchEvent(new CustomEvent('gestura:query-status', {
	detail: JSON.stringify({ requestId: crypto.randomUUID(), ids: ['com.example.shop'] }),
}));
// Keep your own timeout: silence is a legitimate outcome.
```

## Hand-off (page → extension, import)

Two paths, both requiring a **trusted click** and both gated exactly like the
bridge: the switch on with a current consent, **and** the acting frame's own
origin `https://gestura.eu` or the configured developer origin. The origin is
checked in the content script and again in the extension's trusted context from
`sender.url`, so a runtime message that did not come from the content script is
refused too. On any other origin both paths are inert — the click behaves as if
the extension were not installed.

Opening the hand-off to third-party origins is intended to become its own opt-in
with its own warning. Until that switch exists, no origin but the two above can
hand anything over, and the format below is documentation rather than a public
interface.

- **By link:** `<a rel="gestura-menu" href="…">`. The `href` must be same-origin
  with the page; the extension fetches it, follows redirects, and judges
  provenance by the **final** URL. Cap 100 KB.
- **Inline:** a trusted click on `[data-gestura-inline]` opens a 15-second window
  in which the page dispatches `gestura:import` on `document` with the bundle as
  a **JSON string**. The extension fetches nothing on this path. Cap 1 MB.

**CORS applies to the link path.** Both manifests carry `<all_urls>`, but Firefox
MV3 does not *grant* host permissions automatically: until the user opts in at
`about:addons`, the extension's `fetch` is an ordinary cross-origin request from
`moz-extension://…`. The JSON served for a `rel="gestura-menu"` link must
therefore answer with `Access-Control-Allow-Origin: *` (a `GET` of a static JSON
file needs no preflight), and a reverse proxy must not drop the unfamiliar
`chrome-extension://` / `moz-extension://` origin before it reaches the file.
Without that header the link path fails silently on Firefox while working on
Chrome — the inline path is unaffected, because there the page does the fetching.
This applies to a developer origin as well: a local index has to send the header
to be testable in Firefox.

## Provenance

An imported entry stores `source = { type, url?, version, indexId, indexOrigin?, baselineHash? }`.

- `indexId` is the exchange-format id the payload claimed — any file can claim any id.
- `indexOrigin` is set **only by the extension**, and only when the payload's
  origin is verifiable: a website hand-off from an allowed origin, or a URL
  import whose final `Response.url` (after redirects) is on an allowed origin.
  File imports never get one. Disclosure through the bridge requires
  `indexOrigin === location.origin`.
- Entries are identified by the pair `(indexOrigin, indexId)`. Re-import
  matching: a qualified import matches only the same pair; an unqualified import
  matches only unqualified entries and never overwrites a qualified one; any
  ambiguity is imported as a new entry.

## Baseline and canonical form

`baselineHash` = first 16 hex chars (64 bits) of SHA-256 over the canonical
JSON of the stored entry **after** all import transformations, with the `source`
object removed. Canonical JSON: objects with keys sorted recursively, no
whitespace, `undefined` properties dropped, `null` kept, arrays in order
(`undefined` elements become `null`). `modified` = current canonical hash ≠ baseline.

## Consent versions

| Version | Scope |
|---|---|
| 1 | Website hand-offs to the import dialog; bridge `hello` / `query-status` (version and per-entry status to the asking allowed origin). |

A stored consent below the current version disables the integration until the
user confirms again.

## Developer origin

Exactly one, validated as `new URL(input).origin === input` and either `https:`
or `http:` with hostname `localhost` / `127.0.0.1`. It is treated like
`https://gestura.eu` for the bridge and for provenance, and never ships enabled.
