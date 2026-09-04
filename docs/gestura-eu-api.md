# gestura.eu ↔ Gestura API contract

This file is the versioned contract between the Gestura extension and the
gestura.eu index. It is copied into the `gestura-index` repository; changes are
made here first. Design rationale lives in
[the integration design](superpowers/specs/2026-09-02-gestura-eu-integration-design.md).

**apiLevel: 3** (R3). The index must tolerate every older extension: no answer
is indistinguishable from "not installed" and must be handled as such, an
extension at level 1 never calls `/api/v1/updates`, and one below level 3 never
calls any `/api/v1/sync/*` endpoint. Levels are additive — nothing that
answered at level 2 changes shape at level 3.

Within a level, a **request** field may be added when its absence keeps the old
behaviour exactly. `basePayloadHash` (below) is such a field: an extension that
never sends it is served as it was before the field existed, so the addition
needs no new level.

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
	"apiLevel": 3,
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
	"apiLevel": 3,
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
access logs — *the deployment must not log request bodies.* For the same reason
the server **stores only a hash of it** (SHA-256 is enough — the locator is 256
uniform bits, so no salt is needed) and looks states up by that hash: access to
the database must not amount to the right to list or delete anyone's states.
The ciphertext would still be unreadable, but it could be taken away.

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
- **Plaintext of `payload`:** either the settings JSON or its **gzip**,
  recognised by the gzip magic `1f 8b` at the start of the decrypted bytes. A
  JSON object begins with `{` (`0x7b`), so the test is unambiguous and there is
  no format field. `meta` is never compressed. The test vectors below are
  unaffected — they use `role = meta`. Implementations **must bound
  decompression** (the extension stops at 1 MiB and reports the blob as
  undecryptable); the server cannot plant a gzip bomb, because GCM
  authenticates the ciphertext, but a code handed over by a third party can.

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

That paragraph is about the **server**. Two **clients** writing the same state
are a different matter, and one the client cannot solve alone: the
`payloadHash` binds the two blobs of *one* upload to each other, never an
upload to the state it replaces. Without help from the server, the second
browser to press *Overwrite* silently discards the first one's work, and nobody
learns of it. The endpoint therefore takes a **write token**, below.

**The write token is the `payloadHash` of the state being replaced.** It needs
no field of its own on the server: the server recomputes it over the payload
bytes it stores, and the client already holds it — it is in the meta blob it
decrypted when it listed or opened the state. It works as a token because
**every encryption uses a fresh IV**, so two uploads of byte-identical settings
still produce different payloads and different hashes. That is a property of
the envelope, not a coincidence, and it is what makes a hash usable where a
version counter would otherwise be needed.

## Sync — endpoints

All under `/api/v1`, all anonymous, all with the locator in the body. Request
bodies always carry `apiLevel`.

| Endpoint | Body | Answer |
|---|---|---|
| `POST /api/v1/sync/list` | `{ apiLevel, locator }` | `{ states: [{ stateId, size, updatedAt, meta }] }` |
| `PUT /api/v1/sync/state` | `{ apiLevel, locator, stateId, meta, payload, basePayloadHash? }` | `{ stateId, updatedAt, size }` |
| `POST /api/v1/sync/get` | `{ apiLevel, locator, stateId }` | `{ stateId, updatedAt, payload }` |
| `POST /api/v1/sync/delete` | `{ apiLevel, locator, stateId }` — `stateId` omitted deletes every state under the locator | `{ deleted: <count> }` |

`size` is the payload envelope's length in bytes as transmitted; `updatedAt` is
an ISO-8601 UTC timestamp. `meta` and `payload` are the base64 envelope strings.

**`basePayloadHash` — what the upload is built on.** Base64url `SHA-256` over
the raw bytes of the payload envelope currently stored, i.e. the same value the
replaced state's meta blob carries. Three cases, and the first is what keeps
older extensions working:

| `basePayloadHash` | Server does |
|---|---|
| absent | Writes unconditionally, exactly as before. This is how a **new** state is created, and how a client that has seen the conflict says *overwrite anyway*. |
| present, matches the stored payload | Writes. |
| present, does not match | Refuses with **412** and `{ "error": "conflict", "updatedAt": "<ISO-8601>" }`. Nothing is written. |

The `updatedAt` in the refusal is there so the client can say *when* the state
changed under it without a second request; it then re-reads the state and lets
the user decide.

**This does not merge anything.** It makes a lost write visible instead of
silent, and it is the precondition for merging later: a client can only merge
if it can be told "your base is stale" and try again. Merging itself needs
per-entry versions and deletion markers inside the payload, and is deliberately
not part of `apiLevel` 3.

**`POST /api/v1/sync/delete` stays unconditional** and takes no token. Deleting
is a deliberate act behind a confirmation, and unlike a silent overwrite it is
one the user is looking at while it happens.

**Errors** answer with an HTTP status and `{ "error": "<code>" }`:

| Code | Status | Meaning |
|---|---|---|
| `bad-request` | 400 | Malformed body, unknown `apiLevel`, bad `stateId` or locator shape. |
| `not-found` | 404 | No such state under this locator. |
| `conflict` | 412 | `basePayloadHash` does not describe the stored state — someone else wrote it first. The answer carries the current `updatedAt`. |
| `too-large` | 413 | A single blob exceeds its limit. |
| `quota-states` | 409 | The locator already holds the maximum number of states. |
| `rate-limited` | 429 | Per-IP rate limit on requests and on bytes written (the July design's RateLimiter). |

**What protects the quota.** Locators are free and unlimited — 32 random bytes,
no registration, no account — so anyone treating the service as free blob
storage simply derives more of them. The per-locator limits below are
therefore *not* an abuse bound and should not be read as one. What bounds the
cost is the **per-IP rate limit** on bytes written and the **12-month
retention**. If abuse ever appears, the levers in order are: tighten the
per-IP write limit, shorten retention, lower the per-locator total, and only
then proof of work on a registration call.

**Limits**, enforced server-side and mirrored client-side so the user sees the
number before the request rather than after it:

| Limit | Value |
|---|---|
| `meta` envelope | 8 KiB as transmitted |
| `payload` envelope | 512 KiB as transmitted |
| states per locator | 5 |
| total per locator | 4 MiB |

`5 × 512 KiB + 5 × 8 KiB` fits inside the 4 MiB total; the table cannot
contradict itself. **The state limit is checked on create only, never
retroactively:** a locator holding more states than the limit — after the
limit was lowered — keeps all of them; reading, writing and deleting stay
possible, only a further create is refused with `quota-states`. There is no
`locator-full` code: with per-state limits the total is unreachable by
construction.

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
- **Maximum size:** 1 MiB of JSON text — the extension's local settings
  ceiling. The 512 KiB `payload` limit above is a limit on the *envelope* as
  transmitted; compression sits between the two numbers.
- The import is **atomic and replacing**: one validated write of the whole
  settings object, never a partial application, never a merge.

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

The **Sync** switch has a consent of its own, and tier 1 must be enabled with a
current consent for tier 2 to authorize anything:

| Sync version | Scope |
|---|---|
| 1 | Encrypted settings states are stored on gestura.eu under a locator derived from a secret only this browser holds. The server sees ciphertext, sizes and timestamps — not the state names, not the settings. Upload and download are explicit clicks; before every upload the complete content is shown. |

## Developer origin

Exactly one, validated as `new URL(input).origin === input` and either `https:`
or `http:` with hostname `localhost` / `127.0.0.1`. It is treated like
`https://gestura.eu` for the bridge and for provenance, and never ships enabled.
