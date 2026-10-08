import { describe, it, expect } from 'vitest';
import { canonicalText, diffLines, unifiedDiff } from '../js/components/text-diff.js';

describe('canonicalText', () => {
	it('is the same text whatever order the keys were written in', () => {
		expect(canonicalText({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } }))
			.toBe(canonicalText({ a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 }));
	});

	it('keeps array order, which is data', () => {
		expect(canonicalText({ a: [2, 1] })).not.toBe(canonicalText({ a: [1, 2] }));
	});

	it('is pretty-printed with two spaces, one value per line', () => {
		expect(canonicalText({ a: 1, b: [1] })).toBe('{\n  "a": 1,\n  "b": [\n    1\n  ]\n}');
	});
});

describe('diffLines', () => {
	it('reports no operation other than "same" for equal text', () => {
		expect(diffLines(['a', 'b'], ['a', 'b']).every(o => o.t === ' ')).toBe(true);
	});

	it('finds a changed line as one removal and one addition', () => {
		expect(diffLines(['a', 'b', 'c'], ['a', 'X', 'c']).map(o => o.t + o.line)).toEqual([' a', '-b', '+X', ' c']);
	});

	it('finds insertions and deletions in the middle of a run', () => {
		const ops = diffLines(['1', '2', '3', '4'], ['1', '3', '4', '5']);
		expect(ops.filter(o => o.t !== ' ').map(o => o.t + o.line)).toEqual(['-2', '+5']);
	});

	it('still answers, coarsely, for input too large for the exact search', () => {
		const a = Array.from({ length: 3000 }, (_, i) => `a${i}`);
		const b = Array.from({ length: 3000 }, (_, i) => `b${i}`);
		const ops = diffLines(a, b);
		expect(ops.filter(o => o.t === '-')).toHaveLength(3000);
		expect(ops.filter(o => o.t === '+')).toHaveLength(3000);
	});
});

describe('unifiedDiff', () => {
	const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`);

	it('is empty when nothing differs', () => {
		expect(unifiedDiff('a\nb', 'a\nb')).toBe('');
	});

	it('writes the two file headers and a hunk header', () => {
		const out = unifiedDiff('a\nb\nc', 'a\nX\nc', { aName: 'before', bName: 'after' }).split('\n');
		expect(out.slice(0, 3)).toEqual(['--- before', '+++ after', '@@ -1,3 +1,3 @@']);
		expect(out.slice(3)).toEqual([' a', '-b', '+X', ' c']);
	});

	it('keeps three lines of context and starts the hunk where the context does', () => {
		const a = lines(20);
		const b = [...a]; b[9] = 'changed';
		const out = unifiedDiff(a.join('\n'), b.join('\n')).split('\n');
		expect(out[2]).toBe('@@ -7,7 +7,7 @@');
		expect(out).toContain('-line 10');
		expect(out).toContain('+changed');
		expect(out).not.toContain(' line 5');
	});

	it('splits distant changes into separate hunks', () => {
		const a = lines(40);
		const b = [...a]; b[2] = 'x'; b[35] = 'y';
		const out = unifiedDiff(a.join('\n'), b.join('\n')).split('\n');
		expect(out.filter(l => l.startsWith('@@'))).toHaveLength(2);
	});

	it('merges changes whose contexts touch into one hunk', () => {
		const a = lines(20);
		const b = [...a]; b[5] = 'x'; b[9] = 'y';
		const out = unifiedDiff(a.join('\n'), b.join('\n')).split('\n');
		expect(out.filter(l => l.startsWith('@@'))).toHaveLength(1);
	});

	it('counts a hunk that starts at an insertion into an empty side as zero-length', () => {
		const out = unifiedDiff('', 'a').split('\n');
		expect(out.some(l => l.startsWith('@@ -0,0 +1,1 @@'))).toBe(true);
	});
});
