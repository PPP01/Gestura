import { describe, it, expect } from 'vitest';
import '../js/page-icons.js';
const P = globalThis.FlowMousePageIcons;

// A hand-made DOM: nodes expose querySelectorAll, an optional open shadowRoot
// and getRootNode(); only what page-icons.js touches. Selectors are modelled
// strictly - 'svg path[d]' needs an <svg> ancestor.
function node({ tag = 'div', attrs = {}, children = [], shadow = null } = {}) {
	const n = { tag, attrs, children, shadowRoot: shadow, parent: null, root: null,
		getAttribute: (k) => (k in attrs ? attrs[k] : null),
		getRootNode: () => n.root || n,
		querySelectorAll(sel) {
			const out = [];
			const walk = (c) => { for (const k of c.children) { if (match(k, sel)) out.push(k); walk(k); } };
			walk(n);
			return out;
		},
	};
	for (const c of children) c.parent = n;
	return n;
}
function match(n, sel) {
	if (sel === 'a[href]') return n.tag === 'a' && 'href' in n.attrs;
	if (sel === 'svg path[d]') {
		if (n.tag !== 'path' || !('d' in n.attrs)) return false;
		for (let p = n.parent; p; p = p.parent) if (p.tag === 'svg') return true;
		return false;
	}
	if (sel === '*') return true;
	return false;
}
const path = (d) => node({ tag: 'svg', children: [node({ tag: 'path', attrs: { d } })] });
const D = 'M12,2A2,2 0 0,1 14,4Z';

describe('sanitizePathData', () => {
	it('accepts ordinary path data and trims it', () => {
		expect(P.sanitizePathData('  ' + D + ' ')).toBe(D);
		expect(P.sanitizePathData('M2 19.63L13.43 8.2h-3.5e-1Z')).toBe('M2 19.63L13.43 8.2h-3.5e-1Z');
		expect(P.sanitizePathData('M3.5.5L1 1')).toBe('M3.5.5L1 1');
	});
	it('rejects markup, scripts and anything not path data', () => {
		for (const bad of ['', '   ', null, undefined, 42, {}, 'L1 1', '<svg>', 'M1 1"><script>x</script>',
			'M1 1 onload=alert(1)', 'M1,1 url(javascript:x)', "M1 1'", 'M1 1;', 'M0 0 </path>', 'M1 1e']) {
			expect(P.sanitizePathData(bad), String(bad)).toBeNull();
		}
	});
	it('rejects paths too short to draw anything, so the fallback icon shows instead of an empty one', () => {
		for (const bad of ['M', 'Mz', 'M1', 'M1 2', 'M1 2 3', 'M1 2Z']) {
			expect(P.sanitizePathData(bad), bad).toBeNull();
		}
		expect(P.sanitizePathData('M1 2L3 4')).toBe('M1 2L3 4');
	});
	it('rejects a huge string', () => {
		expect(P.sanitizePathData('M' + '1 '.repeat(3000))).toBeNull();
		expect(P.sanitizePathData('M' + '1 '.repeat(1500))).not.toBeNull();
	});
});

describe('targetPath', () => {
	const page = 'https://assi.home.schep.de/home/overview';
	it('returns the path of a same-origin url without query, fragment or trailing slash', () => {
		expect(P.targetPath('https://assi.home.schep.de/energie-2/energie?x=1#y', page)).toBe('/energie-2/energie');
		expect(P.targetPath('https://assi.home.schep.de/config/', page)).toBe('/config');
		expect(P.targetPath('https://assi.home.schep.de/', page)).toBe('/');
	});
	it('refuses another origin (host, port or scheme) and broken input', () => {
		expect(P.targetPath('https://other.example/config', page)).toBeNull();
		expect(P.targetPath('https://assi.home.schep.de:8123/config', page)).toBeNull();
		expect(P.targetPath('http://assi.home.schep.de/config', page)).toBeNull();
		expect(P.targetPath('not a url', page)).toBeNull();
		expect(P.targetPath('/config', page)).toBeNull();
		expect(P.targetPath('https://assi.home.schep.de/x', 'garbage')).toBeNull();
	});
});

describe('pickEntry', () => {
	const entries = [
		{ path: '/config', d: 'M1Z' }, { path: '/config/tools', d: 'M2Z' },
		{ path: '/energie-2', d: 'M3Z' }, { path: '/energie-2/energie', d: 'M4Z' },
	];
	const prefixOk = () => true;
	it('prefers the exact match', () => {
		expect(P.pickEntry(entries, '/energie-2/energie')).toBe('M4Z');
		expect(P.pickEntry(entries, '/energie-2/energie', prefixOk)).toBe('M4Z');
	});
	it('without a prefix rule only exact matches count', () => {
		expect(P.pickEntry(entries, '/energie-2/neu')).toBeNull();
	});
	it('with a prefix rule takes the longest whole-segment prefix', () => {
		expect(P.pickEntry(entries, '/config/tools/yaml', prefixOk)).toBe('M2Z');
		expect(P.pickEntry(entries, '/energie-2/neu', prefixOk)).toBe('M3Z');
	});
	it('never matches inside a segment', () => {
		expect(P.pickEntry([{ path: '/energie', d: 'M1Z' }], '/energie-2', prefixOk)).toBeNull();
	});
	it('lets the rule veto a prefix', () => {
		expect(P.pickEntry(entries, '/config/logs', (a) => a !== '/config')).toBeNull();
	});
	it('handles empty input', () => {
		expect(P.pickEntry([], '/x', prefixOk)).toBeNull();
		expect(P.pickEntry(entries, null, prefixOk)).toBeNull();
	});
});

describe('collect', () => {
	const page = 'https://ha.example/home';
	it('takes the icon inside the anchor', () => {
		const a = node({ tag: 'a', attrs: { href: '/config/entities' }, children: [path(D)] });
		const root = node({ children: [a] });
		expect(P.collect(root, page)).toEqual([{ path: '/config/entities', d: D }]);
	});
	it('ignores a <path> that is not inside an <svg>', () => {
		const orphan = node({ tag: 'a', attrs: { href: '/o' }, children: [node({ tag: 'path', attrs: { d: D } })] });
		expect(P.collect(node({ children: [orphan] }), page)).toEqual([]);
	});
	it('takes the icon from the shadow host when the anchor is the only link in its shadow root', () => {
		const a = node({ tag: 'a', attrs: { href: '/energie-2' } });
		const shadow = node({ children: [a] });
		a.root = shadow;
		const host = node({ tag: 'ha-list-item-button', children: [path(D)], shadow });
		shadow.host = host;
		const root = node({ children: [host] });
		expect(P.collect(root, page)).toEqual([{ path: '/energie-2', d: D }]);
	});
	it('does not hand one unrelated icon to every link of a component', () => {
		const a1 = node({ tag: 'a', attrs: { href: '/one' } });
		const a2 = node({ tag: 'a', attrs: { href: '/two' } });
		const shadow = node({ children: [a1, a2] });
		a1.root = shadow; a2.root = shadow;
		const host = node({ tag: 'nav-bar', children: [path(D)], shadow });
		shadow.host = host;
		expect(P.collect(node({ children: [host] }), page)).toEqual([]);
	});
	it('descends into nested open shadow roots to find the path', () => {
		const inner = node({ children: [path(D)] });
		const icon = node({ tag: 'ha-svg-icon', shadow: inner });
		const a = node({ tag: 'a', attrs: { href: '/map' }, children: [icon] });
		expect(P.collect(node({ children: [a] }), page)).toEqual([{ path: '/map', d: D }]);
	});
	it('skips other origins, hostile data and anchors without any icon; first entry per path wins', () => {
		const other = node({ tag: 'a', attrs: { href: 'https://evil.example/config' }, children: [path(D)] });
		const bad = node({ tag: 'a', attrs: { href: '/bad' }, children: [path('M1 1"><script>')] });
		const none = node({ tag: 'a', attrs: { href: '/none' } });
		const a1 = node({ tag: 'a', attrs: { href: '/dup' }, children: [path('M1 1L2 2Z')] });
		const a2 = node({ tag: 'a', attrs: { href: '/dup/' }, children: [path('M3 3L4 4Z')] });
		const out = P.collect(node({ children: [other, bad, none, a1, a2] }), page);
		expect(out).toEqual([{ path: '/dup', d: 'M1 1L2 2Z' }]);
	});
	it('resolves links with the real base URL, so a <base> pointing elsewhere is not same-origin', () => {
		const foreign = node({ tag: 'a', attrs: { href: '/dashboard' }, children: [path(D)] });
		foreign.baseURI = 'https://foreign.example/';
		expect(P.collect(node({ children: [foreign] }), page)).toEqual([]);
		const local = node({ tag: 'a', attrs: { href: '/dashboard' }, children: [path(D)] });
		local.baseURI = 'https://ha.example/some/dir/';
		expect(P.collect(node({ children: [local] }), page)).toEqual([{ path: '/dashboard', d: D }]);
	});
	it('inspects at most 1500 links', () => {
		const anchors = Array.from({ length: 3000 }, (_, i) =>
			node({ tag: 'a', attrs: { href: '/p' + i }, children: [path(D)] }));
		expect(P.collect(node({ children: anchors }), page)).toHaveLength(1500);
	});
	it('does not throw on an anchor whose root node has no host', () => {
		const a = node({ tag: 'a', attrs: { href: '/x' } });
		expect(() => P.collect(node({ children: [a] }), page)).not.toThrow();
		expect(P.collect(node({ children: [a] }), page)).toEqual([]);
	});
});

describe('createFinder', () => {
	const page = 'https://ha.example/home';
	const a = node({ tag: 'a', attrs: { href: '/energie-2' }, children: [path(D)] });
	const root = node({ children: [a] });
	it('returns the icon path for a link the page shows an icon for', () => {
		const find = P.createFinder(page, root);
		expect(find({ customUrl: 'https://ha.example/energie-2' })).toEqual({ iconPath: D });
	});
	it('falls back to the link icon when nothing matches', () => {
		const find = P.createFinder(page, root);
		expect(find({ customUrl: 'https://ha.example/unknown' })).toEqual({ iconName: 'link' });
		expect(find({ customUrl: 'https://other.example/energie-2' })).toEqual({ iconName: 'link' });
		expect(find({ customUrl: '' })).toEqual({ iconName: 'link' });
		expect(find({})).toEqual({ iconName: 'link' });
	});
	it('resolves placeholders against the page before matching', () => {
		const replace = (t, tab) => t.replace('{tabOrigin:raw}', new URL(tab.url).origin);
		const find = P.createFinder(page, root, replace);
		expect(find({ customUrl: '{tabOrigin:raw}/energie-2' })).toEqual({ iconPath: D });
	});
	it('scans lazily and only once', () => {
		let scans = 0;
		const counting = { querySelectorAll(sel) { scans++; return root.querySelectorAll(sel); } };
		const find = P.createFinder(page, counting);
		expect(scans).toBe(0);
		find({ customUrl: 'https://ha.example/energie-2' });
		const afterFirst = scans;
		find({ customUrl: 'https://ha.example/map' });
		find({ customUrl: 'https://ha.example/energie-2' });
		expect(scans).toBe(afterFirst);
	});
	it('uses the first provider that applies for prefix matches', () => {
		const sub = node({ tag: 'a', attrs: { href: '/energie-2' }, children: [path('M9 9L1 1Z')] });
		const r = node({ children: [sub] });
		const link = { customUrl: 'https://ha.example/energie-2/energie' };
		expect(P.createFinder(page, r)(link)).toEqual({ iconName: 'link' });
		P.providers.push({ id: 'test', applies: () => true, allowPrefix: () => true });
		try {
			expect(P.createFinder(page, r)(link)).toEqual({ iconPath: 'M9 9L1 1Z' });
		} finally { P.providers.pop(); }
	});
});
