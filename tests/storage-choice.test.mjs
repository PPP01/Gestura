import { describe, it, expect } from 'vitest';
import { cardFor, planFor } from '../js/components/storage-choice.js';

describe('cardFor (spec §3) - total over all four combinations', () => {
	it.each([
		['sync', false, { card: 'browser', repair: false }],
		['local', false, { card: 'local', repair: false }],
		['local', true, { card: 'eu', repair: false }],
		['sync', true, { card: 'eu', repair: true }],
	])('(%s, enabled %s)', (area, enabled, want) => {
		expect(cardFor(area, enabled)).toEqual(want);
	});
});

describe('planFor (spec §4)', () => {
	it.each([
		['browser', 'local', 'to-local'],
		['local', 'browser', 'to-browser'],
		['browser', 'eu', 'onboard'],
		['local', 'eu', 'onboard'],
		['eu', 'local', 'off'],
		['eu', 'browser', 'off-then-browser'],
		['eu', 'eu', 'none'],
		['local', 'local', 'none'],
	])('%s -> %s', (from, to, want) => {
		expect(planFor(from, to)).toBe(want);
	});
});
