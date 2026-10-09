// What the user reads when a sync request fails, or when gestura.eu cannot be
// used right now. Shared by the sync panel and the onboarding wizard, so both
// say the same thing about the same failure. No Lit import: tests load it.

// Written out rather than composed from the error code: a computed key cannot
// be found by searching, and a typo in one would surface to the user first.
export const SYNC_ERRORS = {
	network: 'euSyncErrorNetwork',
	'bad-request': 'euSyncErrorBadRequest',
	'not-found': 'euSyncErrorNotFound',
	'too-large': 'euSyncErrorTooLarge',
	'quota-states': 'euSyncErrorQuotaStates',
	'rate-limited': 'euSyncErrorRateLimited',
	server: 'euSyncErrorServer',
	malformed: 'euSyncErrorMalformed',
	decrypt: 'euSyncErrorDecrypt',
	stale: 'euSyncErrorStale',
	disabled: 'euSyncErrorDisabled',
	'no-secret': 'euSyncErrorNoSecret',
	conflict: 'euSyncErrorConflict',
	unavailable: 'euSyncUnreachable',
};

export function syncErrorText(i18n, e) {
	const code = (e && e.code) || '';
	if (code === 'maintenance') return maintenanceText(i18n, e.until);
	return i18n.getMessage(SYNC_ERRORS[code] || 'euSyncErrorServer');
}

// "gestura.eu wird gewartet (voraussichtlich bis 14:00 Uhr)." A later day adds
// the date; an until in the past or none at all drops the time rather than
// promising one that has already gone by (spec §8).
export function maintenanceText(i18n, until, now = new Date()) {
	const end = until ? new Date(until) : null;
	if (!end || Number.isNaN(end.getTime()) || end <= now) return i18n.getMessage('euSyncMaintenance');
	const lang = i18n.getHtmlLang();
	const time = end.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
	if (end.toDateString() === now.toDateString()) {
		return i18n.getMessage('euSyncMaintenanceUntil').replace('{time}', time);
	}
	const date = end.toLocaleDateString(lang, { day: 'numeric', month: 'long' });
	return i18n.getMessage('euSyncMaintenanceUntilDate').replace('{date}', date).replace('{time}', time);
}

// The ping's four answers, as one sentence each (spec §5).
export function reachText(i18n, reach) {
	if (reach.kind === 'maintenance') return maintenanceText(i18n, reach.until);
	if (reach.kind === 'rate-limited') return i18n.getMessage('euSyncErrorRateLimited');
	return i18n.getMessage('euSyncUnreachable');
}
