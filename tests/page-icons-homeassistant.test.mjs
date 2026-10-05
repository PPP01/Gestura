import { describe, it, expect } from 'vitest';
import '../js/page-icons.js';
import '../js/page-icons-homeassistant.js';
const P = globalThis.FlowMousePageIcons;
const HA = globalThis.FlowMouseHomeAssistantIcons;

describe('home assistant provider', () => {
	it('registers itself with the generic module', () => {
		expect(P.providers).toContain(HA);
		expect(HA.id).toBe('homeassistant');
	});
	it('applies to a document that contains the <home-assistant> root element', () => {
		expect(HA.applies({ querySelector: (s) => (s === 'home-assistant' ? {} : null) })).toBe(true);
		expect(HA.applies({ querySelector: () => null })).toBe(false);
		expect(HA.applies({})).toBe(false);
	});
	it('lets a dashboard view fall back to its sidebar entry', () => {
		expect(HA.allowPrefix('/energie-2', '/energie-2/energie')).toBe(true);
		expect(HA.allowPrefix('/dashboard-esszimmer', '/dashboard-esszimmer/heizung-led')).toBe(true);
		expect(HA.allowPrefix('/home', '/home/overview')).toBe(true);
	});
	it('lets a deeper settings page fall back to its section', () => {
		expect(HA.allowPrefix('/config/integrations', '/config/integrations/dashboard')).toBe(true);
		expect(HA.allowPrefix('/config/tools', '/config/tools/yaml')).toBe(true);
	});
	it('never borrows the settings gear (/config) or the root for another page', () => {
		expect(HA.allowPrefix('/config', '/config/logs')).toBe(false);
		expect(HA.allowPrefix('/config', '/config/integrations/dashboard')).toBe(false);
		expect(HA.allowPrefix('/', '/config/logs')).toBe(false);
	});
	it('end to end: Config links on a dashboard page stay generic, dashboard views get the sidebar icon', () => {
		const entries = [
			{ path: '/config', d: 'M1Z' },      // sidebar: settings gear
			{ path: '/energie-2', d: 'M3Z' },   // sidebar: a dashboard
			{ path: '/history', d: 'M5Z' },
		];
		expect(P.pickEntry(entries, '/config/logs', HA.allowPrefix)).toBeNull();
		expect(P.pickEntry(entries, '/config', HA.allowPrefix)).toBe('M1Z');       // exact still works
		expect(P.pickEntry(entries, '/energie-2/energie', HA.allowPrefix)).toBe('M3Z');
		expect(P.pickEntry(entries, '/history', HA.allowPrefix)).toBe('M5Z');
	});
});
