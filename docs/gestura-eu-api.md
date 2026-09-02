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
- The extension answers **only** when the user has enabled *Website
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
