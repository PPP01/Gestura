// A line diff, and the unified format people know from `git diff`. Pure: no DOM,
// no i18n - the settings preview renders it, the tests read it.
//
// Small on purpose. The texts are pretty-printed settings, a few hundred to a few
// thousand lines, and a vendored diff library would be a dependency for what is
// a prefix/suffix trim and one LCS table. Input too large for the exact search
// is answered coarsely rather than slowly: every line of the differing middle is
// shown as removed and added. That is still a correct account of the change, just
// a longer one.

// Cells of the LCS table. 2M cells is 8 MB as Uint32 and well under a second.
const EXACT_LIMIT = 2_000_000;

// Stable text for a settings object: keys sorted, arrays left alone (their order
// is data), two-space indent. The same settings always give the same lines, so
// the diff shows real changes only.
export function canonicalText(value) {
	const sort = (v) => {
		if (Array.isArray(v)) return v.map(sort);
		if (v && typeof v === 'object') {
			const out = {};
			for (const k of Object.keys(v).sort()) out[k] = sort(v[k]);
			return out;
		}
		return v;
	};
	return JSON.stringify(sort(value), null, 2);
}

// Operations in order: { t: ' ' | '-' | '+', line }.
export function diffLines(a, b) {
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

	const ops = [];
	for (let i = 0; i < start; i++) ops.push({ t: ' ', line: a[i] });

	const am = a.slice(start, endA);
	const bm = b.slice(start, endB);
	if (!am.length || !bm.length || am.length * bm.length > EXACT_LIMIT) {
		for (const line of am) ops.push({ t: '-', line });
		for (const line of bm) ops.push({ t: '+', line });
	} else {
		// lcs[i][j] = length of the LCS of am[i..] and bm[j..], row-major.
		const w = bm.length + 1;
		const lcs = new Uint32Array((am.length + 1) * w);
		for (let i = am.length - 1; i >= 0; i--) {
			for (let j = bm.length - 1; j >= 0; j--) {
				lcs[i * w + j] = am[i] === bm[j]
					? lcs[(i + 1) * w + j + 1] + 1
					: Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
			}
		}
		let i = 0;
		let j = 0;
		while (i < am.length && j < bm.length) {
			if (am[i] === bm[j]) { ops.push({ t: ' ', line: am[i] }); i++; j++; }
			// Removals before additions, as in git.
			else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) { ops.push({ t: '-', line: am[i] }); i++; }
			else { ops.push({ t: '+', line: bm[j] }); j++; }
		}
		for (; i < am.length; i++) ops.push({ t: '-', line: am[i] });
		for (; j < bm.length; j++) ops.push({ t: '+', line: bm[j] });
	}

	for (let i = endA; i < a.length; i++) ops.push({ t: ' ', line: a[i] });
	return ops;
}

const split = (text) => (text === '' ? [] : text.split('\n'));

// '' when the two texts are equal. Otherwise the two file headers, then hunks
// with `context` lines around each change; changes whose contexts meet share one.
export function unifiedDiff(aText, bText, { context = 3, aName = 'before', bName = 'after' } = {}) {
	const ops = diffLines(split(aText), split(bText));
	const changed = [];
	ops.forEach((o, i) => { if (o.t !== ' ') changed.push(i); });
	if (!changed.length) return '';

	// Ranges of op indices, widened by the context and joined where they touch.
	const ranges = [];
	for (const i of changed) {
		const from = Math.max(0, i - context);
		const to = Math.min(ops.length - 1, i + context);
		const last = ranges[ranges.length - 1];
		if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
		else ranges.push({ from, to });
	}

	// 1-based line numbers of op i on each side, counted before the op.
	const aBefore = new Array(ops.length + 1);
	const bBefore = new Array(ops.length + 1);
	let ai = 1;
	let bi = 1;
	for (let i = 0; i < ops.length; i++) {
		aBefore[i] = ai; bBefore[i] = bi;
		if (ops[i].t !== '+') ai++;
		if (ops[i].t !== '-') bi++;
	}

	const out = [`--- ${aName}`, `+++ ${bName}`];
	for (const { from, to } of ranges) {
		const slice = ops.slice(from, to + 1);
		const aCount = slice.filter(o => o.t !== '+').length;
		const bCount = slice.filter(o => o.t !== '-').length;
		const aStart = aCount ? aBefore[from] : aBefore[from] - 1;
		const bStart = bCount ? bBefore[from] : bBefore[from] - 1;
		out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
		for (const o of slice) out.push(o.t + o.line);
	}
	return out.join('\n');
}
