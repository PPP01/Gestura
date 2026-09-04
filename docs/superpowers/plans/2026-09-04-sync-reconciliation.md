# Sync Reconciliation (three-way merge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third button, **Sync**, to every gestura.eu state row: a three-way merge of base, local and remote settings that takes over every one-sided change without a question, asks only where both sides changed the same entry, keeps deletions deleted without tombstones, and stakes its upload on the `412` write token that already exists.

**Architecture:** One new pure classic script, `js/settings-merge.js`, declares what an entry is (`MERGE_MAP`) and does the whole merge with one decision table (`mergeEntry`) shared by every kind of key; `apply` turns the user's answers into the final object. A second classic script, `js/eu-sync-base.js`, owns the `euSyncBase` storage key: the gzipped payload this browser last agreed on per state plus the server's `payloadHash` for it. `uploadState` in `js/eu-sync.js` returns the `payloadHash` it computed, because the base needs it and nothing else knows it. The panel runs the loop — download, merge, ask, preview, upload, then write locally and store the base — and a new Lit dialog asks the questions.

**Tech Stack:** Manifest V3, plain JS classic scripts (IIFE + `root.X = api` + `module.exports` for vitest), Lit (vendored `js/lib/lit-all.min.js`), `CompressionStream`/`DecompressionStream` (gzip), `crypto.randomUUID`, vitest (`npm test`, Node 24).

**Spec:** [docs/superpowers/specs/2026-09-04-sync-reconciliation-design.md](../specs/2026-09-04-sync-reconciliation-design.md). The plan argues from the spec; read both. Section numbers below (§3, §5 …) are the spec's.

**Predecessor:** [2026-09-04-storage-move-design.md](../specs/2026-09-04-storage-move-design.md) and its plan, [2026-09-04-storage-move.md](2026-09-04-storage-move.md). This plan's **Tasks 1–6 need nothing from it** and can be built now. **Task 7 needs its Task 9** (gzip in `GesturaSyncCrypto`); **Tasks 8–10 need its Task 10** (`forSync`, `opts.local`, `MAX_BYTES`). The exact names, as that plan defines them:

| from the storage-move plan | used here as |
|---|---|
| `GesturaSyncCrypto.gzip(bytes) → Promise<Uint8Array>`, `gunzipBounded(bytes, max) → Promise<Uint8Array>` (throws `Error('decrypt')` past `max`) — its Task 9 | the base store's compression (Task 7) |
| `GesturaSettingsSchema.buildExport(settings, ver, { forSync: true })` — its Task 10 | the sync shape of the merged result |
| `GesturaSettingsSchema.validate(input, { forSync: true, local })` — its Task 10; with `forSync` the seven device-local keys are filled from `local`, the settings currently in storage, not from the defaults | validating remote, base and result so that the adopt path never touches `theme`. **Always pass `local: settingsStore.current`** — without it the defaults win |
| `GesturaSettingsSchema.validatedExport(settings, ver, opts)` and the panel's `#validatedExport(opts)`, which already adds `forSync: true` — its Task 10 | the local side of the merge |
| `GesturaSettingsSchema.DEVICE_LOCAL` (a `Set` of the seven keys) — its Task 10 | Task 1 keeps its own array so it can be built first; once the Set exists, the test in Task 1 also asserts the two agree |
| `MAX_BYTES === 1048576` in `js/eu-settings-schema.js` — its Task 10 | the size check on the merged result before upload (§3 step 7a) |
| the measured 512 KiB envelope check inside `uploadState` — its Task 9 | already exists today as `payload.length > LIMITS.payloadMaxBytes`; the gzip only changes what is measured |

## Global Constraints

- **No build step.** The repo folder *is* the unpacked extension. New `js/*.js` files are classic scripts (IIFE, `root.GesturaX = api`, `module.exports` for vitest); components under `js/components/` are ES modules. Never mix the two worlds. A classic script reaches another only through `root.*`.
- **Indentation is tabs**, throughout, in JS, JSON and Markdown code blocks alike.
- **Internal `FlowMouse*` identifiers stay.** New globals use the `Gestura*` prefix: `GesturaSettingsMerge`, `GesturaSyncBase`.
- **i18n: en and de only, every new key listed in `PENDING_TRANSLATION`** in `tests/site-menu-locales.test.mjs`. All new keys start with `euSync`, which is already in `NEW_KEY_PREFIXES`, so a key missing from `PENDING_TRANSLATION` fails the 39-locale test immediately.
- **Never put an undeclared `$WORD$` into a message.** Use `{token}` with `.replace()`; `tests/locale-placeholders.test.mjs` guards it.
- **No contract change.** `docs/gestura-eu-api.md` is not touched. No new request field, no `apiLevel` bump. The only change to `js/eu-sync.js` is the return value of `uploadState` (Task 6).
- **`version_name` in `manifest.json` is generated** — never edit it; do not bump `version` in this plan.
- **Registration in `pages/options.html`:** the two new classic scripts go after `../js/eu-sync.js`; the new component module goes before `eu-sync-panel.js`. No content script and no service worker loads any of this — nothing changes in `manifest.json` or the Firefox manifest.
- **Every test in this plan runs with `npx vitest run <file>`** and the full suite with `npm test`; the suite must stay green after every task.

---

## Decisions taken in this plan (2026-09-04)

Where the spec leaves the implementer a choice, or where the code forces a detail the spec did not name:

1. **The reuse key of a conflict is built from canonical JSON, not from a hash.** §3 says answers are remembered under `(path, id, hashOf(mine), hashOf(theirs))`. `hashOf` is async and the merge is synchronous; `FlowMouseEuIntegration.canonicalize` gives the same identity as a string. Conflicts are few and entries small, so the key is `path \0 id \0 canonical(mine) \0 canonical(theirs)`. `settings-merge.js` therefore depends on `js/eu-integration.js`, exactly as `js/eu-settings-schema.js` already does.
2. **The result of `merge()` holds the local value for a conflicted entry.** The spec says `merge` decides nothing; it still has to put *something* in `result` so that `result` is a complete settings object before `apply`. The local value is the preselected `Mine` of §7, so `apply` with no choices equals "keep all mine".
3. **A `keyed-list` is written back remote-first, local-only items appended** — not in the sequence of its `order` key. `js/engine-registry.js` sorts by `searchEngines.order` at read time, so the array sequence of `custom` carries no meaning; coupling the write-back to a sibling key would add a rule for nothing.
4. **Write order in the panel is upload → local write → base, with the base written from inside the adopt path.** `#applySettings` in `options-page.js` reloads the page right after the save; a base written after that call would never run. So the `gestura:settings-apply` event gains an optional `afterSave` callback that runs between the save and the reload. Download uses the same hook. That is exactly §3's 7b–7d, and a failed save writes no base.
5. **The 1 MiB check on the merged result goes through `validate` on the JSON text.** `validate(string)` refuses over `MAX_BYTES`, which the storage-move plan raises to 1 MiB — the same ceiling the façade enforces on write. Passing `JSON.stringify(exportObj)` instead of the object costs one parse and buys the check without a second formula.
6. **`deepEqual` in `settings-store.js` is not exported**, so the spec's "one test runs both copies" cannot import it. The copy in `settings-merge.js` is pinned by tests on the same cases instead (nested objects, arrays vs objects, `null`, `undefined`), and a comment names the original.
7. **`Both` is offered on exactly three paths** — `siteMenus.custom` (`menu_` ids), `actionChains` (`chain_` ids), `searchEngines.custom` (`engine_` ids) — the prefixes the managers generate today. `menuAppend.items` has generated `item_` ids too, but its entries are actions, not named things; two of the same action is a duplicate, not a second entry.
8. **The `Sync` button shows only for states with a base**; `GesturaSyncBase.list()` returns the hashes without inflating anything, and the panel reads it after every listing.
9. **The retry bound is three `412`s per press**; the fourth surfaces today's conflict UI (reload / overwrite anyway).
10. **Version skew is checked with `GesturaEuUpdates.isNewer(candidate, known)`**, which already exists in `js/eu-updates.js` and is loaded on the options page.

## File Structure

| file | responsibility |
|---|---|
| `js/settings-merge.js` (new) | `MERGE_MAP`, `DEVICE_LOCAL`, `deepEqual`, `mergeEntry`, `merge`, `apply`. Pure. Depends on `root.FlowMouseEuIntegration.canonicalize` only. |
| `tests/settings-merge.test.mjs` (new) | everything in the file above |
| `js/eu-sync-base.js` (new) | the `euSyncBase` key: `list`, `read`, `write`, `remove`, `prune`, `clear`, and the two gzip helpers. Depends on `root.GesturaSyncCrypto` for base64 and `STATE_ID_RE`. |
| `tests/eu-sync-base.test.mjs` (new) | everything in the file above |
| `js/eu-sync.js` (modify, `uploadState`) | returns `{ ...answer, payloadHash }` |
| `tests/eu-sync.test.mjs` (extend) | the return value |
| `js/components/options-page.js` (modify, `#applySettings`) | accepts `{ settings, afterSave }` |
| `js/components/eu-sync-panel.js` (modify) | bases on upload/download/delete/list; the `Sync` loop; the merge dialog wiring |
| `js/components/sync-merge-dialog.js` (new) | the conflict dialog of §7 |
| `pages/options.html` (modify) | three script tags |
| `_locales/en/messages.json`, `_locales/de/messages.json` (modify) | new `euSyncMerge*` keys |
| `tests/site-menu-locales.test.mjs` (modify) | `PENDING_TRANSLATION` |
| `CHANGELOG.md` (modify) | one line under `### Unreleased` |

---

## Task 1: `MERGE_MAP` and the partition guard — `js/settings-merge.js`

**Files:**
- Create: `js/settings-merge.js`
- Create: `tests/settings-merge.test.mjs`

**Interfaces:**
- Consumes: `window.GestureConstants.DEFAULT_SETTINGS` (test only), `GesturaSettingsSchema.NEVER` (test only)
- Produces: `GesturaSettingsMerge.MERGE_MAP`, `.DEVICE_LOCAL`, `.spec(raw)`, `.deepEqual(a, b)` — used by every later task

- [ ] **Step 1: Write the failing tests**

```js
// tests/settings-merge.test.mjs
import { describe, it, expect, beforeAll } from 'vitest';

let M, S, DEFAULTS;

beforeAll(async () => {
	// constants.js is a browser IIFE that assigns to window.GestureConstants -
	// the same shim tests/settings-defaults.test.mjs uses.
	globalThis.window = globalThis;
	await import('../js/constants.js');
	await import('../js/eu-integration.js');
	await import('../js/eu-settings-schema.js');
	await import('../js/settings-merge.js');
	M = globalThis.GesturaSettingsMerge;
	S = globalThis.GesturaSettingsSchema;
	DEFAULTS = globalThis.GestureConstants.DEFAULT_SETTINGS;
});

describe('MERGE_MAP', () => {
	// The guard of spec §4: three disjoint sets that together are DEFAULT_SETTINGS.
	// Of NEVER's three members only lastSyncTime is in DEFAULT_SETTINGS; the other
	// two are separate storage.local keys and never reach this loop.
	it('puts every key of DEFAULT_SETTINGS in exactly one of MERGE_MAP, DEVICE_LOCAL, NEVER', () => {
		for (const key of Object.keys(DEFAULTS)) {
			const n = [key in M.MERGE_MAP, M.DEVICE_LOCAL.includes(key), S.NEVER.has(key)].filter(Boolean).length;
			expect(n, `${key} is in ${n} sets`).toBe(1);
		}
	});

	it('names no key DEFAULT_SETTINGS does not have', () => {
		for (const key of Object.keys(M.MERGE_MAP)) expect(key in DEFAULTS, key).toBe(true);
		for (const key of M.DEVICE_LOCAL) expect(key in DEFAULTS, key).toBe(true);
	});

	it('names every fixed child of a container, and only those', () => {
		for (const [key, raw] of Object.entries(M.MERGE_MAP)) {
			const s = M.spec(raw);
			if (s.kind !== 'container') continue;
			expect(Object.keys(s.children).sort(), key).toEqual(Object.keys(DEFAULTS[key]).sort());
		}
	});

	it('uses only the five kinds plus container', () => {
		const walk = (raw) => {
			const s = M.spec(raw);
			expect(['scalar', 'record', 'keyed-list', 'set', 'order', 'container']).toContain(s.kind);
			if (s.kind === 'keyed-list') expect(typeof s.key).toBe('string');
			if (s.kind === 'order') expect(typeof s.of).toBe('string');
			if (s.both) expect(typeof s.idPrefix).toBe('string');
			if (s.kind === 'container') Object.values(s.children).forEach(walk);
		};
		Object.values(M.MERGE_MAP).forEach(walk);
	});

	it('does not offer Both for edited copies, overrides or drag gestures', () => {
		expect(M.spec(M.spec(M.MERGE_MAP.siteMenus).children.edited).both).toBeFalsy();
		expect(M.spec(M.spec(M.MERGE_MAP.searchEngines).children.overrides).both).toBeFalsy();
		expect(M.spec(M.MERGE_MAP.textDragGestures).both).toBeFalsy();
	});
});

describe('deepEqual', () => {
	// The copy of settings-store.js's deepEqual (not exported there), pinned on
	// the cases the merge relies on.
	it('compares by value, not by reference', () => {
		expect(M.deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
	});
	it('tells arrays from objects and null from undefined', () => {
		expect(M.deepEqual([], {})).toBe(false);
		expect(M.deepEqual(null, undefined)).toBe(false);
		expect(M.deepEqual(undefined, undefined)).toBe(true);
		expect(M.deepEqual(null, null)).toBe(true);
	});
	it('sees a missing key', () => {
		expect(M.deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
		expect(M.deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/settings-merge.test.mjs`
Expected: FAIL — `Cannot find module '../js/settings-merge.js'`

- [ ] **Step 3: Write the module**

```js
// js/settings-merge.js
// The three-way merge of two browsers' settings against a stored base
// (docs/superpowers/specs/2026-09-04-sync-reconciliation-design.md).
//
// Pure: no chrome.*, no DOM, no i18n. Loaded as a classic script on the
// options page and imported by vitest. Its one dependency is
// FlowMouseEuIntegration.canonicalize, for the reuse key of a conflict.
//
// MERGE_MAP is the decision this file exists for: every synced key of
// DEFAULT_SETTINGS gets exactly one kind, declared, never inferred. A new key
// without an entry fails tests/settings-merge.test.mjs - deliberately, because
// silently treating a record-shaped key as one opaque scalar would turn every
// future menu-shaped feature into an all-or-nothing conflict.
(function (root) {
	'use strict';

	// The seven keys the storage-move design (§7) keeps out of the sync payload.
	// Listed here so the partition test can prove nothing falls between the maps.
	const DEVICE_LOCAL = [
		'theme', 'language', 'macLinuxHintDismissed', 'edgeGestureConflict',
		'navCollapsed', 'engineManagerLocalOnly', 'sectionAdvanced',
	];

	// Kinds (spec §4):
	//   scalar      the key as a whole; one value, compared deeply
	//   record      object of entries, identity = the child's own name
	//   keyed-list  array of entries, identity = a named field in each item
	//   set         array of primitives, identity = the element itself; never asks
	//   order       an array of ids that is presentation order, not data; never asks
	//   container   fixed children, each with its own kind
	// `both: true` marks a record/keyed-list whose ids are generated, so a
	// conflict may be answered with "keep both" and the incoming copy gets a
	// fresh id with `idPrefix`.
	const MERGE_MAP = {
		enableDragFeatures: 'scalar',
		enableAreaSelect: 'scalar',
		enableSearchEngines: 'scalar',
		enableSiteMenus: 'scalar',
		enableBlacklist: 'scalar',
		enableContextMenu: 'scalar',
		enableGesture: 'scalar',
		gestureTriggerButtons: { kind: 'container', children: {
			right: 'scalar', middle: 'scalar', side1: 'scalar', side2: 'scalar', penRight: 'scalar',
		} },
		enableHUD: 'scalar',
		enableSuggestedGestures: 'scalar',
		enableTrail: 'scalar',
		showTrailOrigin: 'scalar',
		enableTrailSmooth: 'scalar',
		enableGestureCustomization: 'scalar',
		mouseGestures: 'record',
		enableTextDrag: 'scalar',
		textDragIgnoreInput: 'scalar',
		textDropIgnoreInput: 'scalar',
		enableImageDrag: 'scalar',
		enableLinkDrag: 'scalar',
		linkDropIgnoreInput: 'scalar',
		textDragGestures: { kind: 'keyed-list', key: 'direction' },
		linkDragGestures: { kind: 'keyed-list', key: 'direction' },
		imageDragGestures: { kind: 'keyed-list', key: 'direction' },
		hudBgColor: 'scalar',
		hudTextColor: 'scalar',
		hudBlurRadius: 'scalar',
		enableHudShadow: 'scalar',
		trailColor: 'scalar',
		trailColorEnd: 'scalar',
		enableTrailGradient: 'scalar',
		showTrailArrow: 'scalar',
		enableTrailGlow: 'scalar',
		trailWidth: 'scalar',
		customCss: 'scalar',
		distanceThreshold: 'scalar',
		gestureTurnTolerance: 'scalar',
		showRestrictedNotice: 'scalar',
		enableWheelGestures: 'scalar',
		wheelGestures: 'record',
		enableSpecialGestures: 'scalar',
		specialGestures: 'record',
		areaSelectModifierKey: 'scalar',
		areaSelectTextUrl: 'scalar',
		areaSelectWarnThreshold: 'scalar',
		areaSelectDelay: 'scalar',
		actionChains: { kind: 'record', both: true, idPrefix: 'chain_' },
		siteMenus: { kind: 'container', children: {
			disabled: 'set',
			edited: 'record',
			custom: { kind: 'record', both: true, idPrefix: 'menu_' },
			domains: 'record',
			// Declared after `custom`: the order rule drops ids whose custom entry
			// this merge deleted, and containers merge their children in this order.
			order: { kind: 'order', of: 'custom' },
			flags: 'record',
			defaultMenuId: 'scalar',
		} },
		menuAppend: { kind: 'container', children: {
			enabled: 'scalar',
			items: { kind: 'keyed-list', key: 'id' },
		} },
		customMenuSwitcher: { kind: 'container', children: { enabled: 'scalar', position: 'scalar' } },
		customMenuTheme: 'scalar',
		menuOpenBehavior: 'scalar',
		searchEngines: { kind: 'container', children: {
			overrides: 'record',
			hidden: 'set',
			custom: { kind: 'keyed-list', key: 'id', both: true, idPrefix: 'engine_' },
			order: { kind: 'order', of: 'custom' },
		} },
		blacklist: 'set',
		enableBlacklistContextMenu: 'scalar',
		ctxMenuAddSite: 'scalar',
		ctxMenuAssignSite: 'scalar',
		ctxMenuSiteMenu: 'scalar',
		ctxMenuSiteMenuMode: 'scalar',
		ctxMenuSiteMenuId: 'scalar',
		ctxMenuOptions: 'scalar',
		siteMenuAddAsk: 'scalar',
	};

	// A map entry is either a kind name or an object with `kind`.
	function spec(raw) {
		return typeof raw === 'string' ? { kind: raw } : raw;
	}

	// A copy of deepEqual in js/settings-store.js, which is an ES module with
	// chrome.* access and does not export it. "Changed" must mean here exactly
	// what it means there; tests/settings-merge.test.mjs pins the behaviour.
	function deepEqual(a, b) {
		if (a === b) return true;
		if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
		if (Array.isArray(a) !== Array.isArray(b)) return false;
		const ka = Object.keys(a);
		const kb = Object.keys(b);
		if (ka.length !== kb.length) return false;
		for (const k of ka) {
			if (!kb.includes(k) || !deepEqual(a[k], b[k])) return false;
		}
		return true;
	}

	const api = { MERGE_MAP, DEVICE_LOCAL, spec, deepEqual };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSettingsMerge = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/settings-merge.test.mjs`
Expected: PASS, 8 tests. If the partition test names a key, the map and `DEFAULT_SETTINGS` have drifted — fix the map, never the test.

Once the storage-move plan's Task 10 has landed (`GesturaSettingsSchema.DEVICE_LOCAL` exists as a `Set`), add this test to the `MERGE_MAP` block so the two lists cannot drift apart:

```js
	it('agrees with the schema on which keys are device-local', () => {
		expect([...M.DEVICE_LOCAL].sort()).toEqual([...S.DEVICE_LOCAL].sort());
	});
```

- [ ] **Step 5: Commit**

```bash
git add js/settings-merge.js tests/settings-merge.test.mjs
git commit -m "feat(sync): MERGE_MAP - every synced key gets exactly one kind, guarded against DEFAULT_SETTINGS"
```

---

## Task 2: `mergeEntry`, `record`, `scalar`, `container` — the ten cases

**Files:**
- Modify: `js/settings-merge.js`
- Modify: `tests/settings-merge.test.mjs`

**Interfaces:**
- Produces: `GesturaSettingsMerge.mergeEntry(b, l, r) → { value, status }`, `.merge(base, local, remote) → { result, conflicts, summary }`; a conflict is `{ path, id, kind, mine, theirs, canKeepBoth, key }`; `summary` is `{ taken, uploaded, deleted, unchanged }`. `merge` reads only `MERGE_MAP` keys of its three inputs and returns only those.

- [ ] **Step 1: Write the failing tests**

Append to `tests/settings-merge.test.mjs`:

```js
// A settings object holding only what a test is about. merge() reads MERGE_MAP
// keys and treats a missing key as absent, so this is a complete input.
// `chains` is a bare record (usable from Task 2 on); `menus` sits inside the
// siteMenus container, whose `set` and `order` children exist from Task 3 on.
const chains = (custom) => ({ actionChains: custom });
const menus = (custom) => ({ siteMenus: { custom } });
const A = { name: 'A', items: [] };
const A1 = { name: 'A edited here', items: [] };
const A2 = { name: 'A edited there', items: [] };

describe('mergeEntry - the decision table of spec §5', () => {
	const t = (b, l, r) => M.mergeEntry(b, l, r);
	it('row 1: new over there -> taken', () => expect(t(undefined, undefined, A)).toEqual({ value: A, status: 'taken' }));
	it('row 2: new here -> uploaded', () => expect(t(undefined, A, undefined)).toEqual({ value: A, status: 'uploaded' }));
	it('row 3: only remote moved -> taken', () => expect(t(A, A, A2)).toEqual({ value: A2, status: 'taken' }));
	it('row 4: only local moved -> uploaded', () => expect(t(A, A1, A)).toEqual({ value: A1, status: 'uploaded' }));
	it('row 5: deleted over there -> deleted', () => expect(t(A, A, undefined)).toEqual({ value: undefined, status: 'deleted' }));
	it('row 6: deleted here -> stays deleted, and that is uploaded', () => expect(t(A, undefined, A)).toEqual({ value: undefined, status: 'uploaded' }));
	it('row 7: both moved -> conflict', () => expect(t(A, A1, A2).status).toBe('conflict'));
	it('row 8: deleted here, changed there -> conflict', () => expect(t(A, undefined, A2).status).toBe('conflict'));
	it('row 9: changed here, deleted there -> conflict', () => expect(t(A, A1, undefined).status).toBe('conflict'));
	it('row 10: both created the same id differently -> conflict', () => expect(t(undefined, A1, A2).status).toBe('conflict'));
	it('the trivial combinations are unchanged', () => {
		expect(t(A, A, A).status).toBe('unchanged');
		expect(t(undefined, A, A).status).toBe('unchanged');
		expect(t(A, A1, A1).status).toBe('unchanged');
		expect(t(A, undefined, undefined).status).toBe('unchanged');
	});
	it('compares by value, not by reference', () => {
		expect(t(A, { ...A }, { name: 'A', items: [] }).status).toBe('unchanged');
	});
	it('a conflict carries the local value', () => expect(t(A, A1, A2).value).toEqual(A1));
});

describe('merge - record entries', () => {
	it('takes a new remote entry without a question', () => {
		const m = M.merge(chains({}), chains({}), chains({ c1: A }));
		expect(m.result.actionChains).toEqual({ c1: A });
		expect(m.conflicts).toEqual([]);
		expect(m.summary.taken).toBe(1);
	});
	it('keeps a locally deleted entry deleted even though remote still has it', () => {
		const m = M.merge(chains({ c1: A }), chains({}), chains({ c1: A }));
		expect(m.result.actionChains).toEqual({});
		expect(m.summary.uploaded).toBe(1);
	});
	it('deletes here what was deleted over there', () => {
		const m = M.merge(chains({ c1: A, c2: A }), chains({ c1: A, c2: A }), chains({ c2: A }));
		expect(m.result.actionChains).toEqual({ c2: A });
		expect(m.summary).toEqual({ taken: 0, uploaded: 0, deleted: 1, unchanged: 1 });
	});
	it('reports one conflict per entry both sides changed, with path, id and both values', () => {
		const m = M.merge(chains({ c1: A }), chains({ c1: A1 }), chains({ c1: A2 }));
		expect(m.conflicts).toHaveLength(1);
		const c = m.conflicts[0];
		expect(c).toMatchObject({ path: 'actionChains', id: 'c1', kind: 'record', mine: A1, theirs: A2, canKeepBoth: true });
		expect(typeof c.key).toBe('string');
		expect(m.result.actionChains.c1).toEqual(A1);
	});
	it('does not offer Both when one side deleted', () => {
		const m = M.merge(chains({ c1: A }), chains({}), chains({ c1: A2 }));
		expect(m.conflicts[0].canKeepBoth).toBe(false);
		expect(m.conflicts[0].mine).toBeUndefined();
	});
	it('does not offer Both for a record without generated ids', () => {
		const g = (action) => ({ mouseGestures: { '←': { action } } });
		const m = M.merge(g('back'), g('newTab'), g('closeTab'));
		expect(m.conflicts[0]).toMatchObject({ path: 'mouseGestures', id: '←', canKeepBoth: false });
	});
	it('gives two conflicts with the same values the same key, and a changed theirs a new one', () => {
		const a = M.merge(chains({ c1: A }), chains({ c1: A1 }), chains({ c1: A2 })).conflicts[0].key;
		const b = M.merge(chains({ c1: A }), chains({ c1: A1 }), chains({ c1: { ...A2 } })).conflicts[0].key;
		const c = M.merge(chains({ c1: A }), chains({ c1: A1 }), chains({ c1: { name: 'A3', items: [] } })).conflicts[0].key;
		expect(a).toBe(b);
		expect(a).not.toBe(c);
	});
});

describe('merge - scalars and containers', () => {
	it('takes a one-sided scalar change silently and asks on a two-sided one', () => {
		const one = M.merge({ trailWidth: 5 }, { trailWidth: 5 }, { trailWidth: 8 });
		expect(one.result.trailWidth).toBe(8);
		expect(one.conflicts).toEqual([]);
		const two = M.merge({ trailWidth: 5 }, { trailWidth: 6 }, { trailWidth: 8 });
		expect(two.conflicts[0]).toMatchObject({ path: 'trailWidth', id: '', kind: 'scalar', mine: 6, theirs: 8, canKeepBoth: false });
		expect(two.result.trailWidth).toBe(6);
	});
	it('merges the fixed children of a container each on their own', () => {
		const b = { gestureTriggerButtons: { right: true, middle: false } };
		const l = { gestureTriggerButtons: { right: true, middle: true } };
		const r = { gestureTriggerButtons: { right: false, middle: false } };
		const m = M.merge(b, l, r);
		expect(m.result.gestureTriggerButtons).toEqual({ right: false, middle: true });
		expect(m.conflicts).toEqual([]);
	});
	it('merges an undeclared child of a container as a scalar', () => {
		const m = M.merge({ customMenuSwitcher: {} }, { customMenuSwitcher: {} }, { customMenuSwitcher: { futureKey: 1 } });
		expect(m.result.customMenuSwitcher).toEqual({ futureKey: 1 });
	});
	it('returns only MERGE_MAP keys, and no empty containers for keys nobody has', () => {
		const m = M.merge({}, { theme: 'dark', gesturaSettings: 1, _version: '1' }, { theme: 'light' });
		expect(Object.keys(m.result)).toEqual([]);
		expect(m.conflicts).toEqual([]);
		expect(m.summary).toEqual({ taken: 0, uploaded: 0, deleted: 0, unchanged: 0 });
	});
	it('counts the summary from what the result contains', () => {
		const m = M.merge(
			{ trailWidth: 5, hudBlurRadius: 5, customCss: '', actionChains: { c1: A } },
			{ trailWidth: 5, hudBlurRadius: 6, customCss: '', actionChains: { c1: A } },
			{ trailWidth: 8, hudBlurRadius: 5, customCss: '', actionChains: {} },
		);
		expect(m.summary).toEqual({ taken: 1, uploaded: 1, deleted: 1, unchanged: 1 });
		// taken: trailWidth · uploaded: hudBlurRadius · deleted: c1 · unchanged: customCss
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/settings-merge.test.mjs`
Expected: FAIL — `M.mergeEntry is not a function`

- [ ] **Step 3: Implement**

Insert before `const api = …` in `js/settings-merge.js`:

```js
	const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
	const arr = (v) => (Array.isArray(v) ? v : []);
	const union = (...lists) => [...new Set(lists.flat())];
	const get = (o, k) => (isObj(o) ? o[k] : undefined);

	// The one decision table (spec §5), shared by every kind. `undefined` is
	// absence, so the ten rows and the trivial combinations fall out of three
	// comparisons:
	//   local == remote           nothing to decide (rows: all equal, both made
	//                             the same change, both created the same entry)
	//   local == base             only remote moved: take theirs, or delete
	//   remote == base            only local moved: keep mine (also a deletion)
	//   none of the above         both moved: ask
	// A conflict carries the local value, so `result` is complete before apply().
	function mergeEntry(b, l, r) {
		if (deepEqual(l, r)) return { value: l, status: 'unchanged' };
		if (deepEqual(l, b)) return r === undefined ? { value: undefined, status: 'deleted' } : { value: r, status: 'taken' };
		if (deepEqual(r, b)) return { value: l, status: 'uploaded' };
		return { value: l, status: 'conflict' };
	}

	// What an answer is remembered under across a 412 retry (spec §3): the same
	// question again gets the same key, a question whose `theirs` moved does not.
	function conflictKey(path, id, mine, theirs) {
		const C = root.FlowMouseEuIntegration.canonicalize;
		return [path, id, C(mine === undefined ? null : mine), C(theirs === undefined ? null : theirs)].join('\u0000');
	}

	function pushConflict(ctx, path, id, kind, s, l, r) {
		ctx.conflicts.push({
			path, id, kind, mine: l, theirs: r,
			// Both needs two values to keep; a deletion against an edit has one.
			canKeepBoth: !!(s.both && l !== undefined && r !== undefined),
			key: conflictKey(path, id, l, r),
		});
	}

	function count(ctx, status) {
		if (status in ctx.summary) ctx.summary[status]++;
	}

	function mergeScalar(ctx, path, s, b, l, r) {
		const e = mergeEntry(b, l, r);
		if (e.status === 'conflict') pushConflict(ctx, path, '', 'scalar', s, l, r);
		else count(ctx, e.status);
		return e.value;
	}

	function mergeRecord(ctx, path, s, b, l, r) {
		const B = isObj(b) ? b : {};
		const L = isObj(l) ? l : {};
		const R = isObj(r) ? r : {};
		const out = {};
		for (const id of union(Object.keys(L), Object.keys(R), Object.keys(B))) {
			const e = mergeEntry(B[id], L[id], R[id]);
			if (e.status === 'conflict') pushConflict(ctx, path, id, 'record', s, L[id], R[id]);
			else count(ctx, e.status);
			if (e.value !== undefined) out[id] = e.value;
		}
		return out;
	}

	// Fixed children, each by its own kind, in the declared order - so a sibling
	// declared later (`order`) can see what the merge did to one declared
	// earlier (`custom`). A child the map does not name is merged as a scalar:
	// with newer-version payloads refused (spec §3) it can only come from this
	// browser's own storage.
	function mergeContainer(ctx, path, s, b, l, r) {
		const B = isObj(b) ? b : {};
		const L = isObj(l) ? l : {};
		const R = isObj(r) ? r : {};
		const out = {};
		const sib = { spec: s, b: B, l: L, r: R, out };
		for (const child of union(Object.keys(s.children), Object.keys(L), Object.keys(R), Object.keys(B))) {
			const cs = spec(s.children[child] || 'scalar');
			const v = mergeValue(ctx, path + '.' + child, cs, B[child], L[child], R[child], sib);
			if (v !== undefined) out[child] = v;
		}
		return out;
	}

	function mergeValue(ctx, path, s, b, l, r, sib) {
		// A key nobody has is not an empty record, it is nothing: no entry in the
		// result, nothing counted.
		if (b === undefined && l === undefined && r === undefined) return undefined;
		switch (s.kind) {
			case 'scalar': return mergeScalar(ctx, path, s, b, l, r);
			case 'record': return mergeRecord(ctx, path, s, b, l, r);
			case 'container': return mergeContainer(ctx, path, s, b, l, r);
			default: throw new Error('settings-merge: unknown kind ' + s.kind);
		}
	}

	// base, local, remote: settings objects (validated, sync shape). Keys outside
	// MERGE_MAP - the format field, _version, device-local keys - are ignored on
	// the way in and absent on the way out.
	function merge(base, local, remote) {
		const ctx = { conflicts: [], summary: { taken: 0, uploaded: 0, deleted: 0, unchanged: 0 } };
		const result = {};
		for (const [key, raw] of Object.entries(MERGE_MAP)) {
			const v = mergeValue(ctx, key, spec(raw), get(base, key), get(local, key), get(remote, key), null);
			if (v !== undefined) result[key] = v;
		}
		return { result, conflicts: ctx.conflicts, summary: ctx.summary };
	}
```

Extend the api line:

```js
	const api = { MERGE_MAP, DEVICE_LOCAL, spec, deepEqual, mergeEntry, merge };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/settings-merge.test.mjs`
Expected: PASS. The tests in this task deliberately avoid `siteMenus` and `searchEngines`: those containers hold `set`, `order` and `keyed-list` children, which `mergeValue` throws on until Tasks 3 and 4 — and a container merges *all* its declared children, so any test touching `siteMenus` would hit `set` first.

- [ ] **Step 5: Commit**

```bash
git add js/settings-merge.js tests/settings-merge.test.mjs
git commit -m "feat(sync): merge() - one decision table for record, scalar and container"
```

---

## Task 3: `set` and `order`

**Files:**
- Modify: `js/settings-merge.js`
- Modify: `tests/settings-merge.test.mjs`

**Interfaces:**
- Consumes: `mergeEntry`, `mergeValue`, `sib` from Task 2
- Produces: `mergeSet`, `mergeOrder` reachable through `merge()`

- [ ] **Step 1: Write the failing tests**

Append:

```js
describe('merge - set', () => {
	const bl = (list) => ({ blacklist: list });
	it('keeps what was added on either side', () => {
		const m = M.merge(bl(['a.com']), bl(['a.com', 'b.com']), bl(['a.com', 'c.com']));
		expect(m.result.blacklist.sort()).toEqual(['a.com', 'b.com', 'c.com']);
		expect(m.conflicts).toEqual([]);
	});
	it('drops what was removed on either side, and what both removed', () => {
		const m = M.merge(bl(['a.com', 'b.com', 'c.com']), bl(['a.com', 'b.com']), bl(['a.com', 'c.com']));
		expect(m.result.blacklist).toEqual(['a.com']);
		const both = M.merge(bl(['a.com', 'b.com']), bl(['a.com']), bl(['a.com']));
		expect(both.result.blacklist).toEqual(['a.com']);
	});
	it('never reports a conflict for a set', () => {
		const m = M.merge(bl(['a.com']), bl(['b.com']), bl(['c.com']));
		expect(m.conflicts).toEqual([]);
		expect(m.result.blacklist.sort()).toEqual(['b.com', 'c.com']);
	});
	it('counts added-there as taken, added-here as uploaded, removed-there as deleted', () => {
		const m = M.merge(bl(['a.com']), bl(['a.com', 'b.com']), bl(['c.com']));
		expect(m.summary).toMatchObject({ taken: 1, uploaded: 1, deleted: 1 });
	});
	it('tolerates a set that is not an array', () => {
		expect(M.merge(bl(null), bl('x'), bl(['a.com'])).result.blacklist).toEqual(['a.com']);
	});
});

describe('merge - order', () => {
	const sm = (order, custom = {}) => ({ siteMenus: { order, custom } });
	it('keeps a local-only reorder when remote equals the base', () => {
		const m = M.merge(sm(['a', 'b', 'c']), sm(['c', 'a', 'b']), sm(['a', 'b', 'c']));
		expect(m.result.siteMenus.order).toEqual(['c', 'a', 'b']);
		expect(m.conflicts).toEqual([]);
	});
	it('takes a remote-only reorder', () => {
		const m = M.merge(sm(['a', 'b', 'c']), sm(['a', 'b', 'c']), sm(['b', 'c', 'a']));
		expect(m.result.siteMenus.order).toEqual(['b', 'c', 'a']);
	});
	it('lets remote win when both reordered, without a conflict', () => {
		const m = M.merge(sm(['a', 'b', 'c']), sm(['c', 'b', 'a']), sm(['b', 'a', 'c']));
		expect(m.result.siteMenus.order).toEqual(['b', 'a', 'c']);
		expect(m.conflicts).toEqual([]);
	});
	it('appends a local-only id at the end', () => {
		const m = M.merge(sm(['a', 'b']), sm(['a', 'b', 'menu_new'], { menu_new: A }), sm(['b', 'a']));
		expect(m.result.siteMenus.order).toEqual(['b', 'a', 'menu_new']);
	});
	it('drops an id whose custom entry the merge deleted, but never a catalogue id', () => {
		// `search` is a catalogue id: never in `custom`, so never dropped.
		const m = M.merge(
			sm(['search', 'menu_x'], { menu_x: A }),
			sm(['search', 'menu_x'], { menu_x: A }),
			sm(['search'], {}),
		);
		expect(m.result.siteMenus.custom).toEqual({});
		expect(m.result.siteMenus.order).toEqual(['search']);
	});
	it('drops an id deleted here that the untouched remote order still lists', () => {
		const m = M.merge(
			sm(['search', 'menu_x'], { menu_x: A }),
			sm(['search'], {}),
			sm(['search', 'menu_x'], { menu_x: A }),
		);
		expect(m.result.siteMenus.order).toEqual(['search']);
	});
	it('works for the engine order against a keyed-list', () => {
		const se = (order, custom) => ({ searchEngines: { order, custom } });
		const e = { id: 'engine_x', name: 'X', url: 'https://x/?q=%s' };
		const m = M.merge(se(['google', 'engine_x'], [e]), se(['google', 'engine_x'], [e]), se(['google'], []));
		expect(m.result.searchEngines.order).toEqual(['google']);
	});
});

describe('merge - records inside the siteMenus container', () => {
	it('merges custom menus like any record, with Both on offer', () => {
		const m = M.merge(menus({ m1: A }), menus({ m1: A1 }), menus({ m1: A2 }));
		expect(m.conflicts[0]).toMatchObject({ path: 'siteMenus.custom', id: 'm1', kind: 'record', canKeepBoth: true });
		expect(m.result.siteMenus.custom.m1).toEqual(A1);
	});
	it('does not offer Both for an edited catalogue copy', () => {
		const m = M.merge({ siteMenus: { edited: {} } }, { siteMenus: { edited: { search: A1 } } }, { siteMenus: { edited: { search: A2 } } });
		expect(m.conflicts[0]).toMatchObject({ path: 'siteMenus.edited', id: 'search', canKeepBoth: false });
	});
	it('leaves a domain attached to a menu the other side deleted (spec §7: resolvers tolerate it)', () => {
		const b = { siteMenus: { custom: { m1: A }, domains: {} } };
		const l = { siteMenus: { custom: {}, domains: {} } };
		const r = { siteMenus: { custom: { m1: A }, domains: { m1: 'example.com' } } };
		const m = M.merge(b, l, r);
		expect(m.result.siteMenus.custom).toEqual({});
		expect(m.result.siteMenus.domains).toEqual({ m1: 'example.com' });
		expect(m.conflicts).toEqual([]);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/settings-merge.test.mjs`
Expected: FAIL — `settings-merge: unknown kind set`

- [ ] **Step 3: Implement**

Insert before `function mergeValue` in `js/settings-merge.js`:

```js
	// A set is a record whose entries are their own names: presence is the
	// value. mergeEntry then never conflicts - an element present on both sides
	// is equal, one present on one side alone is either newly added or was
	// deleted from the base - and the summary comes out of the same table.
	function mergeSet(ctx, path, s, b, l, r) {
		const B = new Set(arr(b));
		const L = new Set(arr(l));
		const R = new Set(arr(r));
		const out = [];
		for (const x of union(arr(l), arr(r), arr(b))) {
			const e = mergeEntry(B.has(x) ? x : undefined, L.has(x) ? x : undefined, R.has(x) ? x : undefined);
			count(ctx, e.status);
			if (e.value !== undefined) out.push(x);
		}
		return out;
	}

	// The ids a record or keyed-list holds - for the order rule's "does this
	// entry still exist".
	function idsOf(s, value) {
		if (s.kind === 'keyed-list') return arr(value).map(it => (isObj(it) ? it[s.key] : undefined)).filter(id => typeof id === 'string');
		return isObj(value) ? Object.keys(value) : [];
	}

	// Spec §4: the same three-way rule as everything else, then the other
	// side's ids appended, then ids whose entry this merge deleted dropped.
	// Deleted = existed in the `of` sibling on some side, absent from the merged
	// sibling. Catalogue ids are never in `custom`, so never dropped.
	function mergeOrder(ctx, path, s, b, l, r, sib) {
		const B = arr(b);
		const L = arr(l);
		const R = arr(r);
		const chosen = deepEqual(R, B) ? L : R;
		const other = chosen === L ? R : L;
		let gone = new Set();
		if (sib && s.of) {
			const os = spec(sib.spec.children[s.of]);
			const existed = union(idsOf(os, sib.b[s.of]), idsOf(os, sib.l[s.of]), idsOf(os, sib.r[s.of]));
			const kept = new Set(idsOf(os, sib.out[s.of]));
			gone = new Set(existed.filter(id => !kept.has(id)));
		}
		const out = [];
		for (const id of [...chosen, ...other]) {
			if (!gone.has(id) && !out.includes(id)) out.push(id);
		}
		const sameL = deepEqual(out, L);
		const sameR = deepEqual(out, R);
		count(ctx, sameL && sameR ? 'unchanged' : sameL ? 'uploaded' : sameR ? 'taken' : 'uploaded');
		return out;
	}
```

Add the two cases to `mergeValue`:

```js
			case 'set': return mergeSet(ctx, path, s, b, l, r);
			case 'order': return mergeOrder(ctx, path, s, b, l, r, sib);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/settings-merge.test.mjs`
Expected: PASS. The last order test (`engine order against a keyed-list`) still fails with `unknown kind keyed-list` — that is Task 4. If you prefer a green run between tasks, mark that one test `it.skip` and unskip it in Task 4.

- [ ] **Step 5: Commit**

```bash
git add js/settings-merge.js tests/settings-merge.test.mjs
git commit -m "feat(sync): set and order merge - exact, deterministic, never a question"
```

---

## Task 4: `keyed-list`

**Files:**
- Modify: `js/settings-merge.js`
- Modify: `tests/settings-merge.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append:

```js
describe('merge - keyed-list', () => {
	const se = (custom) => ({ searchEngines: { custom } });
	const g = { id: 'engine_g', name: 'G', url: 'https://g/?q=%s' };
	const h = { id: 'engine_h', name: 'H', url: 'https://h/?q=%s' };
	const h1 = { ...h, name: 'H here' };
	const h2 = { ...h, name: 'H there' };

	it('identifies items by id, not by array position', () => {
		// h moved to index 0 on the remote side and was edited there; index-based
		// identity would compare g with h.
		const m = M.merge(se([g, h]), se([g, h]), se([h2, g]));
		expect(m.result.searchEngines.custom).toEqual([h2, g]);
		expect(m.conflicts).toEqual([]);
		expect(m.summary.taken).toBe(1);
	});
	it('keeps a local edit when remote only reordered', () => {
		const m = M.merge(se([g, h]), se([h1, g]), se([h, g]));
		expect(m.result.searchEngines.custom).toEqual([h1, g]);
		expect(m.summary.uploaded).toBe(1);
	});
	it('writes remote items first and appends local-only ones', () => {
		const x = { id: 'engine_x', name: 'X', url: 'https://x/?q=%s' };
		const m = M.merge(se([g]), se([g, x]), se([h, g]));
		expect(m.result.searchEngines.custom.map(e => e.id)).toEqual(['engine_h', 'engine_g', 'engine_x']);
	});
	it('reports a conflict with kind keyed-list and offers Both for custom engines', () => {
		const m = M.merge(se([h]), se([h1]), se([h2]));
		expect(m.conflicts[0]).toMatchObject({ path: 'searchEngines.custom', id: 'engine_h', kind: 'keyed-list', mine: h1, theirs: h2, canKeepBoth: true });
		expect(m.result.searchEngines.custom).toEqual([h1]);
	});
	it('does not offer Both for a drag gesture (fixed key)', () => {
		const d = (action) => ({ textDragGestures: [{ direction: '→', action }] });
		const m = M.merge(d('search'), d('copy'), d('openTab'));
		expect(m.conflicts[0]).toMatchObject({ path: 'textDragGestures', id: '→', canKeepBoth: false });
	});
	it('ignores an item without the key field', () => {
		const m = M.merge(se([]), se([{ name: 'no id' }]), se([g]));
		expect(m.result.searchEngines.custom).toEqual([g]);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/settings-merge.test.mjs`
Expected: FAIL — `settings-merge: unknown kind keyed-list`

- [ ] **Step 3: Implement**

Insert before `function mergeValue`:

```js
	function toMap(s, value) {
		const m = {};
		for (const it of arr(value)) {
			if (isObj(it) && typeof it[s.key] === 'string') m[it[s.key]] = it;
		}
		return m;
	}

	// A record keyed by a field inside each item, written back as an array:
	// remote items in their sequence, local-only items appended. The array's
	// own order carries no meaning - `searchEngines.order` does that job.
	function mergeKeyedList(ctx, path, s, b, l, r) {
		const B = toMap(s, b);
		const L = toMap(s, l);
		const R = toMap(s, r);
		const out = [];
		for (const id of union(Object.keys(R), Object.keys(L), Object.keys(B))) {
			const e = mergeEntry(B[id], L[id], R[id]);
			if (e.status === 'conflict') pushConflict(ctx, path, id, 'keyed-list', s, L[id], R[id]);
			else count(ctx, e.status);
			if (e.value !== undefined) out.push(e.value);
		}
		return out;
	}
```

Add to `mergeValue`:

```js
			case 'keyed-list': return mergeKeyedList(ctx, path, s, b, l, r);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/settings-merge.test.mjs`
Expected: PASS, all tests including the engine-order one from Task 3.

- [ ] **Step 5: Commit**

```bash
git add js/settings-merge.js tests/settings-merge.test.mjs
git commit -m "feat(sync): keyed-list merge - identity by field, never by array index"
```

---

## Task 5: `apply()` — Mine, Theirs, Both

**Files:**
- Modify: `js/settings-merge.js`
- Modify: `tests/settings-merge.test.mjs`

**Interfaces:**
- Produces: `GesturaSettingsMerge.apply(result, conflicts, choices, { stateName }) → object`. `choices` maps `conflict.key` → `'mine' | 'theirs' | 'both'`; a missing choice is `'mine'`. Never mutates its inputs.

- [ ] **Step 1: Write the failing tests**

Append:

```js
describe('apply', () => {
	const conflictOn = (b, l, r) => M.merge(menus(b), menus(l), menus(r));

	it('keeps mine by default and leaves the inputs alone', () => {
		const m = conflictOn({ m1: A }, { m1: A1 }, { m1: A2 });
		const before = structuredClone(m.result);
		const out = M.apply(m.result, m.conflicts, {}, { stateName: 'office' });
		expect(out.siteMenus.custom.m1).toEqual(A1);
		expect(m.result).toEqual(before);
	});
	it('takes theirs', () => {
		const m = conflictOn({ m1: A }, { m1: A1 }, { m1: A2 });
		const out = M.apply(m.result, m.conflicts, { [m.conflicts[0].key]: 'theirs' }, {});
		expect(out.siteMenus.custom.m1).toEqual(A2);
	});
	it('theirs on "changed here, deleted there" deletes here', () => {
		const m = conflictOn({ m1: A }, { m1: A1 }, {});
		const out = M.apply(m.result, m.conflicts, { [m.conflicts[0].key]: 'theirs' }, {});
		expect(out.siteMenus.custom).toEqual({});
	});
	it('theirs on "deleted here, changed there" restores', () => {
		const m = conflictOn({ m1: A }, {}, { m1: A2 });
		const out = M.apply(m.result, m.conflicts, { [m.conflicts[0].key]: 'theirs' }, {});
		expect(out.siteMenus.custom.m1).toEqual(A2);
	});
	it('both keeps mine and adds theirs under a fresh id with the state name appended', () => {
		const m = conflictOn({ m1: A }, { m1: A1 }, { m1: A2 });
		const out = M.apply(m.result, m.conflicts, { [m.conflicts[0].key]: 'both' }, { stateName: 'office' });
		const ids = Object.keys(out.siteMenus.custom);
		expect(ids).toHaveLength(2);
		expect(out.siteMenus.custom.m1).toEqual(A1);
		const fresh = ids.find(id => id !== 'm1');
		expect(fresh).toMatch(/^menu_[0-9a-f]{10}$/);
		expect(out.siteMenus.custom[fresh]).toEqual({ ...A2, name: 'A edited there (office)' });
	});
	it('both without a state name appends (2)', () => {
		const m = conflictOn({ m1: A }, { m1: A1 }, { m1: A2 });
		const out = M.apply(m.result, m.conflicts, { [m.conflicts[0].key]: 'both' }, {});
		const fresh = Object.keys(out.siteMenus.custom).find(id => id !== 'm1');
		expect(out.siteMenus.custom[fresh].name).toBe('A edited there (2)');
	});
	it('both on a conflict that cannot keep both falls back to mine', () => {
		const m = conflictOn({ m1: A }, {}, { m1: A2 });
		const out = M.apply(m.result, m.conflicts, { [m.conflicts[0].key]: 'both' }, {});
		expect(out.siteMenus.custom).toEqual({});
	});
	it('rewrites no reference: a domain pointing at the id keeps pointing at mine', () => {
		const withDomain = (custom) => ({ siteMenus: { custom, domains: { m1: 'example.com' } } });
		const m = M.merge(withDomain({ m1: A }), withDomain({ m1: A1 }), withDomain({ m1: A2 }));
		const out = M.apply(m.result, m.conflicts, { [m.conflicts[0].key]: 'both' }, { stateName: 'office' });
		expect(out.siteMenus.domains).toEqual({ m1: 'example.com' });
	});
	it('handles a keyed-list: theirs replaces in place, both appends a fresh engine', () => {
		const se = (custom) => ({ searchEngines: { custom } });
		const g = { id: 'engine_g', name: 'G', url: 'https://g/?q=%s' };
		const h = { id: 'engine_h', name: 'H', url: 'https://h/?q=%s' };
		const h1 = { ...h, name: 'H here' };
		const h2 = { ...h, name: 'H there' };
		const m = M.merge(se([h, g]), se([h1, g]), se([h2, g]));
		const theirs = M.apply(m.result, m.conflicts, { [m.conflicts[0].key]: 'theirs' }, {});
		expect(theirs.searchEngines.custom).toEqual([h2, g]);
		const both = M.apply(m.result, m.conflicts, { [m.conflicts[0].key]: 'both' }, { stateName: 'office' });
		expect(both.searchEngines.custom).toHaveLength(3);
		expect(both.searchEngines.custom[0]).toEqual(h1);
		const copy = both.searchEngines.custom[2];
		expect(copy.id).toMatch(/^engine_[0-9a-f]{10}$/);
		expect(copy.name).toBe('H there (office)');
	});
	it('handles a scalar', () => {
		const m = M.merge({ trailWidth: 5 }, { trailWidth: 6 }, { trailWidth: 8 });
		expect(M.apply(m.result, m.conflicts, { [m.conflicts[0].key]: 'theirs' }, {}).trailWidth).toBe(8);
		expect(M.apply(m.result, m.conflicts, {}, {}).trailWidth).toBe(6);
	});
	it('handles a nested scalar', () => {
		const b = { gestureTriggerButtons: { right: true, middle: false } };
		const l = { gestureTriggerButtons: { right: false, middle: true } };
		const r = { gestureTriggerButtons: { right: true, middle: false } };
		// Give `right` a conflict: local false, remote null-ish -> use a real two-sided change.
		r.gestureTriggerButtons.right = null;
		const m = M.merge(b, l, r);
		expect(m.conflicts[0]).toMatchObject({ path: 'gestureTriggerButtons.right', kind: 'scalar', mine: false, theirs: null });
		const out = M.apply(m.result, m.conflicts, { [m.conflicts[0].key]: 'theirs' }, {});
		expect(out.gestureTriggerButtons).toEqual({ right: null, middle: true });
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/settings-merge.test.mjs`
Expected: FAIL — `M.apply is not a function`

- [ ] **Step 3: Implement**

Insert before `const api = …`:

```js
	// --- apply -------------------------------------------------------------------

	function freshId(prefix, existing) {
		let id;
		do {
			id = prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
		} while (existing.has(id));
		return id;
	}

	// "Reading" from state "office" arrives as "Reading (office)" - spec §7.
	function suffixName(entry, stateName) {
		if (!isObj(entry) || typeof entry.name !== 'string') return entry;
		return { ...entry, name: `${entry.name} (${stateName || '2'})` };
	}

	function specAt(path) {
		const parts = path.split('.');
		let s = spec(MERGE_MAP[parts[0]] || 'scalar');
		for (let i = 1; i < parts.length; i++) {
			s = spec((s.children && s.children[parts[i]]) || 'scalar');
		}
		return s;
	}

	// The object holding the last path segment, created on the way if missing.
	function parentOf(obj, path) {
		const parts = path.split('.');
		let o = obj;
		for (let i = 0; i < parts.length - 1; i++) {
			if (!isObj(o[parts[i]])) o[parts[i]] = {};
			o = o[parts[i]];
		}
		return [o, parts[parts.length - 1]];
	}

	// result: what merge() returned (holds `mine` for every conflict).
	// choices: { [conflict.key]: 'mine' | 'theirs' | 'both' }; missing = 'mine'.
	// Never mutates; returns the final object for validation, preview and upload.
	function apply(result, conflicts, choices, opts) {
		const out = structuredClone(result);
		const stateName = (opts && opts.stateName) || '';
		for (const c of conflicts || []) {
			const choice = (choices && choices[c.key]) || 'mine';
			const s = specAt(c.path);
			const [parent, last] = parentOf(out, c.path);
			const keep = choice === 'theirs' ? c.theirs : c.mine;
			const both = choice === 'both' && c.canKeepBoth;

			if (c.kind === 'scalar') {
				if (keep === undefined) delete parent[last];
				else parent[last] = keep;
				continue;
			}
			if (c.kind === 'record') {
				const rec = isObj(parent[last]) ? parent[last] : (parent[last] = {});
				if (keep === undefined) delete rec[c.id];
				else rec[c.id] = keep;
				if (both) rec[freshId(s.idPrefix, new Set(Object.keys(rec)))] = suffixName(c.theirs, stateName);
				continue;
			}
			// keyed-list: replace in place, delete in place, append the copy.
			const list = arr(parent[last]).slice();
			const idx = list.findIndex(it => isObj(it) && it[s.key] === c.id);
			if (keep === undefined) {
				if (idx >= 0) list.splice(idx, 1);
			} else if (idx >= 0) {
				list[idx] = keep;
			} else {
				list.push(keep);
			}
			if (both) {
				const id = freshId(s.idPrefix, new Set(list.map(it => (isObj(it) ? it[s.key] : ''))));
				list.push({ ...suffixName(c.theirs, stateName), [s.key]: id });
			}
			parent[last] = list;
		}
		return out;
	}
```

Extend the api line:

```js
	const api = { MERGE_MAP, DEVICE_LOCAL, spec, deepEqual, mergeEntry, merge, apply };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/settings-merge.test.mjs`
Expected: PASS. Then `npm test` — the whole suite green.

- [ ] **Step 5: Commit**

```bash
git add js/settings-merge.js tests/settings-merge.test.mjs
git commit -m "feat(sync): apply() - Mine, Theirs, and Both under a fresh id"
```

---

## Task 6: `uploadState` returns the `payloadHash` it computed

**Files:**
- Modify: `js/eu-sync.js:134-155`
- Modify: `tests/eu-sync.test.mjs`

**Interfaces:**
- Produces: `GesturaSync.uploadState(...)` and `GesturaSync.upload(...)` resolve to `{ stateId, updatedAt, size, payloadHash }` — the server's answer plus the hash written into the meta blob. Task 7 and Task 9 store it as the base's `hash`.

- [ ] **Step 1: Write the failing test**

Add to the `describe('the request body', …)` block in `tests/eu-sync.test.mjs`, after the `binds the meta blob` test:

```js
	// The base (js/eu-sync-base.js) needs the hash the server now holds for this
	// state. The server's answer does not carry it, and it cannot be derived from
	// the settings (fresh IV every time) - the uploader is the only one who knows.
	it('returns the payloadHash it wrote into the meta blob', async () => {
		const r = await S.uploadState({
			secret: await secretBytes(), origin: 'https://gestura.eu', stateId: ID,
			name: 'Work', createdAt: 'x', exportObj: { gesturaSettings: 1 }, extVersion: '2.8.0',
			fetchImpl: fetchOk({ stateId: ID, updatedAt: 'x', size: 1 }),
		});
		expect(r).toMatchObject({ stateId: ID, updatedAt: 'x', size: 1 });
		expect(r.payloadHash).toBe(await X.blobHash(calls[0].body.payload));
	});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/eu-sync.test.mjs -t "returns the payloadHash"`
Expected: FAIL — `expected undefined to be '…'`

- [ ] **Step 3: Implement**

In `js/eu-sync.js`, `uploadState`: compute the hash once, use it in the meta blob, and return it with the answer.

```js
	async function uploadState(opts) {
		const { secret, origin, stateId, name, createdAt, exportObj, extVersion, basePayloadHash, fetchImpl } = opts;
		const X = root.GesturaSyncCrypto;
		const key = await X.deriveKey(secret);
		const payload = await X.encryptBlob(key, stateId, 'payload', exportObj);
		if (payload.length > LIMITS.payloadMaxBytes) throw syncError('too-large');
		// Binds the two blobs of this state to each other, so the server cannot
		// pair this meta with an older payload. Returned to the caller as well: it
		// is what the server will hold for this state from now on, and the base
		// (js/eu-sync-base.js) is written under it.
		const payloadHash = await X.blobHash(payload);
		const meta = await X.encryptBlob(key, stateId, 'meta', {
			name,
			createdAt: createdAt || new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			extVersion,
			payloadHash,
		});
		if (meta.length > LIMITS.metaMaxBytes) throw syncError('too-large');
		const body = { apiLevel: EU.API_LEVEL, locator: await X.deriveLocator(secret), stateId, meta, payload };
		// Only a usable hash travels. Anything else - '', null, a number - would be
		// a token the server has to reject, and the caller meant "unconditional".
		if (typeof basePayloadHash === 'string' && basePayloadHash) body.basePayloadHash = basePayloadHash;
		const answer = await request({ origin, path: PATHS.state, method: 'PUT', fetchImpl, body });
		return { ...(answer && typeof answer === 'object' ? answer : {}), payloadHash };
	}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/eu-sync.test.mjs`
Expected: PASS, all tests (the existing ones assert on `calls[0]`, not on the return value).

- [ ] **Step 5: Commit**

```bash
git add js/eu-sync.js tests/eu-sync.test.mjs
git commit -m "feat(sync): uploadState returns the payloadHash the server now holds"
```

---

## Task 7: The base store — `js/eu-sync-base.js`

**Needs the storage-move plan's Task 9 merged**: `GesturaSyncCrypto.gzip` and `gunzipBounded`.

**Files:**
- Create: `js/eu-sync-base.js`
- Create: `tests/eu-sync-base.test.mjs`
- Modify: `pages/options.html` (one script tag)

**Interfaces:**
- Consumes: `root.GesturaSyncCrypto.gzip`, `.gunzipBounded`, `.bytesToB64`, `.b64ToBytes`, `.STATE_ID_RE`
- Produces: `GesturaSyncBase` with
  - `list() → Promise<{ [stateId]: { hash, date } }>` — no inflating
  - `read(stateId) → Promise<{ hash, payload, date } | null>` — `payload` is the parsed export object; damaged entries are removed and read as `null`
  - `write(stateId, { hash, payload, date? }) → Promise<void>`
  - `remove(stateId) → Promise<void>`
  - `prune(knownStateIds) → Promise<number>` — drops every base not in the list, returns how many
  - `clear() → Promise<void>`
  - `gzipText(text) → Promise<base64>`, `gunzipText(b64, maxBytes) → Promise<string | null>`
  - `KEY = 'euSyncBase'`, `MAX_INFLATED = 1048576`

- [ ] **Step 1: Write the failing tests**

```js
// tests/eu-sync-base.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';

// The same storage fake tests/eu-sync-local.test.mjs uses.
const store = new Map();
globalThis.chrome = {
	storage: {
		local: {
			get: async (key) => (store.has(key) ? { [key]: store.get(key) } : {}),
			set: async (obj) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
			remove: async (key) => { store.delete(key); },
		},
		onChanged: { addListener: () => {} },
	},
};

await import('../js/eu-sync-crypto.js');
await import('../js/eu-sync-base.js');
const B = globalThis.GesturaSyncBase;

const ID1 = '0123456789abcdef0123456789abcdef';
const ID2 = 'fedcba9876543210fedcba9876543210';
const payload = { gesturaSettings: 1, _version: '2.8.0', trailWidth: 5, siteMenus: { custom: { m1: { name: 'A', items: [] } } } };

beforeEach(() => store.clear());

describe('gzip helpers', () => {
	it('round-trips text', async () => {
		const text = JSON.stringify(payload).repeat(50);
		const gz = await B.gzipText(text);
		expect(gz.length).toBeLessThan(text.length);
		expect(await B.gunzipText(gz, B.MAX_INFLATED)).toBe(text);
	});
	it('answers null for garbage and for base64 that is not gzip', async () => {
		expect(await B.gunzipText('not base64!!', B.MAX_INFLATED)).toBeNull();
		expect(await B.gunzipText(btoa('plain text'), B.MAX_INFLATED)).toBeNull();
	});
	it('refuses to inflate past the bound', async () => {
		const gz = await B.gzipText('x'.repeat(10000));
		expect(await B.gunzipText(gz, 1000)).toBeNull();
	});
});

describe('read and write', () => {
	it('a written base reads back with hash, payload and date', async () => {
		await B.write(ID1, { hash: 'H1', payload, date: '2026-09-04T10:00:00Z' });
		expect(await B.read(ID1)).toEqual({ hash: 'H1', payload, date: '2026-09-04T10:00:00Z' });
	});
	it('stores the payload gzipped, not as JSON', async () => {
		await B.write(ID1, { hash: 'H1', payload });
		const raw = store.get(B.KEY)[ID1];
		expect(typeof raw.gz).toBe('string');
		expect(raw.gz).not.toContain('gesturaSettings');
		expect(raw.payload).toBeUndefined();
	});
	it('dates the base itself when no date is given', async () => {
		await B.write(ID1, { hash: 'H1', payload });
		expect((await B.read(ID1)).date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
	it('reads null for a state with no base', async () => {
		expect(await B.read(ID1)).toBeNull();
	});
	it('reads null for a damaged entry and removes it', async () => {
		store.set(B.KEY, {
			[ID1]: { hash: 'H1', gz: 42 },
			[ID2]: { hash: 'H2', gz: btoa('not gzip') },
		});
		expect(await B.read(ID1)).toBeNull();
		expect(await B.read(ID2)).toBeNull();
		expect(store.get(B.KEY)).toEqual({});
	});
	it('reads null when the inflated text is not a JSON object', async () => {
		store.set(B.KEY, { [ID1]: { hash: 'H1', gz: await B.gzipText('[1,2]') } });
		expect(await B.read(ID1)).toBeNull();
	});
	it('survives a storage key that is not an object', async () => {
		store.set(B.KEY, 'nonsense');
		expect(await B.read(ID1)).toBeNull();
		expect(await B.list()).toEqual({});
	});
	it('list() gives hash and date per state without a payload', async () => {
		await B.write(ID1, { hash: 'H1', payload, date: 'd1' });
		await B.write(ID2, { hash: 'H2', payload, date: 'd2' });
		expect(await B.list()).toEqual({ [ID1]: { hash: 'H1', date: 'd1' }, [ID2]: { hash: 'H2', date: 'd2' } });
	});
	it('list() skips entries whose id or hash is malformed', async () => {
		store.set(B.KEY, { nope: { hash: 'H', gz: '' }, [ID1]: { hash: '', gz: '' } });
		expect(await B.list()).toEqual({});
	});
});

describe('remove, prune, clear', () => {
	it('remove deletes exactly one base', async () => {
		await B.write(ID1, { hash: 'H1', payload });
		await B.write(ID2, { hash: 'H2', payload });
		await B.remove(ID1);
		expect(Object.keys(await B.list())).toEqual([ID2]);
	});
	it('prune drops bases for states absent from the listing and keeps the rest', async () => {
		await B.write(ID1, { hash: 'H1', payload });
		await B.write(ID2, { hash: 'H2', payload });
		expect(await B.prune([ID2])).toBe(1);
		expect(Object.keys(await B.list())).toEqual([ID2]);
		expect(await B.prune([ID2])).toBe(0);
	});
	it('clear removes the key', async () => {
		await B.write(ID1, { hash: 'H1', payload });
		await B.clear();
		expect(store.has(B.KEY)).toBe(false);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/eu-sync-base.test.mjs`
Expected: FAIL — `Cannot find module '../js/eu-sync-base.js'`

- [ ] **Step 3: Write the module**

```js
// js/eu-sync-base.js
// The only reader and writer of the `euSyncBase` key in chrome.storage.local:
// per gestura.eu state, the payload this browser last agreed on with the server
// and the payloadHash the server holds for it. That pair is the third point the
// three-way merge (js/settings-merge.js) needs; without it every difference
// would look like "both sides moved".
//
// Separate from `euSync` on purpose (spec §3): that key is read on every gated
// path and must stay small; this one is read only during a reconciliation.
// The payload is stored gzipped - a realistic 18 KB base is about 3.6 KB.
//
// No live cache, no onChanged listener: nothing needs "the base, right now"
// without awaiting. Reads never throw; a damaged entry reads as "no base" and
// is removed, so a corrupted store cannot wedge the panel.
(function (root) {
	'use strict';

	const KEY = 'euSyncBase';
	// The local ceiling of the storage-move design. DecompressionStream would
	// happily inflate a hostile blob into gigabytes; this is the bound.
	const MAX_INFLATED = 1024 * 1024;

	const X = () => root.GesturaSyncCrypto;

	// The same gzip the sync envelope uses (js/eu-sync-crypto.js), as base64 for
	// storage.
	async function gzipText(text) {
		return X().bytesToB64(await X().gzip(new TextEncoder().encode(text)));
	}

	// null for anything that is not a gzip of at most `max` bytes of text:
	// b64ToBytes throws on bad base64, gunzipBounded on a non-gzip and past the
	// bound. All three are "no base", none is an exception.
	async function gunzipText(b64, max) {
		try {
			return new TextDecoder().decode(await X().gunzipBounded(X().b64ToBytes(b64), max));
		} catch {
			return null;
		}
	}

	async function readAll() {
		try {
			const got = await chrome.storage.local.get(KEY);
			const raw = got && got[KEY];
			return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? { ...raw } : {};
		} catch {
			return {};
		}
	}

	function writeAll(all) {
		return chrome.storage.local.set({ [KEY]: all });
	}

	const wellFormed = (id, e) => X().STATE_ID_RE.test(id) && !!e && typeof e === 'object'
		&& typeof e.hash === 'string' && !!e.hash && typeof e.gz === 'string';

	// Which states have a base, and under which hash - for the panel's row
	// buttons. Nothing is inflated here.
	async function list() {
		const all = await readAll();
		const out = {};
		for (const [id, e] of Object.entries(all)) {
			if (wellFormed(id, e)) out[id] = { hash: e.hash, date: typeof e.date === 'string' ? e.date : '' };
		}
		return out;
	}

	async function remove(stateId) {
		const all = await readAll();
		if (!(stateId in all)) return;
		delete all[stateId];
		await writeAll(all);
	}

	async function read(stateId) {
		const all = await readAll();
		const e = all[stateId];
		if (e === undefined) return null;
		if (!wellFormed(stateId, e)) {
			await remove(stateId);
			return null;
		}
		const text = await gunzipText(e.gz, MAX_INFLATED);
		let payload = null;
		if (text !== null) {
			try { payload = JSON.parse(text); } catch { payload = null; }
		}
		if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
			await remove(stateId);
			return null;
		}
		return { hash: e.hash, payload, date: typeof e.date === 'string' ? e.date : '' };
	}

	// Called only after the server has acknowledged the payload this hash names
	// (spec §3): after an upload with the hash uploadState returned, after a
	// download with the hash the payload was checked against.
	async function write(stateId, { hash, payload, date }) {
		const all = await readAll();
		all[stateId] = {
			hash,
			gz: await gzipText(JSON.stringify(payload)),
			date: date || new Date().toISOString(),
		};
		await writeAll(all);
	}

	// After a SUCCESSFUL listing only: a base for a state the server no longer
	// has is a copy of the user's settings with no purpose.
	async function prune(knownStateIds) {
		const keep = new Set(knownStateIds || []);
		const all = await readAll();
		let dropped = 0;
		for (const id of Object.keys(all)) {
			if (!keep.has(id)) {
				delete all[id];
				dropped++;
			}
		}
		if (dropped) await writeAll(all);
		return dropped;
	}

	async function clear() {
		try { await chrome.storage.local.remove(KEY); } catch { /* nothing to clear */ }
	}

	const api = { KEY, MAX_INFLATED, gzipText, gunzipText, list, read, write, remove, prune, clear };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSyncBase = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/eu-sync-base.test.mjs`
Expected: PASS. The `garbage` test relies on `b64ToBytes` throwing on `'not base64!!'` (`atob` throws `InvalidCharacterError`) and on `gunzipBounded` throwing on bytes that are not gzip; both are caught into `null`.

- [ ] **Step 5: Register the two classic scripts on the options page**

In `pages/options.html`, after the line `<script src="../js/eu-sync.js"></script>`:

```html
	<script src="../js/settings-merge.js"></script>
	<script src="../js/eu-sync-base.js"></script>
```

Run: `npx vitest run tests/page-content-deps.test.mjs` — still PASS (it checks the order of content.js dependencies, which this does not touch).

- [ ] **Step 6: Commit**

```bash
git add js/eu-sync-base.js tests/eu-sync-base.test.mjs pages/options.html
git commit -m "feat(sync): the base store - what this browser last agreed on, gzipped, per state"
```

---

## Task 8: Upload, download and delete maintain the base; `afterSave` on the adopt path

**Needs the storage-move plan's Task 10 merged**: its download path already calls `validate(payload, { forSync: true, local: settingsStore.current })`; this task builds on that line.

**Files:**
- Modify: `js/components/options-page.js:1687-1706` (`#applySettings`)
- Modify: `js/components/eu-sync-panel.js` — `#uploadTo`, `#downloadState`, `#deleteState`, `#deleteAll`, `#refreshStates`

**Interfaces:**
- Consumes: `GesturaSync.upload(...) → { …, payloadHash }` (Task 6), `GesturaSyncBase.write/remove/clear/prune/list` (Task 7)
- Produces: the `gestura:settings-apply` event accepts `detail` as either a settings object (today) or `{ settings, afterSave }`, where `afterSave` is an async function run after a successful save and before the reload. `this._bases` in the panel: `{ [stateId]: { hash, date } }`, refreshed with every listing.

- [ ] **Step 1: `#applySettings` accepts the hook**

Replace the method in `js/components/options-page.js`:

```js
	// The one write that the file import and the sync download and sync merge
	// share: a validated object, complete, atomic - and a reload afterwards,
	// because settingsStore.save() updates #current before writing and
	// handleExternalChange therefore reports no change. The subcomponents would
	// otherwise keep their old state.
	//
	// `input` is the settings object, or { settings, afterSave }: the sync panel
	// stores its base (js/eu-sync-base.js) in afterSave, which must run after the
	// save succeeded and before the reload takes the page away. A failed save
	// runs no afterSave - a base that names settings this browser does not hold
	// would make the next merge overwrite local changes (spec §3).
	async #applySettings(input) {
		const settings = input && input.settings && typeof input.settings === 'object' ? input.settings : input;
		const afterSave = input && typeof input.afterSave === 'function' ? input.afterSave : null;
		// A debounce patch still pending comes from the state *before* the import
		// and would write the old values back over it on beforeunload.
		if (this._debounceTimer) clearTimeout(this._debounceTimer);
		this._debounceTimer = null;
		this._pendingPatch = null;
		const ok = await this._store.save(settings);
		if (!ok) {
			this.#showStatus(window.i18n.getMessage('importFailedSyncError'), 'error');
			return false;
		}
		if (afterSave) {
			try {
				await afterSave();
			} catch {
				// The settings are saved; only the bookkeeping after them failed. The
				// reload still happens - the next Sync merges against the older base,
				// which is correct, merely one round late.
			}
		}
		sessionStorage.setItem(IMPORT_RELOAD_KEY, '1');
		window.location.reload();
		return true;
	}
```

- [ ] **Step 2: The panel keeps `_bases` and prunes after a listing**

In `js/components/eu-sync-panel.js`:

Add to `static properties`:

```js
		_bases: { state: true },
```

In the constructor, after `this._conflict = null;`:

```js
		this._bases = {};        // stateId -> { hash, date }, from GesturaSyncBase.list()
```

Replace `#refreshStates`:

```js
	async #refreshStates() {
		if (!this.#effective) return;
		// Re-reading is one of the two answers to a conflict, so it clears it: what
		// the list shows afterwards is the state as it now stands.
		this._conflict = null;
		const list = await this.#run(() => window.GesturaSync.list());
		if (!list) return;
		this._states = list;
		// A base for a state the server no longer has is dropped - after a
		// SUCCESSFUL listing only; a failed one proves nothing (spec §3).
		await window.GesturaSyncBase.prune(list.map(s => s.stateId));
		this._bases = await window.GesturaSyncBase.list();
	}
```

- [ ] **Step 3: Upload writes the base**

In `#uploadTo`'s `commit`, replace the block after `this._conflict = null;`:

```js
				this._conflict = null;
				const now = new Date().toISOString();
				// The server now holds exactly this payload under exactly this hash:
				// that pair is the base the next Sync merges against (spec §3, §6).
				await window.GesturaSyncBase.write(id, { hash: done.payloadHash, payload: exportObj, date: now });
				await window.GesturaSyncLocal.setState(id, {
					name,
					lastUploadHash: await window.GesturaSettingsSchema.hashOf(exportObj),
					lastUploadDate: now,
				});
				this._newName = '';
				await this.#refreshStates();
```

- [ ] **Step 4: Download writes the base after the save**

In `#downloadState`, replace the `commit:` line of `#openPreview`:

```js
			// The adopt path saves, runs afterSave, reloads. The base is written in
			// afterSave - after the save succeeded, so a base never names settings
			// this browser does not hold - under the hash the payload was checked
			// against, which is the hash the server holds (spec §6).
			commit: () => window.dispatchEvent(new CustomEvent('gestura:settings-apply', {
				detail: {
					settings: result.settings,
					afterSave: () => window.GesturaSyncBase.write(state.stateId, {
						hash: expectPayloadHash,
						payload: result.exportObj,
						date: new Date().toISOString(),
					}),
				},
			})),
```

The validate call in the same method stays as the storage-move plan left it — `validate(payload, { forSync: true, local: settingsStore.current })` — so `theme` and the other six device-local keys come from the local copy (storage-move design §7).

- [ ] **Step 5: Delete drops the base**

In `#deleteState`, after `await window.GesturaSyncLocal.removeState(state.stateId);`:

```js
		await window.GesturaSyncBase.remove(state.stateId);
```

In `#deleteAll`, after `await window.GesturaSyncLocal.write({ states: {} });`:

```js
		await window.GesturaSyncBase.clear();
		this._bases = {};
```

- [ ] **Step 6: Verify in the browser**

Load the extension unpacked, open the options page with sync enabled, and in the page's DevTools:

```js
await chrome.storage.local.get('euSyncBase')
```

Expected: after **Overwrite** on a state, one entry with a `hash` equal to the state's `payloadHash` (compare with the listing's decrypted meta — `GesturaSync.list()` in the console), a `gz` string, a `date`. After **Open here** on another state, a second entry with that state's hash. After **Delete**, its entry gone. `npm test` still green.

- [ ] **Step 7: Commit**

```bash
git add js/components/options-page.js js/components/eu-sync-panel.js
git commit -m "feat(sync): upload, download and delete keep the base in step with the server"
```

---

## Task 9: The conflict dialog — `js/components/sync-merge-dialog.js`

**Files:**
- Create: `js/components/sync-merge-dialog.js`
- Modify: `pages/options.html` (one module script tag)
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json`
- Modify: `tests/site-menu-locales.test.mjs` (`PENDING_TRANSLATION`)

**Interfaces:**
- Consumes: the conflict shape of Task 2 (`{ path, id, kind, mine, theirs, canKeepBoth, key }`), `summary` of Task 2
- Produces: `<sync-merge-dialog ?open .conflicts .summary .stateName .choices @merge-confirm @merge-cancel>`; `merge-confirm`'s `detail` is `{ choices }` with one entry per conflict.

- [ ] **Step 1: The i18n keys, en and de**

Append to `_locales/en/messages.json` (after `"euSyncConflictOverwrite"`):

```json
	"euSyncMerge": { "message": "Sync" },
	"euSyncMergeTitle": { "message": "Sync with “{name}”" },
	"euSyncMergeSummary": { "message": "{taken} taken over from the state, {uploaded} uploaded from here, {deleted} deleted." },
	"euSyncMergeInSync": { "message": "Already in sync. Nothing to transfer." },
	"euSyncMergeNewerVersion": { "message": "This state was written by a newer Gestura. Update Gestura first, or use “Open here” to see what would be lost." },
	"euSyncMergeNoBase": { "message": "This browser has not opened or uploaded this state yet. Open it here once; after that, Sync is available." },
	"euSyncMergeMovedAgain": { "message": "The state changed again in the meantime. Merging against the new version." },
	"euSyncMergeConflictsLead": { "message": "Both sides changed these entries. Choose for each one:" },
	"euSyncMergeMine": { "message": "Mine" },
	"euSyncMergeTheirs": { "message": "Theirs" },
	"euSyncMergeBoth": { "message": "Both" },
	"euSyncMergeAllMine": { "message": "Keep all mine" },
	"euSyncMergeAllTheirs": { "message": "Take all theirs" },
	"euSyncMergeContinue": { "message": "Continue" },
	"euSyncMergeCancel": { "message": "Cancel" },
	"euSyncMergeDeleted": { "message": "deleted" },
	"euSyncMergeSectionSiteMenus": { "message": "Website menus" },
	"euSyncMergeSectionEngines": { "message": "Search engines" },
	"euSyncMergeSectionGestures": { "message": "Gestures" },
	"euSyncMergeSectionChains": { "message": "Action chains" },
	"euSyncMergeSectionOther": { "message": "Other settings" },
```

Append to `_locales/de/messages.json` (after `"euSyncConflictOverwrite"`):

```json
	"euSyncMerge": { "message": "Abgleichen" },
	"euSyncMergeTitle": { "message": "Abgleich mit „{name}“" },
	"euSyncMergeSummary": { "message": "{taken} aus dem Stand übernommen, {uploaded} von hier hochgeladen, {deleted} gelöscht." },
	"euSyncMergeInSync": { "message": "Bereits abgeglichen. Nichts zu übertragen." },
	"euSyncMergeNewerVersion": { "message": "Dieser Stand stammt aus einer neueren Gestura. Aktualisiere Gestura zuerst, oder sieh mit „Hier öffnen“, was verloren ginge." },
	"euSyncMergeNoBase": { "message": "Dieser Browser hat diesen Stand noch nie geöffnet oder hochgeladen. Öffne ihn einmal hier; danach ist Abgleichen verfügbar." },
	"euSyncMergeMovedAgain": { "message": "Der Stand hat sich inzwischen erneut geändert. Abgleich gegen die neue Version." },
	"euSyncMergeConflictsLead": { "message": "Diese Einträge wurden auf beiden Seiten geändert. Wähle für jeden:" },
	"euSyncMergeMine": { "message": "Meins" },
	"euSyncMergeTheirs": { "message": "Deren" },
	"euSyncMergeBoth": { "message": "Beide" },
	"euSyncMergeAllMine": { "message": "Überall meins behalten" },
	"euSyncMergeAllTheirs": { "message": "Überall deren übernehmen" },
	"euSyncMergeContinue": { "message": "Weiter" },
	"euSyncMergeCancel": { "message": "Abbrechen" },
	"euSyncMergeDeleted": { "message": "gelöscht" },
	"euSyncMergeSectionSiteMenus": { "message": "Website-Menüs" },
	"euSyncMergeSectionEngines": { "message": "Suchmaschinen" },
	"euSyncMergeSectionGestures": { "message": "Gesten" },
	"euSyncMergeSectionChains": { "message": "Aktionsketten" },
	"euSyncMergeSectionOther": { "message": "Weitere Einstellungen" },
```

Append to `PENDING_TRANSLATION` in `tests/site-menu-locales.test.mjs` (keep the array's existing style, one group per line):

```js
	'euSyncMerge', 'euSyncMergeTitle', 'euSyncMergeSummary', 'euSyncMergeInSync',
	'euSyncMergeNewerVersion', 'euSyncMergeNoBase', 'euSyncMergeMovedAgain',
	'euSyncMergeConflictsLead', 'euSyncMergeMine', 'euSyncMergeTheirs', 'euSyncMergeBoth',
	'euSyncMergeAllMine', 'euSyncMergeAllTheirs', 'euSyncMergeContinue', 'euSyncMergeCancel',
	'euSyncMergeDeleted', 'euSyncMergeSectionSiteMenus', 'euSyncMergeSectionEngines',
	'euSyncMergeSectionGestures', 'euSyncMergeSectionChains', 'euSyncMergeSectionOther',
```

Run: `npx vitest run tests/site-menu-locales.test.mjs tests/locale-placeholders.test.mjs`
Expected: PASS. (Before the `PENDING_TRANSLATION` edit the 39-locale test fails on every new key — that is the guard working.)

- [ ] **Step 2: Write the component**

```js
// js/components/sync-merge-dialog.js
import { LitElement, html, css } from '../../js/lib/lit-all.min.js';
import { commonStyles, optionStyles } from './shared-styles.js';

// The conflict dialog of the reconciliation design (spec §7): one dialog for
// the whole merge, listing only the entries both sides changed. The automatic
// cases are one summary line above the list - the user must be able to see
// what happened without being asked about it.
//
// Mine is preselected: there is no defensible default when both sides moved,
// and the local value is the one that cannot surprise the person sitting in
// front of this browser. Two bulk buttons make a long list bearable without
// hiding it. Nothing here writes anything; `merge-confirm` hands the choices
// back to the panel, which shows the R3 preview next.
const SECTIONS = [
	[/^siteMenus\./, 'euSyncMergeSectionSiteMenus'],
	[/^searchEngines\./, 'euSyncMergeSectionEngines'],
	[/^(mouseGestures|wheelGestures|specialGestures|textDragGestures|linkDragGestures|imageDragGestures|gestureTriggerButtons)/, 'euSyncMergeSectionGestures'],
	[/^actionChains/, 'euSyncMergeSectionChains'],
];

class SyncMergeDialog extends LitElement {
	static properties = {
		open: { type: Boolean },
		conflicts: { type: Array },
		summary: { type: Object },
		stateName: { type: String },
		choices: { type: Object },
		_choices: { state: true },
	};

	static styles = [commonStyles, optionStyles, css`
		:host { display: contents; }
		.modal-overlay { position: fixed; inset: 0; z-index: 10000; background: rgba(0, 0, 0, 0.35); display: flex; align-items: center; justify-content: center; }
		.modal-panel { width: min(720px, 94vw); max-height: 88vh; display: flex; flex-direction: column; background: var(--card-bg); border-radius: 14px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--border-color); }
		.modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border-color); }
		.modal-header h3 { margin: 0; font-size: 17px; font-weight: 600; }
		.modal-body { padding: 18px 20px; overflow-y: auto; }
		.summary { margin: 0 0 14px; font-size: 13px; color: var(--text-secondary); }
		.lead { margin: 0 0 10px; font-size: 14px; }
		.bulk { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
		.conflict { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--border-color); }
		.conflict .what { min-width: 0; }
		.conflict .section { font-size: 12px; color: var(--text-secondary); }
		.conflict .name { font-weight: 600; overflow-wrap: anywhere; }
		.conflict .side { font-size: 12px; color: var(--text-secondary); }
		.choices { display: flex; gap: 10px; flex: none; }
		.choices label { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; cursor: pointer; }
		.modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--border-color); }
	`];

	constructor() {
		super();
		this.open = false;
		this.conflicts = [];
		this.summary = { taken: 0, uploaded: 0, deleted: 0, unchanged: 0 };
		this.stateName = '';
		this.choices = {};
		this._choices = {};
	}

	willUpdate(changed) {
		// Answers remembered from an earlier pass (a 412 retry) arrive through
		// `choices`; everything not answered starts as Mine.
		if (changed.has('conflicts') || changed.has('choices')) {
			const next = {};
			for (const c of this.conflicts || []) next[c.key] = (this.choices && this.choices[c.key]) || 'mine';
			this._choices = next;
		}
	}

	#sectionOf(path) {
		for (const [re, key] of SECTIONS) if (re.test(path)) return key;
		return 'euSyncMergeSectionOther';
	}

	#nameOf(c) {
		const v = c.mine !== undefined ? c.mine : c.theirs;
		if (v && typeof v === 'object' && typeof v.name === 'string' && v.name) return v.name;
		return c.id || c.path;
	}

	#sideText(v) {
		const i18n = window.i18n;
		if (v === undefined) return i18n.getMessage('euSyncMergeDeleted');
		if (v && typeof v === 'object') return typeof v.name === 'string' && v.name ? v.name : JSON.stringify(v).slice(0, 60);
		return String(v);
	}

	#set(key, value) { this._choices = { ...this._choices, [key]: value }; }

	#setAll(value) {
		const next = {};
		for (const c of this.conflicts || []) next[c.key] = value;
		this._choices = next;
	}

	#cancel() { this.dispatchEvent(new CustomEvent('merge-cancel')); }

	#confirm() {
		this.dispatchEvent(new CustomEvent('merge-confirm', { detail: { choices: { ...this._choices } } }));
	}

	#renderConflict(c) {
		const i18n = window.i18n;
		const choice = this._choices[c.key] || 'mine';
		const radio = (value, label) => html`
			<label><input type="radio" name=${c.key} .checked=${choice === value}
				@change=${() => this.#set(c.key, value)}>${label}</label>`;
		return html`
			<div class="conflict">
				<div class="what">
					<div class="section">${i18n.getMessage(this.#sectionOf(c.path))}</div>
					<div class="name">${this.#nameOf(c)}</div>
					<div class="side">${i18n.getMessage('euSyncMergeMine')}: ${this.#sideText(c.mine)} · ${i18n.getMessage('euSyncMergeTheirs')}: ${this.#sideText(c.theirs)}</div>
				</div>
				<div class="choices">
					${radio('mine', i18n.getMessage('euSyncMergeMine'))}
					${radio('theirs', i18n.getMessage('euSyncMergeTheirs'))}
					${c.canKeepBoth ? radio('both', i18n.getMessage('euSyncMergeBoth')) : ''}
				</div>
			</div>`;
	}

	render() {
		if (!this.open) return html``;
		const i18n = window.i18n;
		const s = this.summary || {};
		const summary = i18n.getMessage('euSyncMergeSummary')
			.replace('{taken}', String(s.taken || 0))
			.replace('{uploaded}', String(s.uploaded || 0))
			.replace('{deleted}', String(s.deleted || 0));
		return html`
			<div class="modal-overlay" @click=${(e) => { if (e.target === e.currentTarget) this.#cancel(); }}>
				<div class="modal-panel" role="dialog" aria-modal="true" @keydown=${(e) => { if (e.key === 'Escape') this.#cancel(); }}>
					<div class="modal-header">
						<h3>${i18n.getMessage('euSyncMergeTitle').replace('{name}', this.stateName || '')}</h3>
					</div>
					<div class="modal-body">
						<p class="summary">${summary}</p>
						<p class="lead">${i18n.getMessage('euSyncMergeConflictsLead')}</p>
						<div class="bulk">
							<button class="btn btn-secondary" @click=${() => this.#setAll('mine')}>${i18n.getMessage('euSyncMergeAllMine')}</button>
							<button class="btn btn-secondary" @click=${() => this.#setAll('theirs')}>${i18n.getMessage('euSyncMergeAllTheirs')}</button>
						</div>
						${(this.conflicts || []).map(c => this.#renderConflict(c))}
					</div>
					<div class="modal-footer">
						<button class="btn btn-secondary" @click=${this.#cancel}>${i18n.getMessage('euSyncMergeCancel')}</button>
						<button class="btn btn-primary" @click=${this.#confirm}>${i18n.getMessage('euSyncMergeContinue')}</button>
					</div>
				</div>
			</div>`;
	}
}

customElements.define('sync-merge-dialog', SyncMergeDialog);
```

- [ ] **Step 3: Register the module**

In `pages/options.html`, before `<script type="module" src="../js/components/eu-sync-panel.js"></script>`:

```html
	<script type="module" src="../js/components/sync-merge-dialog.js"></script>
```

- [ ] **Step 4: Verify in the browser**

Reload the extension, open the options page, and in DevTools:

```js
const d = document.createElement('sync-merge-dialog');
d.conflicts = [{ path: 'siteMenus.custom', id: 'm1', kind: 'record', mine: { name: 'Reading here' }, theirs: { name: 'Reading there' }, canKeepBoth: true, key: 'k1' },
               { path: 'trailWidth', id: '', kind: 'scalar', mine: 6, theirs: 8, canKeepBoth: false, key: 'k2' }];
d.summary = { taken: 14, uploaded: 3, deleted: 2, unchanged: 40 };
d.stateName = 'office';
d.addEventListener('merge-confirm', e => console.log(e.detail.choices));
d.open = true;
document.body.append(d);
```

Expected: the dialog shows the summary line, two conflicts — the first with three radios, the second with two — Mine preselected on both; *Take all theirs* flips both; *Continue* logs `{ k1: 'theirs', k2: 'theirs' }`; Escape or the backdrop fires nothing but closes via the panel (here: nothing, the element stays — that is the panel's job).

- [ ] **Step 5: Commit**

```bash
git add js/components/sync-merge-dialog.js pages/options.html _locales/en/messages.json _locales/de/messages.json tests/site-menu-locales.test.mjs
git commit -m "feat(sync): the merge dialog - one dialog for the whole reconciliation, Mine preselected"
```

---

## Task 10: The `Sync` loop in the panel

**Needs the storage-move plan's Task 10 merged**: `buildExport(..., { forSync: true })`, `validate(..., { forSync: true, local })`, `MAX_BYTES` = 1 MiB. Every `validate` call below passes `local: settingsStore.current`; without it the device-local keys would be filled from the defaults and a `Sync` would reset this device's theme.

**Files:**
- Modify: `js/components/eu-sync-panel.js`

**Interfaces:**
- Consumes: `GesturaSettingsMerge.merge/apply` (Tasks 2–5), `GesturaSyncBase.read/write` (Task 7), `GesturaSync.download/upload/list` (Task 6), `GesturaEuUpdates.isNewer`, `<sync-merge-dialog>` (Task 9), the `afterSave` hook (Task 8), `GesturaSettingsSchema.validate/buildExport/hashOf`
- Produces: a `Sync` button per state row that has a base; the loop of spec §3.

- [ ] **Step 1: State for the merge**

Add to `static properties`:

```js
		_merge: { state: true },
		_notice: { state: true },
```

In the constructor:

```js
		this._merge = null;      // { state, merged, choices, attempt, expect } while the dialog is open
		this._notice = '';       // one informational line (in sync, moved again)
```

Add a style line to `static styles`:

```js
		.info { margin-top: 8px; color: var(--text-secondary); font-size: 12px; }
```

- [ ] **Step 2: The loop**

Add after `#downloadState`:

```js
	// Spec §3: download, merge against the base, ask where both sides moved,
	// preview, upload with the write token, and only then write locally and
	// store the result as the new base. A 412 restarts from the top with the
	// answers kept; the fourth one hands over to the existing conflict UI.
	//
	// `choices` are the answers from an earlier pass; `attempt` counts passes.
	async #syncState(state, attempt = 1, choices = {}) {
		const i18n = window.i18n;
		const S = window.GesturaSettingsSchema;
		// A fresh press starts clean; a 412 retry keeps its "moved again" line for
		// after the dialogs, and puts the same sentence into the preview's note.
		if (attempt === 1) this._notice = '';
		const expect = state.meta && state.meta.payloadHash;
		if (typeof expect !== 'string' || !expect) {
			this._error = i18n.getMessage('euSyncStateBroken');
			return;
		}
		// A newer Gestura's payload would lose keys in validate() and the merge
		// would upload that loss; refused before anything is compared (spec §3).
		if (window.GesturaEuUpdates.isNewer(state.meta.extVersion, i18n.version)) {
			this._error = i18n.getMessage('euSyncMergeNewerVersion');
			return;
		}
		const base = await window.GesturaSyncBase.read(state.stateId);
		if (!base) {
			this._error = i18n.getMessage('euSyncMergeNoBase');
			return;
		}
		const payload = await this.#run(() => window.GesturaSync.download({ stateId: state.stateId, expectPayloadHash: expect }));
		if (!payload) return;

		const local0 = settingsStore.current;
		const remote = S.validate(payload, { forSync: true, local: local0 });
		if (!remote.ok) {
			this._error = settingsErrorMessage(i18n, remote.error);
			return;
		}
		if (remote.dropped.length || remote.retyped.length) {
			this._error = i18n.getMessage('euSyncMergeNewerVersion');
			return;
		}
		const baseV = S.validate(base.payload, { forSync: true, local: local0 });
		if (!baseV.ok) {
			await window.GesturaSyncBase.remove(state.stateId);
			this._error = i18n.getMessage('euSyncMergeNoBase');
			return;
		}
		const local = this.#validatedExport({ json: false });   // #validatedExport adds forSync: true
		if (!local.ok) {
			this._error = settingsErrorMessage(i18n, local.error);
			return;
		}

		// With remote hash === base hash the remote side has not moved, and the
		// table yields "keep mine" for every difference - no special case needed.
		const merged = window.GesturaSettingsMerge.merge(baseV.settings, local.settings, remote.settings);
		const s = merged.summary;
		if (!merged.conflicts.length && !s.taken && !s.uploaded && !s.deleted) {
			this._notice = i18n.getMessage('euSyncMergeInSync');
			return;
		}
		// Only answers whose question is asked again are kept (spec §3).
		const kept = {};
		for (const c of merged.conflicts) if (choices[c.key]) kept[c.key] = choices[c.key];
		const open = merged.conflicts.some(c => !kept[c.key]);
		const ctx = { state, merged, choices: kept, attempt, expect };
		if (open) {
			this._merge = ctx;
			return;
		}
		await this.#commitMerge(ctx);
	}

	#onMergeConfirm(e) {
		const ctx = this._merge;
		this._merge = null;
		if (ctx) this.#commitMerge({ ...ctx, choices: e.detail.choices });
	}

	// After the questions: apply, validate the result as one object, show the
	// preview, and on confirmation upload -> write locally -> store the base.
	async #commitMerge(ctx) {
		const i18n = window.i18n;
		const S = window.GesturaSettingsSchema;
		const { state, merged, choices, attempt, expect } = ctx;
		const name = this.#nameOf(state);
		const final = window.GesturaSettingsMerge.apply(merged.result, merged.conflicts, choices, { stateName: name });
		// As text, so validate() applies MAX_BYTES - the 1 MiB local ceiling - to
		// the merged result before anything is sent (spec §3 step 7a). `local`
		// supplies the seven device-local keys r.settings will be saved with.
		const r = S.validate(
			JSON.stringify(S.buildExport(final, i18n.version, { forSync: true })),
			{ forSync: true, local: settingsStore.current },
		);
		if (!r.ok) {
			this._error = settingsErrorMessage(i18n, r.error);
			return;
		}
		const s = merged.summary;
		const summaryLine = i18n.getMessage('euSyncMergeSummary')
			.replace('{taken}', String(s.taken)).replace('{uploaded}', String(s.uploaded)).replace('{deleted}', String(s.deleted));
		// On a retry the user sees this preview a second time; the reason belongs
		// in the dialog they are looking at, not in a panel line behind it.
		const note = attempt > 1 ? `${i18n.getMessage('euSyncMergeMovedAgain')} ${summaryLine}` : summaryLine;
		this.#openPreview({
			mode: 'import',
			json: r.json,
			dropped: r.dropped,
			retyped: r.retyped,
			legacy: false,
			note,
			commit: async () => {
				const done = await this.#run(() => window.GesturaSync.upload({
					stateId: state.stateId,
					name,
					createdAt: state.meta && state.meta.createdAt,
					exportObj: r.exportObj,
					extVersion: i18n.version,
					basePayloadHash: expect,
				}));
				if (!done) {
					if (this._errorCode !== 'conflict') return;
					// Someone wrote between our download and this upload. Nothing has
					// been written here. Three times we merge again; then the existing
					// conflict UI takes over (spec §3 step 8).
					if (attempt >= 3) {
						this._conflict = { stateId: state.stateId, name, createdAt: state.meta && state.meta.createdAt, basePayloadHash: null };
						return;
					}
					const list = await this.#run(() => window.GesturaSync.list());
					if (!list) return;
					this._states = list;
					const fresh = list.find(x => x.stateId === state.stateId);
					if (!fresh) {
						this._error = i18n.getMessage(EuSyncPanel.SYNC_ERRORS['not-found']);
						return;
					}
					this._notice = i18n.getMessage('euSyncMergeMovedAgain');
					await this.#syncState(fresh, attempt + 1, choices);
					return;
				}
				// The server holds r.exportObj under done.payloadHash. Save locally
				// through the adopt path; the base and the upload record are written
				// in afterSave, after the save succeeded and before the reload.
				const now = new Date().toISOString();
				window.dispatchEvent(new CustomEvent('gestura:settings-apply', {
					detail: {
						settings: r.settings,
						afterSave: async () => {
							await window.GesturaSyncBase.write(state.stateId, { hash: done.payloadHash, payload: r.exportObj, date: now });
							await window.GesturaSyncLocal.setState(state.stateId, {
								name,
								lastUploadHash: await S.hashOf(r.exportObj),
								lastUploadDate: now,
							});
						},
					},
				}));
			},
		});
	}
```

- [ ] **Step 3: The preview passes `note` through**

In `#renderStates`, the `<settings-preview-dialog>` gains one attribute:

```js
				.note=${this._preview ? (this._preview.note || '') : ''}
```

- [ ] **Step 4: The button, the dialog, the notice**

In `#renderStateRow`, before the Download button:

```js
					${this._bases[state.stateId] ? html`
						<button class="btn btn-primary" ?disabled=${this._busy || state.broken}
							@click=${() => this.#syncState(state)}>${i18n.getMessage('euSyncMerge')}</button>` : ''}
```

In `#renderStates`, after the `<settings-preview-dialog …>` element:

```js
			<sync-merge-dialog
				?open=${!!this._merge}
				.conflicts=${this._merge ? this._merge.merged.conflicts : []}
				.summary=${this._merge ? this._merge.merged.summary : {}}
				.stateName=${this._merge ? this.#nameOf(this._merge.state) : ''}
				.choices=${this._merge ? this._merge.choices : {}}
				@merge-confirm=${this.#onMergeConfirm}
				@merge-cancel=${() => { this._merge = null; }}></sync-merge-dialog>
```

In `render()`, after the `_error` line:

```js
			${this._notice ? html`<div class="info">${this._notice}</div>` : ''}
```

- [ ] **Step 5: Verify in the browser** — the six scenarios of spec §9, two profiles (the harness under `~/.claude/projects/c--Programme-alt-Gestura/browser-verify/`; two Chrome profiles with the unpacked extension and the same sync code):

1. Home: set up, **Overwrite** into a new state. Office: **Open here**. Both panels show **Sync** on the row; `chrome.storage.local.get('euSyncBase')` shows the same `hash` on both.
2. Office: add a menu, edit another, reorder, **Sync** (no dialog — home has not moved; summary appears in the preview note). Home: **Sync** → no dialog, the new menu, the edit and the order arrive; the preview note reads *"3 taken over …"*.
3. Edit the same menu on both; **Sync** on one → dialog with exactly one conflict, Mine preselected, Both offered. Choose Both → after reload two menus, the copy named *"… (state name)"*, no domain on the copy.
4. Delete a menu at home, **Sync**; office **Sync** → it disappears and the next **Sync** at office says *"Already in sync"*. Then: edit menu X at home, delete X at office, office **Sync** → one conflict; Theirs → X restored at office; **Sync** at home → in sync.
5. Home: press **Sync**, answer the dialog, **do not confirm the preview yet**; office: **Overwrite**; home: confirm → the notice *"changed again"* appears, the dialog does **not** reappear for the same entry, the merge completes on the second pass. `euSyncBase` at home was **unchanged** between the 412 and the retry.
6. Cancel the dialog, cancel the preview: `chrome.storage.local.get('euSyncBase')` unchanged, no request in the network panel after the download, settings unchanged.
7. Set `theme` to dark at home before a **Sync**; still dark afterwards.

- [ ] **Step 6: `npm test` green, then commit**

```bash
git add js/components/eu-sync-panel.js
git commit -m "feat(sync): the Sync button - three-way merge against the base, staked on the 412 token"
```

---

## Task 11: Changelog and the spec's status line

**Files:**
- Modify: `CHANGELOG.md` (`### Unreleased`)
- Modify: `docs/superpowers/specs/2026-09-04-sync-reconciliation-design.md` (status line)

- [ ] **Step 1: Changelog**

Under `### Unreleased` in `CHANGELOG.md`, in the existing style of that section:

```markdown
- gestura.eu sync: a **Sync** button per state merges a state and this browser three-way against what they last agreed on — one-sided changes are taken over without a question, deletions stay deleted, and only an entry both sides changed asks (Mine / Theirs / Both). Uploads are still protected by the write token, so two racing browsers cannot lose a write.
```

- [ ] **Step 2: Spec status**

Change the `**Status:**` line of the spec to:

```markdown
- **Status:** approved by the user (brainstorming completed); implemented by
  [2026-09-04-sync-reconciliation.md](../plans/2026-09-04-sync-reconciliation.md).
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md docs/superpowers/specs/2026-09-04-sync-reconciliation-design.md
git commit -m "docs: changelog and status for the sync reconciliation"
```

---

## Self-review

**Spec coverage.**

| spec | task |
|---|---|
| §3 base: what, where, when written (after ack, with the client's hash), when dropped (successful listing, delete, damaged) | 7 (store), 8 (upload/download/delete/list), 10 (sync) |
| §3 `uploadState` returns `payloadHash` | 6 |
| §3 loop steps 1–8 incl. `412` retry with bound, answer reuse | 10 |
| §3 newer-version refusal (`extVersion`, `dropped`, `retyped`) | 10 |
| §3 missing base → no Sync, adoption instead | 10 (button gated on `_bases`), 8 |
| §4 five kinds + container, `MERGE_MAP`, partition guard, undeclared child as scalar, `order` three-way rule, `keyed-list` by field | 1, 2, 3, 4 |
| §5 ten cases, trivial combinations, `deepEqual` copy, both sides validated in the sync shape | 2, 10 |
| §6 adoption writes the base (download and both upload paths, incl. overwrite-anyway) | 8 |
| §7 dialog: one for all, summary line, Mine/Theirs/Both, Both restricted, fresh id + name suffix, no reference rewriting, bulk buttons, Mine preselected | 5, 9 |
| §7 atomic and replacing through the adopt path, device-local keys untouched | 8 (`afterSave`), 10 (`validate(..., { forSync: true })`) |
| §7 cancelling writes nothing | 10 (dialog cancel clears `_merge`; preview cancel clears `_preview`; nothing runs before `commit`) |
| §8 file layout | as listed |
| §9 automated tests | 1–7; the `412`/retry/answer-reuse tests the spec lists under `tests/eu-sync.test.mjs` live in the panel, which has no Node test harness — covered by the browser checks in Task 10 step 5, and the pure halves (`conflictKey` stability, `apply`) in Tasks 2 and 5 |
| §9 browser checks 1–7 | 10 step 5 |
| §10 decomposition | followed; the dialog (9) comes before the loop (10) because the loop renders it |
| §11 not done: no reference rewriting, `lastUploadHash` unchanged (still written on sync, as on upload) | 5, 10 |

**Gap accepted:** the spec's `tests/eu-sync.test.mjs` bullets about the loop cannot be unit-tested without extracting the loop from the Lit component. If that is wanted later, `#syncState`/`#commitMerge` can move into a pure `js/sync-reconcile.js` taking `{ download, upload, list, readBase, writeBase, ask, preview }` as functions; the plan does not do it now (YAGNI, and the browser checks cover it).

**Placeholder scan:** no TBD/TODO; every code step carries its code; the `forSync` flag and `MAX_BYTES` are named as coming from the predecessor plan, with the behaviour required stated where used.

**Type consistency:** `mergeEntry(b, l, r) → { value, status }`; `merge → { result, conflicts, summary }` with conflict `{ path, id, kind, mine, theirs, canKeepBoth, key }` used identically in Tasks 2, 5, 9, 10; `apply(result, conflicts, choices, { stateName })` in 5 and 10; `GesturaSyncBase.read → { hash, payload, date } | null`, `write(stateId, { hash, payload, date })`, `list → { [id]: { hash, date } }`, `prune(ids) → number` in 7, 8, 10; `uploadState → { …answer, payloadHash }` in 6, 8, 10; `gestura:settings-apply` detail `{ settings, afterSave }` in 8 and 10; `<sync-merge-dialog>` properties and events in 9 and 10.
