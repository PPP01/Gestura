# gestura.eu ↔ Gestura API contract

This file is the versioned contract between the Gestura extension and the
gestura.eu index. It is copied into the `gestura-index` repository; changes are
made here first. Design rationale lives in
[the integration design](superpowers/specs/2026-09-02-gestura-eu-integration-design.md).

**apiLevel: 2** (R2). The index must tolerate every older extension: no answer
is indistinguishable from "not installed" and must be handled as such, and an
extension at level 1 never calls `/api/v1/updates` at all. R3 adds the sync
endpoints to this file.

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

## Update check (`POST /api/v1/updates`)

Anonymous, no account, no identifier. Sent **only** while *gestura.eu
integration* is on with a current consent, at most **once per 24 hours per
origin**, and only when the user opens the extension's settings — there is no
background alarm and no traffic while the settings are closed.

**One request per index origin.** Entries are grouped by `source.indexOrigin`:
production entries go to `https://gestura.eu` and dev-index entries to the
configured developer origin. Neither ever appears in the other's request.
Entries without `indexOrigin` — every file import — appear in none.

Request body:

```json
{
	"apiLevel": 2,
	"entries": [
		{ "id": "eu.example.shop", "version": "1.2.0" },
		{ "id": "eu.example.search", "version": null }
	]
}
```

- **Id and version, and nothing else.** Whether an entry is a menu or a search
  engine is information about the user's setup, and ids are unique across both in
  the index, so the kind is not needed to look one up. The client keeps it locally
  and uses it to check the answer (below).
- `version` is the content version the entry was imported with, or `null` when
  the entry carries none (imported before versions were recorded). `null` means
  "tell me the current version"; the client decides for itself whether that
  differs from what it stores.
- **The endpoint must not redirect.** The client sends `redirect: "error"`,
  because a `307`/`308` preserves method *and* body: a redirect off the index
  would forward these ids and versions to whatever origin it names, and that
  origin can answer the preflight permissively. A `3xx` is therefore a failed
  check, not a hop.

Answer — **only** entries that have something to say (a newer version, a
deprecation, or both). Everything up to date is simply absent:

```json
{
	"apiLevel": 2,
	"updates": [
		{
			"id": "eu.example.shop",
			"type": "menu",
			"version": "1.3.0",
			"url": "https://gestura.eu/api/v1/menus/eu.example.shop/1.3.0",
			"changelog": "Two new patterns for /cart",
			"deprecated": false,
			"successor": null
		}
	]
}
```

- `type` is `"menu"` or `"engine"` and is **checked against the kind the client
  asked about**: an answer that calls a menu an engine is dropped. This is the
  only reason `type` is in the protocol, and it is why it travels in the answer
  rather than in the request.
- `version` must be a numeric triple (`\d{1,5}\.\d{1,5}\.\d{1,5}`, the same
  `SEMVER_RE` the exchange format enforces) and is compared **numerically**
  against what the entry stores. Merely differing is not enough: after a manual
  import of `1.4.0`, an answer still naming `1.3.0` must not be offered as an
  update.
- `url` is where the entry's exchange JSON for that version can be fetched. It
  **must** be on the same origin that answered; the extension drops any result
  whose `url` points elsewhere. When the user then adopts the update, the
  extension checks the **final** URL after redirects against that same origin and
  refuses the import if it moved — so the guarantee holds at download time too,
  not only for the URL the answer announced.
- `changelog` is optional plain text, no markup, truncated to 1000 characters by
  the client.
- `deprecated: true` says the index no longer maintains the entry. It may appear
  with an unchanged `version`, and `successor` may name the entry that replaces
  it.
- An empty `updates` array is the normal, healthy answer.

**Validation on the client — strict on the envelope, lenient on the element.**
A non-200 status, a body over 256 KiB, unparseable JSON, or a missing/non-array
`updates` makes the whole answer invalid: the origin's cache slot, `checkedAt`
included, stays exactly as it was, so **a network error does not start the
24-hour window** and the next settings open tries that origin again. A single
malformed *element* is dropped and the rest of the answer is kept — an element
naming a `type` a future level introduces must not invalidate today's answer.
Elements are dropped when: the `id` was not asked for, it repeats, `type` is
missing or disagrees with the kind that id was asked about, `version` is not a
numeric triple, or `url` is unparseable or not on the answering origin. At most
200 elements.

The response is read under the same abort timer as the request — `fetch` resolves
on the response *headers*, so a body that arrives slowly forever would otherwise
hang the check indefinitely. A `Content-Length` above the cap is an early exit;
because a chunked answer declares none, the byte count on the received text is
the actual limit and the timer is what bounds the rest.

**CORS.** Both manifests carry `<all_urls>`, but Firefox MV3 does not *grant*
host permissions automatically, so until the user opts in at `about:addons` this
is an ordinary cross-origin request from `moz-extension://…`. A JSON `POST` is
not a CORS simple request, so the endpoint must answer `OPTIONS` with:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

and the reverse proxy must not drop the unfamiliar `chrome-extension://` /
`moz-extension://` `Origin` before it reaches the API. Open CORS is safe here:
the endpoint is anonymous and returns only public index data.

**Result cache** (`chrome.storage.local`, key `euUpdates`), kept per origin — one
shared `checkedAt` could not express "production answered, the dev index was
down":

```json
{
	"origins": [
		{
			"origin": "https://gestura.eu",
			"checkedAt": "2026-09-02T15:04:05.000Z",
			"results": [ { "id": "…", "type": "menu", "version": "1.3.0", "url": "…" } ]
		}
	]
}
```

An array, not origin-keyed objects — no arbitrary strings as object keys. A
validated answer replaces only its own origin's slot, so badges survive closing
the settings instead of vanishing behind the throttle window. Withdrawing consent
or switching the integration off deletes the whole key; changing or clearing the
developer origin deletes that origin's slot.

A badge is shown when the cached result's `version` differs from what the entry
stores **now**, or when it is `deprecated`. Comparing against the stored version
rather than trusting the server's "newer" is what makes a badge disappear the
moment the user adopts the update, instead of at the next check.

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
| 2 | Everything in 1, plus the anonymous update check: when the settings are opened, at most once a day per origin, Gestura sends the ids and versions of the entries imported from that origin. |

A stored consent below the current version disables the integration until the
user confirms again.

## Developer origin

Exactly one, validated as `new URL(input).origin === input` and either `https:`
or `http:` with hostname `localhost` / `127.0.0.1`. It is treated like
`https://gestura.eu` for the bridge and for provenance, and never ships enabled.
