import { describe, it, expect } from 'vitest';
import '../js/menu-switcher.js';
const { buildSwitcherMenus } = globalThis.FlowMouseMenuSwitcher;

describe('buildSwitcherMenus', () => {
	const menus = {
		a: { name: 'Standard' },
		b: { name: 'Shopping', showInSwitcher: true },
		c: { name: 'Coding', showInSwitcher: false },
		d: {}, // no name, no flag
	};

	it('excludes the current menu', () => {
		const r = buildSwitcherMenus(menus, 'a');
		expect(r.find(m => m.id === 'a')).toBeUndefined();
	});

	it('includes showInSwitcher true or absent, excludes false, in definition order', () => {
		const r = buildSwitcherMenus(menus, 'x');
		expect(r.map(m => m.id)).toEqual(['a', 'b', 'd']);
	});

	it('applies fallback name only for unnamed menus', () => {
		const r = buildSwitcherMenus(menus, 'x', 'Menu');
		expect(r.find(m => m.id === 'd').name).toBe('Menu');
		expect(r.find(m => m.id === 'a').name).toBe('Standard');
	});

	it('handles empty and null input', () => {
		expect(buildSwitcherMenus({}, 'x')).toEqual([]);
		expect(buildSwitcherMenus(null, 'x')).toEqual([]);
	});
});
