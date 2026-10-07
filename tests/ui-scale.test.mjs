import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// gesture-visual.js and gesture-recognizer.js are classic scripts that hang their
// exports on window; the zoom manager is created when the first one loads.
globalThis.window = globalThis;
await import('../js/gesture-visual.js');
await import('../js/gesture-recognizer.js');
const Z = globalThis.FlowMouseZoom;
const R = globalThis.GestureRecognizer;

const reset = () => Z.update({ tabZoom: 1, defaultZoom: 1, userScale: null });

describe('ZoomManager', () => {
	beforeEach(reset);

	it('keeps the screen size when the tab is zoomed', () => {
		Z.update({ tabZoom: 2 });
		expect(Z.uiScale).toBe(0.5);
	});

	it('takes the browser default zoom as the base', () => {
		Z.update({ tabZoom: 1.5, defaultZoom: 1.5 });
		expect(Z.uiScale).toBe(1);
	});

	it('lets the user scale replace the default zoom, still divided by the tab zoom', () => {
		Z.update({ userScale: 2, tabZoom: 2 });
		expect(Z.uiScale).toBe(1);
	});

	it('clamps the default zoom and the user scale to 0.5 .. 3', () => {
		Z.update({ userScale: 10 });
		expect(Z.uiScale).toBe(3);
		Z.update({ userScale: 0.1 });
		expect(Z.uiScale).toBe(0.5);
		Z.update({ userScale: null, defaultZoom: 9 });
		expect(Z.uiScale).toBe(3);
	});

	it('ignores values that are not positive numbers', () => {
		Z.update({ tabZoom: 2 });
		Z.update({ tabZoom: 0 });
		Z.update({ tabZoom: NaN });
		Z.update({ tabZoom: 'x' });
		expect(Z.tabZoom).toBe(2);
	});

	it('clears the user scale again with null', () => {
		Z.update({ userScale: 2 });
		Z.update({ userScale: null });
		expect(Z.uiScale).toBe(1);
	});

	it('says so only when the scale or the tab zoom really changed', () => {
		const seen = [];
		const onScale = () => seen.push('scale');
		const onZoom = () => seen.push('zoom');
		Z.addEventListener('uiscalechange', onScale);
		Z.addEventListener('tabzoomchange', onZoom);
		Z.update({ tabZoom: 2 });
		Z.update({ tabZoom: 2 });
		Z.update({ defaultZoom: 1 });
		Z.removeEventListener('uiscalechange', onScale);
		Z.removeEventListener('tabzoomchange', onZoom);
		expect(seen).toEqual(['zoom', 'scale']);
	});
});

describe('recognizer at a tab zoom', () => {
	beforeEach(reset);

	const drag = (zoom, px) => {
		Z.update({ tabZoom: zoom });
		const r = new R({ distanceThreshold: 20 });
		r.start(0, 0, 0);
		for (let i = 1; i <= 10; i++) r.move(0, px * i / 10, 8 * i);
		return r.getPattern();
	};

	it('needs the screen distance, not the CSS distance', () => {
		expect(drag(1, 15)).toBe('');
		expect(drag(2, 15)).toBe('↓');
	});

	it('needs more CSS pixels when the tab is zoomed out', () => {
		expect(drag(1, 25)).toBe('↓');
		expect(drag(0.5, 25)).toBe('');
	});
});
