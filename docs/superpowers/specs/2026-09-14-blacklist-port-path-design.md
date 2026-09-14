# Design: a blacklist entry that can name a port and a path

- **Date:** 2026-09-14
- **Status:** approved by the user (brainstorming completed)
- **Issue:** [#6](https://github.com/PPP01/Gestura/issues/6)
- **Revised 2026-09-14** after a review that found three blocking defects in the
  first draft: normalization widened an entry with an explicit default port into a
  host-wide one (§2), the matcher was registered in three lists when it needs five
  (§4), and area selection stayed live on a path-blocked page (§5). The review's
  three further points — one state doing two jobs (§5), an undefined winner among
  several matching entries (§7), and lowercasing a path (§2) — are folded in as
  well. §7 resolves the ambiguity differently from the way the review proposed;
  the reason is given there.
- **Revised again 2026-09-14**, after a review of the resulting plan found the
  load-bearing assumption of §5 to be false. The draft said the guard lambdas "are
  already evaluated on every gesture"; they are not — an `EventManager` condition
  is read only in `update()`, to decide whether to *attach* a listener, and
  `update()` runs from one place. Without a change to `EventManager` the feature
  would not have worked at all in either direction. §5 now specifies a live gate,
  and with it a full transient-state reset, since `resetState()` leaves three
  flags standing that would survive a round trip through a blocked path.
- **Leaves out, on purpose, with a ticket each:**
  [#7](https://github.com/PPP01/Gestura/issues/7) — a path entry reaching into
  the page's iframes; [#8](https://github.com/PPP01/Gestura/issues/8) — a quick
  toggle that can choose page, port or domain. §11 says why.

## 1 · Goal and occasion

A blacklist entry can only name a host. `#addDomain()` in
`js/components/blacklist-manager.js` runs the input through `new URL()` and keeps
`url.hostname` alone, so `localhost:3000` is stored as `localhost`, and
`http://localhost:3001/galaxy-patrol.html` is stored as `localhost` too. Nothing
is said about it; the entry simply comes out broader than what was typed.

The occasion is a game at `http://localhost:3001/galaxy-patrol.html` that uses the
right mouse button as a game control. Today the only way to silence gestures there
is to blacklist `localhost` outright, which takes them away from every other local
development site at the same time.

Reached when:

- an entry can carry a port, a path, or both, and means exactly that;
- an entry that names only a host keeps meaning precisely what it means today —
  the whole host — with no migration and no change a user could notice;
- **no input is ever stored as something broader than what was typed**;
- one matcher answers the question, and every place that asks uses it;
- a path entry keeps working when a single-page app changes its route without
  reloading the document.

**Non-goal:** wildcards, regular expressions, or any syntax to learn. §3 says why
the pattern system the project already has is not the right tool here.

## 2 · The rule

An entry is canonically `host[:port][/path]` — **the host lowercased, the path
left exactly as typed**, no scheme, no query, no fragment, no trailing slash.

Case is split because URLs are: a host is case-insensitive by definition, a path
is not. `/Game` and `/game` may be two different resources, so folding the path
would silently blacklist something the user did not name.

An entry matches a URL when all three hold:

1. **Host** is exactly equal, after lowercasing both.
2. **Port**: if the entry names one, the URL's **effective** port must equal it.
   If the entry names none, the port does not participate.
3. **Path**: if the entry names one, the URL's `pathname` must equal it or begin
   with it followed by `/`, compared **case-sensitively**. If the entry names
   none, the path does not participate.

Query and fragment never participate.

| entry | matches | does not match |
|---|---|---|
| `localhost` | every port, every path on the host | `127.0.0.1` |
| `localhost:3000` | everything on that port | `localhost:8080/app` |
| `localhost:3001/galaxy-patrol.html` | that page, `?x=1` and `#top` included | `…/galaxy-patrol.html.bak` |
| `localhost:3001/games` | `/games`, `/games/pong` | `/gameszone`, `/Games` |
| `example.com:443` | `https://example.com/…` | `http://example.com/…` |

The path comparison breaking at `/` is what keeps `/games` from swallowing
`/gameszone`. It is also the reason the rule needs no syntax: the boundary is a
property of paths, not something the user has to mark.

### Default ports: the effective port on both sides

**The scheme is ignored** — `http` and `https` match alike, because asking a user
to tell them apart would mean two entries for one page.

Default ports are the one place where that cannot hold, and the first draft got it
badly wrong. The URL API *removes* a port that is the default for its scheme:

```
new URL('https://example.com:443').port === ''      // gone
new URL('http://example.com:80').port  === ''       // gone
new URL('https://example.com:80').port === '80'     // kept — not https's default
```

Normalizing through `new URL('https://' + input)` therefore turned
`example.com:443` into the entry `example.com` — silently widening a request for
one port into a block on the entire host, the exact failure this change exists to
prevent — while `example.com:80` survived intact. Inconsistent *and* dangerous.

Two rules close it:

**Parsing keeps every port.** `normalize` parses under a non-special scheme, which
has no default port, so nothing is ever dropped. §6 has the details.

**Matching compares effective ports.** A URL's effective port is `url.port` when
it is set, otherwise `443` for `https:` and `80` for `http:`. So `example.com:443`
matches `https://example.com` — which is what someone typing it means — and does
not match `http://example.com`, whose effective port is 80.

This does let a port entry distinguish the schemes, which sounds like a
contradiction of "the scheme is ignored". It is not: the user brought the
distinction in by naming a port. An entry meant to cover a host regardless of
scheme is written `example.com`, and that stays true.

### A trailing slash is not available as a marker

Using `localhost:3000/` for "this page only" was considered and rejected.
`localhost:3000` and `localhost:3000/` are *the same URL* to the parser — both
have `pathname === "/"` and the same `href` — so the distinction lives only in the
raw input string and survives no round trip through the URL API. It would also be
invisible in the tag list, one character apart for opposite meanings, in a feature
whose failure mode is silent.

What the rule therefore cannot express is "the front page but not what is below
it". No use for that has come up. If one does, an explicit `localhost:3000/*` for
"everything below" can be added later without changing anything decided here.

## 3 · Why not the pattern system that already exists

`js/menu-patterns.js` and `matchesPatterns` (`js/search-url.js:48`) already match
URLs for website menus, with `*` wildcards. They are the wrong tool here, for two
reasons.

`patternToRegExp` builds an **unanchored** regular expression: `*hostname*`
becomes `/.*hostname.*/i` and is tested against the whole URL. A blacklist entry
built that way would match anywhere in the string — `evil.com/?ref=localhost:3000`
would match an entry meant for a local dev server. For a website menu a loose
match offers a menu that was not wanted; for the blacklist it silently removes
gestures from an unrelated site. It is also case-insensitive throughout, which §2
just established is wrong for paths.

And the stored entries are bare hostnames today. Turning them into patterns means
either a migration or a special case that reads a pattern-less string as an
implicit host match — work in exchange for a syntax the user did not ask for and
the decided rule does not need.

The two systems stay separate. This is worth stating because from a distance they
look like the same problem.

## 4 · One matcher, five registrations

The blacklist is consulted in four places, each with its own
`blacklist.includes(hostname)`:

| place | asks |
|---|---|
| `js/content.js:2095` `checkBlacklist()` | should this frame have gestures |
| `js/components/popup-page.js:362` | is the current tab blocked, and may the switch act |
| `js/background.js:1982` | should the context menu offer to unblock |
| `js/background.js:2175` | the context menu's toggle |

Four exact-string comparisons are four correct implementations of "is this host in
the list". Four *prefix* matchers would be four chances to drift. So the rule lives
in one file.

### `js/blacklist-match.js`

A classic script in the shape of `js/menu-patterns.js` — an IIFE that hangs an
object on the global and also exports through `module.exports` so the tests can
import it. Named `GesturaBlacklist`, following the newer files
(`GesturaSettingsStorage`, `GesturaEuLocal`); the inherited `FlowMouse*` names stay
as they are.

```
normalize(input)              -> canonical entry string, or null if unusable
parse(entry)                  -> { host, port, path } or null
matches(url, entry)           -> boolean
matchingEntries(url, entries) -> every entry that matches, in list order
evaluate(loc, entries)        -> { originBlocked, pathEntries }
pathMatches(pathname, path)   -> boolean
```

`matchingEntries` returns **all** matches rather than the first, because §7 needs
to know whether the bare host is the *only* reason a page is blocked. A function
returning one of several matches would make the popup's behaviour depend on the
order the user happened to add entries in.

`evaluate` is the state computation §5 needs, kept here as a pure function of a
location-like object and the list so it can be tested without a DOM.

`pathMatches` is exported because the hot path in §5 needs it without re-parsing a
URL, and because it is where the `/games` vs `/gameszone` boundary lives.

### It loads in five places, not three

A classic script needs registering wherever it is used, and this one is used by
content scripts, by the worker, and by two extension pages:

| where | why |
|---|---|
| `content_scripts` in `manifest.json` | before `js/content.js` |
| `importScripts` in `js/background.js` | the context menu paths |
| `background.scripts` in the Firefox manifest (`firefox-build`) | Firefox has no `importScripts` |
| `pages/popup.html` | before the `popup-page.js` module |
| `pages/options.html` | before `content.js` at line 50 |

Missing any of them surfaces only at runtime, as `GesturaBlacklist is not defined`
— at `document_start` in every frame, or when the popup opens.

Both pages load their components as `<script type="module">`, which is deferred
and therefore always runs after the classic scripts; the binding constraint on
`options.html` is `content.js` at line 50, which is classic and must come after.

**Test coverage for the registrations.** `tests/load-order.test.mjs` takes the
first three — but its Gecko block asserts only that the list *begins with* the
first two files (`tests/load-order.test.mjs:49`), so a missing
`blacklist-match.js` there would pass unnoticed. It needs an assertion of its own,
skipped on `main` the way the existing one is and load-bearing after the merge:
`js/blacklist-match.js` must appear in `background.scripts` before
`js/background.js`.

`tests/page-content-deps.test.mjs` already asserts that every page loading
`content.js` loads its dependencies first — adding `blacklist-match.js` to
`REQUIRED_BEFORE_CONTENT` covers `options.html`. `popup.html` loads neither
`content.js` nor `i18n.js` in the shape those blocks look for and so falls through
every existing assertion; it needs its own, by the same shape: any page loading
`popup-page.js` must load `blacklist-match.js` before it.

## 5 · Static and live: where host, port and path part ways

A host and a port are fixed for the life of a document. A path is not — a
single-page app changes its route through the History API without reloading
anything. That difference, not the matching, is the only structural change here.

**Host and port entries keep today's arrangement exactly.** They are decided once,
from `location` and from the outermost entry of `location.ancestorOrigins` (an
origin carries scheme, host and port, so this keeps working unchanged), and when
one matches, `initGestures()` is never called. Nothing is attached to a page whose
gestures are off for good.

**Path entries are decided per event**, through a mechanism `EventManager` does
not have yet.

The first draft claimed the guard lambdas (`js/content.js:2591-2594`) "are already
evaluated on every gesture". They are not. A binding's `condition` is read only in
`update()` (`js/content.js:233`), to decide whether the listener is *attached*;
the registered `safeHandler` (`:215`) checks `e.isTrusted` and calls straight
through. And `update()` runs from exactly one place, `loadSettings()` (`:2403`).
A condition is an **attach** condition, not a runtime one.

Left uncorrected, the feature would not work at all: a page entered on an allowed
path keeps its listeners after routing onto a blocked one, and a page entered on a
blocked path never gets them back.

So `EventManager` gains a second kind of condition — one re-read on every event:

```js
	setLiveGate(fn) { this._liveGate = fn; return this; }

	// inside add(), replacing the body of safeHandler:
	const safeHandler = (e) => {
		if (!e.isTrusted) return;
		if (condition && this._liveGate && !this._liveGate()) return;
		handler(e);
	};
```

**The gate applies only to bindings that carry a condition.** That one clause is
what makes this cheap. A binding registered with `null` is a cleanup handler —
`pageshow`, `visibilitychange`, `pagehide`, `blur`, Escape — and those must keep
running on a page whose gestures are off, or the state they clear is stranded
across the transition. Bindings with a condition are the ones that *do* something,
and they are exactly the set that should fall silent. No `add()` call site
changes; the attach conditions keep their present meaning and simply lose the path
from their reckoning.

This still needs no `popstate` listener, no monkey-patching of
`history.pushState`, and no `webNavigation` permission — and patching the page's
own `history` is worth avoiding for its own sake, since frameworks patch it too
and the extension runs in every frame of every site.

### Three states, not one

The first draft mapped both the computed blacklist verdict and the permanent hard
stops onto a single `originBlocked`, which recomputes on every settings change —
so a later edit to the blacklist would have resurrected gestures after
`pauseGesture` or after the extension context went invalid. They are separate:

```js
let hardStopped = false;     // pauseGesture, dispose, invalid context — one way, never recomputed
let originBlocked = false;   // host/port/ancestor verdict — recomputed on settings change
let livePathEntries = [];    // parsed path entries whose host+port match this document
let gateBlocked = false;     // last value, for edge detection

function blockedNow() {
	if (hardStopped || originBlocked) return true;
	if (livePathEntries.length === 0) return false;
	return livePathEntries.some(e => GesturaBlacklist.pathMatches(location.pathname, e.path));
}
```

`hardStopped` is what `pauseGesture` (`:2512`), the dispose event (`:2609`) and
the invalid-context path (`:2625`) set. `originBlocked` and `livePathEntries` come
from `GesturaBlacklist.evaluate()` at settings load and in the `onChanged` handler
that already watches `blacklist` and `enableBlacklist` (`:2121`).

For every page without a path entry on its host, `blockedNow()` is one
`length === 0` per gesture.

`initGestures()` runs whenever `originBlocked` is false, *including* when a path
entry matches at load time — otherwise routing away from a blocked path could
never restore gestures.

### What each kind of guard now carries

The attach conditions lose the path and keep everything else: the four lambdas
(`:2591-2594`) read `originBlocked` where they read `isBlacklisted`, and so does
the `contextmenu` guard (`:2784`). The `openSiteMenuOverlay` message handler
(`:2418`) is not an `EventManager` binding and reads `blockedNow()` directly.

**`isAreaSelectModifierEnabled` (`:2872`) needs no change at all.** It has no
blacklist check today — harmless so far, because a blacklisted page never reaches
`initGestures()` and its four listeners (`:2875`, `:2886`, `:2914`, `:2918`) are
never attached. Under this design a path-blocked page does reach it, and area
selection would stay live on a page the user silenced. The live gate closes that
without touching the lambda, because it is a binding *with* a condition. Adding an
explicit check there as well would be redundant, and the first draft's instruction
to do so is withdrawn.

The listeners registered with `null` — `pageshow` (`:2758`), `visibilitychange`
(`:2767`), `pagehide` (`:2774`), `pointerdown` (`:2863`), `keydown`/Escape
(`:3346`) and `blur` (`:3443`) — are outside the gate by the same rule that
defines it. Every one only *clears* state. They must keep running on a blocked
page, and gating them would strand exactly the state the next section is about.

**`update()` has to run when the verdict changes.** The inner `onChanged` handler
returns early when `blacklist` is the only changed key (`:2409`) — an optimisation
that is now wrong, because a blacklist edit can flip `originBlocked` and the
listeners have to be re-attached or dropped accordingly. The early return goes;
`loadSettings()` still excludes `blacklist` from `SETTINGS` (`:2339`), which stays
right.

### Crossing from allowed to blocked

A route change during a held gesture would otherwise strand the recognizer: the
gate starts refusing, so `pointermove` and `pointerup` no longer reach their
handlers, nothing calls `resetState()`, and the trail overlay stays on screen.

The live gate is therefore the function that notices the edge:

```js
eventManager.setLiveGate(() => !refreshGate());

function refreshGate() {
	const now = blockedNow();
	if (now && !gateBlocked) resetTransientState();
	gateBlocked = now;
	return now;
}
```

The cleanup has to happen in the *gate* rather than in a handler, because a
handler behind a closed gate is precisely what does not run.

**`resetState()` is not enough.** It resets the recognizer and `gestureState`
(`:2536-2551`) and leaves three flags standing that only the ungated cleanup
handlers ever clear:

| flag | left set | what it does on the way back |
|---|---|---|
| `wheelGestureTriggered` (`:2754`) | after a wheel gesture | suppresses the next `contextmenu` (`:2790`) |
| `rockerGestureTriggered` (`:2755`) | after a rocker gesture | the same |
| `areaSelectPending` (`:2874`) | between modifier-press and drag | an old selection resumes on the next `pointermove` |

Routing into a blocked path and back out would carry any of them across. So the
edge runs one operation that clears all of it:

```js
function resetTransientState() {
	resetState();
	wheelGestureTriggered = false;
	rockerGestureTriggered = false;
	areaSelectPending = null;
	visualizer.cleanup();
	toaster.cleanup();
	ctxMenu.close();
	window.FlowMouseAreaSelect?.exit();
}
```

Both live inside `initGestures()`, where `resetState`, the overlays and those
three flags are in scope; the four state variables live in the enclosing IIFE
alongside today's `isBlacklisted`. They are declared after the point where
`refreshGate` sits, which is safe because nothing calls it until a listener fires,
and no listener is attached until `update()` runs from `loadSettings()`.

The edge is noticed at the next event rather than at the instant of navigation —
for a held gesture, the next `pointermove`.

## 6 · Input and display

`#addDomain()` (`js/components/blacklist-manager.js:139`) calls `normalize()` and
stores what comes back.

`normalize` must not lose a default port (§2), so it does not parse under
`https://`. It strips any scheme the user typed and parses under a **non-special**
scheme, which the URL standard gives no default port:

```js
const stripped = input.trim().replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
const u = new URL('gestura://' + stripped);        // no default port, nothing dropped
const host = u.hostname.toLowerCase();             // not folded by this scheme — do it here
const path = u.pathname.replace(/\/+$/, '');       // '' and '/' both mean "no path"
return host + (u.port ? ':' + u.port : '') + path;
```

Verified against the four cases that matter: `example.com:443` keeps its port,
`[::1]:3000` parses as host `[::1]` port `3000`, `/Games` keeps its case, and
query and fragment fall away on their own. A parse failure yields `null`.

A non-special scheme does *not* lowercase the host the way `https:` does, which is
why the `.toLowerCase()` is explicit — and is also what leaves the path untouched,
exactly as §2 requires.

The existing host plausibility check stays — `if (!domain.includes('.') && domain
!== 'localhost')` rejects a hostname with no dot — but it now runs against the
**host part only**, so `localhost:3000` and `localhost:3001/galaxy-patrol.html`
pass while a typo like `lcoalhost` still does not.

The tag shows the canonical form: typing `http://localhost:3001/galaxy-patrol.html`
produces `localhost:3001/galaxy-patrol.html`. The duplicate check compares
canonical forms, so the same page entered two ways is caught.

## 7 · The quick toggle stays host-wide

The popup switch and its context-menu twin keep writing and removing the bare
hostname. They read `matchingEntries(url, list)`:

| `matchingEntries` | switch | acting on it |
|---|---|---|
| empty | off, enabled | adds the hostname |
| exactly `[hostname]` | on, enabled | removes it |
| anything else | on, **disabled**, names what blocks | — |

**Why not "the bare host entry wins".** The review proposed that a matching bare
host entry take precedence, so the toggle stays actionable. That produces a worse
outcome in the case it is meant to fix: with both `example.com` and
`example.com/path` stored and the user on `/path`, the toggle would be enabled,
the click would delete `example.com` — and the page would stay blocked by
`example.com/path`, so the switch snaps straight back to "on". The user has lost
an entry and achieved nothing.

Requiring the match set to be *exactly* the bare host removes the ambiguity the
review correctly identified, without that failure: when anything finer is also in
play, the switch declines and says so. `matchingEntries` returning all matches in
list order makes this deterministic regardless of insertion order.

The note names the entry that is **not** the bare host. With both stored, the
first match may be the host, and "blocked by localhost" would give a reason that
does not explain why the switch is inert.

**The disabled state has to be visible.** `css/common.css` styles `.toggle` and
its slider but has no rule for a disabled one, and `.toggle .slider` sets
`cursor: pointer` unconditionally (`css/common.css:122`). The `disabled` attribute
alone stops the click and changes nothing a user can see, which reads as a broken
control rather than a refused one. So the switch also needs a reduced opacity and
`cursor: not-allowed`, and — because a `title` tooltip is not reachable by
keyboard or screen reader — `aria-disabled` plus the reason as the accessible
name, not only as a tooltip.

Taking the block off every page under a path because the user wanted it off this
one is worse than asking them to walk one screen further. The context menu says
the same with `enabled: false` on its item.

This is a deliberate floor, not the finished shape —
[#8](https://github.com/PPP01/Gestura/issues/8) carries the three-way choice that
would let the quick path create a fine entry.

## 8 · i18n

One new string: the note naming what blocks the page, used by both the popup and
the context-menu item.

**It must use `{entry}` and `.replace()`, never `$ENTRY$`.** An undeclared
`$WORD$` makes `chrome.i18n` read a placeholder that is not declared and the
extension fails to load entirely; `tests/locale-placeholders.test.mjs` guards it.

`blacklist` is not in `NEW_KEY_PREFIXES` in `tests/site-menu-locales.test.mjs`, so
a new `blacklist*` key would have to land in all 39 locales at once. Add
`blacklist` to that list and the new key to `PENDING_TRANSLATION`: that is the
mechanism the project already has for a string that ships in `en` and `de` first,
and CLAUDE.md names `PENDING_TRANSLATION` the release checklist, so the key cannot
quietly stay untranslated. The existing `blacklist*` keys are already in all 39
locales and stay green when the prefix is added.

Two existing strings change wording in `en` and `de` by hand, because they now
describe something wider — `blacklistPlaceholder` ("Enter domain, e.g.
example.com…") and `invalidDomain`. No test catches a changed wording in the other
37 locales; they are named here so the release notices them.

## 9 · Storage shape, and why there is no migration

`blacklist` stays `string[]`. It is `set` in `MERGE_MAP`
(`js/settings-merge.js:114`) and `[]` in `DEFAULT_SETTINGS`
(`js/constants.js:295`); a set merge over strings keeps working as long as the
entries stay strings. Objects would mean a new merge kind, a schema change and a
migration, for something the string form expresses exactly.

No migration is needed in the other direction either: an existing entry is a bare
hostname, and by §2 a bare hostname matches every port and every path on that host
— which is what it does today.

## 10 · Tests

**`tests/blacklist-match.test.mjs`** (new), against `js/blacklist-match.js`:

- `normalize`: scheme stripped, host folded, **path case preserved**, trailing
  slash dropped, `/` alone is no path, query and fragment dropped, junk yields
  `null`, and `normalize(normalize(x)) === normalize(x)`.
- **`normalize('example.com:443') === 'example.com:443'`** and the same for `:80`
   — the regression that the first draft would have shipped.
- `normalize('[::1]:3000')` keeps host and port.
- `matches`: every row of §2's table, both ways.
- effective ports: `example.com:443` matches `https://example.com` and not
  `http://example.com`; `example.com:80` the mirror image.
- the boundary: `/games` matches `/games` and `/games/pong`, not `/gameszone`,
  not `/gam`, **not `/Games`**.
- a bare hostname matches every port and path — the compatibility guarantee.
- `matchingEntries`: with `['example.com', 'example.com/path']` and a URL on
  `/path`, both come back, in list order, and reversing the stored order does not
  change the result — the determinism §7 rests on.
- `evaluate`: a host entry yields `originBlocked`, a path entry on a matching
  host+port yields a `pathEntries` item, a path entry on a *different* port yields
  neither, and an `ancestorOrigin` argument reproduces today's iframe behaviour.

**`tests/load-order.test.mjs`** gains `js/blacklist-match.js` in the three script
lists.

**`tests/page-content-deps.test.mjs`** gains `blacklist-match.js` in
`REQUIRED_BEFORE_CONTENT`, plus the new assertion for `popup.html` from §4.

**`tests/site-menu-locales.test.mjs`** exercises the new prefix through its
existing assertions once `blacklist` is added.

`refreshGate()`, the live gate and the popup switch remain untested end to end —
`js/content.js` is one long IIFE whose top level touches `chrome.*`, and the
components need a DOM. The answer is to leave as little untested logic there as
possible: `evaluate` carries the state computation and is tested above, the
matching is tested above, and what stays in `content.js` is variable assignment,
one edge comparison (`now && !gateBlocked`) and one clause in `safeHandler`. The
popup's rule is likewise a comparison against `matchingEntries`, whose output is
tested.

What that leaves has to be checked by hand, and the transient-state cases are the
ones a reader would not think to try:

1. A path entry blocks its page; gestures work one path over.
2. Area selection does not start on the blocked path — the guard that had none.
3. Routing into the blocked path and back out turns gestures off and on.
4. **Hold a wheel or rocker gesture, route into the blocked path, route back:** the
   next right-click must open the page's own context menu. A stranded
   `wheelGestureTriggered` would swallow it.
5. **Press the area-select modifier, route into the blocked path, route back, move
   the pointer:** no selection rectangle may appear from the old press.
6. Removing the entry restores gestures without a reload — this is the path that
   needs `update()` to run on a blacklist-only change.
7. `pauseGesture`, then edit the blacklist: gestures stay off.

## 11 · Explicitly not done

- **A path entry does not reach into the page's iframes** —
  [#7](https://github.com/PPP01/Gestura/issues/7). `ancestorOrigins` yields
  origins without a path, so this needs the worker as a detour, and a way back out
  of a teardown that today is one-way. Host and port entries silence frames
  exactly as before.
- **The quick toggle cannot create a fine entry** —
  [#8](https://github.com/PPP01/Gestura/issues/8).
- **No wildcards.** §2.
- **`version_name`, releases, the Firefox branch** — untouched, except that
  `js/blacklist-match.js` must be added to `background.scripts` when this merges
  into `firefox-build`.

## 12 · Decomposition for the plan phase

1. `js/blacklist-match.js` with its tests — `normalize`, `parse`, `matches`,
   `pathMatches`, `matchingEntries`, `evaluate`. Registered in all five places,
   with `load-order` and `page-content-deps` extended. Nothing calls it yet; the
   suite is green.
2. `#addDomain()` and the tag rendering move to `normalize`. Entries can now be
   created with a port and a path; nothing matches them yet, which is visible and
   harmless.
3. `EventManager.setLiveGate` and the one clause in `safeHandler`. On its own this
   changes nothing — no gate is set yet — so it lands green and separately from
   what uses it.
4. `content.js`: the four states, `blockedNow()`, `refreshGate()`,
   `resetTransientState()`, the attach conditions, and the early return at `:2409`
   that has to go. The feature works from here.
5. The popup and the context menu: `matchingEntries`, the disabled state and its
   styling, the new string in `en` and `de`, the prefix and the
   `PENDING_TRANSLATION` entry.
6. The reworded strings, and a pass over `docs/` if the blacklist is described
   anywhere.

Steps 1-4 are the feature; 5 keeps the quick paths honest about what they can and
cannot do. Each step leaves the suite green.

## 13 · Locked decisions

- Prefix matching that breaks at `/`; no syntax, no wildcards.
- Host lowercased and compared case-insensitively; path preserved and compared
  case-sensitively.
- Normalization parses under a non-special scheme so no port is ever dropped;
  matching compares effective ports.
- A trailing slash means nothing — it cannot survive the URL parser.
- Host and port decided once per document, as attach conditions; path decided per
  event, through a live gate in `EventManager`.
- The live gate applies only to bindings that carry a condition — the `null` ones
  are cleanup handlers and must keep running on a blocked page.
- The crossing into blocked runs `resetTransientState()`, which clears the three
  flags `resetState()` does not.
- Four separate states: `hardStopped`, `originBlocked`, `livePathEntries`,
  `gateBlocked`.
- No `popstate` listener and no patching of the page's `history`.
- One matcher in `js/blacklist-match.js`, registered in five places, with the
  Gecko list asserted separately.
- `blacklist` stays `string[]`, `set` in `MERGE_MAP`, no migration.
- The quick toggle is actionable only when the match set is exactly the bare host.
- The menu pattern system is not reused.
