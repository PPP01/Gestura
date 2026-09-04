# Design: moving the settings out of `chrome.storage.sync`

- **Date:** 2026-09-04
- **Status:** approved by the user (brainstorming completed)
- **First of two.** The second (`2026-09-04-sync-reconciliation-design.md`)
  designs the three-way reconciliation between two browsers. This document
  needs nothing from it; the second builds on two parts of this one —
  `buildExport(..., { forSync: true })` (§7) and gzip (§8) — and ships after
  it. They are separate because this one relieves pain users have today and
  must not wait for the other.
- **Reviewed 2026-09-04** against the code; the review's corrections are folded
  in (the façade's `onChanged` and `reset`, the adopt rule for device-local
  keys, the switch sequence, the page registration list, the 5 MB floor of
  `storage.local`, and the numbers).
- **Builds on:** [2026-08-30-speicheranzeige-design.md](2026-08-30-speicheranzeige-design.md),
  which called this "Vorhaben zwei" and already carries the split that makes it
  cheap. `js/storage-usage.js` is inherited unchanged.
- **Amends the contract:** [docs/gestura-eu-api.md](../../gestura-eu-api.md) —
  section 9 below lists every change.

## 1 · Goal and occasion

Settings live in `chrome.storage.sync`, where **8192 bytes per item** is the
binding limit and every top-level branch is one item. `siteMenus` is one branch.
An imported menu with ten entries weighs about 1750 B, so three or four fill it.
Measured: a menu averages **1001 B** (`AVG_FALLBACK.menu` in
`js/storage-usage.js` — one number, in one place), and the entire built-in catalogue — 15
menus and 27 search engines — fully edited into storage weighs **18 KB**, more
than twice what one branch can hold.

The storage display makes that limit visible. This document makes it **optional**.

Reached when:

- the settings can grow past 8192 B per branch for users who choose it;
- a user who never chooses it is not affected in any way — same storage, same
  API, same limits, no migration;
- hitting the limit is a **decision with three named ways out**, not a failed
  save with a generic message;
- what can be stored can also be exported, uploaded, downloaded and imported —
  one ceiling, true at all four doors;
- browser sync and gestura.eu sync can never run at the same time.

**Non-goal:** reconciling two browsers' settings. That is the second document.
Until it ships, the conflict protection of `a32f7df` keeps a lost write visible
rather than silent, which is what makes the wait safe.

## 2 · The one decision: one storage area at a time

The original intent was `storage.local` as the read model with `storage.sync`
kept in step beside it. That is rejected. Writing both at once brings four
problems that exist **only** because both are written:

- which one wins on load when they diverge (a browser that was offline);
- what a save means whose local half succeeded and whose mirror failed (hourly
  write quota, no network);
- every key counts twice against both quotas;
- and a migration for every existing user.

Instead: **exactly one area is active, and one switch selects it.**

| | browser sync **on** | browser sync **off** |
|---|---|---|
| read and written | `chrome.storage.sync` — **today, unchanged** | `chrome.storage.local` |
| ceiling | 8192 B per branch, checked by us *before* the browser rejects | 1 MiB total |
| `storage.sync` | the truth | left in place, going stale, plus the note of §4 |
| gestura.eu sync | refused | available |

The gain is not elegance, it is risk: the state "browser sync on" is not *almost*
today, it **is** today — the same API, the same store, the same limits. No
existing user can lose anything to this rebuild, and there is **no migration
step at all**. The one-time copy `sync → local` happens at the moment *that*
user switches. A user who never switches never notices the rebuild happened.

The price is real and is accepted: **the way back is conditional.** With 300 KB
in `storage.local`, turning browser sync back on cannot work. The switch checks
and refuses, naming the numbers, at a point where the user is deliberately
clicking — rather than losing data silently.

## 3 · The ceiling when browser sync is off: 1 MiB

`storage.local` offers **5 MB on Chrome 109–113 and 10 MB from Chrome 114**
(the quota was raised in 114; `minimum_chrome_version` is 109 and
`unlimitedStorage` is deliberately not requested — see Conventions on
permissions). Firefox enforces no quota on `storage.local`. Even the 5 MB is
not the number to promise:

- The **transport** is narrower. The contract caps the `payload` envelope at
  512 KiB **as transmitted**, and what is transmitted is base64: 4/3 inflation
  plus a 12-byte IV and a 16-byte tag. Without compression the real plaintext
  ceiling is **393 188 B ≈ 384 KiB**, while `MAX_BYTES` in
  `js/eu-settings-schema.js` claims 512 KiB of JSON text. A 500 KiB blob passes
  our own validator and earns a `413` from the server. That asymmetry is fixed
  here (§9, §10).
- The **favicon cache** shares that room (`js/background.js`, key
  `faviconCache`), and today nothing bounds how many origins it holds.

With gzip (§8) the transport carries far more than 1 MiB of settings at the
pessimistic ratio, so **1 MiB (1 048 576 B) total** is the ceiling: about 1000
menus, 128× today's per-branch limit, 10× today's whole-profile quota, and at
least 4 MB of `storage.local` left as headroom for the cache and anything later
(9 MB from Chrome 114). The favicon cap of §10.3 is sized against the **5 MB**
floor, not the 10 MB.

The ceiling is a **total**, not per branch: `storage.local` has no per-item cap,
so a per-branch number there would be an invention.

## 4 · The switch, and the note it leaves behind

The switch cannot live in the settings — it decides where the settings live.
It gets its own `chrome.storage.local` key beside `euIntegration` and `euSync`:

```js
settingsArea: {
	area: 'sync' | 'local',   // 'sync' is the default and today's behaviour
	movedAt: '',              // ISO date of the switch, '' while area === 'sync'
	movedTo: '',              // 'local' | 'gestura.eu' — why it was switched
}
```

(Not `settingsStore`: that name is already the ES export of
`js/settings-store.js`, and one word for two things is how a grep goes wrong.)

Being in `storage.local` makes it **per browser**, which is correct: each device
decides for itself.

**Switching to `local`** copies the 70 known keys from `storage.sync` to
`storage.local` once, sets `area`, and then writes a note **into
`storage.sync`** for the other browsers:

```js
syncMovedAt: '2026-09-04T…',   syncMovedTo: 'local' | 'gestura.eu'
```

**The switch is not atomic, and the sequence is what makes that harmless.**
`area` is cached in every context — the service worker, every content script in
every frame, every open page — and each cache learns of the change through
`chrome.storage.onChanged`, which arrives after the write, not with it. Between
the copy and that arrival, a context still in state `sync` writes to
`storage.sync` (the worker adding a site menu from the context menu,
`content.js` writing `edgeGestureConflict`), and that write would land in the
copy left behind. So `switchTo('local')` runs in three steps: **copy → set
`area` → copy again.** The second copy is idempotent and cheap (one `get`, one
`set`) and picks up anything written into `storage.sync` during the first
step; what remains is the latency of one `onChanged` delivery, during which a
write can still go to the old area. That window is a few milliseconds on a
click the user made deliberately, and it loses at most a flag that the next
gesture rewrites. Named here so nobody tries to close it with a lock.

The stale copy in `storage.sync` is **never deleted**. Deleting a key is what
makes another browser fall back to `DEFAULT_SETTINGS` (§10.1) — a wipe on a
machine the user was not even looking at. So it is left to age, and the note is
what keeps that honest: a browser still in state `sync` that finds
`syncMovedAt` shows one line in the storage section — *"These settings have not
been synchronised since 4 September. You can switch this browser too."* —
instead of silently working on a still frame.

`syncMovedAt` and `syncMovedTo` are **not** settings: they are not in
`DEFAULT_SETTINGS`, never exported, never imported, and the façade's key filter
(§10.2) ignores them on the way in.

**Switching back to `sync`** requires the data to fit: every one of the three
growing branches must be ≤ 8192 B and the whole set ≤ 102 400 B. If it does
not, the switch is refused with the offending branch and its size named. On
success it clears `syncMovedAt` / `syncMovedTo`, writes all keys to
`storage.sync`, and sets `area: 'sync'`.

**gestura.eu sync requires `area === 'local'`.** Enabling tier 2 in the sync
panel performs the switch (with the same consent flow it has today); switching
back to `sync` while tier 2 is enabled is refused, naming tier 2 as the reason.
That is the whole of "no double sync": one switch, two consumers, and no state
in which both run.

## 5 · The façade

The rebuild is mechanical but wide: **47 `get`/`set`/`remove`/`clear` calls**
reach `chrome.storage.sync` directly (counted 2026-09-04; the plan regenerates
the list with `grep -n "chrome.storage.sync\.\(get\|set\|remove\|clear\)"`
rather than trusting this number), across three execution contexts:

- the **service worker** — `js/background.js`, 31 of them;
- **content scripts** — `js/content.js` and `js/eu-bridge.js`, both in the
  `content_scripts` list of `manifest.json`;
- **extension pages** — `js/settings-store.js` (ES module, options / popup /
  css-editor), `js/i18n.js` (classic, every page), `js/context-menu.js` (an ES
  module in `pages/context-menu.html` and `pages/css-editor.html` — **not** a
  content script, although its name suggests one) and `js/tutorial.js`
  (classic, `pages/tutorial.html`).

Four `chrome.storage.onChanged` listeners filter on `namespace === 'sync'`
and have to follow the area as well: `js/settings-store.js`, `js/background.js`
(one), `js/content.js` (two).

All of them go through **one** new module.

### `js/settings-storage.js`

A classic IIFE exposing `window.GesturaSettingsStorage`. **Not** an ES module:
content scripts cannot use modules and the service worker reaches it through
`importScripts`. It owns seven things and nothing else:

```js
area()                     → 'sync' | 'local'          // from the live cache
get(keys)                  → Promise<object>           // keys: array | object | null
set(patch)                 → Promise<{ ok, error?, branch?, bytes?, quota? }>
remove(keys)               → Promise<void>             // known keys only
onChanged(fn)              → unsubscribe               // fn(changes) — active area, known keys only
usage(settings)            → { area, branches, total, quota }
switchTo(area)             → Promise<{ ok, error?, branch?, bytes?, quota? }>
```

- `get`/`set`/`remove` pick the area. `get(null)` returns the 70 known keys
  only, never a foreign key that happens to sit in `storage.local`. `remove`
  refuses unknown keys for the same reason — the façade must never be the
  thing that deletes `euIntegration`.
- `set` runs the **pre-check** (§6) and returns `{ ok: false, error:
  'branch-full' | 'total-full', branch, bytes, quota }` instead of writing.
  Nothing is written when the check fails — the whole patch or nothing.
- `onChanged` is the **only** way anyone listens to settings changes. It
  subscribes to `chrome.storage.onChanged` once, drops events from the
  inactive area, drops keys outside `DEFAULT_SETTINGS`, and hands the rest on.
  This is what keeps the four existing listeners (§5 above) honest in state
  `local`: without the key filter, every `faviconCache` write by the worker
  would hit `loadSettings()` in every frame of every open tab, because
  [content.js:2417](../../../js/content.js#L2417) reloads on any change that
  is not the blacklist alone. The area filter also removes the
  `namespace === 'sync'` literal from four places at once.
- `usage(settings)` is pure over the object it is given — the façade caches
  the area, not the settings, so a synchronous `usage()` with no argument
  would have nothing to measure.
- The area is cached and fed by `chrome.storage.onChanged` on the
  `settingsArea` key, the same shape `js/eu-local.js` and `js/eu-sync-local.js`
  already use, and for the same reason: every caller must be able to ask "which
  area, right now" without awaiting.
- `switchTo` performs the one-time copy, the note, and the refusals of §4.
- There is **no `clear()`**. In state `local` a `chrome.storage.local.clear()`
  would take `euIntegration`, `euSync`, `settingsArea` and `faviconCache` with
  it. Reset (below) does not need one.

`js/settings-store.js` (the pages' ES module) keeps everything it does today —
change listeners, `normalizeSetting`, the rollback of `#current` on a failed
write ([settings-store.js:110](../../../js/settings-store.js#L110)) — and
delegates storage to the façade. Its `save()` returns the façade's typed
failure instead of `false`, so a caller can tell "too large" from "the write
broke". Its `reset()` changes: today it is
`chrome.storage.sync.clear()` ([settings-store.js:141](../../../js/settings-store.js#L141));
it becomes `set(structuredClone(DEFAULT_SETTINGS))` through the façade — the
defaults written as **values**, so a reset reaches other browsers through what
is there rather than through what is missing. That is what §10.1 requires, and
it is the upstream v2.3.1 behaviour the comment in `reset()` already points at.

`pages/*.html` load classic scripts before modules, so the global is there when
`settings-store.js` initialises. One ordering has to change: in every page
`js/i18n.js` loads **before** `js/constants.js`, and its read at
[i18n.js:276](../../../js/i18n.js#L276) is issued **at load** —
`initPromise = init()` ([i18n.js:354](../../../js/i18n.js#L354)) runs
synchronously up to its first `await`, and the `get` is what it awaits. The
façade needs `DEFAULT_SETTINGS` for its key filter, so on every page the order
becomes `constants.js` → façade → `i18n.js`. Neither `constants.js` nor the
façade uses anything from `i18n.js`, so the swap costs nothing; the
`localStorage` theme cache that `init()` applies first is unaffected.

### Registration, in the places nothing checks for you

- `content_scripts` in `manifest.json` is load-ordered: the façade goes
  **directly after `js/constants.js`**, because `js/eu-bridge.js` reads
  `storage.sync` and sits before `js/content.js`.
- The `importScripts` list in `js/background.js`.
- `background.scripts` in the **Firefox** manifest on `firefox-build`. Firefox
  has no `importScripts` in a background script; a dependency registered in only
  one of the two breaks after the next merge, and no test says so.
- **Every page that reads settings**, as a classic `<script>` after
  `constants.js` and **before `i18n.js`**: `pages/options.html`, `pages/popup.html`,
  `pages/css-editor.html`, `pages/tutorial.html` and `pages/context-menu.html`.
  The last one loads only `menu-icons.js` and `context-menu.js` today and has
  to gain `constants.js` as well.

## 6 · The limit as a decision

The pre-check uses the formula of `js/storage-usage.js` — `utf8Length(key) +
utf8Length(JSON.stringify(value))`, exactly Chrome's own accounting. It cannot
use the **module**: `storage-usage.js` is an ES module (`export`), imported by
five components and its test, and a classic IIFE loaded through
`importScripts` and `content_scripts` cannot import one. Converting it would
change its five consumers, which its own design forbids. So the façade carries
**its own three-line copy** of `byteLength`/`entryBytes`, and one test in
`tests/settings-storage.test.mjs` runs both copies over the same fixtures and
asserts equal results — the honest price of "unchanged", named rather than
hidden. What changes is only the ceiling the number is measured against.

In state `sync`, `set` computes the post-write size of each affected branch. Over
8192 B it refuses with `'branch-full'`; over 102 400 B in total with
`'total-full'`. In state `local` only the total is checked, against 1 MiB.

That refusal is what the user sees, at the point where they were adding
something:

> **Website menus are full** (8192 of 8192 bytes). Browser sync cannot carry more.
> · **Make it smaller** — nothing is saved, you clear some out
> · **Switch to gestura.eu sync** — about 1 MiB, across browsers
> · **Turn off browser sync** — about 1 MiB, this device only

Ways two and three are the same switch; way two additionally enables tier 2.
Both go through `switchTo('local')`, so both leave the note of §4.

The three places the storage display already occupies stay, with the ceiling
swapped:

| | browser sync on | browser sync off |
|---|---|---|
| manager line | three branches against 8192 B, highlighted from 75 % | one total against 1 MiB |
| central section | bytes per branch + sum against 102 400 B | bytes total against 1 MiB, **plus the switch** |
| import dialog | blocked — now **with** the three ways | effectively never; the check stays |

One thing is dropped rather than translated: the remaining-count estimate
(*"about 6 more menus"*) is noise at 1 MiB — *"about 900 more menus"* tells
nobody anything. In state `local` the manager line shows **nothing** below 75 %;
the numbers stay in the central section for whoever goes looking.

New i18n keys use the **`storage`** prefix, which is already in
`NEW_KEY_PREFIXES` in `tests/site-menu-locales.test.mjs`, so the 39-locale guard
applies without touching the test. Placeholders are `{token}` with `.replace()`
— never a bare `$WORD$`, which stops the extension loading.

## 7 · Device-local keys

Seven of the 70 keys are not settings but facts about *this* device or the state
of *this* browser's UI. They are excluded from the sync payload, so they can
never travel and the reconciliation of the second document needs no exception
list:

| key | why |
|---|---|
| `theme` | light/dark belongs to the screen it is on |
| `language` | the UI language belongs to the installation |
| `macLinuxHintDismissed` | a hint dismissed here, and platform-specific |
| `edgeGestureConflict` | a conflict detected in *this* browser, written by `content.js` |
| `navCollapsed` | options-page navigation state |
| `engineManagerLocalOnly` | a filter toggle in the engine manager |
| `sectionAdvanced` | which section is open |

**Adopting a sync state keeps this device's seven.** This does not come for
free: `validate()` in `js/eu-settings-schema.js` seeds its result with
`structuredClone(defaults())`, and the adopt path
([options-page.js:1698](../../../js/components/options-page.js#L1698)) writes
that result whole — the import is "atomic and replacing" by contract. A
downloaded state that carries no `theme` would therefore write `theme: 'auto'`
over the `dark` this device chose. So the seven are taken **from the local
copy** when a sync state is applied: `validate(input, { forSync: true })`
fills them from the settings currently in storage instead of from the
defaults. A device that never chose stays on `'auto'` — following the OS and
the browser UI language — and one that did keeps its choice. Only on a fresh
profile, where the local copy *is* the defaults, do the defaults win, which is
the one case where they should.

**File exports keep them.** A file is a deliberate one-off with a full preview,
not a recurring automatism; a user moving to a new machine may well want their
theme. So `buildExport(settings, extVersion, { forSync })` gains one flag:
`forSync: true` omits the seven, the default keeps them. The flag is threaded
**through `validate`** as well: `validate` rebuilds the export object
internally (`buildExport(settings, raw._version)`), and without the flag that
rebuild would put the seven straight back, so `validatedExport(...,
{ forSync: true }).exportObj` would not be the sync shape and neither would
its hash. Import from a file accepts the seven either way — the user chose the
file. `hashOf` (the "changed since last upload" comparison) uses the **sync**
shape, or a theme change would offer an upload that carries nothing.

**The two syncs differ here, deliberately.** Browser sync (state `sync`,
unchanged) carries `theme` and `language` across devices as it always has;
gestura.eu sync does not. A user who moves from one to the other will notice
that the theme stops following. That is the intended trade: the browser's own
profile sync is one user on one account, gestura.eu sync is a code that may be
typed into a colleague's browser, and a code should not repaint someone else's
screen.

The existing `NEVER` set (`euIntegration`, `euSync`, `lastSyncTime`) is
unchanged and separate: those are excluded from **both** doors.

## 8 · Compression, and where exactly it sits

Nothing is compressed today. Measured on real data — gzip level 9 over a
settings blob shaped like a heavy user's:

| case | ratio |
|---|---|
| pessimistic: every name and URL random | **2.7 ×** |
| real catalogue content, natural language, shared URL patterns | **5.1 ×** |
| many variants of the same site | 12 × and up |

Menu icons are **names**, not data URLs (`iconMax: 64` in
`js/menu-exchange.js`), so no base64 blob sits in the settings resisting
compression. 2.7 × is a realistic floor.

`CompressionStream('gzip')` needs Chrome 80 / Firefox 113; the extension
requires **Chrome 109 / Firefox 140**. Available unconditionally — no feature
detection, no fallback path.

**Payload only.** Not `meta` (a few hundred bytes; gzip's own header is 18 B and
it would grow), not the `storage.sync` mirror (§11), not file exports (they are
meant to be readable).

**The contract's test vectors must not move** — the gestura-index side is
building against them. The envelope vector uses `role = meta` with plaintext
`{"name":"Work"}`, so compressing only the payload leaves it valid byte for
byte. In `js/eu-sync-crypto.js`:

- `encryptBlob(key, stateId, role, value, iv)` keeps its signature **and its
  behaviour**. Internally it becomes
  `encryptBytes(key, stateId, role, enc.encode(JSON.stringify(value)), iv)`.
- `encryptBytes` is the new primitive. The payload path calls it with
  `await gzip(json)`.
- `decryptBlob` decides from the plaintext itself: bytes beginning `1f 8b` are
  gunzipped, anything else is parsed as JSON. A `{` is never `0x1f`, so the test
  is unambiguous, and there is no format field to keep in step.

New clients therefore read old payloads, old clients keep reading their own, and
the contract needs **one paragraph** rather than a format version or an
`apiLevel` bump.

**The gzip bomb.** `DecompressionStream` will happily turn 512 KiB into
gigabytes. The server cannot plant one — AES-GCM authenticates the ciphertext,
so a blob that decrypts at all was made by someone holding the key. The threat
is the key holder who is not this user: a sync code handed over by a third
party ("import my settings"), or a leaked one. Against that, decompression is
**bounded at 1 MiB** (the local ceiling) and aborts into the same opaque
`decrypt` error as any other damaged blob. Without that bound we would have
traded a size limit for a crash on a code somebody else wrote.

**The transport is measured, not predicted — and it already is.**
[eu-sync.js:139](../../../js/eu-sync.js#L139) builds the real envelope and
checks its length against `LIMITS.payloadMaxBytes` before the request, and
`tests/eu-sync.test.mjs` covers it. That stays exactly as it is; compression
only changes what the envelope contains. The storage display may *estimate*
with the measured ratio, but the guarantee is the measurement, so a
pathologically incompressible state is refused at upload with an honest message
instead of being promised at save time.

## 9 · Contract amendments

All additive or narrowing; no `apiLevel` bump.

1. **`payload` plaintext may be gzip.** One paragraph in the envelope section:
   the payload's plaintext is either the settings JSON or its gzip, recognised
   by the `1f 8b` magic; `meta` is never compressed; the test vectors are
   unaffected. Implementations must bound decompression.
2. **`states per locator` 10 → 5.** `5 × 512 KiB + 5 × 8 KiB = 2600 KiB ≈
   2.54 MiB` fits inside the existing **4 MiB** total (ten states would need
   5.08 MiB), so the table stops contradicting itself without raising anything.

   The reason is **usefulness, not cost.** gestura.eu has 75 GB of quota, which
   at the realistic compressed size — 18 KB of settings become about 4.9 KB per
   state, so roughly 25 KB per user — is room for something on the order of
   three million users; even five full 512 KiB states per user would still fit
   about 28 800 of them. Disk is not the binding constraint. What makes 5 the
   right number is that a state is a *different settings set*, not a device:
   two devices sharing one set share one state, so the common case is one or
   two, and three with a restore point. Offering ten sets nobody keeps buys
   nothing, and the per-locator limits keep a listing to one request with all
   meta blobs cheap to decrypt.

3. **The per-locator limits are not an abuse bound, and should not be presented
   as one.** Locators are free and unlimited — 32 random bytes, no registration,
   no account — so anyone treating the service as free blob storage simply
   derives more of them. What actually protects the quota is the **per-IP rate
   limit** (`429`, today a single row in the error table) and the **12-month
   retention**. The contract says so plainly rather than implying that a small
   `states per locator` provides safety it cannot provide.

   **Considered and rejected: making locators issued rather than derived.** Two
   shapes were weighed — a server-signed token in the manner of a JWT, and an id
   assigned by gestura.eu when sync is switched on.

   The token would in fact address the one thing named above: if a locator has
   to be *issued*, issuance can be bounded. It is rejected because the cost
   driver is not the number of locators but the **number of bytes written over
   time**, and that is already bounded per IP. Filling the quota requires
   uploading it; a thousand locators do not raise anyone's write rate. The token
   would add a request, a table, an error code and a failure mode to bound
   something the write limit bounds already.

   The assigned id is rejected for a stronger reason: today **the code is the
   whole identity** — locator and key both derive from the same 32 bytes, so one
   string on paper restores everything, years later, with a wiped profile, and
   with the server remembering nothing. An assigned id would mean two things to
   back up instead of one, and it cannot be re-derived: losing the profile would
   make the states unreachable *even with the code*, which is exactly what the
   contract's "lost secret" paragraph relies on not happening. It would also
   create a server-side issuance record with a time and an IP — the kind of
   trail `PRIVACY.md` promises not to keep.

   If abuse ever appears, the levers in order are: tighten the per-IP write
   limit, shorten retention, lower the per-locator total, and only then
   **proof of work on a registration call** — which costs an attacker CPU, costs
   an honest user one 200 ms delay, reveals nothing, and can be added later
   without touching the crypto.
4. **The state limit is checked on create only, never retroactively.** A locator
   holding five states keeps all five if the limit is later lowered — reading,
   writing and deleting stay possible, only a sixth is refused. Otherwise a
   configuration change would destroy user data. Raising the limit needs a
   server change plus, eventually, a client release to update the mirrored
   value; until then the client is conservative, which no user notices.
5. **No `locator-full` error code is added.** With per-state limits the total is
   unreachable by construction. This closes one of the three limit questions
   deferred by `a32f7df`.
6. **Maximum settings size: 1 MiB of JSON text**, replacing "512 KiB of JSON
   text". The 512 KiB payload cap remains what it is — a limit on the
   *envelope*, as transmitted — and the two numbers are no longer confusable
   because compression sits between them. This closes the second deferred
   question (the export/import asymmetry).

## 10 · What gets repaired alongside

Not opportunistic cleanup — each of these is either exposed or created by the
move.

**10.1 · Absence means default — a guard, not a live bug.**
[settings-store.js:158](../../../js/settings-store.js#L158) turns a **missing**
key in an external change into `structuredClone(DEFAULT_SETTINGS[key])`. To be
precise about what can trigger it today: `chrome.storage.sync.set` never
removes a key, and `save()` writes all 70 on every call, so a browser cannot
make a key vanish by "no longer writing it". The only path to a removal today
is `clear()` in `reset()` — and there the other browser falling back to the
defaults is exactly the propagation a reset intends. So this is not a bug a
user meets today. It **is** the reason §4 must never delete the stale copy, and
it is the one thing standing between an older Gestura and any future change
of what `storage.sync` holds. Fixed: a missing key, or a value whose shape the
reader does not recognise, **leaves the local copy standing**. Reset keeps its
meaning by writing the defaults as values (§5). A `syncFormat: 1` marker is
written alongside from this release on, meaning nothing yet — it is what makes
compression inside `storage.sync` possible later without breaking an older
Gestura (measured: an older reader handed a compressed string throws
`TypeError: Cannot use 'in' operator` inside `#load()`, the promise never
resolves, and the options page never renders).

**10.2 · Foreign keys.** The same loop assigns **any** key of an external change
into `#current`. Harmless while only settings live in `storage.sync`; in
`storage.local` the neighbour is `faviconCache`, which would land in `#current`
and be written back on the next save. The façade filters to the 70 keys of
`DEFAULT_SETTINGS` on `get` and in `onChanged` — and because all four
listeners (§5) subscribe through `onChanged`, `handleExternalChange` and the
two `content.js` listeners and the worker's are filtered by the same line.

**10.3 · The favicon cache.** `js/background.js`: 60 KB per icon, a 30-day TTL,
and **no bound on the number of origins**. Irrelevant while it was alone in
`storage.local`; from now on it shares a room with the settings, and on Chrome
109–113 that room is 5 MB (§3). It gets a cap — a maximum number of entries,
evicting the oldest `ts` first — checked on write, where the cache object is
already in hand. The cap is sized so that cap × 60 KB plus the 1 MiB settings
ceiling stays under 5 MB with margin: **48 entries** (2.9 MB worst case, in
practice far less because most icons are a few KB).

**10.4 · `reorderMouseGestures` on a non-object.** `p in storedMG` throws for a
string or a number, inside the load promise, which then never resolves. Storage
can hold anything; the loader must survive it. It returns `{}` for a
non-object, which the normalisation already treats as "nothing stored".

## 11 · Explicitly not done

- **No compression in `storage.sync`.** base64-of-gzip is larger than gzip, the
  net gain inside 8192 B is 2.0 × at the floor, and the reader on the other side
  is not our contract but a possibly older Gestura, for which it is a hard
  break, not a degradation (10.1). §10.1's marker and guard are the groundwork
  that makes it a safe, switchable option a release or two later. There is no
  hurry: the gestura.eu path already offers 1 MiB.
- **No chunking of large branches across several sync items.** It would raise the
  per-branch limit to roughly the whole-profile quota, at the cost of partial
  writes and a read order — and it would move the limit the user asked to keep
  exactly where it is.
- **No reconciliation between browsers.** Second document.
- **No change to what the storage display computes.** `js/storage-usage.js` is
  inherited unchanged, exactly as its own design promised. The façade's copy of
  the formula (§6) is the consequence, not an exception.

## 12 · Tests

**Automated** — everything here is pure or can be made pure. New
`tests/settings-storage.test.mjs`, with `chrome.storage` faked the way the
existing `eu-*` suites fake it:

- `area()` defaults to `'sync'` with no stored key and follows the stored value.
- `get`/`set`/`remove` address the selected area and no other.
- `get(null)` returns the 70 known keys and omits a foreign key present in
  `storage.local`.
- The pre-check refuses at 8193 B on a branch with `'branch-full'`, names the
  branch and both numbers, and **writes nothing**.
- The pre-check refuses over 102 400 B in total with `'total-full'`.
- In state `local` a branch over 8192 B is written without complaint; the total
  is refused over 1 MiB.
- `remove` of an unknown key (`euIntegration`, `faviconCache`) is refused and
  touches nothing.
- `entryBytes` in the façade and in `js/storage-usage.js` agree on a fixture
  set that includes multi-byte characters (§6).
- `onChanged` delivers a change from the active area and drops one from the
  inactive area; it drops `faviconCache` and passes `siteMenus`; the
  subscription is a single `chrome.storage.onChanged` listener however many
  callers subscribe.
- `switchTo('local')` copies all 70 keys, sets `movedAt`/`movedTo`, writes
  `syncMovedAt`/`syncMovedTo` into `storage.sync`, and **deletes nothing** there.
- `switchTo('local')` picks up a key written into `storage.sync` between the
  first copy and the area write (the fake writes it from an `onChanged`
  hook on the first `set`) — the second copy of §4.
- `switchTo('sync')` is refused while a branch exceeds 8192 B, and refused while
  tier 2 is enabled, each naming its reason.
- `switchTo('sync')` on data that fits clears the note and writes every key.
- `reset()` writes `DEFAULT_SETTINGS` as values through `set`, in either
  area, and leaves `euIntegration`, `euSync`, `settingsArea` and `faviconCache`
  untouched in `storage.local`.
- A missing key in an external change leaves the local copy standing (10.1).
- A `faviconCache` change does not reach `#current` (10.2).
- `reorderMouseGestures` returns `{}` for a string, a number and `null` (10.4).
- The favicon cache holds at most 48 entries after a write; the oldest `ts`
  goes first (10.3).

Extended suites:

- `tests/eu-settings-schema.test.mjs` — `forSync: true` omits the seven
  device-local keys, the default keeps them, import from a file accepts them
  either way, `validatedExport(..., { forSync: true }).exportObj` does **not**
  contain them (the flag survives the rebuild inside `validate`), `validate(...,
  { forSync: true })` fills them from the supplied local copy rather than the
  defaults, and `hashOf` ignores a `theme` change.
- `tests/eu-sync-crypto.test.mjs` — the existing envelope vector still passes
  byte for byte; a gzip round-trip through `encryptBytes`/`decryptBlob`; an
  **uncompressed** payload from an older client still decrypts; a blob that
  expands past 1 MiB fails as `decrypt` rather than exhausting memory.
- `tests/eu-sync.test.mjs` — the existing test that the upload measures the
  real envelope and refuses over 512 KiB stays green with a compressed payload;
  `LIMITS.statesMax` is 5.
- `tests/storage-usage.test.mjs` — unchanged, and that is the point.

**In a browser**, because it is UI (the harness under
`~/.claude/projects/c--Programme-alt-Gestura/browser-verify/`):

1. Fill `siteMenus` past 8192 B → the three ways appear, nothing was saved.
2. "Turn off browser sync" → the settings are intact, `storage.local` holds
   them, `storage.sync` still holds the old copy plus the note.
3. A second browser still in state `sync` shows the note line.
4. Try to switch back with 300 KB → refused, with the numbers.
5. Enable gestura.eu sync from state `sync` → the switch happens as part of it;
   switching back is then refused, naming tier 2.
6. In state `local`, the manager line is silent below 75 % and the central
   section shows one total.

## 13 · Decomposition for the plan phase

1. `js/settings-storage.js` plus its tests — area selection, `get`/`set`/
   `remove`/`onChanged`, the key filter, the formula copy with its agreement
   test. Test-first; nothing else changes yet.
2. The pre-check and the typed failures, on top of 1.
3. `switchTo` in both directions — copy, area, second copy — the note, the two
   refusals.
4. The call sites, context by context: service worker, the two content scripts,
   `js/settings-store.js` (including `reset()` as values) and the four page
   scripts; the four `onChanged` listeners onto the façade's `onChanged`.
   Registration in the two manifests, `importScripts`, and the five pages
   (§5).
5. The repairs of §10 — each with its own test, each independently revertible.
6. Compression: `encryptBytes`, the `1f 8b` sniff, the decompression bound; the
   existing transport check is verified against a compressed payload.
7. Device-local keys: `forSync` in `buildExport` **and** `validate`, the adopt
   path filling the seven from the local copy, `hashOf` on the sync shape.
8. The storage display: the swapped ceiling, the three ways at the wall, the
   switch in the central section, the note line.
9. The contract amendments of §9, and the copy handed to gestura-index.
10. i18n: the new `storage` keys in `en` and `de`, listed in
    `PENDING_TRANSLATION`; `PRIVACY.md` gains the sentence about compressed
    length.

Order: 1 → 2 → 3 → 4 → (5, 6, 7 independent) → 8 → (9, 10).

## 14 · Locked decisions

- **One storage area at a time, chosen by one switch.** Not two written in
  parallel. ✔
- **State "browser sync on" is byte-for-byte today's behaviour**, including the
  8192 B per branch. ✔
- **No migration.** The copy happens when that user switches. ✔
- **Ceiling with browser sync off: 1 MiB total.** ✔
- **The way back is conditional** and refused with numbers, never silent. ✔
- **gestura.eu sync requires `area === 'local'`.** One switch, no state in which
  both syncs run. ✔
- **The stale `storage.sync` copy is never deleted**, and a note keeps it
  honest. ✔
- **Seven device-local keys**, excluded from the sync payload, kept in file
  exports, and **taken from the local copy when a sync state is adopted** —
  never reset to defaults by a download. ✔
- **The façade has no `clear()`; reset writes the defaults as values.** ✔
- **Every settings listener goes through the façade's `onChanged`**, filtered
  to the active area and the known keys. ✔
- **gzip on the payload only**, recognised by `1f 8b`, decompression bounded,
  test vectors untouched. ✔
- **`statesMax` 5, total per locator unchanged at 4 MiB, no new error code.** ✔
- **No compression in `storage.sync`, no chunking.** ✔
- **`js/storage-usage.js` is inherited unchanged**; the façade carries its own
  copy of the formula, pinned to it by a test. ✔

**The one deviation from "byte for byte", recorded.** State "browser sync on" is
today's behaviour byte for byte in the store it uses, the quotas it enforces and
the API it presents — but not in the last eleven bytes of the total. The format
marker of §10.1 (`syncFormat: 1`) is written beside the settings from this
release on, and it costs `entryBytes('syncFormat', 1)` = 11 B of the 102 400.
`precheck()` counts it, because it is genuinely written; `usage()` counts it too,
so the data section shows the number the pre-check will refuse on rather than one
eleven bytes more generous. A user who never switches areas therefore has 102 389
bytes for settings where an older Gestura had 102 400. The marker is sanctioned
by §10.1 and the deviation is accepted, not repaired.
