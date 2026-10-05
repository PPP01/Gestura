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

	it('collapses a longer raw pattern with no direct extension', () => {
		const m = { '↓→': { action: 'closeTab' }, '↓→↑': { action: 'newTab' } };
		expect(suggestionBase('↓↓→', Object.keys(m), activeIn(m))).toBe('↓→');
	});
});
