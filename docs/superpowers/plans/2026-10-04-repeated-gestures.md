# Repeated Gestures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a direction repeat inside a gesture (`↓↓`, `→→`, `↑↑`, `←←`, also within longer patterns) — entered by a long stroke or by a pause — with a fallback to the collapsed pattern whenever the repeated one has no entry.

**Architecture:** The shared `GestureRecognizer` learns two repeat rules (long stroke, pause) that are off unless configured. A new classic script `js/gesture-binding.js` holds the pure resolution logic (raw pattern → effective pattern + binding, suggestion base); `content.js` routes every mouse and drag decision through it. Two scalar settings switch the rules on by default and are tuned in the options page; the recorders get the live values.

**Tech Stack:** Plain JS (classic content scripts, window globals), Lit components for the options page, vitest.

**Spec:** [docs/superpowers/specs/2026-10-04-repeated-gestures-design.md](../specs/2026-10-04-repeated-gestures-design.md) (v3, approved). Read it before starting; this plan argues from it.

## Global Constraints

- No build step; content scripts cannot use ES modules — `js/gesture-binding.js` is a classic script exposing `GestureBinding` on `self`/`globalThis`, like `js/blacklist-match.js`.
- Indentation is **tabs** everywhere.
- Internal `FlowMouse*` identifiers stay untouched; do not rename anything unrelated.
- Recognizer config omitted / invalid → **off**. Valid values: `repeatDistance` 0–600 (px), `repeatPause` 0–2000 (ms); 0 = off.
- Effective `repeatDistance` = `max(repeatDistance, 2 × distanceThreshold)` when non-zero.
- `PAUSE_JITTER` = 6 CSS px, fixed.
- Never more than two equal directions in a row.
- Settings defaults: `gestureRepeatDistance: 400`, `gestureRepeatPause: 500`; both `scalar` in `MERGE_MAP`.
- Missing entry → fallback to the collapsed pattern; an entry whose action is `none` → blocks (no fallback).
- New i18n keys only in `en` and `de`, prefixed `fork`, listed in `PENDING_TRANSLATION`. Never put a `$WORD$` into a message.
- Merging into `firefox-build` later: the Gecko `manifest.json` there has its own `content_scripts` list — `js/gesture-binding.js` must be added there too (`tests/load-order.test.mjs` catches it on that branch).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Unbound long stroke on a tall screen** — a user who never binds a repeat draws a 500 px `↓`: it must scroll exactly as before, HUD showing `↓` and "Scroll down" (Task 4 manual check; recognizer side pinned in Task 2).
2. **Customised basic gesture reached through fallback** — `↓` with a custom name / scroll distance; long `↓` must use that configuration (pinned in Task 1, `resolve` carries the binding object).
3. **Super drag dropped after a long stroke** — drop must still be accepted (`preventDefault`) when only `↓` has a drag gesture (Task 5 manual check).
4. **Small sideways drift right after a repeat** — must not become a turn (pinned in Task 2 regression test).
5. **Slow or hesitant start** — a user who presses the button and waits before moving must not get a repeat (pinned in Task 3).

## File Map

| file | change |
| --- | --- |
| `js/gesture-binding.js` | **new** — `collapse`, `resolve`, `suggestionBase` |
| `tests/gesture-binding.test.mjs` | **new** |
| `js/gesture-recognizer.js` | long-stroke and pause rules, config normalisation, `start(..., { source })` |
| `tests/gesture-recognizer.test.mjs` | **new** |
| `manifest.json` | add `js/gesture-binding.js` to `content_scripts` |
| `tests/load-order.test.mjs` | assert the new script loads before `content.js` |
| `js/content.js` | mouse + drag decisions through `GestureBinding`; drag `source`; pass repeat config |
| `js/constants.js` | two `DEFAULT_SETTINGS` keys |
| `js/settings-merge.js` | two `MERGE_MAP` entries |
| `js/components/options-page.js` | two sliders, off notice, `recognizerConfig` to recorders |
| `js/components/gesture-recorder.js` | `open({ recognizerConfig })` |
| `js/components/drag-gesture-manager.js` | `recognizerConfig` property, passed to `open()` |
| `_locales/en/messages.json`, `_locales/de/messages.json` | five `fork*` keys |
| `tests/site-menu-locales.test.mjs` | `PENDING_TRANSLATION` += five keys |
| `CHANGELOG.md`, `README.md`, `README.de.md` | feature entry |

---

### Task 1: `GestureBinding` — pattern resolution

**Files:**
- Create: `js/gesture-binding.js`
- Create: `tests/gesture-binding.test.mjs`
- Modify: `manifest.json` (content_scripts list)
- Modify: `tests/load-order.test.mjs`

**Interfaces:**
- Produces:
  - `GestureBinding.collapse(pattern: string) → string` — every run of equal directions folded to one.
  - `GestureBinding.resolve(rawPattern: string, lookup: (p) => binding | undefined) → { rawPattern, effectivePattern, binding }` — `null` from `lookup` counts as "no entry" too.
  - `GestureBinding.suggestionBase(rawPattern: string, patterns: string[], isActive: (p) => boolean) → string`.

**Acceptance:** all new tests pass; `load-order` test asserts the script is listed before `content.js`; `npm test` green; no other file changes.

- [ ] **Step 1: Write the failing tests**

`tests/gesture-binding.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import '../js/gesture-binding.js';
const { collapse, resolve, suggestionBase } = globalThis.GestureBinding;

const lookupIn = (map) => (p) => map[p];
const activeIn = (map) => (p) => !!map[p] && map[p].action !== 'none';

describe('collapse', () => {
	it('folds every run of a direction into one', () => {
		expect(collapse('↓↓')).toBe('↓');
		expect(collapse('↓↓→→')).toBe('↓→');
		expect(collapse('↑↓')).toBe('↑↓');
		expect(collapse('')).toBe('');
	});
});

describe('resolve', () => {
	it('uses the raw pattern when it has an entry', () => {
		const r = resolve('↓↓', lookupIn({ '↓↓': { action: 'refresh' }, '↓': { action: 'scrollDown' } }));
		expect(r).toEqual({ rawPattern: '↓↓', effectivePattern: '↓↓', binding: { action: 'refresh' } });
	});

	// The whole point of returning the binding: a fallback must carry the
	// configuration of the pattern it falls back to, not just its action.
	it('falls back to the collapsed pattern and carries its whole binding', () => {
		const down = { action: 'scrollDown', scrollDistance: 1000, customName: 'Big scroll' };
		const r = resolve('↓↓', lookupIn({ '↓': down }));
		expect(r.rawPattern).toBe('↓↓');
		expect(r.effectivePattern).toBe('↓');
		expect(r.binding).toBe(down);
	});

	it('collapses longer patterns', () => {
		const m = { '↓→': { action: 'closeTab' } };
		expect(resolve('↓↓→', lookupIn(m)).effectivePattern).toBe('↓→');
		expect(resolve('↓↓→→', lookupIn(m)).effectivePattern).toBe('↓→');
	});

	it('lets an entry with action none block the fallback', () => {
		const r = resolve('↓↓', lookupIn({ '↓↓': { action: 'none' }, '↓': { action: 'scrollDown' } }));
		expect(r.effectivePattern).toBe('↓↓');
		expect(r.binding).toEqual({ action: 'none' });
	});

	it('returns the raw pattern unbound when nothing matches', () => {
		expect(resolve('↓↓', lookupIn({}))).toEqual({ rawPattern: '↓↓', effectivePattern: '↓↓', binding: undefined });
		expect(resolve('↑→↓', lookupIn({}))).toEqual({ rawPattern: '↑→↓', effectivePattern: '↑→↓', binding: undefined });
	});

	it('treats null from lookup as no entry', () => {
		const r = resolve('↓↓', (p) => (p === '↓' ? { action: 'scrollDown' } : null));
		expect(r.effectivePattern).toBe('↓');
	});

	it('works with drag-style list lookups', () => {
		const lists = { '↓': [{ direction: '↓', action: 'search' }] };
		const lookup = (p) => (lists[p]?.length ? lists[p] : undefined);
		const r = resolve('↓↓', lookup);
		expect(r.effectivePattern).toBe('↓');
		expect(r.binding).toBe(lists['↓']);
	});
});

describe('suggestionBase', () => {
	it('keeps the raw pattern when an active pattern extends it', () => {
		const m = { '↓↓→': { action: 'refresh' }, '↓→': { action: 'closeTab' } };
		expect(suggestionBase('↓↓', Object.keys(m), activeIn(m))).toBe('↓↓');
	});

	it('falls back to the collapsed pattern otherwise', () => {
		const m = { '↓→': { action: 'closeTab' } };
		expect(suggestionBase('↓↓', Object.keys(m), activeIn(m))).toBe('↓');
	});

	it('ignores a disabled extension', () => {
		const m = { '↓↓→': { action: 'none' }, '↓→': { action: 'closeTab' } };
		expect(suggestionBase('↓↓', Object.keys(m), activeIn(m))).toBe('↓');
	});

	it('does not count the raw pattern itself as an extension', () => {
		const m = { '↓↓': { action: 'refresh' }, '↓→': { action: 'closeTab' } };
		expect(suggestionBase('↓↓', Object.keys(m), activeIn(m))).toBe('↓');
	});

	it('leaves a pattern without repeats unchanged', () => {
		expect(suggestionBase('↓', [], () => false)).toBe('↓');
	});
});
```

Add to `tests/load-order.test.mjs`, inside `describe('manifest.json content scripts', …)`, after the page-icon test:

```js
	// content.js resolves every mouse and drag gesture through GestureBinding; a
	// missing or late entry is "GestureBinding is not defined" on the first gesture.
	it('loads gesture-binding.js before content.js', () => {
		const b = list.indexOf('js/gesture-binding.js');
		expect(b, 'js/gesture-binding.js missing from content_scripts').toBeGreaterThanOrEqual(0);
		expect(b).toBeLessThan(list.indexOf('js/content.js'));
	});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/gesture-binding.test.mjs tests/load-order.test.mjs`
Expected: FAIL — cannot resolve `../js/gesture-binding.js`; load-order: "js/gesture-binding.js missing from content_scripts".

- [ ] **Step 3: Implement**

`js/gesture-binding.js`:

```js
// Resolves a recognised gesture pattern to the binding that should run.
//
// The recognizer can produce repeated directions (↓↓). A repeated pattern with
// no entry of its own falls back to the pattern with every repeat collapsed
// (↓↓→ → ↓→), so nothing changes for anyone who never binds one. An entry whose
// action is 'none' is an entry: it blocks the fallback.
(function (root) {
	'use strict';

	function collapse(pattern) {
		return String(pattern || '').replace(/(.)\1+/g, '$1');
	}

	// lookup(pattern) returns the binding for a pattern, or undefined/null when
	// the pattern has no entry. What a binding is belongs to the caller: a
	// mouse-gesture entry, or a list of drag-gesture configs.
	function resolve(rawPattern, lookup) {
		const raw = typeof rawPattern === 'string' ? rawPattern : '';
		const direct = raw ? lookup(raw) : undefined;
		if (direct != null) return { rawPattern: raw, effectivePattern: raw, binding: direct };
		const collapsed = collapse(raw);
		if (collapsed !== raw) {
			const fallback = lookup(collapsed);
			if (fallback != null) return { rawPattern: raw, effectivePattern: collapsed, binding: fallback };
		}
		return { rawPattern: raw, effectivePattern: raw, binding: undefined };
	}

	// The pattern HUD suggestions are computed from: the raw one while some
	// active pattern directly extends it, else the collapsed one. No fallback is
	// applied for that check - a disabled ↓↓→ must not hide the ↓→ suggestions.
	function suggestionBase(rawPattern, patterns, isActive) {
		const raw = typeof rawPattern === 'string' ? rawPattern : '';
		for (const p of patterns) {
			if (p.length > raw.length && p.startsWith(raw) && isActive(p)) return raw;
		}
		return collapse(raw);
	}

	const api = { collapse, resolve, suggestionBase };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GestureBinding = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

`manifest.json`, in `content_scripts[0].js`, insert after `"js/gesture-recognizer.js",`:

```json
                "js/gesture-binding.js",
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run tests/gesture-binding.test.mjs tests/load-order.test.mjs`
Expected: PASS. Then `npm test` — all suites green.

- [ ] **Step 5: Commit**

```bash
git add js/gesture-binding.js tests/gesture-binding.test.mjs manifest.json tests/load-order.test.mjs
git commit -m "feat(gestures): GestureBinding resolves repeated patterns with a collapse fallback"
```

---

### Task 2: Recognizer — long-stroke repeat

**Files:**
- Modify: `js/gesture-recognizer.js` (whole file replaced, see below)
- Create: `tests/gesture-recognizer.test.mjs`

**Interfaces:**
- Produces:
  - `new GestureRecognizer({ distanceThreshold, longGestureMultiplier, maxThreshold, repeatDistance })` — `repeatDistance` optional, omitted/invalid = off.
  - `updateConfig({ repeatDistance })` — accepts 0.
  - `GestureRecognizer.REPEAT_DISTANCE_MAX === 600`.
  - A repeat sets `result.directionChanged = true`, `result.direction`, `result.pattern`.

**Acceptance:** all tests below pass; with `repeatDistance` omitted the recognizer behaves exactly as before (the "both off" tests); `npm test` green. No caller changes yet — `content.js` passes no `repeatDistance`, so the extension behaves as before.

- [ ] **Step 1: Write the failing tests**

`tests/gesture-recognizer.test.mjs`:

```js
import { describe, it, expect } from 'vitest';

// gesture-recognizer.js is a classic script that ends in
// `window.GestureRecognizer = …`; give it a window before loading it.
globalThis.window = globalThis;
await import('../js/gesture-recognizer.js');
const R = globalThis.GestureRecognizer;

// Moves in `steps` equal steps from `from` to `to`, one event every `dt` ms
// starting after `t0`. `ts: false` sends no timestamps (as the tutorial does).
function path(r, [x0, y0], [x1, y1], { steps = 10, t0 = 0, dt = 8, ts = true } = {}) {
	let last;
	for (let i = 1; i <= steps; i++) {
		const x = x0 + (x1 - x0) * i / steps;
		const y = y0 + (y1 - y0) * i / steps;
		last = ts ? r.move(x, y, t0 + dt * i) : r.move(x, y);
	}
	return last;
}

const LONG = { distanceThreshold: 20, longGestureMultiplier: 0.10, repeatDistance: 400 };

describe('recognizer without repeat config', () => {
	it('keeps today\'s patterns', () => {
		const r = new R({ distanceThreshold: 20 });
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 200]);
		expect(r.getPattern()).toBe('↓');
		path(r, [0, 200], [200, 200]);
		expect(r.getPattern()).toBe('↓→');
	});

	it('never repeats a long stroke', () => {
		const r = new R({ distanceThreshold: 20 });
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 900], { steps: 30 });
		expect(r.getPattern()).toBe('↓');
	});
});

describe('long-stroke repeat', () => {
	it('turns a stroke past repeatDistance into ↓↓', () => {
		const r = new R(LONG);
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 390], { steps: 13 });
		expect(r.getPattern()).toBe('↓');
		path(r, [0, 390], [0, 450], { steps: 2, t0: 104 });
		expect(r.getPattern()).toBe('↓↓');
	});

	it('reports the repeat like a turn', () => {
		const r = new R(LONG);
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 390], { steps: 13 });
		const result = r.move(0, 420, 112);
		expect(result.directionChanged).toBe(true);
		expect(result.direction).toBe('↓');
		expect(result.pattern).toBe('↓↓');
	});

	it('repeats when a single move event activates beyond repeatDistance', () => {
		const r = new R(LONG);
		r.start(0, 0, 0);
		const result = r.move(0, 450, 8);
		expect(result.activated).toBe(true);
		expect(result.pattern).toBe('↓↓');
		expect(result.directionChanged).toBe(true);
	});

	// Codex review #1: the repeat must not reset the physical segment length, or
	// the adaptive turn threshold collapses and a small drift becomes a turn.
	it('keeps the turn tolerance after a repeat', () => {
		const r = new R(LONG);
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 420], { steps: 14 });
		expect(r.getPattern()).toBe('↓↓');
		path(r, [0, 420], [25, 420], { steps: 5, t0: 112 });
		expect(r.getPattern()).toBe('↓↓');
	});

	it('never produces three equal directions in a row', () => {
		const r = new R(LONG);
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 900], { steps: 30 });
		expect(r.getPattern()).toBe('↓↓');
	});

	it('repeats again after a turn', () => {
		const r = new R(LONG);
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 100]);
		path(r, [0, 100], [450, 100], { steps: 15, t0: 80 });
		expect(r.getPattern()).toBe('↓→→');
	});

	it('raises repeatDistance to at least twice distanceThreshold', () => {
		const r = new R({ distanceThreshold: 100, repeatDistance: 50 });
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 190], { steps: 19 });
		expect(r.getPattern()).toBe('↓');
		path(r, [0, 190], [0, 300], { steps: 11, t0: 152 });
		expect(r.getPattern()).toBe('↓↓');
	});
});

describe('repeatDistance normalisation', () => {
	for (const bad of [0, -1, Infinity, NaN, '300', null]) {
		it(`treats ${String(bad)} as off`, () => {
			const r = new R({ distanceThreshold: 20, repeatDistance: bad });
			r.start(0, 0, 0);
			path(r, [0, 0], [0, 900], { steps: 30 });
			expect(r.getPattern()).toBe('↓');
		});
	}

	it('clamps to REPEAT_DISTANCE_MAX', () => {
		expect(R.REPEAT_DISTANCE_MAX).toBe(600);
		const r = new R({ distanceThreshold: 20, repeatDistance: 5000 });
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 570], { steps: 19 });
		expect(r.getPattern()).toBe('↓');
		path(r, [0, 570], [0, 630], { steps: 2, t0: 152 });
		expect(r.getPattern()).toBe('↓↓');
	});

	it('updateConfig accepts 0 to switch it off', () => {
		const r = new R(LONG);
		r.updateConfig({ repeatDistance: 0 });
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 900], { steps: 30 });
		expect(r.getPattern()).toBe('↓');
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/gesture-recognizer.test.mjs`
Expected: 8 FAIL — every `long-stroke repeat` test and the clamp test (pattern stays `↓`, `R.REPEAT_DISTANCE_MAX` is `undefined`). The "without repeat config" tests and the normalisation "off" tests already PASS (current behaviour).

- [ ] **Step 3: Implement**

Replace `js/gesture-recognizer.js` with:

```js
class GestureRecognizer {
	static REPEAT_DISTANCE_MAX = 600;

	#distanceThreshold;
	#longGestureMultiplier;
	#maxThreshold;
	#repeatDistance = 0;
	#active = false;
	#startX = 0;
	#startY = 0;
	#startTimestamp = 0;
	#anchorX = 0;
	#anchorY = 0;
	#currentX = 0;
	#currentY = 0;
	#pattern = [];
	#points = [];
	#segmentLength = 0;
	#repeatProgress = 0;

	constructor(config = {}) {
		this.#distanceThreshold = config.distanceThreshold || 20;
		this.#longGestureMultiplier = config.longGestureMultiplier ?? 0.10;
		this.#maxThreshold = config.maxThreshold ?? 120;
		this.#repeatDistance = GestureRecognizer.#limit(config.repeatDistance, GestureRecognizer.REPEAT_DISTANCE_MAX);
		this.reset();
	}

	// Anything but a finite positive number - omitted, negative, a string from a
	// hand-edited import - means off.
	static #limit(value, max) {
		if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
		return Math.min(value, max);
	}

	updateConfig(config) {
		if (config.distanceThreshold) {
			this.#distanceThreshold = config.distanceThreshold;
		}
		if (config.longGestureMultiplier !== undefined) {
			this.#longGestureMultiplier = config.longGestureMultiplier;
		}
		if (config.repeatDistance !== undefined) {
			this.#repeatDistance = GestureRecognizer.#limit(config.repeatDistance, GestureRecognizer.REPEAT_DISTANCE_MAX);
		}
	}

	reset() {
		this.#active = false;
		this.#startX = 0;
		this.#startY = 0;
		this.#startTimestamp = 0;
		this.#anchorX = 0;
		this.#anchorY = 0;
		this.#currentX = 0;
		this.#currentY = 0;
		this.#pattern = [];
		this.#points = [];
		this.#segmentLength = 0;
		this.#repeatProgress = 0;
	}

	start(x, y, timestamp = 0) {
		this.reset();
		this.#startX = x;
		this.#startY = y;
		this.#startTimestamp = timestamp;
		this.#anchorX = x;
		this.#anchorY = y;
		this.#currentX = x;
		this.#currentY = y;
		this.#points.push({ x, y, timestamp });
	}

	move(x, y, timestamp = null) {
		this.#currentX = x;
		this.#currentY = y;
		this.#points.push({ x, y, timestamp });

		const result = {
			activated: false,
			directionChanged: false,
			direction: null,
			pattern: this.#pattern.join(''),
			preActivationTrail: [],
			totalDistance: 0,
		};

		const totalDeltaX = this.#currentX - this.#startX;
		const totalDeltaY = this.#currentY - this.#startY;
		const totalDistance = Math.sqrt(totalDeltaX * totalDeltaX + totalDeltaY * totalDeltaY);
		result.totalDistance = totalDistance;

		if (!this.#active && totalDistance > this.#distanceThreshold) {
			this.#active = true;
			result.activated = true;
			result.preActivationTrail = [...this.#points];

			if (this.#distanceThreshold >= 10) {
				let replayMultiplier = 0.7;
				if (this.#distanceThreshold < 15) replayMultiplier = 0.8;

				const replayThreshold = this.#distanceThreshold * replayMultiplier;

				this.#pattern = [];
				this.#anchorX = this.#startX;
				this.#anchorY = this.#startY;
				this.#segmentLength = 0;

				for (const p of this.#points) {
					const deltaX = p.x - this.#anchorX;
					const deltaY = p.y - this.#anchorY;
					const dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

					if (dist > replayThreshold) {
						const direction = this.#getDirection(deltaX, deltaY);
						const lastDirection = this.#pattern[this.#pattern.length - 1];

						if (direction !== lastDirection) {
							this.#pattern.push(direction);
							this.#anchorX = p.x;
							this.#anchorY = p.y;
							this.#segmentLength = dist;
						} else {
							this.#segmentLength += dist;
							this.#anchorX = p.x;
							this.#anchorY = p.y;
						}
					}
				}
			}

			if (this.#pattern.length === 0) {
				const dir = this.#getDirection(totalDeltaX, totalDeltaY);
				this.#pattern.push(dir);
				this.#anchorX = this.#currentX;
				this.#anchorY = this.#currentY;
				this.#segmentLength = totalDistance;
			}

			result.pattern = this.#pattern.join('');
			result.direction = this.#pattern[this.#pattern.length - 1];
			result.directionChanged = true;

			// A single long move event from pointer-down has no later move to
			// cross repeatDistance on, so the replayed segment is checked here.
			this.#repeatProgress = this.#segmentLength;
			this.#checkLongStroke(result);
		}

		if (!this.#active) {
			return result;
		}

		const deltaX = this.#currentX - this.#anchorX;
		const deltaY = this.#currentY - this.#anchorY;
		const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

		if (distance > this.#distanceThreshold) {
			const direction = this.#getDirection(deltaX, deltaY);
			const lastDirection = this.#pattern[this.#pattern.length - 1];

			if (direction === lastDirection) {
				this.#segmentLength += distance;
				this.#repeatProgress += distance;
				this.#anchorX = this.#currentX;
				this.#anchorY = this.#currentY;
				this.#checkLongStroke(result);
			} else {
				const adaptiveThreshold = Math.min(
					this.#maxThreshold,
					this.#distanceThreshold + this.#segmentLength * this.#longGestureMultiplier
				);

				if (distance > adaptiveThreshold) {
					this.#pattern.push(direction);
					result.directionChanged = true;
					result.direction = direction;
					result.pattern = this.#pattern.join('');

					this.#segmentLength = distance;
					this.#repeatProgress = distance;
					this.#anchorX = this.#currentX;
					this.#anchorY = this.#currentY;
				}
			}
		}

		return result;
	}

	getPattern() {
		return this.#pattern.join('');
	}

	isActive() {
		return this.#active;
	}

	get startX() {
		return this.#startX;
	}

	get startY() {
		return this.#startY;
	}

	get currentX() {
		return this.#currentX;
	}

	get currentY() {
		return this.#currentY;
	}

	get startTimestamp() {
		return this.#startTimestamp;
	}

	// Never below twice the activation threshold, or every stroke would double
	// on its first step.
	#effectiveRepeatDistance() {
		return this.#repeatDistance ? Math.max(this.#repeatDistance, 2 * this.#distanceThreshold) : 0;
	}

	// Appends the last direction once more - never a third time in a row - and
	// reports it exactly like a turn, so HUD, suggestions and recorder update.
	#appendRepeat(result) {
		const n = this.#pattern.length;
		const direction = this.#pattern[n - 1];
		if (n >= 2 && this.#pattern[n - 2] === direction) return false;
		this.#pattern.push(direction);
		result.directionChanged = true;
		result.direction = direction;
		result.pattern = this.#pattern.join('');
		return true;
	}

	// segmentLength is deliberately left alone: it is the physical stroke, and
	// the adaptive turn threshold depends on it.
	#checkLongStroke(result) {
		const limit = this.#effectiveRepeatDistance();
		if (limit && this.#repeatProgress >= limit && this.#appendRepeat(result)) {
			this.#repeatProgress -= limit;
		}
	}

	#getDirection(deltaX, deltaY) {
		const absDeltaX = Math.abs(deltaX);
		const absDeltaY = Math.abs(deltaY);

		if (absDeltaX > absDeltaY) {
			return deltaX > 0 ? '→' : '←';
		} else {
			return deltaY > 0 ? '↓' : '↑';
		}
	}
}

window.GestureRecognizer = GestureRecognizer;
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run tests/gesture-recognizer.test.mjs`
Expected: PASS. Then `npm test` — all green.

- [ ] **Step 5: Commit**

```bash
git add js/gesture-recognizer.js tests/gesture-recognizer.test.mjs
git commit -m "feat(gestures): recognizer repeats a direction after a long stroke"
```

---

### Task 3: Recognizer — pause repeat

**Files:**
- Modify: `js/gesture-recognizer.js`
- Modify: `tests/gesture-recognizer.test.mjs`

**Interfaces:**
- Consumes: Task 2's recognizer (`#appendRepeat`, `#checkLongStroke`, `#repeatProgress`).
- Produces:
  - Constructor / `updateConfig` accept `repeatPause` (ms; omitted/invalid = off; 0 accepted by `updateConfig`).
  - `start(x, y, timestamp = 0, { source = 'pointer' } = {})` — `source` is `'pointer'` or `'drag'`; anything else is `'pointer'`.
  - `GestureRecognizer.PAUSE_JITTER === 6`, `GestureRecognizer.REPEAT_PAUSE_MAX === 2000`.

**Acceptance:** all recognizer tests pass, including Task 2's unchanged; `npm test` green.

Note on one refinement of the spec's timestamp rule: when a move without a usable timestamp leaves the rest radius, the new rest point gets `t: null` ("unknown"), and the next usable timestamp inside the radius starts the clock. That is stricter than keeping the old `rest.t`, which would let the unknown gap count as stillness.

- [ ] **Step 1: Write the failing tests**

Append to `tests/gesture-recognizer.test.mjs`:

```js
const PAUSE = { distanceThreshold: 20, longGestureMultiplier: 0.10, repeatPause: 500 };

describe('pause repeat (pointer)', () => {
	it('repeats ↓ after a pause and a continuation', () => {
		const r = new R(PAUSE);
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 100]);                          // ends at t=80
		expect(r.getPattern()).toBe('↓');
		path(r, [0, 100], [0, 160], { steps: 6, t0: 680 }); // first event 600 ms later
		expect(r.getPattern()).toBe('↓↓');
	});

	it('reports the repeat like a turn', () => {
		const r = new R(PAUSE);
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 100]);
		path(r, [0, 100], [0, 120], { steps: 2, t0: 680 });
		const result = r.move(0, 130, 704);
		expect(result.directionChanged).toBe(true);
		expect(result.direction).toBe('↓');
		expect(result.pattern).toBe('↓↓');
	});

	// Gemini review #8: after a full stop the next stroke is a new segment, so a
	// turn needs only distanceThreshold - 30 px here, where 50 px would be needed
	// without the pause.
	it('turns after a pause with only distanceThreshold of travel', () => {
		const r = new R(PAUSE);
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 300], { steps: 10 });
		path(r, [0, 300], [30, 300], { steps: 3, t0: 680 });
		expect(r.getPattern()).toBe('↓→');
	});

	it('does not repeat on a pause followed by release', () => {
		const r = new R(PAUSE);
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 100]);
		r.move(0, 108, 680);
		expect(r.getPattern()).toBe('↓');
	});

	it('counts jitter within 6 px as still', () => {
		const r = new R(PAUSE);
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 100]);
		r.move(3, 102, 300);
		r.move(-2, 104, 500);
		r.move(0, 103, 650);
		path(r, [0, 103], [0, 160], { steps: 4, t0: 650 });
		expect(r.getPattern()).toBe('↓↓');
	});

	it('does not count slow drift beyond 6 px as a pause', () => {
		const r = new R(PAUSE);
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 100]);
		for (let i = 1; i <= 8; i++) r.move(0, 100 + 2 * i, 80 + 100 * i);
		path(r, [0, 116], [0, 160], { steps: 4, t0: 880 });
		expect(r.getPattern()).toBe('↓');
	});

	it('ignores a pause before activation', () => {
		const r = new R(PAUSE);
		r.start(0, 0, 0);
		r.move(0, 5, 300);
		r.move(0, 10, 700);
		r.move(0, 25, 710);
		path(r, [0, 25], [0, 85], { steps: 6, t0: 710 });
		expect(r.getPattern()).toBe('↓');
	});

	it('treats sparse samples as a pause for the pointer source', () => {
		const r = new R(PAUSE);
		r.start(0, 0, 0);
		for (let i = 1; i <= 8; i++) r.move(0, 40 * i, 550 * i);
		expect(r.getPattern()).toBe('↓↓');
	});
});

describe('pause repeat (drag)', () => {
	// Codex review #2: dragover arrives sparsely while moving; a gap is no pause.
	it('does not repeat on sparse samples of a moving drag', () => {
		const r = new R(PAUSE);
		r.start(0, 0, 0, { source: 'drag' });
		for (let i = 1; i <= 8; i++) r.move(0, 40 * i, 550 * i);
		expect(r.getPattern()).toBe('↓');
	});

	it('repeats after stationary samples spanning the pause', () => {
		const r = new R(PAUSE);
		r.start(0, 0, 0, { source: 'drag' });
		path(r, [0, 0], [0, 100], { dt: 50 });               // ends at t=500
		r.move(0, 100, 850);
		r.move(0, 101, 1100);
		path(r, [0, 101], [0, 131], { steps: 3, t0: 1100, dt: 50 });
		expect(r.getPattern()).toBe('↓↓');
	});
});

describe('pause and cap', () => {
	it('consumes a pause the cap rejects, so it cannot leak into a later segment', () => {
		const r = new R({ ...PAUSE, repeatDistance: 400 });
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 420], { steps: 14 });            // ↓↓ by long stroke, t=112
		expect(r.getPattern()).toBe('↓↓');
		r.move(0, 430, 712);                                 // leaves the rest point after 600 ms
		path(r, [0, 430], [0, 480], { steps: 5, t0: 712 });  // capped repeat attempt
		path(r, [0, 480], [100, 480], { steps: 10, t0: 752 });
		path(r, [100, 480], [200, 480], { steps: 10, t0: 832 });
		expect(r.getPattern()).toBe('↓↓→');
	});
});

describe('pause timestamps and config', () => {
	it('never pauses without timestamps', () => {
		const r = new R(PAUSE);
		r.start(0, 0);
		path(r, [0, 0], [0, 100], { ts: false });
		path(r, [0, 100], [0, 160], { steps: 6, ts: false });
		expect(r.getPattern()).toBe('↓');
	});

	it('ignores decreasing and non-finite timestamps', () => {
		const r = new R(PAUSE);
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 100]);           // t=80
		r.move(0, 110, 10);                  // runs backwards
		r.move(0, 120, NaN);
		path(r, [0, 120], [0, 160], { steps: 4, t0: 700 });
		expect(r.getPattern()).toBe('↓');
	});

	for (const bad of [0, -1, Infinity, '500', null]) {
		it(`treats repeatPause ${String(bad)} as off`, () => {
			const r = new R({ ...PAUSE, repeatPause: bad });
			r.start(0, 0, 0);
			path(r, [0, 0], [0, 100]);
			path(r, [0, 100], [0, 160], { steps: 6, t0: 680 });
			expect(r.getPattern()).toBe('↓');
		});
	}

	it('updateConfig accepts 0 to switch it off', () => {
		const r = new R(PAUSE);
		r.updateConfig({ repeatPause: 0 });
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 100]);
		path(r, [0, 100], [0, 160], { steps: 6, t0: 680 });
		expect(r.getPattern()).toBe('↓');
	});

	it('exposes its constants', () => {
		expect(R.PAUSE_JITTER).toBe(6);
		expect(R.REPEAT_PAUSE_MAX).toBe(2000);
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/gesture-recognizer.test.mjs`
Expected: 7 FAIL — the pointer/drag "repeats" tests, "reports the repeat like a turn", the turn-after-pause test, the jitter test, the sparse-pointer test and the constants test. The "does not repeat"/"off" tests and the cap test already PASS (no pause logic yet); the cap test is a guard: it fails if a capped pause is not consumed (verified by mutation while writing this plan).

- [ ] **Step 3: Implement**

In `js/gesture-recognizer.js`:

1. Static fields and private fields — replace the first lines of the class up to and including `#repeatProgress = 0;` with:

```js
class GestureRecognizer {
	// Stillness radius for the pause rule, in CSS px. Fixed on purpose: tied to
	// distanceThreshold it would grow to 25 px at that slider's maximum.
	static PAUSE_JITTER = 6;
	static REPEAT_DISTANCE_MAX = 600;
	static REPEAT_PAUSE_MAX = 2000;

	#distanceThreshold;
	#longGestureMultiplier;
	#maxThreshold;
	#repeatDistance = 0;
	#repeatPause = 0;
	#source = 'pointer';
	#active = false;
	#startX = 0;
	#startY = 0;
	#startTimestamp = 0;
	#anchorX = 0;
	#anchorY = 0;
	#currentX = 0;
	#currentY = 0;
	#pattern = [];
	#points = [];
	#segmentLength = 0;
	#repeatProgress = 0;
	#rest = null;
	#pauseArmed = false;
	#lastTimestamp = null;
```

2. Constructor — after the `#repeatDistance` line add:

```js
		this.#repeatPause = GestureRecognizer.#limit(config.repeatPause, GestureRecognizer.REPEAT_PAUSE_MAX);
```

3. `updateConfig` — after the `repeatDistance` block add:

```js
		if (config.repeatPause !== undefined) {
			this.#repeatPause = GestureRecognizer.#limit(config.repeatPause, GestureRecognizer.REPEAT_PAUSE_MAX);
		}
```

4. `reset()` — after `this.#repeatProgress = 0;` add:

```js
		this.#source = 'pointer';
		this.#rest = null;
		this.#pauseArmed = false;
		this.#lastTimestamp = null;
```

5. `start` — replace with:

```js
	start(x, y, timestamp = 0, { source = 'pointer' } = {}) {
		this.reset();
		this.#source = source === 'drag' ? 'drag' : 'pointer';
		this.#acceptTimestamp(timestamp);
		this.#startX = x;
		this.#startY = y;
		this.#startTimestamp = timestamp;
		this.#anchorX = x;
		this.#anchorY = y;
		this.#currentX = x;
		this.#currentY = y;
		this.#points.push({ x, y, timestamp });
	}
```

6. `move` — first line of the body becomes:

```js
		const ts = this.#acceptTimestamp(timestamp);
```

   followed by the existing `this.#currentX = x;` etc.

7. `move`, activation block — directly before `this.#repeatProgress = this.#segmentLength;` add:

```js
			// Rest tracking starts here, not in start(): slow movement before
			// activation must never count as a pause.
			this.#rest = { x: this.#currentX, y: this.#currentY, t: ts };
```

8. `move` — replace from `if (!this.#active) {` to the end of the `if (distance > this.#distanceThreshold) { … }` block with:

```js
		if (!this.#active) {
			return result;
		}

		if (!result.activated) {
			this.#trackRest(ts);
		}

		const deltaX = this.#currentX - this.#anchorX;
		const deltaY = this.#currentY - this.#anchorY;
		const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

		if (distance > this.#distanceThreshold) {
			const direction = this.#getDirection(deltaX, deltaY);
			const lastDirection = this.#pattern[this.#pattern.length - 1];

			if (this.#pauseArmed) {
				// Consumed whatever happens - also when the cap rejects the
				// repeat - so it never leaks into a later segment.
				this.#pauseArmed = false;
				if (direction === lastDirection) {
					this.#appendRepeat(result);
				} else {
					this.#pattern.push(direction);
					result.directionChanged = true;
					result.direction = direction;
					result.pattern = this.#pattern.join('');
				}
				this.#segmentLength = distance;
				this.#repeatProgress = distance;
				this.#anchorX = this.#currentX;
				this.#anchorY = this.#currentY;
			} else if (direction === lastDirection) {
				this.#segmentLength += distance;
				this.#repeatProgress += distance;
				this.#anchorX = this.#currentX;
				this.#anchorY = this.#currentY;
				this.#checkLongStroke(result);
			} else {
				const adaptiveThreshold = Math.min(
					this.#maxThreshold,
					this.#distanceThreshold + this.#segmentLength * this.#longGestureMultiplier
				);

				if (distance > adaptiveThreshold) {
					this.#pattern.push(direction);
					result.directionChanged = true;
					result.direction = direction;
					result.pattern = this.#pattern.join('');

					this.#segmentLength = distance;
					this.#repeatProgress = distance;
					this.#anchorX = this.#currentX;
					this.#anchorY = this.#currentY;
				}
			}
		}
```

9. New private methods — add before `#getDirection`:

```js
	// Only a finite timestamp that does not run backwards can measure a pause.
	#acceptTimestamp(timestamp) {
		if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
		if (this.#lastTimestamp !== null && timestamp < this.#lastTimestamp) return null;
		this.#lastTimestamp = timestamp;
		return timestamp;
	}

	#trackRest(ts) {
		if (!this.#repeatPause) return;
		const x = this.#currentX;
		const y = this.#currentY;
		const rest = this.#rest;
		if (!rest) {
			this.#rest = { x, y, t: ts };
			return;
		}
		const still = Math.hypot(x - rest.x, y - rest.y) <= GestureRecognizer.PAUSE_JITTER;
		if (still) {
			if (rest.t === null) rest.t = ts;
			else if (ts !== null && ts - rest.t >= this.#repeatPause) this.#armPause(rest);
			return;
		}
		// Mouse and pen send nothing while still, so for them the gap before the
		// move that leaves the radius is the pause. dragover keeps firing while
		// still and arrives sparsely while moving: there a gap proves nothing.
		if (this.#source === 'pointer' && ts !== null && rest.t !== null && ts - rest.t >= this.#repeatPause) {
			this.#armPause(rest);
		}
		// After arming, so the anchor above is the pre-pause rest point.
		this.#rest = { x, y, t: ts };
	}

	// Anchors at the point of rest, so the resumed movement counts toward the
	// next segment, and starts that segment from zero: after a full stop a turn
	// needs only distanceThreshold.
	#armPause(rest) {
		this.#pauseArmed = true;
		this.#anchorX = rest.x;
		this.#anchorY = rest.y;
		this.#segmentLength = 0;
		this.#repeatProgress = 0;
	}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run tests/gesture-recognizer.test.mjs`
Expected: PASS (Task 2 tests included). Then `npm test` — all green.

- [ ] **Step 5: Commit**

```bash
git add js/gesture-recognizer.js tests/gesture-recognizer.test.mjs
git commit -m "feat(gestures): recognizer repeats a direction after a pause"
```

---

### Task 4: `content.js` — mouse gestures through `GestureBinding`

**Files:**
- Modify: `js/content.js` — `getGestureAction` / `getActionName` (~2285–2340), `getSuggestedGestures` (~2342–2375), pointermove HUD block (~3101–3107), `executeGesture` (~4077–4091)

**Interfaces:**
- Consumes: `window.GestureBinding.resolve`, `window.GestureBinding.suggestionBase` (Task 1).
- Produces (inside `initGestures`): `lookupMouseBinding(pattern) → binding | undefined`, `resolveMouseGesture(pattern) → { rawPattern, effectivePattern, binding }`, `getBindingName(binding) → string`, `getActionName(pattern) → string` (direct, no fallback), `getSuggestedGestures(rawPattern) → { base, suggestions }`.

**Acceptance:** `npm test` green; `grep -n "getGestureAction" js/content.js` returns nothing; manual: reload the extension, all default gestures and HUD labels/suggestions behave as before (the recognizer still gets no repeat config, so no repeats occur yet); a gesture with a custom name still shows it.

- [ ] **Step 1: Replace `getGestureAction` and `getActionName`**

Replace the whole of `function getGestureAction(pattern) { … }` and `function getActionName(pattern) { … }` with:

```js
		// One binding shape for both sources - the stored entry, or a default
		// wrapped as { action } - so a fallback from ↓↓ to ↓ carries ↓'s
		// configuration along with its action.
		function lookupMouseBinding(pattern) {
			if (!SETTINGS.enableGestureCustomization) {
				const action = DEFAULT_GESTURES[pattern];
				return action ? { action } : undefined;
			}
			const entry = SETTINGS.mouseGestures?.[pattern];
			return entry && typeof entry === 'object' ? entry : undefined;
		}

		function resolveMouseGesture(pattern) {
			return window.GestureBinding.resolve(pattern, lookupMouseBinding);
		}

		function getBindingName(binding) {
			const action = binding?.action;
			if (!action || action === 'none') return '';
			if (SETTINGS.enableGestureCustomization && binding.customName) {
				return binding.customName;
			}
			if (action === 'actionChain') {
				const chain = SETTINGS.actionChains?.[binding.chainId];
				if (chain?.name) return chain.name;
				if (!chain) return `${msg(ACTION_KEYS[action])} ${msg('chainNotFound')}`;
			}
			if (action === 'customMenu') {
				return binding.ownMenu?.name || msg('customMenuOwnLabel');
			}
			if (action === 'siteMenu') {
				const resolved = resolveGestureMenu(siteMenuCfg(binding));
				if (resolved?.name) return resolved.name;
				if (resolved?.nameKey) {
					const localized = msg(resolved.nameKey);
					if (localized) return localized;
				}
				if (!resolved) {
					return (binding.mode === 'standard' || binding.mode === 'fork')
						? `${msg(ACTION_KEYS[action])} ${msg('menuNotFound')}`
						: msg('customMenuContextualLabel');
				}
			}
			if (action === 'simulateKey') {
				const defaults = ACTION_DEFAULTS.simulateKey || {};
				const keyValue = binding.keyValue || defaults.keyValue || 'ArrowLeft';
				const mods = [];
				if (binding.modCtrl) mods.push('Ctrl');
				if (binding.modShift) mods.push('Shift');
				if (binding.modAlt) mods.push('Alt');
				if (binding.modMeta) mods.push('Meta');
				mods.push(keyValue);
				return `${msg(ACTION_KEYS[action])} (${mods.join('+')})`;
			}
			const i18nKey = ACTION_KEYS[action];
			return i18nKey ? msg(i18nKey) : '';
		}

		// Direct lookup, no fallback: suggestions list stored patterns as they are.
		function getActionName(pattern) {
			return getBindingName(lookupMouseBinding(pattern));
		}
```

Before replacing, diff the old `getActionName` against this once more line by line: the only intended change is reading `binding` instead of `SETTINGS.mouseGestures?.[pattern]` / `getGestureAction(pattern)`.

- [ ] **Step 2: Replace `getSuggestedGestures`**

```js
		function getSuggestedGestures(rawPattern) {
			const source = SETTINGS.enableGestureCustomization
				? (SETTINGS.mouseGestures || {})
				: DEFAULT_GESTURES;
			const patterns = Object.keys(source);
			const isActive = (p) => {
				const action = lookupMouseBinding(p)?.action;
				return !!action && action !== 'none';
			};
			// The whole pipeline runs on the base: prefix, candidate length and
			// the sort key's next direction.
			const base = window.GestureBinding.suggestionBase(rawPattern, patterns, isActive);
			const suggestions = [];
			for (const pattern of patterns) {
				if (!pattern.startsWith(base)) continue;
				if (pattern.length !== base.length + 1) continue;
				const actionName = getActionName(pattern);
				if (!actionName) continue;
				suggestions.push({ pattern, actionName });
			}

			const lastDir = base.slice(-1);
			const isHorizontal = lastDir === '←' || lastDir === '→';
			const isVertical = lastDir === '↑' || lastDir === '↓';

			const getSortKey = (pattern) => {
				const D = pattern[base.length];
				if (isHorizontal) {
					if (D === '↑') return 0;
					if (D === '←' || D === '→') return 1;
					if (D === '↓') return 2;
				} else if (isVertical) {
					if (D === '←') return 0;
					if (D === '↑' || D === '↓') return 1;
					if (D === '→') return 2;
				}
				return 3;
			};

			suggestions.sort((a, b) => getSortKey(a.pattern) - getSortKey(b.pattern));
			return { base, suggestions };
		}
```

- [ ] **Step 3: Update the pointermove HUD block**

Replace:

```js
			if (result.directionChanged && SETTINGS.enableHUD) {
				const actionName = getActionName(result.pattern);
				visualizer.updateAction(result.pattern, actionName ? [actionName] : []);
				if (SETTINGS.enableSuggestedGestures) {
					const suggestions = getSuggestedGestures(result.pattern);
					visualizer.updateSuggestedGestures(suggestions, result.pattern);
				}
			}
```

with:

```js
			if (result.directionChanged && SETTINGS.enableHUD) {
				// Arrows show the effective pattern: an unbound long ↓ reads ↓.
				const resolved = resolveMouseGesture(result.pattern);
				const actionName = getBindingName(resolved.binding);
				visualizer.updateAction(resolved.effectivePattern, actionName ? [actionName] : []);
				if (SETTINGS.enableSuggestedGestures) {
					const { base, suggestions } = getSuggestedGestures(result.pattern);
					visualizer.updateSuggestedGestures(suggestions, base);
				}
			}
```

- [ ] **Step 4: Update `executeGesture`**

Replace its first lines and the `config` computation:

```js
		function executeGesture(pattern) {
			const { binding } = resolveMouseGesture(pattern);
			const action = binding?.action;
			if (!action || action === 'none') return;
```

…keep the Edge block unchanged…

```js
			const config = SETTINGS.enableGestureCustomization ? binding : {};
			executeAction(action, config, { startX: recognizer.startX, startY: recognizer.startY, endX: recognizer.currentX, endY: recognizer.currentY }, gestureState.startTarget);
		}
```

- [ ] **Step 5: Verify**

Run: `npm test` → green. Run: `grep -n "getGestureAction" js/content.js` → no output.
Manual: reload the extension at `chrome://extensions` (or Edge with `--load-extension`); on any page draw `↓`, `↓→`, `→↓←↑`; HUD labels and suggestions as before; give `↓` a custom name in the options (customisation on) — HUD shows it.

- [ ] **Step 6: Commit**

```bash
git add js/content.js
git commit -m "refactor(gestures): mouse gestures resolve through GestureBinding"
```

---

### Task 5: `content.js` — super drag through `GestureBinding`

**Files:**
- Modify: `js/content.js` — near `hasDragAction` (~2273), `dragstart` `recognizer.start` (~3328), `dragover` (~3381–3389), `dragenter` (~3396), `drop` (~3421–3425)

**Interfaces:**
- Consumes: `GestureBinding.resolve` (Task 1); `start(..., { source: 'drag' })` (Task 3).
- Produces: `resolveDragPattern(dragType, pattern) → string` (the effective pattern).

**Acceptance:** `npm test` green; manual: text/link/image drags in all four basic directions behave as before (drop accepted, HUD hint shown).

- [ ] **Step 1: Add `resolveDragPattern`** directly after `hasDragAction`:

```js
		// The raw pattern if it has drag gestures, else the collapsed one if that
		// has. Drag configs derive from the pattern alone, so resolving the pattern
		// once is enough for hints, drop acceptance and execution.
		function resolveDragPattern(dragType, pattern) {
			const gestures = getGesturesForDragType(dragType);
			if (!gestures || !pattern) return pattern;
			return window.GestureBinding.resolve(pattern, (p) => {
				const configs = getDragGestureConfigs(gestures, p);
				return configs.length ? configs : undefined;
			}).effectivePattern;
		}
```

- [ ] **Step 2: Drag source** — in the `dragstart` handler replace `recognizer.start(e.clientX, e.clientY, e.timeStamp);` with:

```js
				recognizer.start(e.clientX, e.clientY, e.timeStamp, { source: 'drag' });
```

(Only this one; the pointerdown call at ~3040 stays as it is.)

- [ ] **Step 3: `dragover`** — replace:

```js
			if (hasDragAction(gestureState.dragType, recognizer.getPattern())) {
				e.preventDefault();
				e.stopImmediatePropagation();
			}

			if (result.directionChanged && SETTINGS.enableHUD) {
				const hints = getDragHints(gestureState.dragType, result.pattern, gestureState.selectedText, gestureState.parentLink);
				visualizer.updateAction(hints.length > 0 ? result.pattern : '', hints);
			}
```

with:

```js
			const dragPattern = resolveDragPattern(gestureState.dragType, recognizer.getPattern());
			if (hasDragAction(gestureState.dragType, dragPattern)) {
				e.preventDefault();
				e.stopImmediatePropagation();
			}

			if (result.directionChanged && SETTINGS.enableHUD) {
				const hints = getDragHints(gestureState.dragType, dragPattern, gestureState.selectedText, gestureState.parentLink);
				visualizer.updateAction(hints.length > 0 ? dragPattern : '', hints);
			}
```

- [ ] **Step 4: `dragenter`** — replace `if (hasDragAction(gestureState.dragType, recognizer.getPattern())) {` with:

```js
			if (hasDragAction(gestureState.dragType, resolveDragPattern(gestureState.dragType, recognizer.getPattern()))) {
```

- [ ] **Step 5: `drop`** — replace `const pattern = recognizer.getPattern();` with:

```js
					const pattern = resolveDragPattern(gestureState.dragType, recognizer.getPattern());
```

- [ ] **Step 6: Verify**

Run: `npm test` → green. Run: `grep -n "recognizer.getPattern()" js/content.js` → every drag-related hit is wrapped in `resolveDragPattern(`; the pointerup hit (`executeGesture(recognizer.getPattern())`) stays raw — `executeGesture` resolves itself.
Manual: drag text `→` (search), a link `↓`, an image `→`; each runs as before with its HUD hint.

- [ ] **Step 7: Commit**

```bash
git add js/content.js
git commit -m "refactor(gestures): super drag resolves through GestureBinding"
```

---

### Task 6: Settings — turn repeats on

**Files:**
- Modify: `js/constants.js` (`DEFAULT_SETTINGS`, after `gestureTurnTolerance: 0.10,` ~265)
- Modify: `js/settings-merge.js` (`MERGE_MAP`, after `gestureTurnTolerance: 'scalar',` ~76)
- Modify: `js/content.js` (recognizer construction ~2192, `updateConfig` ~2405)

**Interfaces:**
- Produces: settings keys `gestureRepeatDistance` (number, default 400) and `gestureRepeatPause` (number, default 500).

**Acceptance:** `npm test` green (the partition test in `settings-merge.test.mjs` covers the new keys); manual: with no repeated gesture bound, a long `↓` (> 400 px) still scrolls and the HUD shows `↓`; a pause between two `↓` strokes still scrolls as `↓`.

- [ ] **Step 1: Defaults** — in `DEFAULT_SETTINGS` after `gestureTurnTolerance: 0.10,`:

```js
		gestureRepeatDistance: 400,
		gestureRepeatPause: 500,
```

- [ ] **Step 2: Run the partition test to see it fail**

Run: `npx vitest run tests/settings-merge.test.mjs`
Expected: FAIL — the two keys are in none of `MERGE_MAP` / `DEVICE_LOCAL` / `NEVER`.

- [ ] **Step 3: Merge kind** — in `MERGE_MAP` after `gestureTurnTolerance: 'scalar',`:

```js
		gestureRepeatDistance: 'scalar',
		gestureRepeatPause: 'scalar',
```

Run: `npx vitest run tests/settings-merge.test.mjs` → PASS.

- [ ] **Step 4: Content script config** — the recognizer construction becomes:

```js
		const recognizer = new window.GestureRecognizer({
			distanceThreshold: CONFIG.DISTANCE_THRESHOLD,
			repeatDistance: DEFAULT_SETTINGS.gestureRepeatDistance,
			repeatPause: DEFAULT_SETTINGS.gestureRepeatPause
		});
```

and the `updateConfig` call in `loadSettings`:

```js
					recognizer.updateConfig({
						distanceThreshold: SETTINGS.distanceThreshold,
						longGestureMultiplier: SETTINGS.gestureTurnTolerance,
						repeatDistance: SETTINGS.gestureRepeatDistance,
						repeatPause: SETTINGS.gestureRepeatPause
					});
```

- [ ] **Step 5: Verify**

Run: `npm test` → green.
Manual (reload extension): long `↓` > 400 px → scrolls, HUD shows `↓` + "Scroll down"; `↓`, pause ~1 s, `↓` → scrolls, HUD `↓`; long `↓` then `→` → `↓→` action (close tab — use a throwaway tab).

- [ ] **Step 6: Commit**

```bash
git add js/constants.js js/settings-merge.js js/content.js
git commit -m "feat(gestures): repeated gestures on by default (400 px, 500 ms)"
```

---

### Task 7: Options page, recorders, i18n, docs

**Files:**
- Modify: `js/components/gesture-recorder.js` (`open()` ~336–345)
- Modify: `js/components/drag-gesture-manager.js` (properties ~9–13, constructor ~191–196, `#changeDirection` ~496–502, `#addRow` ~513–516)
- Modify: `js/components/options-page.js` (sliders after the `gestureTurnTolerance` row ~708, three `<drag-gesture-manager>` ~781/804/840, recorder call ~1701, new private method)
- Modify: `_locales/en/messages.json`, `_locales/de/messages.json` (after `gestureTurnToleranceDesc` ~924)
- Modify: `tests/site-menu-locales.test.mjs` (`PENDING_TRANSLATION`)
- Modify: `CHANGELOG.md`, `README.md`, `README.de.md`

**Interfaces:**
- Consumes: settings keys from Task 6; recognizer config names from Tasks 2–3.
- Produces: `GestureRecorder.open({ button, bannedPatterns, recognizerConfig })`; `DragGestureManager.recognizerConfig` (Object).

**Acceptance:** `npm test` green (locale tests include the five keys via `PENDING_TRANSLATION`; placeholder test passes); manual: both sliders appear in advanced mode next to the existing gesture sliders, with inline reset; both at 0 shows the notice; the mouse recorder ("add gesture") records `↓↓` by long stroke and by pause; each drag manager's recorder does too.

- [ ] **Step 1: Recorder** — in `gesture-recorder.js` replace the `open` signature and the recognizer construction:

```js
	async open({ button = 'right', bannedPatterns = [], recognizerConfig = {} } = {}) {
```

```js
		// The live recognizer settings, so what is recorded is what pages recognise.
		this.#recognizer = new window.GestureRecognizer({ distanceThreshold: 20, ...recognizerConfig });
```

The recorder never resolves patterns; `bannedPatterns` keeps comparing raw patterns. Its mouse events already pass `e.timeStamp`.

- [ ] **Step 2: Drag manager** — add to `static properties`:

```js
		recognizerConfig: { type: Object },
```

in the constructor:

```js
		this.recognizerConfig = {};
```

and in both `#changeDirection` and `#addRow` replace `recorder.open({ button: 'left' })` with:

```js
recorder.open({ button: 'left', recognizerConfig: this.recognizerConfig })
```

- [ ] **Step 3: Options page — config helper** — add as a private method near `#coerce`:

```js
	#recognizerConfig() {
		const s = this._settings;
		return {
			distanceThreshold: s.distanceThreshold,
			longGestureMultiplier: s.gestureTurnTolerance,
			repeatDistance: s.gestureRepeatDistance,
			repeatPause: s.gestureRepeatPause,
		};
	}
```

Pass it to all three `<drag-gesture-manager>` elements (text, image, link), next to `.dragGestures=…`:

```js
										.recognizerConfig=${this.#recognizerConfig()}
```

and to the gesture recorder call (~1701):

```js
		const result = await recorder.open({ button: 'right', bannedPatterns: existingPatterns, recognizerConfig: this.#recognizerConfig() });
```

- [ ] **Step 4: Options page — sliders** — directly after the closing `</div>` of the `gestureTurnTolerance` `setting-row` (inside the same `setting-group`):

```js
							<div class="setting-row advanced-setting">
								<div class="setting-label">
									<span class="setting-title">${i18n.getMessage('forkGestureRepeatDistance')}${this.#renderInlineReset('gestureRepeatDistance')}</span>
									<span>${i18n.getMessage('forkGestureRepeatDistanceDesc')}</span>
								</div>
								<div class="slider-control">
									<input type="range" id="gestureRepeatDistance" min="0" max="600" step="10" .value=${String(this._settings.gestureRepeatDistance)} @change=${e => this.#updateSetting('gestureRepeatDistance', e.target.value)} @input=${e => this.#debounceSetting('gestureRepeatDistance', e.target.value)}>
									<span>${this._settings.gestureRepeatDistance} px</span>
								</div>
							</div>

							<div class="setting-row advanced-setting">
								<div class="setting-label">
									<span class="setting-title">${i18n.getMessage('forkGestureRepeatPause')}${this.#renderInlineReset('gestureRepeatPause')}</span>
									<span>${i18n.getMessage('forkGestureRepeatPauseDesc')}</span>
								</div>
								<div class="slider-control">
									<input type="range" id="gestureRepeatPause" min="0" max="2000" step="50" .value=${String(this._settings.gestureRepeatPause)} @change=${e => this.#updateSetting('gestureRepeatPause', e.target.value)} @input=${e => this.#debounceSetting('gestureRepeatPause', e.target.value)}>
									<span>${this._settings.gestureRepeatPause} ms</span>
								</div>
							</div>
							${(this._settings.gestureRepeatDistance === 0 && this._settings.gestureRepeatPause === 0) ? html`
								<div class="setting-notice advanced-setting">${i18n.getMessage('forkGestureRepeatOffNotice')}</div>
							` : ''}
```

(`#coerce` turns the slider string into a number because the defaults are numbers.)

- [ ] **Step 5: i18n** — `_locales/en/messages.json`, after the `gestureTurnToleranceDesc` entry:

```json
	"forkGestureRepeatDistance": {
		"message": "Repeat by long stroke",
		"description": "Title of the setting for repeating a gesture direction with a long stroke"
	},
	"forkGestureRepeatDistanceDesc": {
		"message": "A stroke longer than this counts as the same direction twice, e.g. ↓↓. Only matters for gestures you bind to a repeated direction. 0 turns it off.",
		"description": "Description of the long-stroke repeat setting"
	},
	"forkGestureRepeatPause": {
		"message": "Repeat by pause",
		"description": "Title of the setting for repeating a gesture direction after a pause"
	},
	"forkGestureRepeatPauseDesc": {
		"message": "Hold still this long, then continue in the same direction to repeat it, e.g. ↓ pause ↓. Only matters for gestures you bind to a repeated direction. 0 turns it off.",
		"description": "Description of the pause repeat setting"
	},
	"forkGestureRepeatOffNotice": {
		"message": "Both are off: repeated gestures such as ↓↓ can neither be drawn nor recorded.",
		"description": "Notice shown when both repeat settings are 0"
	},
```

`_locales/de/messages.json`, same position:

```json
	"forkGestureRepeatDistance": {
		"message": "Wiederholung durch langen Strich",
		"description": "Title of the setting for repeating a gesture direction with a long stroke"
	},
	"forkGestureRepeatDistanceDesc": {
		"message": "Ein längerer Strich zählt als zweimal dieselbe Richtung, z. B. ↓↓. Wirkt nur bei Gesten, die du mit einer wiederholten Richtung belegst. 0 schaltet es aus.",
		"description": "Description of the long-stroke repeat setting"
	},
	"forkGestureRepeatPause": {
		"message": "Wiederholung durch Pause",
		"description": "Title of the setting for repeating a gesture direction after a pause"
	},
	"forkGestureRepeatPauseDesc": {
		"message": "So lange stillhalten und dann in dieselbe Richtung weiterziehen, um sie zu wiederholen, z. B. ↓ Pause ↓. Wirkt nur bei Gesten, die du mit einer wiederholten Richtung belegst. 0 schaltet es aus.",
		"description": "Description of the pause repeat setting"
	},
	"forkGestureRepeatOffNotice": {
		"message": "Beide sind aus: Wiederholte Gesten wie ↓↓ lassen sich weder zeichnen noch aufzeichnen.",
		"description": "Notice shown when both repeat settings are 0"
	},
```

`tests/site-menu-locales.test.mjs` — append to the `PENDING_TRANSLATION` array (before the closing `]`):

```js
	'forkGestureRepeatDistance', 'forkGestureRepeatDistanceDesc', 'forkGestureRepeatPause',
	'forkGestureRepeatPauseDesc', 'forkGestureRepeatOffNotice'
```

(add a comma after the current last entry `'iconPickerPage'`).

Run: `npx vitest run tests/site-menu-locales.test.mjs tests/locale-placeholders.test.mjs` → PASS.

- [ ] **Step 6: Docs**

`CHANGELOG.md`, under `### Unreleased` → `**New Features:**`, add as the first bullet:

```markdown
- **Repeated gestures:** a direction can now repeat inside a gesture — `↓↓`,
  `→→`, `↑↑`, `←←`, also within longer ones like `↓↓→`. Draw a long stroke, or
  stop briefly and continue in the same direction. Both ways are on by default
  and tunable (or switched off) in the advanced gesture settings. Until you bind
  a repeated gesture nothing changes: an unbound `↓↓` simply runs `↓`. Works
  for mouse gestures and super drag; record them like any custom gesture.
```

`README.md`, under `### ✨ What Gestura adds`, append as the last bullet:

```markdown
- **Repeated gestures** — `↓↓`, `→→`, `↑↑`, `←←` and longer ones like `↓↓→`, drawn as a long stroke or as stroke, pause, stroke. Unbound repeats fall back to the plain gesture, so nothing changes until you use them.
```

`README.de.md`, under `### ✨ Was Gestura hinzufügt`, append as the last bullet:

```markdown
- **Wiederholte Gesten** — `↓↓`, `→→`, `↑↑`, `←←` und längere wie `↓↓→`, gezeichnet als langer Strich oder als Strich, Pause, Strich. Unbelegte Wiederholungen fallen auf die einfache Geste zurück, es ändert sich also nichts, bis du sie nutzt.
```

- [ ] **Step 7: Verify**

Run: `npm test` → green.
Manual (reload extension, open options, advanced mode on in the gesture section):
- both sliders visible with px/ms values; inline reset appears after changing a value and restores 400 / 500;
- set both to 0 → notice appears; set one back → notice disappears;
- "add gesture": record a long `↓` → recorder shows `↓↓`; record `↓`, pause, `↓` → `↓↓`; save, assign an action;
- text-drag manager: "change direction" on a row, record a long `→` → `→→`.

- [ ] **Step 8: Commit**

```bash
git add js/components/gesture-recorder.js js/components/drag-gesture-manager.js js/components/options-page.js _locales/en/messages.json _locales/de/messages.json tests/site-menu-locales.test.mjs CHANGELOG.md README.md README.de.md
git commit -m "feat(options): settings and recorders for repeated gestures"
```

---

### Task 8: End-to-end browser verification

**Files:** none, unless the decision point below triggers a change.

**Acceptance:** every item of the spec's manual check is ticked with mouse **and** touchpad, at 100 % and 150 % zoom; the drag-pause decision is made and recorded.

- [ ] **Step 1: Unbound behaviour (success criterion 1)** — with no repeated gesture bound: long `↓` scrolls with HUD `↓`; `↓` pause `↓` scrolls; long `↓` + `→` closes the tab (throwaway tab); suggestions after a long `↓` show the `↓…` completions; customised `↓` (custom name, scroll distance via customisation) applies through a long stroke; super drag text `→` with a long stroke still searches and the drop is accepted.
- [ ] **Step 2: Bound repeats (criterion 2)** — bind `↓↓` to e.g. "Scroll to bottom": fires via long stroke and via pause; set `↓↓` to "none" → long `↓` does nothing (blocks); delete `↓↓` → long `↓` scrolls again. Bind a text-drag `→→` → fires via long drag; a continuous slow drag never produces `→→`.
- [ ] **Step 3: Settings (criterion 3)** — distance 0 → long strokes never repeat; pause 0 → pauses never repeat; values take effect on open pages after the options change (content scripts reload settings).
- [ ] **Step 4: Tutorial** — `pages/tutorial.html` steps pass with long strokes (no repeats there).
- [ ] **Step 5: Decision point — drag pause.** Hold a super drag still on mouse and on touchpad, then continue in the same direction. If the pause registers reliably, note "drag pause verified on mouse + touchpad" in the PR description. If it does not, **stop and report** what you observed (device, how long held, what the HUD showed). Switching the pause off for `source: 'drag'` is a design change: the spec is amended first, then a follow-up task is planned — no inline fix.
- [ ] **Step 6: Defaults feel** — if 400 px / 500 ms / 6 px feel wrong on either device, report the observed values; changing defaults is a spec amendment, not an inline tweak.
- [ ] **Step 7: Final** — `npm test` green; `git status` clean except intended changes.
