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
