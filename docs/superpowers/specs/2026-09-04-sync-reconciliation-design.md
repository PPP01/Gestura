# Design: reconciling two browsers — a three-way merge against a stored base

- **Date:** 2026-09-04
- **Status:** approved by the user (brainstorming completed)
- **Reviewed 2026-09-04** against the code; the review's corrections are folded
  in. Four of them changed behaviour: the base is written *after* a successful
  upload with the hash the client computed (§3), a state written by a newer
  Gestura is refused rather than merged (§3), the case "changed here, deleted
  there" was missing from the table (§5), and `order` follows the same
  three-way rule as everything else instead of always taking the remote side
  (§4). The rest is precision: what `Both` does to references (§7), how the
  result is written (§7), which sets the `MERGE_MAP` guard compares (§4), where
  `deepEqual` comes from (§5), when bases are dropped (§3), and a bound on the
  `412` retry (§3).
- **Second of two.** The first
  ([2026-09-04-storage-move-design.md](2026-09-04-storage-move-design.md))
  moves the settings out of `chrome.storage.sync`. That one does **not** depend
  on this one; this one builds on three of its parts — `buildExport(...,
  { forSync: true })` and `validate(input, { forSync: true })` with the adopt
  rule for device-local keys (its §7), gzip (its §8), and the façade's
  pre-check (its §6) — so it ships after it. It is also the larger of the two,
  while the first relieves pain users have today.
- **Answers:** the gestura-index report of 2026-09-03, point 2
  (*Zusammenführen*), acknowledged in `a32f7df` as deliberately out of scope.
- **Contract impact: none.** No new field, no format version, no `apiLevel`
  bump. Section 3 is why.

## 1 · Goal and occasion

The sync has two buttons: **Download** replaces everything local with the
state, **Upload** replaces the state with everything local. Since `a32f7df` an
upload that would clobber a foreign write is refused with `412` and the user is
told — so nothing is lost silently any more. But there is still no way to say
*"my laptop has menu X, my desktop has menu Y, I want both"*. Every transfer is
still all-or-nothing in one direction.

This adds the third button: **Sync**.

Reached when:

- a state and a browser that have both moved since their last exchange end up
  with the union of what changed, without a question;
- a question is asked **only** where both sides changed the same thing;
- a deletion on one side stays deleted, rather than being resurrected by the
  other side's copy;
- the system clock is never the arbiter;
- the result is shown before it is written, like every other transfer in R3;
- two browsers racing each other still cannot lose a write — the existing `412`
  keeps holding;
- a failed or interrupted reconciliation leaves **every** store exactly as it
  was: nothing local, nothing remote, no base.

**Non-goals.** Continuous or background synchronisation: `Sync` is a button the
user presses. Per-field merging inside a single menu entry: an entry is the
smallest unit. Automatic conflict resolution: where both sides moved, the user
decides. Rewriting references when an entry is duplicated (§7).

## 2 · Why three-way, and not "the newer one wins"

The obvious design gives every entry a version and a timestamp and lets the
newer win. It was considered and is rejected, because it answers the wrong
question. *"Which is newer"* needs a clock, and the clock belongs to the user's
machine: one wrongly set system time and the wrong entry wins, silently, with
no way for anyone to notice.

The right question is *"which side moved"*, and that needs no clock — only a
third reference point: **the base**, the state as it was when this browser last
exchanged with it. Then:

> *my entry equals the base* → only the other side moved → **take theirs**
> *their entry equals the base* → only I moved → **keep mine, upload it**
> *neither equals the base* → both moved → **ask**

This is how `git merge` works, and it brings a second gift: **no tombstones.**
With a base, a deletion is *"in the base, absent from mine"* — distinguishable
from *"never had it"*. Deletion markers would otherwise have to be stored,
transmitted, and eventually garbage-collected, and their absence is the single
biggest simplification in this document.

The rule is applied to **every** kind of key, including the presentation
orders (§4). The one place the first draft made an exception — "always take the
remote order" — was wrong for exactly the reason this section gives: a
reordering done here while the other side did not touch the order is *"their
order equals the base"*, and the rule already says what to do with that.

## 3 · The base: what it is, where it lives, why the contract does not change

The base is a **local** copy of the last payload this browser agreed on with a
given state, together with the `payloadHash` that payload had on the server.

Both halves already exist in the system. The payload is what
`GesturaSettingsSchema.buildExport(settings, ver, { forSync: true })` produces;
the hash is the `payloadHash` in the state's meta blob, which `js/eu-sync.js`
already reads on every list and every download, and which `a32f7df` already
uses as the write token. **Nothing new travels.** That is the whole reason this
document leaves `docs/gestura-eu-api.md` untouched.

### What the hash is, precisely

`payloadHash` is `SHA-256` over the **encrypted** payload envelope — computed by
the uploading client in `uploadState`
([eu-sync.js:147](../../../js/eu-sync.js#L147)) and put into the meta blob;
recomputed by the server over the bytes it stores when checking
`basePayloadHash`; read back by every client out of the meta blob. Because every
encryption uses a fresh IV, two uploads of identical settings hash differently.
Two consequences shape this design:

- After an upload, the hash the base needs is one **only the uploading client
  knows** — the server's answer is `{ stateId, updatedAt, size }` and carries no
  hash. So `uploadState` returns `{ ...answer, payloadHash }`, the hash it
  computed for the meta blob. That is the one change to `js/eu-sync.js`.
- The hash cannot be derived from the settings. A base is therefore never
  "reconstructed"; it is written at exactly the moments listed below, from the
  hash that was in hand at that moment, or not at all.

### Where

Not in the `euSync` key. That key holds the secret and the tier-2 switch and is
read on every gated path; putting a megabyte of payload in it would make every
one of those reads expensive. A separate `chrome.storage.local` key, read only
during a reconciliation:

```js
euSyncBase: {
	'<stateId>': {
		hash: '',   // the payloadHash on the server this base corresponds to
		gz: '',     // the sync-shape payload JSON, gzipped, as base64
		date: '',   // when this base was agreed, for the UI only
	},
}
```

Gzipped because gzip is there anyway (storage-move design §8) and because it
turns a realistic base of 18 KB into about 3.6 KB. Five states cost roughly
20 KB; five pathological 1 MiB states about 370 KB. Against the 5 MB floor of
`storage.local` (storage-move design §3) either is noise.

**When a base is written.** Only at the end of a transfer that *succeeded on
the server*, and always with the hash of the payload the server now holds:

| after | payload stored as base | `hash` |
|---|---|---|
| Upload to an existing state (§6) | what was uploaded | the `payloadHash` `uploadState` returned |
| Upload as a new state (§6) | what was uploaded | the `payloadHash` `uploadState` returned |
| Download / adoption (§6) | what was downloaded, validated | the `payloadHash` out of the meta blob it was checked against |
| Sync (below) | the merged result, validated | the `payloadHash` `uploadState` returned |

Never speculatively, never before the upload has been acknowledged, never from
a `412`.

**When a base is dropped.** A state deleted from the panel takes its base with
it (also on "delete all"). A base whose `stateId` is absent from a **successful**
listing is dropped on that listing — a network error or a `disabled` gate drops
nothing, because "the state may be gone" is not "the state is gone". A base
whose stored `gz` does not inflate to a valid payload reads as "no base" and is
dropped on that read. Bases are keyed by `stateId` alone: stateIds are 128
random bits, so a different secret lists different ids and its listing drops
every base of the old one. That is correct — those states are unreachable
under the new secret — and it is the one situation in which a browser has to
adopt again after having synced before.

### The loop, and how it composes with `412`

```
1. list; download the state             → remote payload, remote hash R (meta.payloadHash)
2. validate the remote payload          → refuse if written by a newer Gestura (below)
3. load the base for this stateId       → base settings B, base hash Hb
4. R === Hb: the state has not moved since we last agreed. Nothing to merge.
      local == B  → "already in sync", done.
      local != B  → result = local, no conflicts; continue at 7.
5. three-way merge (B, local, remote)   → result, conflicts, summary
6. conflicts, if any: ask (§7). Nothing is written until every one is answered.
7. validate(result, { forSync: true, local }) — `local` being the settings
   currently in storage, so the seven device-local keys come from this device
   and not from the defaults (storage-move design §7); show the R3 preview,
   with the summary line as its note; on confirmation:
      a. pre-check: 1 MiB total via the façade's rule, 512 KiB measured envelope
         (storage-move design §6, §8). Refused → nothing written anywhere.
      b. upload with basePayloadHash = R  → returns payloadHash P
      c. write locally through the adopt path (device-local keys kept, §7)
      d. store { hash: P, gz: gzip(result), date: now } as the new base
8. 7b returned 412: someone wrote between step 1 and step 7. Nothing has been
      written (7c and 7d did not run). Go back to step 1; answers already given
      are reused (below). The second pass says why where the user is looking:
      the preview's note carries "the state changed again" in front of the
      summary line — not a line in the panel behind a modal dialog.
      After three 412s in one press, stop and show the existing conflict
      sentence with its two ways out — Download, or Upload overwriting.
```

**The order of 7b–7d is load-bearing.** Written the other way round — local
first, base second, upload last — a `412` would leave behind a base whose
payload is the merged result and whose hash matches nothing on the server. The
next pass would then find `local == B` for every entry, conclude that only the
remote side moved, and take theirs everywhere: every local change silently
overwritten. Upload first, and a refused upload has cost nothing. If 7c fails
after 7b succeeded (the façade refusing a write it pre-checked a moment ago is
the only way, and it is not expected), the base is **not** written and the panel
says so; the next `Sync` merges again against the old base, which is correct,
merely one round late.

Step 8 is why the conflict protection was worth building first: the merge does
not need its own locking. It reads, merges, and stakes its upload on the version
it merged against. If that version is gone, the merge is simply redone against
the new one — and the user's decisions for entries that did not change again are
remembered across the retry, so a second racing browser does not mean answering
the same question twice. An answer is remembered under the key `(path, id,
hashOf(mine), hashOf(theirs))`; a conflict whose `theirs` changed again in the
new remote is a new question.

**A state written by a newer Gestura is refused, not merged.** `validate` drops
top-level keys this version does not know (`dropped`) and repairs containers
whose shape it does not recognise (`retyped`). A file import shows both in the
preview and lets the user decide. A merge must not: what is dropped from the
remote payload is missing from the merged result, the merged result is uploaded,
and on the newer browser's next `Sync` those keys read as *"in the base, absent
on the server → deleted over there"* — the newer browser's settings deleted by
the older one, twice removed from anyone noticing. So step 2 refuses `Sync` when
the remote `meta.extVersion` is greater than this extension's version, or when
`dropped` or `retyped` is non-empty, with the sentence Download already has for
a state from a newer Gestura. Download stays available — the preview there shows
what would be lost, which is the right place for that decision.

**Missing base.** If there is no base for this state — first sync on this
browser, a cleared profile, a changed secret — there is nothing to merge
against, and *every* difference would look like "both sides moved". That is not
a merge; it is an adoption, and it stays a separate explicit action (§6).

## 4 · What an entry is

Merging needs identity, and the settings already carry it — but in five
different shapes, which is why this needs to be declared rather than inferred.
A new declaration, `MERGE_MAP` in a new pure module `js/settings-merge.js`,
gives every synced key exactly one kind:

| kind | identity | keys |
|---|---|---|
| `record` | the child's own name | `mouseGestures` (by pattern), `wheelGestures`, `specialGestures`, `actionChains`, `siteMenus.custom` / `.edited` / `.domains` / `.flags`, `searchEngines.overrides` |
| `keyed-list` | a named field inside each item | `searchEngines.custom` (by `id`), `menuAppend.items` (by `id`), `textDragGestures` / `linkDragGestures` / `imageDragGestures` (by `direction`) |
| `set` | the element itself | `blacklist`, `siteMenus.disabled`, `searchEngines.hidden` |
| `order` | not data — a presentation order | `siteMenus.order`, `searchEngines.order` |
| `scalar` | the key as a whole | the remaining ~50, plus fixed children like `siteMenus.defaultMenuId`, `menuAppend.enabled`, `gestureTriggerButtons.*`, `customMenuSwitcher.*` |

**Two of the five can never produce a conflict**, which is what keeps the
question surface small:

- **`set`** — a three-way set merge is exact and total. Added on either side →
  present. Removed on either side → absent. Removed on one side, untouched on
  the other → absent. There is no case left to ask about.
- **`order`** — an order difference is never worth interrupting anyone, and the
  three-way rule resolves it deterministically without a dialog. Compare each
  side's order with the base's: remote equals base → take the local order;
  local equals base → take the remote order; both differ → take the remote
  order, as the tiebreak. Then append ids present in the other side's order but
  missing from the chosen one, in their own sequence, and drop ids whose entry
  no longer exists in the merged result. A reordering done on one side alone
  therefore survives; two browsers that reorder differently converge on the
  remote order without a dialog.

`record`, `keyed-list` and `scalar` are the three that can. **`keyed-list` is
merged exactly like a `record`** keyed by its named field, and written back as
an array in the sequence of its `order` key where one exists, else remote
entries first and new local ones appended — so it reaches §5's ten cases by the
same path a `record` does and needs no rules of its own.

`searchEngines.custom` is worth naming explicitly because it is the trap: it is
an **array**, not an object, so index position is meaningless as identity and
`custom[2]` on two browsers is not the same engine. It is keyed by `id`.

**A child a container has that `MERGE_MAP` does not name** — a nested key the
default does not describe, which `conformRecord` passes through untouched — is
merged as a `scalar`. With §3's refusal of newer-version payloads such a child
can only come from storage this browser wrote itself, so treating it opaquely
loses nothing that a declared kind would have saved.

**`MERGE_MAP` is a second file that must agree with `DEFAULT_SETTINGS`** — the
same hazard `CLAUDE.md` records for `LOCAL_ACTIONS` / `CONTENT_ACTIONS`. The
guard is a partition: every key of `DEFAULT_SETTINGS` lies in **exactly one** of
three sets — `MERGE_MAP`, the seven device-local keys of the storage-move design
(its §7), or the schema's `NEVER` set — and a test fails when a key is in none
of them or in two. Of `NEVER`'s three members only `lastSyncTime` is a key of
`DEFAULT_SETTINGS`; `euIntegration` and `euSync` are separate
`chrome.storage.local` keys and never enter the partition. The
map deliberately does **not** default to `scalar`: silently treating a new
record key as one opaque blob would turn every future menu-shaped feature into
an all-or-nothing conflict, and nobody would notice for a release.

## 5 · The ten cases

For every entry, per `stateId`. `X`, `X′` and `X″` are different values of the
same identity; `–` is absence.

| # | base | local | remote | result | asks? |
|---|---|---|---|---|---|
| 1 | – | – | X | new over there → **take it** | no |
| 2 | – | X | – | new here → **upload it** | no |
| 3 | X | X | X′ | only remote moved → **take theirs** | no |
| 4 | X | X′ | X | only local moved → **keep mine** | no |
| 5 | X | X | – | deleted over there → **delete here** | no |
| 6 | X | – | X | deleted here → **stays deleted** | no |
| 7 | X | X′ | X″ | both moved → **ask** | yes |
| 8 | X | – | X′ | deleted here, changed there → **ask** | yes |
| 9 | X | X′ | – | changed here, deleted there → **ask** | yes |
| 10 | – | X | X′ | both created the same id → **ask** | yes |

The trivial combinations — all three equal, both sides equal to each other with
the base different, or both created the identical entry — are "unchanged" and
counted as such. Rows 5 and 6 are what the base buys and tombstones would
otherwise have cost. Rows 8 and 9 are mirror images and are both asked: a
deletion is a decision, and so is an edit, and the merge cannot rank them. In
row 9 `Theirs` means "delete it here too". Row 10 is rare but real: two browsers
editing the same catalogue menu produce the same `edited[id]` from nothing.

Equality is `deepEqual` on the entry — the same comparison
`js/settings-store.js` already uses for external changes, so "changed" means
exactly what it means everywhere else in the extension. `settings-store.js` is
an ES module with `chrome.*` access and cannot be imported by a pure classic
script, so `js/settings-merge.js` carries **its own copy** of the eleven lines,
and one test runs both over the same fixtures — the same price the storage-move
design pays for `byteLength`, named rather than hidden. Both sides are compared
in the same shape: the local settings go through `validatedExport(settings,
ver, { forSync: true })` before the merge, exactly as the remote payload went
through `validate`, so a repaired container or a device-local key can never
read as a change.

## 6 · The first sync: adoption, not merge

With no base, everything that differs falls into row 7 and the user would be
asked about every single entry. So the first exchange with a state is not a
merge and is not offered as one. It is today's **Download** — replace the
synced keys, after the preview R3 already shows, keeping this device's seven
(storage-move design §7) — and its second effect is that it **establishes the
base**: the validated payload, under the `payloadHash` it was checked against.
From then on the row is a `Sync`.

This is the flow as the user described it, unchanged: set everything up at home,
upload; at the office, download once (the defaults there are overwritten, which
is what is wanted); from then on both sides reconcile.

The same is true of **Upload** — to an existing state or as a new one: a
successful upload writes the base from what was uploaded, under the hash
`uploadState` returned, so the browser that uploaded can reconcile with the
state immediately. This includes the "overwrite anyway" path after a `412`: it
is an upload that succeeded, and what it uploaded is now what the server holds.

A state row therefore offers `Sync` when a base exists and `Download` /
`Upload` always — Download stays available as the deliberate "throw mine away
and take theirs", which a merge can never express, and as the way out when
`Sync` refuses a newer-version state (§3).

## 7 · The conflict dialog, and the write

One dialog for the whole reconciliation, never one per entry. It lists only the
conflicts — the automatic cases are summarised in a single line above them
(*"14 entries taken over, 3 uploaded, 2 deleted"*), because the user must be
able to see what happened without being asked about it.

Each conflict offers:

- **Mine** — keep the local entry, upload it. In row 8 that means "stays
  deleted"; in row 9, "keep my edit".
- **Theirs** — take the remote entry. In row 8 that means "take their edit"; in
  row 9, "delete it here too".
- **Both** — only where the entry type can be duplicated: `record` and
  `keyed-list` entries whose ids are generated (custom menus, custom engines,
  action chains). The incoming entry is stored under a fresh id and its `name`
  gets the state's name appended, so *"Reading"* from state *"office"* arrives
  as *"Reading (office)"* rather than as a second nameless *"Reading"*; a state
  without a name gets *"(2)"*. Not offered for a `scalar`, for an `edited[id]`
  override, for `searchEngines.overrides`, or for a `keyed-list` keyed by a
  fixed field (`direction`), where two values of one thing is not a state that
  can exist.

**What `Both` does to references — and does not.** Ids are referenced from
elsewhere: `siteMenus.domains[id]`, `.flags[id]`, `.disabled`, `.order`,
`.defaultMenuId`, `ctxMenuSiteMenuId`, the `menuId` of `siteMenu` and
`addSiteToMenu` actions, the `engineId` of `searchLink` items in menus and in
`menuAppend.items`. All of those keep naming the **original** id, which after
`Both` is the local entry. The copy arrives the way a menu or engine imported
from a file arrives: with no domain, no flags, enabled, at the end of its list,
referenced by nothing. "At the end" costs no write to the `order` array: both
resolvers already place an id that is absent from `order` after the ordered
ones (`js/menu-model.js` appends custom ids after the ordered and catalogue
ones; `js/engine-registry.js` sorts an unknown id with position `Infinity`), so
`apply` adds the entry and touches nothing else. Rewriting the remote side's references to
point at the copy was considered and rejected: it would require knowing, per
reference, which side wrote it, and the merge does not track provenance below
the entry. The user who chose `Both` gets two entries and decides what points
where.

**References to a deleted entry** can survive a merge in one case: the other
side attached something to it in the meantime — a domain, a flag, a menu item —
and that attachment is "new over there → take it". The resolvers already
tolerate an id that resolves to nothing (`js/menu-model.js` skips unknown ids
in `order`, an unknown `domains[id]` is never read), so it costs a few stale
bytes and no behaviour. `order` is the exception, and only because §4's rule
already drops unknown ids there.

**Mine** is preselected. There is no defensible default when both sides moved,
and preselecting the local value is the one that cannot surprise: the user is
sitting in front of this browser and does not lose what they are looking at.
Two bulk buttons — *take all theirs*, *keep all mine* — make a long list
bearable without hiding it.

Nothing is written until every conflict is answered and the result has been
shown in the R3 preview. **The write is atomic and replacing** for the synced
keys: one validated object — `validate(…, { forSync: true, local })` with the
settings currently in storage as `local` — through the same adopt path Download
uses, so the seven device-local keys are taken from the local copy and never touched
(storage-move design §7) — never a partial application, and never the merged
result's absent `theme` written as `'auto'` over this device's choice.

Cancelling — at the dialog or at the preview — writes nothing, uploads nothing,
and leaves the base untouched, so cancelling is always safe and the next `Sync`
starts from the same place.

## 8 · Where it lives

- **`js/settings-merge.js`** — new, pure, no `chrome.*` and no DOM, a classic
  IIFE in the manner of `js/menu-exchange.js` and `js/eu-settings-schema.js` so
  it is testable in the existing Node environment and reachable from the panel
  as a window global. It owns `MERGE_MAP`, its own `deepEqual`, and two
  functions:

  ```js
  merge(base, local, remote)
    → { result, conflicts, summary }
  // conflicts: [{ path, kind, id, mine, theirs, canKeepBoth, mineHash, theirsHash }]
  // summary:   { taken, uploaded, deleted, unchanged }

  apply(result, conflicts, choices, { stateName })
    → the final object
  // choices: { [conflictKey]: 'mine' | 'theirs' | 'both' }
  ```

  `merge` decides nothing that needs a user. It reports conflicts; the caller
  resolves them and calls `apply` for the final object. Splitting it that way is
  what makes the retry of §3 step 8 able to reuse answers: the panel keeps
  `choices` across passes and drops only the keys whose conflict is no longer
  reported.

- **`js/eu-sync-base.js`** — new, the only reader and writer of the
  `euSyncBase` key, shaped like `js/eu-local.js` and `js/eu-sync-local.js`:
  `read(stateId)`, `write(stateId, { hash, payload })`, `remove(stateId)`,
  `prune(knownStateIds)`; gzip in, gzip out, never throw on damaged storage.

- **`js/eu-sync.js`** — one change: `uploadState` returns the server's answer
  extended with the `payloadHash` it computed.

- **`js/components/eu-sync-panel.js`** — the `Sync` button per row, the loop of
  §3, the `412` retry with its bound, the base written after every successful
  upload and download, `prune` after every successful listing, `remove` on
  delete.

- **`js/components/sync-merge-dialog.js`** — new, the dialog of §7. It reuses
  `settings-preview-dialog.js` for the final preview rather than growing its own.

## 9 · Tests

**Automated — `tests/settings-merge.test.mjs`**, the bulk of the work, because
`merge` is pure:

- Each of the ten rows of §5, one test each, on a `record` entry; rows 8 and 9
  each report a conflict, and `apply` with `theirs` deletes in row 9 and
  restores in row 8.
- The trivial combinations count as `unchanged` and report no conflict.
- Rows 3 and 4 again on a `keyed-list` (`searchEngines.custom`, keyed by `id`,
  with the items in different array positions on the two sides — the case that
  index-based identity would get wrong).
- Set merge: added here, added there, removed here, removed on both, removed
  here and untouched there. No conflict is ever reported for a `set`.
- Order: a local-only reorder survives when remote equals the base; a
  remote-only reorder is taken; both reordered → remote wins; a local-only id
  lands at the end; an id whose entry is gone is dropped; two differently
  reordered browsers converge.
- `scalar`: both changed → conflict; one changed → taken silently.
- An entry that is deeply equal on both sides but not reference-equal counts as
  unchanged; the module's `deepEqual` agrees with `settings-store.js`'s over the
  same fixtures.
- An undeclared child of a container is merged as a `scalar`.
- `summary` counts match what `result` actually contains.
- `apply` with a `mine` / `theirs` / `both` choice each; `both` gives the
  incoming entry a fresh id, appends the state name (or *"(2)"* without one),
  leaves the local entry untouched, and rewrites **no** reference.
- `both` is not offered for a `scalar`, an `edited[id]`, an `overrides[id]`, or
  a drag gesture.
- **Every key of `DEFAULT_SETTINGS` is in exactly one of `MERGE_MAP`, the seven
  device-local keys, and `NEVER`** — the partition guard of §4.

**`tests/eu-sync-base.test.mjs`:**

- Round-trip through gzip; a base survives being written and read.
- A damaged or non-string `gz` reads as "no base" instead of throwing, and is
  removed.
- `prune` drops a base for a `stateId` absent from the list it is given and
  keeps the others.
- `remove` deletes exactly one base.

**Extended — `tests/eu-sync.test.mjs`:**

- `uploadState` returns the `payloadHash` it wrote into the meta blob, and it
  equals `blobHash` of the payload it sent.
- The reconciliation loop uploads with `basePayloadHash` equal to the hash it
  merged against, not to its own base's hash.
- A `412` restarts the loop and writes **no** base and **no** local settings;
  the second pass reuses answers for entries that did not change again and asks
  again for one whose `theirs` moved.
- The fourth `412` in one press stops the loop and surfaces the conflict.
- A remote payload with a `dropped` key, a `retyped` key, or a greater
  `extVersion` is refused before any merge.
- A successful upload, download and sync each write a base with the right hash;
  a cancelled preview writes none.

**In a browser** (the harness under
`~/.claude/projects/c--Programme-alt-Gestura/browser-verify/`), because it is the
part no unit test reaches:

1. Two profiles, one state. Set up at home, upload; adopt at the office;
   confirm the base exists on both, with the same `hash`.
2. Add a menu at the office, edit another, reorder the list, sync back. At
   home, press `Sync`: the new menu arrives without a question, the edited one
   arrives without a question (local was unchanged), the order follows the
   office, summary line correct.
3. Edit the *same* menu on both sides, then `Sync`: exactly one conflict, `Mine`
   preselected, `Both` offered, and the choice is what lands; after `Both` the
   copy carries the state's name and no domain.
4. Delete a menu at home, sync; at the office it disappears and does **not**
   come back on the next sync. Edit a menu at home that the office deleted:
   one conflict, and `Theirs` deletes it at home.
5. A foreign write between download and upload → `412` → the loop repeats, the
   base is unchanged, and the answers already given are not asked again.
6. Cancel the dialog → nothing written, nothing uploaded, base unchanged; next
   `Sync` behaves as if it had not been started.
7. The device's `theme` is `dark` before a `Sync` and still `dark` after it.

## 10 · Decomposition for the plan phase

1. `js/settings-merge.js`: `MERGE_MAP`, `deepEqual`, plus the partition guard
   test. Nothing else — the map is the decision, and it should be reviewable
   alone.
2. `merge()` for `record` and `scalar`, the ten rows, test-first.
3. `set` and `order`.
4. `keyed-list`, including the differing-array-position case.
5. `apply()` and the three choices, including `both` with the fresh id and the
   name suffix.
6. `js/eu-sync-base.js` plus its tests.
7. `uploadState` returns `payloadHash`; Upload, create and Download write the
   base; delete and listing maintain it.
8. The loop in the panel: `Sync` per row, the newer-version refusal, the
   pre-checks, the `412` retry with its bound, answer reuse, the write order.
9. `js/components/sync-merge-dialog.js`, reusing the R3 preview.
10. i18n for the dialog, the summary, the refusal and the retry note, `en` and
    `de`, listed in `PENDING_TRANSLATION`.

Order: 1 → 2 → (3, 4 independent) → 5 → 6 → 7 → 8 → 9 → 10.

## 11 · Explicitly not done

- **No rewriting of references after `Both`** (§7). Two entries, the user
  points things where they belong.
- **No change to `lastUploadHash`** in `euSync.states` and the "changed since
  last upload" hint. With a base, "local differs from B" answers the same
  question and could serve a browser that adopted by Download, which today
  never sees the hint. That is a small later gift, not part of this document.
- **No merge across versions.** A newer state is refused; Download shows what
  would be lost. Making the merge carry unknown keys through would be possible
  and is not attempted here.
- **No per-field merge inside an entry**, and no automatic resolution where
  both sides moved.

## 12 · Locked decisions

- **Three-way against a stored base**, not versions and timestamps. The clock is
  never the arbiter. ✔
- **No tombstones.** A deletion is "in the base, absent from mine". ✔
- **No contract change** — no new field, no format version, no `apiLevel` bump.
  The base is local, and its hash is the `payloadHash` that already travels. ✔
- **The base lives in its own `storage.local` key**, gzipped, not in `euSync`. ✔
- **The base is written after the server acknowledged**, with the hash the
  client computed for that upload (or read for that download) — never before,
  never from a `412`. `uploadState` returns that hash. ✔
- **A newer-version state is refused, not merged.** ✔
- **`Sync` is a button.** No background or continuous synchronisation. ✔
- **An entry is the smallest unit.** No merging inside one menu entry. ✔
- **Five kinds of key, declared in `MERGE_MAP`**, guarded as a partition of
  `DEFAULT_SETTINGS` with the device-local and `NEVER` sets, no silent
  default. ✔
- **`set` and `order` never ask**, and `order` follows the three-way rule. ✔
- **Ten cases**, four of which ask; deletion against edit asks in both
  directions. ✔
- **A question only where both sides moved**, `Mine` preselected, bulk buttons
  for long lists. ✔
- **`Both` duplicates the entry and rewrites no reference.** ✔
- **First exchange is an adoption, not a merge**, and it establishes the base.
  `Download` stays available afterwards as the deliberate replacement. ✔
- **Atomic and replacing for the synced keys**, through the adopt path, after
  the R3 preview; the seven device-local keys are never touched; cancelling
  writes nothing. ✔
- **The `412` write token carries the merge** — no locking of its own, at most
  three retries per press, answers reused. ✔
