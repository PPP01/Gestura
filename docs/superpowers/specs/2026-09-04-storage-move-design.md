# Design: moving the settings out of `chrome.storage.sync`

- **Date:** 2026-09-04
- **Status:** approved by the user (brainstorming completed)
- **First of two.** The second (`2026-09-04-sync-reconciliation-design.md`)
  designs the three-way reconciliation between two browsers. It needs nothing
  from this document and this document needs nothing from it; they are separate
  because this one relieves pain users have today and must not wait for the
  other.
- **Builds on:** [2026-08-30-speicheranzeige-design.md](2026-08-30-speicheranzeige-design.md),
  which called this "Vorhaben zwei" and already carries the split that makes it
  cheap. `js/storage-usage.js` is inherited unchanged.
- **Amends the contract:** [docs/gestura-eu-api.md](../../gestura-eu-api.md) —
  section 9 below lists every change.

## 1 · Goal and occasion

Settings live in `chrome.storage.sync`, where **8192 bytes per item** is the
binding limit and every top-level branch is one item. `siteMenus` is one branch.
An imported menu with ten entries weighs about 1750 B, so three or four fill it.
Measured: a menu averages **1002 B**, and the entire built-in catalogue — 15
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

`storage.local` offers 10 MiB, but that is not the number to promise:

- The **transport** is narrower. The contract caps the `payload` envelope at
  512 KiB **as transmitted**, and what is transmitted is base64: 4/3 inflation
  plus a 12-byte IV and a 16-byte tag. Without compression the real plaintext
  ceiling is **393 188 B ≈ 384 KiB**, while `MAX_BYTES` in
  `js/eu-settings-schema.js` claims 512 KiB of JSON text. A 500 KiB blob passes
  our own validator and earns a `413` from the server. That asymmetry is fixed
  here (§9, §10).
- The **favicon cache** shares the 10 MiB (`js/background.js`, key
  `faviconCache`), and today nothing bounds how many origins it holds.

With gzip (§8) the transport carries far more than 1 MiB of settings at the
pessimistic ratio, so **1 MiB (1 048 576 B) total** is the ceiling: about 1000
menus, 64× today's per-branch limit, 10× today's whole-profile quota, and 9 MiB
of `storage.local` left as headroom for the cache and anything later.

The ceiling is a **total**, not per branch: `storage.local` has no per-item cap,
so a per-branch number there would be an invention.

## 4 · The switch, and the note it leaves behind

The switch cannot live in the settings — it decides where the settings live.
It gets its own `chrome.storage.local` key beside `euIntegration` and `euSync`:

```js
settingsStore: {
	area: 'sync' | 'local',   // 'sync' is the default and today's behaviour
	movedAt: '',              // ISO date of the switch, '' while area === 'sync'
	movedTo: '',              // 'local' | 'gestura.eu' — why it was switched
}
```

Being in `storage.local` makes it **per browser**, which is correct: each device
decides for itself.

**Switching to `local`** copies the 70 known keys from `storage.sync` to
`storage.local` once, sets `area`, and then writes a note **into
`storage.sync`** for the other browsers:

```js
syncMovedAt: '2026-09-04T…',   syncMovedTo: 'local' | 'gestura.eu'
```

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

The rebuild is mechanical but wide: **40 call sites** reach
`chrome.storage.sync` directly, across three execution contexts — the service
worker (`js/background.js`, the bulk of them), content scripts
(`js/content.js`, `js/context-menu.js`, `js/tutorial.js`), and the ES-module
pages via `js/settings-store.js`, plus `js/i18n.js` and `js/eu-bridge.js`.

All of them go through **one** new module.

### `js/settings-storage.js`

A classic IIFE exposing `window.GesturaSettingsStorage`. **Not** an ES module:
content scripts cannot use modules and the service worker reaches it through
`importScripts`. It owns five things and nothing else:

```js
area()                     → 'sync' | 'local'          // from the live cache
get(keys)                  → Promise<object>           // keys: array | object | null
set(patch)                 → Promise<{ ok, error?, branch?, bytes?, quota? }>
remove(keys)               → Promise<void>
usage()                    → { area, branches, total, quota }
switchTo(area)             → Promise<{ ok, error?, branch?, bytes?, quota? }>
```

- `get`/`set`/`remove` pick the area. `get(null)` returns the 70 known keys
  only, never a foreign key that happens to sit in `storage.local`.
- `set` runs the **pre-check** (§6) and returns `{ ok: false, error:
  'branch-full' | 'total-full', branch, bytes, quota }` instead of writing.
  Nothing is written when the check fails — the whole patch or nothing.
- The area is cached and fed by `chrome.storage.onChanged` on the
  `settingsStore` key, the same shape `js/eu-local.js` and `js/eu-sync-local.js`
  already use, and for the same reason: every caller must be able to ask "which
  area, right now" without awaiting.
- `switchTo` performs the one-time copy, the note, and the refusals of §4.

`js/settings-store.js` (the pages' ES module) keeps everything it does today —
change listeners, `normalizeSetting`, the rollback of `#current` on a failed
write ([settings-store.js:110](../../../js/settings-store.js#L110)) — and
delegates storage to the façade. Its `save()` returns the façade's typed
failure instead of `false`, so a caller can tell "too large" from "the write
broke". `pages/*.html` already load classic scripts before modules, so the
global is there when the module initialises.

### Registration, in three places that nothing checks for you

- `content_scripts` in `manifest.json` is load-ordered: the façade goes **before**
  `js/content.js` and before `js/context-menu.js`.
- The `importScripts` list in `js/background.js`.
- `background.scripts` in the **Firefox** manifest on `firefox-build`. Firefox
  has no `importScripts` in a background script; a dependency registered in only
  one of the two breaks after the next merge, and no test says so.

## 6 · The limit as a decision

The pre-check uses `js/storage-usage.js` unchanged — the module the storage
display already introduced, whose formula (`utf8Length(key) +
utf8Length(JSON.stringify(value))`) is exactly Chrome's own accounting. What
changes is only the ceiling it is measured against.

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

`theme` and `language` default to `'auto'` — following the OS and the browser UI
language — so a freshly adopted state gets device-appropriate values by
construction, with no special case anywhere.

**File exports keep them.** A file is a deliberate one-off with a full preview,
not a recurring automatism; a user moving to a new machine may well want their
theme. So `buildExport(settings, extVersion, { forSync })` gains one flag:
`forSync: true` omits the seven, the default keeps them. Import accepts them
either way — the user chose the file. `hashOf` (the "changed since last upload"
comparison) uses the **sync** shape, or a theme change would offer an upload
that carries nothing.

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
gigabytes. The server is not trusted — that is the entire reason for the
encryption — so decompression is **bounded at 1 MiB** (the local ceiling) and
aborts into the same opaque `decrypt` error as any other damaged blob. Without
that bound we would have traded a size limit for a crash.

**The transport is measured, not predicted.** Before an upload the real envelope
is built and its length checked against 512 KiB. The storage display may
*estimate* with the measured ratio, but the guarantee is the measurement, so a
pathologically incompressible state is refused at upload with an honest message
instead of being promised at save time.

## 9 · Contract amendments

All additive or narrowing; no `apiLevel` bump.

1. **`payload` plaintext may be gzip.** One paragraph in the envelope section:
   the payload's plaintext is either the settings JSON or its gzip, recognised
   by the `1f 8b` magic; `meta` is never compressed; the test vectors are
   unaffected. Implementations must bound decompression.
2. **`states per locator` 10 → 5.** `5 × 512 KiB + 5 × 8 KiB = 2.6 MiB` fits
   inside the existing **4 MiB** total, so the table stops contradicting itself
   without raising anything.

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

**10.1 · The wipe hole.**
[settings-store.js:157](../../../js/settings-store.js#L157) turns a **missing**
key in an external change into `structuredClone(DEFAULT_SETTINGS[key])`. So a
browser that stops writing a key erases that key on every other browser sharing
the profile. It is why §4 never deletes the stale copy, and it is a live bug
today. Fixed: a missing key, or a value whose shape the reader does not
recognise, **leaves the local copy standing**. A `syncFormat: 1` marker is
written alongside from this release on, meaning nothing yet — it is what makes
compression inside `storage.sync` possible later without breaking an older
Gestura (measured: an older reader handed a compressed string throws
`TypeError: Cannot use 'in' operator` inside `#load()`, the promise never
resolves, and the options page never renders).

**10.2 · Foreign keys.** The same loop assigns **any** key of an external change
into `#current`. Harmless while only settings live in `storage.sync`; in
`storage.local` the neighbour is `faviconCache`, which would land in `#current`
and be written back on the next save. The façade filters to the 70 keys of
`DEFAULT_SETTINGS`, and so does `handleExternalChange`.

**10.3 · The favicon cache.** `js/background.js`: 60 KB per icon, a 30-day TTL,
and **no bound on the number of origins**. Irrelevant while it was alone in
`storage.local`; from now on it shares a 10 MiB room with the settings. It gets
a cap — a maximum number of entries, evicting the oldest `ts` first — checked on
write, where the cache object is already in hand.

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
  inherited unchanged, exactly as its own design promised.

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
- `switchTo('local')` copies all 70 keys, sets `movedAt`/`movedTo`, writes
  `syncMovedAt`/`syncMovedTo` into `storage.sync`, and **deletes nothing** there.
- `switchTo('sync')` is refused while a branch exceeds 8192 B, and refused while
  tier 2 is enabled, each naming its reason.
- `switchTo('sync')` on data that fits clears the note and writes every key.
- A missing key in an external change leaves the local copy standing (10.1).
- A `faviconCache` change does not reach `#current` (10.2).
- `reorderMouseGestures` returns `{}` for a string, a number and `null` (10.4).

Extended suites:

- `tests/eu-settings-schema.test.mjs` — `forSync: true` omits the seven
  device-local keys, the default keeps them, import accepts them either way, and
  `hashOf` ignores a `theme` change.
- `tests/eu-sync-crypto.test.mjs` — the existing envelope vector still passes
  byte for byte; a gzip round-trip through `encryptBytes`/`decryptBlob`; an
  **uncompressed** payload from an older client still decrypts; a blob that
  expands past 1 MiB fails as `decrypt` rather than exhausting memory.
- `tests/eu-sync.test.mjs` — the upload measures the real envelope and refuses
  over 512 KiB before the request; `LIMITS.statesMax` is 5.
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
   `remove`, the key filter. Test-first; nothing else changes yet.
2. The pre-check and the typed failures, on top of 1.
3. `switchTo` in both directions, the note, the two refusals.
4. The 40 call sites, context by context: service worker, content scripts,
   `js/settings-store.js` and the pages. Registration in all three manifests
   (§5).
5. The repairs of §10 — each with its own test, each independently revertible.
6. Compression: `encryptBytes`, the `1f 8b` sniff, the decompression bound, the
   measured transport check.
7. Device-local keys: `forSync` in the schema, `hashOf` on the sync shape.
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
  exports. ✔
- **gzip on the payload only**, recognised by `1f 8b`, decompression bounded,
  test vectors untouched. ✔
- **`statesMax` 5, total per locator unchanged at 4 MiB, no new error code.** ✔
- **No compression in `storage.sync`, no chunking.** ✔
- **`js/storage-usage.js` is inherited unchanged.** ✔
