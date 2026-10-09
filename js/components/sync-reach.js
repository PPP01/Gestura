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
};

export function syncErrorText(i18n, e) {
	const code = (e && e.code) || '';
	return i18n.getMessage(SYNC_ERRORS[code] || 'euSyncErrorServer');
}
