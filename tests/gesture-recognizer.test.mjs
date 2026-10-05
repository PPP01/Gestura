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
	// Consumed: after the capped attempt the ↓ segment grows to ~330 px, so the
	// turn threshold is ~53 px and 35 px sideways is drift. Leaked: every ↓ step
	// re-enters the armed branch, resets the segment to 30 px, the threshold stays
	// ~23 px and the drift becomes a turn. Fails for both ways of leaking (pause
	// kept after the cap, with or without consuming it on a turn).
	it('consumes a pause the cap rejects, so it cannot leak into a later segment', () => {
		const r = new R({ ...PAUSE, repeatDistance: 400 });
		r.start(0, 0, 0);
		path(r, [0, 0], [0, 420], { steps: 14 });            // ↓↓ by long stroke, t=112
		expect(r.getPattern()).toBe('↓↓');
		r.move(0, 430, 712);                                 // leaves the rest point after 600 ms: armed
		path(r, [0, 430], [0, 750], { steps: 32, t0: 712 }); // capped repeat attempt, then a long ↓
		path(r, [0, 750], [35, 750], { steps: 7, t0: 968 }); // sideways drift
		expect(r.getPattern()).toBe('↓↓');
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

describe('configFromSettings', () => {
	it('maps the four settings to recognizer config', () => {
		expect(R.configFromSettings({
			distanceThreshold: 25, gestureTurnTolerance: 0.2, gestureRepeatDistance: 350, gestureRepeatPause: 700, other: 1,
		})).toEqual({ distanceThreshold: 25, longGestureMultiplier: 0.2, repeatDistance: 350, repeatPause: 700 });
	});
});
