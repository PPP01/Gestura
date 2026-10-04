# Repeated gestures (↓↓, →→, ↑↑, ←←) — design

Status: draft v3 (Codex and Gemini reviews addressed), awaiting approval · 2026-10-04

## Goal

All twelve two-direction gestures are taken by the defaults. Repeating a
direction (`↓↓`, `→→`, `↑↑`, `←←`) opens four more two-stroke gestures — and,
combined with other directions, many longer ones (`↓↓→`, `→↑↑`, …).

Two ways to enter a repeat, both on by default:

- **Long stroke** — a stroke in one direction that runs past a configurable
  length counts as that direction twice.
- **Pause** — stop, hold still for a configurable time, then continue in the
  same direction.

A repeated pattern that has **no binding at all** falls back to the pattern
with the repeats collapsed, so nothing changes for anyone who never binds a
repeated gesture.

## Non-goals

- No live HUD feedback *during* a pause; the repeat shows up as soon as the
  pointer moves on.
- No default bindings for repeated gestures.
- No more than two equal directions in a row (`↓↓↓` is never produced).
- No repeats in the tutorial (it keeps its exact-pattern checks).
- No textual pattern entry; repeated gestures are recorded like any other.
- No translations beyond `en`/`de` before the next store release.

## Why this has no effect until someone binds a repeat

The recognizer will produce `↓↓` for a long downward stroke that today yields
`↓` (scroll down). Without the fallback that would silently break the four
basic gestures on tall screens. With it, an unbound `↓↓` resolves to `↓` —
action, configuration, HUD label and arrows included — and behaves exactly as
before. This is what makes "on by default" safe, and every part of this design
is checked against it.

## Design

### 1. Recognizer — [js/gesture-recognizer.js](../../../js/gesture-recognizer.js)

#### Configuration

| config | meaning | omitted / invalid |
| --- | --- | --- |
| `repeatDistance` | px of straight travel after which the same direction is appended again | 0 (off) |
| `repeatPause` | ms of stillness after which the next stroke in the same direction is appended again | 0 (off) |

Omitted means **off**, so every caller that does not pass these values — the
tutorial today — keeps exactly the current behaviour. Values are normalised in
the constructor and in `updateConfig()`: a finite number, clamped to the UI
range (`repeatDistance` 0–600, `repeatPause` 0–2000), anything else is 0.
`updateConfig()` uses `!== undefined` checks, so an explicit 0 is accepted.
A non-zero `repeatDistance` is raised at runtime to at least
`2 × distanceThreshold`, so a short repeat distance can never double every
stroke on its first step.

`start(x, y, timestamp, { source })` gains an optional `source`:
`'pointer'` (default; mouse and pen) or `'drag'` (super drag, fed by
`dragover`). It only affects pause detection, see below.

#### State

The current `segmentLength` keeps its single job: the straight-line length of
the current physical segment, feeding the adaptive turn threshold. **A
long-stroke repeat never resets it** — the hand is still moving in one stroke.
An armed **pause** does reset it to 0: after a full stop the next stroke is a
new physical segment, so a turn after a pause needs only `distanceThreshold`,
not the threshold inflated by the stroke before the stop. Two new pieces of
state:

- `repeatProgress` — travel since the last direction boundary (new direction
  *or* repeat). Drives the long-stroke rule.
- `rest` — `{ x, y, t }` of the point where the pointer last came to rest, plus
  `pauseArmed`.

Both are initialised **at activation**, not in `start()`, so slow movement
before activation can never count as a pause.

#### Rules

- **Long stroke.** When the active segment is extended in its own direction and
  `repeatProgress ≥ repeatDistance`, append the direction once more (subject to
  the cap) and set `repeatProgress` to the overshoot. The long-stroke rule is
  also evaluated once **on activation**, against the replayed active segment,
  so a single long move event from pointer-down still yields `↓↓`.
- **Pause.** A move within `PAUSE_JITTER` (a fixed 6 CSS px, not tied to
  `distanceThreshold`) of `rest` does not move it. How stillness is measured
  depends on the source:
  - `'pointer'`: mouse and pen fire no events while still, so the gap counts.
    When a move leaves the radius and `t − rest.t ≥ repeatPause`, the pause is
    armed.
  - `'drag'`: `dragover` fires periodically even while still and arrives in
    sparse samples while moving, so a gap proves nothing. The pause is armed
    only by an observed sample **inside** the radius with
    `t − rest.t ≥ repeatPause`. A continuously moving drag with slow samples
    can therefore never arm it. (Effective drag pause is `repeatPause` plus up
    to one `dragover` interval.)
  When a move leaves the radius, `rest` is reset to that move — **after**
  arming has been decided.
- **Armed pause.** Arming snapshots the pre-pause rest point as `pauseRest`
  before `rest` is updated, and resets the anchor to `pauseRest`, so the
  resumed movement counts toward the first post-pause segment. The next segment
  that exceeds `distanceThreshold` is decided: if it has the last direction it
  is appended as a repeat (subject to the cap); otherwise it is a normal turn.
  Either way the pause is **consumed**, including when the cap rejects the
  append — it never leaks into a later segment.
- **A pause needs a continuation.** The repeat is created by the stroke
  *after* the pause, not by the pause itself: `↓`, pause, release is `↓`.
  Releasing while a pause is armed commits nothing extra.
- **Cap.** Never more than two equal directions in a row, from either source.
- **Timestamps.** Only a finite timestamp not smaller than the previous one is
  pause-capable. Anything else (null, omitted, non-finite, decreasing) updates
  position as today but never arms a pause. If such a move leaves the rest
  radius, the new rest point's time is unknown (`t: null`) and the clock starts
  with the next usable timestamp inside the radius — an unmeasured gap is never
  counted as stillness. Numeric 0 is a valid timestamp.

Order of evaluation per `move()`: activation (incl. replay and the long-stroke
check) → pause bookkeeping (`rest`, arming) → segment classification (extend /
turn / repeat) → cap → anchors and counters → disarm → result.

A repeat is reported exactly like a turn: `directionChanged: true`,
`direction`, `pattern`. HUD, suggestions and recorder therefore update without
changes on their side.

### 2. Binding resolution — new [js/gesture-binding.js](../../../js/gesture-binding.js)

A classic script exposing `window.GestureBinding`, registered in
`content_scripts` before `content.js` (enforced by `tests/load-order.test.mjs`)
and in every extension page that loads `content.js` — `pages/options.html`,
`pages/about.html`, `pages/css-editor.html` (enforced by
`tests/page-content-deps.test.mjs`).
It holds the decision logic so it can be unit-tested; `content.js` only calls
it.

```js
GestureBinding.resolve(rawPattern, lookup)
// → { rawPattern, effectivePattern, binding }
```

`lookup(pattern)` returns the binding for a pattern or `undefined` if the
pattern has **no entry**. The caller decides what a binding is:

- mouse gestures: always one shape, `{ action, ...config }`. With
  customisation on it is the `mouseGestures` entry as stored; with
  customisation off it is `DEFAULT_GESTURES[pattern]` wrapped as `{ action }`.
  Consumers read `binding.action` and the configuration from the same object
  and never look anything up by pattern again;
- super drag: the list of drag configs for that direction (empty list = no
  entry).

Resolution:

1. `lookup(raw)` has an entry → use it, **even if its action is `none`**.
2. Otherwise collapse every run of equal directions to one (`↓↓→` → `↓→`). If
   that differs from `raw` and `lookup(collapsed)` has an entry → use it.
3. Otherwise → `{ effectivePattern: raw, binding: undefined }`.

**Missing entry means "inherit", an entry with `none` means "block".** A user
who records `↓↓` and leaves or sets it to "none" switches `↓↓` off; to get the
fallback back they delete the gesture. Newly recorded gestures are stored with
`none` until an action is chosen, so they block from the moment they exist —
that is intended. A basic gesture set to `none` still yields nothing when a
repeat collapses onto it.

Every decision in `content.js` consumes the **same resolved object**, never the
raw pattern:

- mouse: `executeGesture` (action *and* `mouseGestures[...]` config),
  `getActionName` (all its custom-name lookups), HUD arrows;
- super drag: `hasDragAction` (drop acceptance / `preventDefault`),
  `getDragHints`, `executeDragGesture`, HUD arrows.

**HUD arrows show `effectivePattern`.** An unbound long `↓` is displayed as
`↓`, exactly as today; `↓↓` appears only when `↓↓` itself has an entry.

### 3. HUD suggestions

`GestureBinding.suggestionBase(rawPattern, patterns, isActive)` returns the
pattern to compute suggestions from:

- `raw`, if some pattern **directly** extends it (starts with `raw`, longer
  than `raw`) and is active — has an entry whose action is not `none`; no
  fallback is applied for this check;
- otherwise the collapsed pattern.

`getSuggestedGestures` computes its list from that base and returns the base
with the items. **The whole pipeline works on the base**: prefix match,
candidate length (`base.length + 1`) and the sort key's next direction
(`candidate[base.length]`) all use it, and the HUD shows the base completions
as stored (`↓→`, not a virtual `↓↓→`) — consistent with the HUD arrows, which
also show the effective pattern. Without any bound repeated gesture the HUD therefore looks
exactly as it does today; a disabled `↓↓→` does not keep `↓→` from being
suggested.

### 4. Recorder — [js/components/gesture-recorder.js](../../../js/components/gesture-recorder.js)

`open()` gains `recognizerConfig` — `{ distanceThreshold, longGestureMultiplier,
repeatDistance, repeatPause }` — and builds its recognizer from it (source
`'pointer'` for the mouse recorder; the drag recorder records with the mouse as
well, so `'pointer'` too). The recorder never resolves: it records the raw
pattern, and `bannedPatterns` compares raw patterns.

Data path: `options-page` derives `recognizerConfig` from its settings and

- passes it to `open()` of its own gesture recorder;
- sets it as a new `recognizerConfig` property on all three
  `drag-gesture-manager` instances, which pass it to both of their `open()`
  calls.

### 5. Settings

| key | default | `MERGE_MAP` | UI |
| --- | --- | --- | --- |
| `gestureRepeatDistance` | `400` | `scalar` | slider 0–600 px, step 10, 0 = off |
| `gestureRepeatPause` | `500` | `scalar` | slider 0–2000 ms, step 50, 0 = off |

Both live in the advanced section of the options page next to
`distanceThreshold` / `gestureTurnTolerance`, each with an inline reset. The
content script passes them to its recognizer alongside the existing values; the
recognizer's normalisation also covers malformed stored or imported values.

**Both off is allowed and intentional.** Repeated gestures then can neither be
drawn nor recorded; existing bindings stay stored. A notice under the sliders
says so while both are 0.

i18n: new keys use the `fork` prefix (`forkGestureRepeatDistance`,
`forkGestureRepeatDistanceDesc`, `forkGestureRepeatPause`,
`forkGestureRepeatPauseDesc`, `forkGestureRepeatOffNotice`), exist in `en` and
`de` only and are listed in `PENDING_TRANSLATION`.

### 6. Tests

- `tests/gesture-recognizer.test.mjs` (new):
  - long stroke → `↓↓`; single move event beyond `repeatDistance` at
    activation → `↓↓`;
  - **regression:** ↓ 420 px then → 25 px drift with defaults → still `↓↓`
    (turn tolerance not lost after a repeat);
  - `repeatDistance` below `2 × distanceThreshold` is raised to it;
  - pointer pause → `↓↓`; pause then turn → `↓→` with only
    `distanceThreshold` of travel (segment length reset by the pause);
    pause then release → `↓`; jitter ≤ 6 px is still; slow cumulative drift
    beyond 6 px is not a pause;
  - drag: sparse samples 550 ms apart while moving → no repeat; stationary
    samples spanning the pause → `↓↓`;
  - slow pre-activation movement → no pause;
  - cap at two; cap-rejected pause is consumed;
  - repeat sets `directionChanged`/`direction`/`pattern`;
  - omitted config, 0, negative, `Infinity`, string → off/clamped;
    `updateConfig({ repeatPause: 0 })` turns it off;
  - null / decreasing timestamps never arm a pause;
  - with both off, existing patterns (`↓→`, `↑↓`, …) unchanged.
- `tests/gesture-binding.test.mjs` (new): raw entry wins; collapse to entry,
  **binding object (config, custom name) comes from the effective pattern**;
  `↓↓→` → `↓→`; `↓↓→→` → `↓→`; explicit `none` blocks; nothing → raw/undefined; drag-list
  lookup; `suggestionBase` with a direct active prefix, a disabled raw prefix,
  and mixed repeated/non-repeated descendants.
- `load-order.test.mjs` covers the new script; `settings-merge.test.mjs` the
  two keys; `site-menu-locales.test.mjs` the i18n keys.
- **Manual browser check** (Edge with `--load-extension`, mouse and touchpad,
  at default zoom and 150 %): unbound repeats behave as today including HUD;
  bound `↓↓` via long stroke and via pause; super drag likewise, including drop
  acceptance; customised `↓` (custom name, scroll distance) still applies via
  fallback; recorder records `↓↓` in both places; both off shows the notice;
  tutorial unchanged; defaults (400 px, 500 ms, 6 px) feel right — adjust
  before release if not.
- **Decision point — drag pause.** Hold a super drag still on mouse and on
  touchpad. If the 6 px radius does not reliably register a pause there
  (hand drift, touchpad flutter while `dragover` keeps firing), pause is
  switched off for `source: 'drag'` — long stroke only for super drag — and
  this spec is amended accordingly. Not tuned blindly in code.

Known cosmetic difference: `arrowsToSvg` draws single corners like `↓→` as one
curved glyph (`CORNER_SVG`), while `↓↓→` is drawn as separate arrows. Accepted;
no new glyphs.

## Success criteria

1. With no repeated gesture bound, every existing gesture and drag gesture
   behaves as before — action, configuration, HUD label, HUD arrows and
   suggestions.
2. A bound `↓↓` fires via a long stroke and via a pause, for mouse gestures and
   super drag; a continuously moving drag never produces one.
3. Both triggers can be switched off and tuned in the options page; the
   recorders record with the live values.
4. `npm test` is green.
