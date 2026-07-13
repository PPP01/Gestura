import { describe, it, expect } from 'vitest';
import '../js/menu-icons.js';
const ICONS = globalThis.FlowMouseMenuIcons;

describe('FlowMouseMenuIcons', () => {
	it('is a non-empty map of svg strings', () => {
		const names = Object.keys(ICONS);
		expect(names.length).toBeGreaterThanOrEqual(40);
		for (const name of names) {
			expect(ICONS[name], name).toMatch(/^<svg /);
			expect(ICONS[name], name).toContain('stroke="currentColor"');
			expect(ICONS[name], name).toMatch(/<\/svg>$/);
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
