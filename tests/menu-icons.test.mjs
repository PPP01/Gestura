import { describe, it, expect } from 'vitest';
import '../js/menu-icons.js';
const ICONS = globalThis.FlowMouseMenuIcons;

describe('FlowMouseMenuIcons', () => {
	it('is a non-empty map of svg strings', () => {
		const names = Object.keys(ICONS);
		expect(names.length).toBeGreaterThanOrEqual(40);
		for (const name of names) {
			expect(ICONS[name], name).toMatch(/^<svg /);
			// Lucide icons are drawn with strokes, Material Design Icons (mdi…) are filled.
			expect(ICONS[name], name).toContain(name.startsWith('mdi') ? 'fill="currentColor"' : 'stroke="currentColor"');
			expect(ICONS[name], name).toMatch(/<\/svg>$/);
		}
	});
	it('bundles the Material Design Icons Home Assistant uses, filled and with one path each', () => {
		const names = ['mdiPuzzle', 'mdiDevices', 'mdiShape', 'mdiRobot', 'mdiHammer',
			'mdiTextBoxOutline', 'mdiUpdate', 'mdiChartBox'];
		for (const n of names) {
			expect(ICONS[n], `missing ${n}`).toBeTruthy();
			expect(ICONS[n], n).toContain('viewBox="0 0 24 24"');
			expect(ICONS[n], n).toContain('fill="currentColor"');
			expect(ICONS[n], n).not.toContain('stroke');
			expect(ICONS[n].match(/<path /g), n).toHaveLength(1);
			expect(ICONS[n], n).toMatch(/<path d="M[^"<>]+Z"\/>/);
		}
	});
	it('contains the icons the catalog needs', () => {
		for (const n of ['house', 'shoppingCart', 'bell', 'package', 'gitPullRequest', 'circleDot',
			'calendar', 'users', 'send', 'inbox', 'tag', 'trendingUp', 'play', 'video', 'mapPin',
			'messageSquare', 'briefcase', 'newspaper', 'image', 'fileText', 'upload', 'rss',
			'history', 'star', 'heart', 'mail', 'user', 'search', 'bookmark', 'timer',
			'refreshCw', 'compass', 'squarePen', 'trash2', 'ban', 'circleHelp', 'layers',
			'hardDrive', 'github', 'globe', 'layoutList', 'settings', 'link', 'externalLink', 'rotateCcw']) {
			expect(ICONS[n], `missing icon ${n}`).toBeTruthy();
		}
	});
});
