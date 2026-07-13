import { describe, it, expect } from 'vitest';
import '../js/menu-model.js';
const M = globalThis.FlowMouseMenuModel;

const CATALOG = [
	{ id: 'gh', name: 'GitHub', patterns: ['*github.com*'], items: [
		{ id: 'a', action: 'openCustomUrl', labelKey: 'kA', customUrl: 'https://github.com/a' },
		{ id: 's1', type: 'separator' },
		{ id: 'b', action: 'openCustomUrl', labelKey: 'kB', customUrl: 'https://github.com/b' },
	] },
	{ id: 'amz', name: 'Amazon', patterns: ['*amazon.*'], domains: { choices: ['amazon.de', 'amazon.com'], default: 'amazon.de' }, items: [
		{ id: 'cart', action: 'openCustomUrl', labelKey: 'kCart', customUrl: 'https://www.{domain}/cart' },
	] },
];
const EMPTY = { disabled: [], edited: {}, custom: {}, domains: {}, order: [] };
const matches = (url, pats) => pats.some(p => url.includes(p.replaceAll('*', '')));

describe('getBaseMenu', () => {
	it('returns catalog copy for pristine menu', () => {
		const m = M.getBaseMenu(CATALOG, EMPTY, 'gh');
		expect(m.name).toBe('GitHub');
		m.items.push({ id: 'x' });
		expect(CATALOG[0].items).toHaveLength(3); // Katalog unangetastet
	});
	it('edited copy wins over catalog', () => {
		const sm = { ...EMPTY, edited: { gh: { name: 'Mein GitHub', patterns: [], items: [] } } };
		expect(M.getBaseMenu(CATALOG, sm, 'gh').name).toBe('Mein GitHub');
	});
	it('resolves custom menus and returns null for unknown ids', () => {
		const sm = { ...EMPTY, custom: { menu_1: { name: 'Eigenes', patterns: [], items: [] } } };
		expect(M.getBaseMenu(CATALOG, sm, 'menu_1').name).toBe('Eigenes');
		expect(M.getBaseMenu(CATALOG, sm, 'nope')).toBeNull();
	});
});

describe('listMenus / listActiveMenus', () => {
	const sm = { ...EMPTY, disabled: ['amz'], custom: { menu_1: { name: 'Eigenes', items: [] } }, order: ['amz'] };
	it('orders by siteMenus.order first, then catalog, then customs; flags set', () => {
		const l = M.listMenus(CATALOG, sm);
		expect(l.map(m => m.id)).toEqual(['amz', 'gh', 'menu_1']);
		expect(l[0].disabled).toBe(true);
		expect(l[2].isCustom).toBe(true);
	});
	it('listActiveMenus drops disabled', () => {
		expect(M.listActiveMenus(CATALOG, sm).map(m => m.id)).toEqual(['gh', 'menu_1']);
	});
});

describe('resolveFork — Vererbungsregeln', () => {
	const base = () => ([
		{ id: 'a', action: 'openCustomUrl', labelKey: 'kA', customUrl: 'u1' },
		{ id: 'b', action: 'openCustomUrl', labelKey: 'kB', customUrl: 'u2' },
		{ id: 'c', action: 'openCustomUrl', labelKey: 'kC', customUrl: 'u3' },
	]);
	it('empty fork mirrors base', () => {
		expect(M.resolveFork(base(), M.emptyFork()).map(i => i.id)).toEqual(['a', 'b', 'c']);
	});
	it('override replaces the whole item, keeps id + position; base change to overridden item is ignored', () => {
		const fork = { ...M.emptyFork(), overrides: { b: { action: 'openCustomUrl', customName: 'Mein B', customUrl: 'mine' } } };
		const later = base(); later[1].customUrl = 'changed-upstream';
		const out = M.resolveFork(later, fork);
		expect(out[1]).toMatchObject({ id: 'b', customName: 'Mein B', customUrl: 'mine' });
	});
	it('unchanged items follow base changes', () => {
		const later = base(); later[0].customUrl = 'new-a';
		const out = M.resolveFork(later, M.emptyFork());
		expect(out[0].customUrl).toBe('new-a');
	});
	it('removed stays gone even after base edits', () => {
		const fork = { ...M.emptyFork(), removed: ['b'] };
		const later = base(); later[1].customUrl = 'changed';
		expect(M.resolveFork(later, fork).map(i => i.id)).toEqual(['a', 'c']);
	});
	it('Positionsvererbung: new base item appears at its base position', () => {
		const later = base(); later.splice(1, 0, { id: 'neu', action: 'openCustomUrl', customUrl: 'n' });
		expect(M.resolveFork(later, M.emptyFork()).map(i => i.id)).toEqual(['a', 'neu', 'b', 'c']);
	});
	it('added items anchor after afterId; "" means start; missing anchor -> end', () => {
		const fork = { ...M.emptyFork(), added: [
			{ id: 'x', afterId: 'a', action: 'none' },
			{ id: 'y', afterId: '', action: 'none' },
			{ id: 'z', afterId: 'weg', action: 'none' },
		] };
		expect(M.resolveFork(base(), fork).map(i => i.id)).toEqual(['y', 'a', 'x', 'b', 'c', 'z']);
	});
	it('added can anchor to another added item', () => {
		const fork = { ...M.emptyFork(), added: [
			{ id: 'x', afterId: 'a', action: 'none' },
			{ id: 'y', afterId: 'x', action: 'none' },
		] };
		expect(M.resolveFork(base(), fork).map(i => i.id)).toEqual(['a', 'x', 'y', 'b', 'c']);
	});
	it('fixed order wins; NEW base items go to the end; stale order-ids ignored', () => {
		const fork = { ...M.emptyFork(), order: ['c', 'a', 'geloescht', 'b'] };
		const later = base(); later.push({ id: 'neu', action: 'none' });
		expect(M.resolveFork(later, fork).map(i => i.id)).toEqual(['c', 'a', 'b', 'neu']);
	});
	it('separators are items with ids and inherit like any item', () => {
		const b = [{ id: 'a', action: 'none' }, { id: 's1', type: 'separator' }, { id: 'b', action: 'none' }];
		const fork = { ...M.emptyFork(), removed: ['s1'] };
		expect(M.resolveFork(b, fork).map(i => i.id)).toEqual(['a', 'b']);
	});
});

describe('fork edit helpers (immutabel)', () => {
	const base = [{ id: 'a', action: 'none' }, { id: 'b', action: 'none' }];
	it('forkOverrideItem on base item creates override; on added item updates added', () => {
		let f = M.forkOverrideItem(M.emptyFork(), base, { id: 'a', action: 'none', customName: 'A2' });
		expect(f.overrides.a.customName).toBe('A2');
		f = M.forkAddItem(f, { id: 'n1', action: 'none' }, 'a');
		f = M.forkOverrideItem(f, base, { id: 'n1', action: 'none', customName: 'N2' });
		expect(f.added.find(i => i.id === 'n1').customName).toBe('N2');
		expect(f.overrides.n1).toBeUndefined();
	});
	it('forkDeleteItem: base item -> removed (override dropped); added item -> dropped entirely', () => {
		let f = M.forkOverrideItem(M.emptyFork(), base, { id: 'a', action: 'none', customName: 'A2' });
		f = M.forkDeleteItem(f, base, 'a');
		expect(f.removed).toEqual(['a']);
		expect(f.overrides.a).toBeUndefined();
		f = M.forkAddItem(f, { id: 'n1', action: 'none' }, '');
		f = M.forkDeleteItem(f, base, 'n1');
		expect(f.added).toEqual([]);
		expect(f.removed).toEqual(['a']);
	});
	it('forkRestoreItem clears removed and override (re-inherits)', () => {
		let f = { ...M.emptyFork(), removed: ['a'], overrides: { b: { action: 'none', customName: 'B2' } } };
		f = M.forkRestoreItem(f, 'a');
		f = M.forkRestoreItem(f, 'b');
		expect(f.removed).toEqual([]);
		expect(f.overrides).toEqual({});
	});
	it('forkReorder sets fixed order; forkAddItem with existing order inserts into order', () => {
		let f = M.forkReorder(M.emptyFork(), ['b', 'a']);
		expect(f.order).toEqual(['b', 'a']);
		f = M.forkAddItem(f, { id: 'n1', action: 'none' }, 'b');
		expect(f.order).toEqual(['b', 'n1', 'a']);
	});
	it('forkAddItem with afterId "" prepends to a fixed order (consistent with start-insert)', () => {
		let f = M.forkReorder(M.emptyFork(), ['b', 'a']);
		f = M.forkAddItem(f, { id: 'n1', action: 'none' }, '');
		expect(f.order).toEqual(['n1', 'b', 'a']);
	});
});

describe('resolveMenu', () => {
	it('mode standard resolves base menu', () => {
		const r = M.resolveMenu(CATALOG, EMPTY, { mode: 'standard', menuId: 'gh' });
		expect(r.name).toBe('GitHub');
		expect(r.items).toHaveLength(3);
	});
	it('mode fork applies overlay and optional fork name', () => {
		const cfg = { mode: 'fork', menuId: 'gh', fork: { ...M.emptyFork(), removed: ['b'], name: 'Mein GH' } };
		const r = M.resolveMenu(CATALOG, EMPTY, cfg);
		expect(r.name).toBe('Mein GH');
		expect(r.items.map(i => i.id)).toEqual(['a', 's1']);
	});
	it('mode own uses private definition; empty own -> null', () => {
		const r = M.resolveMenu(CATALOG, EMPTY, { mode: 'own', ownMenu: { name: 'Privat', items: [{ id: 'p1', action: 'none' }] } });
		expect(r.name).toBe('Privat');
		expect(M.resolveMenu(CATALOG, EMPTY, { mode: 'own', ownMenu: null })).toBeNull();
	});
	it('mode contextual picks first active matching menu, else fallback, else null', () => {
		const ctx = { url: 'https://github.com/x', matchesPatterns: matches };
		expect(M.resolveMenu(CATALOG, EMPTY, { mode: 'contextual', fallbackMenuId: 'amz' }, ctx).menuId).toBe('gh');
		const smDis = { ...EMPTY, disabled: ['gh'] };
		expect(M.resolveMenu(CATALOG, smDis, { mode: 'contextual', fallbackMenuId: 'amz' }, ctx).menuId).toBe('amz');
		expect(M.resolveMenu(CATALOG, smDis, { mode: 'contextual', fallbackMenuId: '' }, ctx)).toBeNull();
	});
	it('legacy config without mode resolves like standard (no crash)', () => {
		expect(M.resolveMenu(CATALOG, EMPTY, { menuId: 'weg', contextual: false })).toBeNull();
		expect(M.resolveMenu(CATALOG, EMPTY, { menuId: 'gh' }).menuId).toBe('gh');
	});
	it('substitutes {domain} using chosen domain, falling back to default', () => {
		expect(M.resolveMenu(CATALOG, EMPTY, { mode: 'standard', menuId: 'amz' }).items[0].customUrl)
			.toBe('https://www.amazon.de/cart');
		const sm = { ...EMPTY, domains: { amz: 'amazon.com' } };
		expect(M.resolveMenu(CATALOG, sm, { mode: 'standard', menuId: 'amz' }).items[0].customUrl)
			.toBe('https://www.amazon.com/cart');
	});
	it('disabled menu still resolves via direct reference', () => {
		const sm = { ...EMPTY, disabled: ['gh'] };
		expect(M.resolveMenu(CATALOG, sm, { mode: 'standard', menuId: 'gh' })).not.toBeNull();
	});
	it('contextual: siteMenus.order promotes which matching menu wins', () => {
		const cat = [
			{ id: 'a', name: 'A', patterns: ['*example.com*'], items: [] },
			{ id: 'b', name: 'B', patterns: ['*example.com*'], items: [] },
		];
		const matches = (url, pats) => pats.some(p => url.includes(p.replaceAll('*', '')));
		expect(M.resolveContextualMenuId(cat, EMPTY, 'https://example.com/', matches)).toBe('a');
		const sm = { ...EMPTY, order: ['b'] };
		expect(M.resolveContextualMenuId(cat, sm, 'https://example.com/', matches)).toBe('b');
	});
	it('applies {domain} to fork-added and overridden items (substitution after overlay)', () => {
		const cfg = { mode: 'fork', menuId: 'amz', fork: { ...M.emptyFork(),
			overrides: { cart: { action: 'openCustomUrl', customUrl: 'https://www.{domain}/cart2' } },
			added: [{ id: 'n1', afterId: 'cart', action: 'openCustomUrl', customUrl: 'https://www.{domain}/neu' }] } };
		const r = M.resolveMenu(CATALOG, { ...EMPTY, domains: { amz: 'amazon.com' } }, cfg);
		expect(r.items.map(i => i.customUrl)).toEqual(['https://www.amazon.com/cart2', 'https://www.amazon.com/neu']);
	});
});

describe('settings helpers', () => {
	it('withMenuDef writes catalog ids to edited, others to custom', () => {
		let sm = M.withMenuDef(CATALOG, EMPTY, 'gh', { name: 'GH2', items: [] });
		expect(sm.edited.gh.name).toBe('GH2');
		sm = M.withMenuDef(CATALOG, sm, 'menu_9', { name: 'Neu', items: [] });
		expect(sm.custom.menu_9.name).toBe('Neu');
		expect(EMPTY.edited).toEqual({}); // Eingabe unangetastet
	});
	it('withMenuReset removes the edited copy', () => {
		const sm = M.withMenuReset({ ...EMPTY, edited: { gh: { name: 'x', items: [] } } }, 'gh');
		expect(sm.edited).toEqual({});
	});
	it('withMenuDisabled toggles; withoutCustomMenu deletes; withDomain sets', () => {
		let sm = M.withMenuDisabled(EMPTY, 'gh', true);
		expect(sm.disabled).toEqual(['gh']);
		sm = M.withMenuDisabled(sm, 'gh', false);
		expect(sm.disabled).toEqual([]);
		sm = M.withoutCustomMenu({ ...EMPTY, custom: { m1: { items: [] } }, order: ['m1'] }, 'm1');
		expect(sm.custom).toEqual({});
		expect(sm.order).toEqual([]);
		expect(M.withDomain(EMPTY, 'amz', 'amazon.com').domains.amz).toBe('amazon.com');
	});
	it('addPatternToMenu appends deduped, creating edited copy for pristine catalog menus', () => {
		const { siteMenus, added } = M.addPatternToMenu(CATALOG, EMPTY, 'gh', '*gh.io*');
		expect(added).toBe('*gh.io*');
		expect(siteMenus.edited.gh.patterns).toEqual(['*github.com*', '*gh.io*']);
		const again = M.addPatternToMenu(CATALOG, siteMenus, 'gh', '*gh.io*');
		expect(again.added).toBeNull();
		expect(M.addPatternToMenu(CATALOG, EMPTY, 'nope', '*x*').added).toBeNull();
	});
});
