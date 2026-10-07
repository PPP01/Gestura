import { describe, it, expect } from 'vitest';
import '../js/wheel-accumulator.js';
const WheelAccumulator = globalThis.GesturaWheelAccumulator;

describe('WheelAccumulator', () => {
	it('lets the first event of a scroll through at once', () => {
		const w = new WheelAccumulator(30);
		expect(w.step(10, 0, 0)).toBe(true);
	});

	it('holds back small deltas until they add up to the threshold', () => {
		const w = new WheelAccumulator(30);
		w.step(10, 0, 0);
		expect(w.step(10, 0, 10)).toBe(false);
		expect(w.step(10, 0, 20)).toBe(false);
		expect(w.step(10, 0, 30)).toBe(true);
		expect(w.step(10, 0, 40)).toBe(false);
	});

	it('steps once per notch of a mouse wheel', () => {
		const w = new WheelAccumulator(30);
		w.step(100, 0, 0);
		expect(w.step(100, 0, 100)).toBe(true);
		expect(w.step(100, 0, 200)).toBe(true);
	});

	it('fires at once when the direction turns, and restarts the count', () => {
		const w = new WheelAccumulator(30);
		w.step(10, 0, 0);
		w.step(10, 0, 10);
		expect(w.step(-10, 0, 20)).toBe(true);
		expect(w.step(-10, 0, 30)).toBe(false);
	});

	it('treats an event after a pause as a new scroll', () => {
		const w = new WheelAccumulator(30);
		w.step(10, 0, 0);
		expect(w.step(10, 0, 1500)).toBe(true);
	});

	it('counts line-mode deltas as 16.67px per line', () => {
		const w = new WheelAccumulator(30);
		w.step(1, 1, 0);
		expect(w.step(1, 1, 10)).toBe(false);
		expect(w.step(1, 1, 20)).toBe(true);
	});

	it('steps once per event in page mode', () => {
		const w = new WheelAccumulator(30);
		w.step(1, 2, 0);
		expect(w.step(1, 2, 10)).toBe(true);
	});

	it('follows a threshold that changes while it is in use', () => {
		const w = new WheelAccumulator(30);
		w.step(10, 0, 0);
		w.threshold = 5;
		expect(w.step(10, 0, 10)).toBe(true);
	});

	it('counts pixels at the tab zoom, lines not', () => {
		const px = new WheelAccumulator(30);
		px.step(10, 0, 0);
		expect(px.step(10, 0, 10, 2)).toBe(false);
		expect(px.step(10, 0, 20, 2)).toBe(true);
		const lines = new WheelAccumulator(30);
		lines.step(1, 1, 0);
		expect(lines.step(1, 1, 10, 2)).toBe(false);
		expect(lines.step(1, 1, 20, 2)).toBe(true);
	});

	it('forgets its state on reset', () => {
		const w = new WheelAccumulator(30);
		w.step(10, 0, 0);
		w.reset();
		expect(w.step(10, 0, 10)).toBe(true);
	});
});
