import { describe, it, expect } from 'vitest';
import { describeChanges } from '../js/components/settings-changes.js';

// Labels the dialog supplies from i18n and the registries; plain stand-ins here.
const labels = {
	gesture: (group, key, entry) => `${key}${entry && entry.action ? ` (${entry.action})` : ''}`,
	menu: (id) => `menu:${id}`,
	engine: (id) => `engine:${id}`,
	option: (path) => path,
};
const run = (before, after) => describeChanges(before, after, labels);
const area = (res, name) => (res.find(a => a.area === name) || { items: [] }).items;

describe('describeChanges', () => {
	it('says nothing when nothing differs', () => {
		expect(run({ a: 1, mouseGestures: { D: { action: 'x' } } }, { a: 1, mouseGestures: { D: { action: 'x' } } })).toEqual([]);
	});

	it('ignores the export envelope', () => {
		expect(run({ gesturaSettings: 1, _version: '2.7.0', a: 1 }, { gesturaSettings: 1, _version: '2.8.0', a: 1 })).toEqual([]);
	});

	describe('gestures', () => {
		it('reports an added, a changed and a removed gesture, each under its own name', () => {
			const res = run(
				{ mouseGestures: { D: { action: 'close' }, L: { action: 'back' } } },
				{ mouseGestures: { D: { action: 'reload' }, U: { action: 'top' } } },
			);
			expect(area(res, 'gestures')).toEqual([
				{ kind: 'changed', name: 'D (reload)' },
				{ kind: 'removed', name: 'L (back)' },
				{ kind: 'added', name: 'U (top)' },
			]);
		});

		it('keys the drag lists by direction', () => {
			const res = run(
				{ textDragGestures: [{ direction: '→', action: 'search' }] },
				{ textDragGestures: [{ direction: '→', action: 'copy' }, { direction: '↓', action: 'x' }] },
			);
			expect(area(res, 'gestures').map(i => i.kind)).toEqual(['changed', 'added']);
		});

		it('names an action chain by its own name', () => {
			const res = run({ actionChains: {} }, { actionChains: { chain_1: { name: 'Morning' } } });
			expect(area(res, 'gestures')).toEqual([{ kind: 'added', name: 'Morning' }]);
		});
	});

	describe('website menus', () => {
		it('reports an own menu by its name, and an edit of a built-in one by the label', () => {
			const res = run(
				{ siteMenus: { custom: {}, edited: {}, disabled: [] } },
				{ siteMenus: { custom: { menu_1: { name: 'Wiki' } }, edited: { wikipedia: { removed: ['x'] } }, disabled: [] } },
			);
			expect(area(res, 'menus')).toEqual([
				{ kind: 'added', name: 'Wiki' },
				{ kind: 'added', name: 'menu:wikipedia' },
			]);
		});

		it('reports the other parts of the menu settings as changed options, without values', () => {
			const res = run({ siteMenus: { disabled: [], custom: {} } }, { siteMenus: { disabled: ['a'], custom: {} } });
			expect(area(res, 'menus')).toEqual([{ kind: 'changed', name: 'siteMenus.disabled' }]);
		});
	});

	describe('search engines', () => {
		it('names an own engine by its name and an override by the engine', () => {
			const res = run(
				{ searchEngines: { custom: [], overrides: {} } },
				{ searchEngines: { custom: [{ id: 'e1', name: 'Mine' }], overrides: { google: { url: 'x' } } } },
			);
			expect(area(res, 'engines')).toEqual([
				{ kind: 'added', name: 'Mine' },
				{ kind: 'added', name: 'engine:google' },
			]);
		});
	});

	describe('everything else', () => {
		it('shows old and new value for a plain option', () => {
			const res = run({ trailWidth: 12, enableTrail: true }, { trailWidth: 20, enableTrail: false });
			expect(area(res, 'settings')).toEqual([
				{ kind: 'changed', name: 'enableTrail', from: 'true', to: 'false' },
				{ kind: 'changed', name: 'trailWidth', from: '12', to: '20' },
			]);
		});

		it('lists the elements of a set one by one', () => {
			const res = run({ blacklist: ['a.com', 'b.com'] }, { blacklist: ['b.com', 'c.com'] });
			expect(area(res, 'settings')).toEqual([
				{ kind: 'removed', name: 'blacklist: a.com' },
				{ kind: 'added', name: 'blacklist: c.com' },
			]);
		});

		it('lists the elements of a set of numbers or booleans too', () => {
			const res = run({ levels: [1, 2] }, { levels: [2, 3] });
			expect(area(res, 'settings')).toEqual([
				{ kind: 'removed', name: 'levels: 1' },
				{ kind: 'added', name: 'levels: 3' },
			]);
		});

		it('looks into a container of fixed children', () => {
			const res = run({ gestureTriggerButtons: { right: true, middle: false } }, { gestureTriggerButtons: { right: true, middle: true } });
			expect(area(res, 'settings')).toEqual([{ kind: 'changed', name: 'gestureTriggerButtons.middle', from: 'false', to: 'true' }]);
		});

		it('shortens a long value rather than printing it', () => {
			const res = run({ customCss: 'a' }, { customCss: 'b'.repeat(500) });
			const item = area(res, 'settings')[0];
			expect(item.to.length).toBeLessThan(80);
			expect(item.to.endsWith('…')).toBe(true);
		});
	});

	it('orders the areas gestures, menus, engines, settings and drops empty ones', () => {
		const res = run(
			{ a: 1, mouseGestures: {}, searchEngines: { custom: [] } },
			{ a: 2, mouseGestures: { D: { action: 'x' } }, searchEngines: { custom: [{ id: 'e', name: 'E' }] } },
		);
		expect(res.map(a => a.area)).toEqual(['gestures', 'engines', 'settings']);
	});
});
