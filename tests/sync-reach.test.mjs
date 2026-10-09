import { describe, it, expect } from 'vitest';
import { syncErrorText, maintenanceText, reachText } from '../js/components/sync-reach.js';

const MSG = {
	euSyncMaintenance: 'M',
	euSyncMaintenanceUntil: 'M until {time}',
	euSyncMaintenanceUntilDate: 'M until {date}, {time}',
	euSyncUnreachable: 'U',
	euSyncErrorRateLimited: 'R',
	euSyncErrorServer: 'S',
};
const i18n = { getMessage: k => MSG[k] ?? k, getHtmlLang: () => 'de' };
const now = new Date(2026, 9, 9, 10, 0);          // local time, 10:00

describe('maintenanceText', () => {
	it('names the time for a later hour today', () => {
		expect(maintenanceText(i18n, new Date(2026, 9, 9, 14, 0).toISOString(), now)).toBe('M until 14:00');
	});
	it('names date and time for a later day', () => {
		const t = maintenanceText(i18n, new Date(2026, 9, 10, 9, 30).toISOString(), now);
		expect(t.startsWith('M until 10. Oktober, ')).toBe(true);
		expect(t.endsWith('09:30')).toBe(true);
	});
	it('drops the time for an until in the past', () => {
		expect(maintenanceText(i18n, new Date(2026, 9, 9, 9, 0).toISOString(), now)).toBe('M');
	});
	it('drops the time for a missing or unparsable until', () => {
		expect(maintenanceText(i18n, '', now)).toBe('M');
		expect(maintenanceText(i18n, 'soon', now)).toBe('M');
	});
});

describe('syncErrorText and reachText', () => {
	it('unavailable reads as unreachable', () => {
		expect(syncErrorText(i18n, { code: 'unavailable' })).toBe('U');
	});
	it('maintenance from any endpoint uses the maintenance sentence', () => {
		expect(syncErrorText(i18n, { code: 'maintenance', until: '' })).toBe('M');
	});
	it('maintenance from an endpoint carries its until into the sentence', () => {
		const until = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
		expect(syncErrorText(i18n, { code: 'maintenance', until })).toMatch(/^M until /);
	});
	it('the four ping kinds', () => {
		expect(reachText(i18n, { kind: 'unreachable' })).toBe('U');
		expect(reachText(i18n, { kind: 'rate-limited' })).toBe('R');
		expect(reachText(i18n, { kind: 'maintenance', until: '' })).toBe('M');
	});
	it('an unknown code falls back to the server sentence', () => {
		expect(syncErrorText(i18n, { code: 'weird' })).toBe('S');
	});
});
