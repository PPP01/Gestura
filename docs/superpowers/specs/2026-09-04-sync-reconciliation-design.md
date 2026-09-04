# Design: reconciling two browsers — a three-way merge against a stored base

- **Date:** 2026-09-04
- **Status:** approved by the user (brainstorming completed)
- **Second of two.** The first
  ([2026-09-04-storage-move-design.md](2026-09-04-storage-move-design.md))
  moves the settings out of `chrome.storage.sync`. That one does **not** depend
  on this one; this one builds on two of its parts — `buildExport(...,
  { forSync: true })` (its §7) and gzip (its §8) — so it ships after it. It is
  also the larger of the two, while the first relieves pain users have today.
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
  keeps holding.

**Non-goals.** Continuous or background synchronisation: `Sync` is a button the
user presses. Per-field merging inside a single menu entry: an entry is the
smallest unit. Automatic conflict resolution: where both sides moved, the user
decides.

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

## 3 · The base: what it is, where it lives, why the contract does not change

The base is a **local** copy of the last payload this browser agreed on with a
given state, together with the `payloadHash` that payload had.

Both halves already exist in the system. The payload is what
`GesturaSettingsSchema.buildExport(settings, ver, { forSync: true })` produces;
the hash is the `payloadHash` in the state's meta blob, which `js/eu-sync.js`
already reads on every list and every download, and which `a32f7df` already
uses as the write token. **Nothing new travels.** That is the whole reason this
document leaves `docs/gestura-eu-api.md` untouched.

### Where

Not in the `euSync` key. That key holds the secret and the tier-2 switch and is
read on every gated path; putting a megabyte of payload in it would make every
one of those reads expensive. A separate `chrome.storage.local` key, read only
during a reconciliation:

```js
euSyncBase: {
	'<stateId>': {
		hash: '',   // the payloadHash this base corresponds to
		gz: '',     // the payload JSON, gzipped, as base64
		date: '',   // when this base was agreed, for the UI only
	},
}
```

Gzipped because gzip is there anyway (storage-move design §8) and because it
turns a realistic base of 18 KB into about 3.6 KB. Five states cost roughly
20 KB of the 10 MiB; five pathological 1 MiB states about 370 KB. Either is
noise.

A base is written **only** when a reconciliation, an adoption (§6) or an upload
completes — never speculatively. A state deleted from the panel takes its base
with it. A base whose `stateId` no longer exists on the server is dropped on the
next listing, so an abandoned state cannot leave a copy of the user's settings
behind indefinitely.

### The loop, and how it composes with `412`

```
1. list + download the state          → remote settings, remote hash R
2. load the base for this stateId     → base settings B, base hash Hb
3. if R === Hb: the state has not moved since we last agreed.
      Nothing to merge. Upload if local differs from B, else done.
4. else: three-way merge (B, local, remote) → result + conflicts
5. conflicts, if any: ask (§7). Nothing is written until every one is answered.
6. show the result (the R3 preview), then on confirmation:
      write locally · store the result as the new base · upload with
      basePayloadHash = R
7. if the upload returns 412, someone wrote between step 1 and step 6:
      discard nothing, go back to step 1 with a note that the state moved again.
```

Step 7 is why the conflict protection was worth building first: the merge does
not need its own locking. It reads, merges, and stakes its upload on the version
it merged against. If that version is gone, the merge is simply redone against
the new one — and the user's already-made decisions for entries that did not
change again are remembered across the retry, so a second racing browser does
not mean answering the same question twice.

**Missing base.** If there is no base for this state — first sync on this
browser, or a cleared profile — there is nothing to merge against, and *every*
difference would look like "both sides moved". That is not a merge; it is an
adoption, and it stays a separate explicit action (§6).

## 4 · What an entry is

Merging needs identity, and the settings already carry it — but in five
different shapes, which is why this needs to be declared rather than inferred.
A new declaration, `MERGE_MAP` in a new pure module `js/settings-merge.js`,
gives every one of the 70 keys exactly one kind:

| kind | identity | keys |
|---|---|---|
| `record` | the child's own name | `mouseGestures` (by pattern), `wheelGestures`, `specialGestures`, `actionChains`, `siteMenus.custom` / `.edited` / `.domains` / `.flags`, `searchEngines.overrides` |
| `keyed-list` | a named field inside each item | `searchEngines.custom` (by `id`), `menuAppend.items` (by `id`), `textDragGestures` / `linkDragGestures` / `imageDragGestures` (by `direction`) |
| `set` | the element itself | `blacklist`, `siteMenus.disabled`, `searchEngines.hidden` |
| `order` | not data — a presentation order | `siteMenus.order`, `searchEngines.order` |
| `scalar` | the key as a whole | the remaining ~55, plus fixed children like `siteMenus.defaultMenuId`, `gestureTriggerButtons.*`, `customMenuSwitcher.*` |

**Two of the five can never produce a conflict**, which is what keeps the
question surface small:

- **`set`** — a three-way set merge is exact and total. Added on either side →
  present. Removed on either side → absent. Removed on one side, untouched on
  the other → absent. There is no case left to ask about.
- **`order`** — an order difference is never worth interrupting anyone. The rule
  is deterministic: take the remote order, append ids that are present locally
  but missing from it in their local order, then drop ids whose entry no longer
  exists. Two browsers that reorder differently converge on the remote order
  without a dialog.

`record`, `keyed-list` and `scalar` are the three that can. **`keyed-list` is
merged exactly like a `record`** keyed by its named field, and written back as
an array in the sequence of its `order` key where one exists, else remote
entries first and new local ones appended — so it reaches §5's nine cases by
the same path a `record` does and needs no rules of its own.

`searchEngines.custom` is worth naming explicitly because it is the trap: it is
an **array**, not an object, so index position is meaningless as identity and
`custom[2]` on two browsers is not the same engine. It is keyed by `id`.

**`MERGE_MAP` is a second file that must agree with `DEFAULT_SETTINGS`** — the
same hazard `CLAUDE.md` records for `LOCAL_ACTIONS` / `CONTENT_ACTIONS`. A test
fails when a key of `DEFAULT_SETTINGS` has no entry in the map. It deliberately
does **not** default to `scalar`: silently treating a new record key as one
opaque blob would turn every future menu-shaped feature into an all-or-nothing
conflict, and nobody would notice for a release.

The seven device-local keys of the storage-move design (§7 there) never appear
here at all — they are not in the sync payload, so there is nothing to merge.

## 5 · The nine cases

For every entry, per `stateId`. `X` and `X′` are different values of the same
identity; `–` is absence.

| base | local | remote | result | asks? |
|---|---|---|---|---|
| – | – | X | new over there → **take it** | no |
| – | X | – | new here → **upload it** | no |
| X | X | X′ | only remote moved → **take theirs** | no |
| X | X′ | X | only local moved → **keep mine** | no |
| X | X | – | deleted over there → **delete here** | no |
| X | – | X | deleted here → **stays deleted** | no |
| X | X′ | X″ | both moved → **ask** | yes |
| X | – | X′ | deleted here, changed there → **ask** | yes |
| – | X | X′ | both created the same id → **ask** | yes |

Rows 5 and 6 are what the base buys and tombstones would otherwise have cost.
Row 9 is rare but real: two browsers editing the same catalogue menu produce the
same `edited[id]` from nothing.

Equality is `deepEqual` on the entry — the same comparison
`js/settings-store.js` already uses for external changes, so "changed" means
exactly what it means everywhere else in the extension. It runs on the
**validated** payloads, so a repaired container cannot read as a change.

## 6 · The first sync: adoption, not merge

With no base, everything that differs falls into row 7 and the user would be
asked about every single entry. So the first exchange with a state is not a
merge and is not offered as one. It is today's **Download** — replace
everything, after the preview R3 already shows — and its second effect is that
it **establishes the base**. From then on the row is a `Sync`.

This is the flow as the user described it, unchanged: set everything up at home,
upload; at the office, download once (the defaults there are overwritten, which
is what is wanted); from then on both sides reconcile.

The same is true of **Upload as a new state**: creating a state writes the base
too, so the browser that created it can reconcile with it immediately.

A state row therefore offers `Sync` when a base exists and `Download` /
`Upload` always — Download stays available as the deliberate "throw mine away
and take theirs", which a merge can never express.

## 7 · The conflict dialog

One dialog for the whole reconciliation, never one per entry. It lists only the
conflicts — the automatic cases are summarised in a single line above them
(*"14 entries taken over, 3 uploaded, 2 deleted"*), because the user must be
able to see what happened without being asked about it.

Each conflict offers:

- **Mine** — keep the local entry, upload it.
- **Theirs** — take the remote entry.
- **Both** — only where the entry type can be duplicated: `record` and
  `keyed-list` entries whose ids are generated (custom menus, custom engines,
  action chains). The incoming entry is stored under a fresh id and its name
  gets the state's name appended, so *"Reading"* from state *"office"* arrives
  as *"Reading (office)"* rather than as a second nameless *"Reading"*. Not
  offered for a `scalar` or for an `edited[id]` override, where two values of
  one thing is not a state that can exist.

**Mine** is preselected. There is no defensible default when both sides moved,
and preselecting the local value is the one that cannot surprise: the user is
sitting in front of this browser and does not lose what they are looking at.
Two bulk buttons — *take all theirs*, *keep all mine* — make a long list
bearable without hiding it.

Nothing is written until every conflict is answered and the result has been
shown in the R3 preview. The write is **atomic and replacing**, one validated
object, exactly like the import rule in the contract's exchange format — never
a partial application.

Cancelling writes nothing, uploads nothing, and leaves the base untouched, so
cancelling is always safe and the next `Sync` starts from the same place.

## 8 · Where it lives

- **`js/settings-merge.js`** — new, pure, no `chrome.*` and no DOM, in the
  manner of `js/menu-exchange.js` and `js/eu-settings-schema.js` so it is
  testable in the existing Node environment. It owns `MERGE_MAP` and one
  function:

  ```js
  merge(base, local, remote)
    → { result, conflicts, summary }
  // conflicts: [{ path, kind, id, mine, theirs, canKeepBoth }]
  // summary:   { taken, uploaded, deleted, unchanged }
  ```

  `merge` decides nothing that needs a user. It reports conflicts; the caller
  resolves them and calls `apply(result, conflicts, choices)` for the final
  object. Splitting it that way is what makes the retry of §3 step 7 able to
  reuse answers.

- **`js/eu-sync-base.js`** — new, the only reader and writer of the
  `euSyncBase` key, shaped like `js/eu-local.js` and `js/eu-sync-local.js`:
  gzip in, gzip out, drop bases for unknown states, never throw on damaged
  storage.

- **`js/components/eu-sync-panel.js`** — the `Sync` button per row, the loop of
  §3, the retry on `412`.

- **`js/components/sync-merge-dialog.js`** — new, the dialog of §7. It reuses
  `settings-preview-dialog.js` for the final preview rather than growing its own.

Nothing in `js/eu-sync.js` changes except that the upload already takes
`basePayloadHash`.

## 9 · Tests

**Automated — `tests/settings-merge.test.mjs`**, the bulk of the work, because
`merge` is pure:

- Each of the nine rows of §5, one test each, on a `record` entry.
- Rows 3 and 4 again on a `keyed-list` (`searchEngines.custom`, keyed by `id`,
  with the items in different array positions on the two sides — the case that
  index-based identity would get wrong).
- Set merge: added here, added there, removed here, removed on both, removed
  here and untouched there. No conflict is ever reported for a `set`.
- Order: remote order wins; a local-only id lands at the end; an id whose entry
  is gone is dropped; two differently reordered browsers converge.
- `scalar`: both changed → conflict; one changed → taken silently.
- An entry that is deeply equal on both sides but not reference-equal counts as
  unchanged.
- `summary` counts match what `result` actually contains.
- `apply` with a `mine` / `theirs` / `both` choice each; `both` gives the
  incoming entry a fresh id, appends the state name, and leaves the local entry
  untouched.
- `both` is not offered for a `scalar` or an `edited[id]`.
- **Every key of `DEFAULT_SETTINGS` has a `MERGE_MAP` entry** — the guard of §4.
- None of the seven device-local keys appears in `MERGE_MAP`.

**`tests/eu-sync-base.test.mjs`:**

- Round-trip through gzip; a base survives being written and read.
- A damaged or non-string `gz` reads as "no base" instead of throwing.
- A base for a `stateId` absent from a listing is dropped.
- Deleting a state deletes its base.

**Extended — `tests/eu-sync.test.mjs`:** the reconciliation loop uploads with
`basePayloadHash` equal to the hash it merged against, not to its own base; a
`412` restarts the loop; the second pass reuses answers for entries that did not
change again.

**In a browser** (the harness under
`~/.claude/projects/c--Programme-alt-Gestura/browser-verify/`), because it is the
part no unit test reaches:

1. Two profiles, one state. Set up at home, upload; adopt at the office;
   confirm the base exists on both.
2. Add a menu at the office, edit another, sync back. At home, press `Sync`:
   the new menu arrives without a question, the edited one arrives without a
   question (local was unchanged), summary line correct.
3. Edit the *same* menu on both sides, then `Sync`: exactly one conflict, `Mine`
   preselected, `Both` offered, and the choice is what lands.
4. Delete a menu at home, sync; at the office it disappears and does **not**
   come back on the next sync.
5. A foreign write between download and upload → `412` → the loop repeats and
   the answers already given are not asked again.
6. Cancel the dialog → nothing written, nothing uploaded, next `Sync` behaves as
   if it had not been started.

## 10 · Decomposition for the plan phase

1. `js/settings-merge.js`: `MERGE_MAP` plus the `DEFAULT_SETTINGS` guard test.
   Nothing else — the map is the decision, and it should be reviewable alone.
2. `merge()` for `record` and `scalar`, the nine rows, test-first.
3. `set` and `order`.
4. `keyed-list`, including the differing-array-position case.
5. `apply()` and the three choices, including `both` with the fresh id.
6. `js/eu-sync-base.js` plus its tests.
7. The loop in the panel: `Sync` per row, `412` retry, answer reuse.
8. `js/components/sync-merge-dialog.js`, reusing the R3 preview.
9. Adoption writes the base (download and create-state paths).
10. i18n for the dialog and the summary, `en` and `de`, listed in
    `PENDING_TRANSLATION`.

Order: 1 → 2 → (3, 4 independent) → 5 → 6 → 7 → 8 → 9 → 10.

## 11 · Locked decisions

- **Three-way against a stored base**, not versions and timestamps. The clock is
  never the arbiter. ✔
- **No tombstones.** A deletion is "in the base, absent from mine". ✔
- **No contract change** — no new field, no format version, no `apiLevel` bump.
  The base is local, and its hash is the `payloadHash` that already travels. ✔
- **The base lives in its own `storage.local` key**, gzipped, not in `euSync`. ✔
- **`Sync` is a button.** No background or continuous synchronisation. ✔
- **An entry is the smallest unit.** No merging inside one menu entry. ✔
- **Five kinds of key, declared in `MERGE_MAP`**, guarded against
  `DEFAULT_SETTINGS` drift, with no silent default. ✔
- **`set` and `order` never ask.** ✔
- **A question only where both sides moved**, `Mine` preselected, bulk buttons
  for long lists. ✔
- **First exchange is an adoption, not a merge**, and it establishes the base.
  `Download` stays available afterwards as the deliberate replacement. ✔
- **Atomic and replacing**, after the R3 preview; cancelling writes nothing. ✔
- **The `412` write token carries the merge** — no locking of its own. ✔
