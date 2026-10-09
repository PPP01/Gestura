import { fillRefusal } from './storage-refusal.js';

// Switching where the settings live, without component state (onboarding
// design §3). `S` is GesturaSettingsStorage; passed in so tests need no window.
//
// Judged by the area, not by ok: switchTo() answers { ok: false, error: 'write' }
// when its sequence broke, and a failed rollback inside it can leave the
// browser genuinely switched. "Nothing was changed" on the strength of ok:false
// alone would then be a lie.
export async function switchArea(S, target, reason = 'local') {
	const res = await S.switchTo(target, reason);
	const landed = S.area() === target;
	return { landed, refusal: (!res.ok && !landed) ? res : null };
}

// res.branch / res.bytes / res.quota describe the TARGET area's ceiling here -
// unlike a set() failure, where they describe the active one.
export function refusalText(i18n, res) {
	const fill = (key) => fillRefusal(i18n, key, res);
	return res.error === 'branch-full' ? fill('storageSwitchRefusedBranch')
		: res.error === 'total-full' ? fill('storageSwitchRefusedTotal')
		: res.error === 'tier2-enabled' ? i18n.getMessage('storageSwitchRefusedTier2')
		: i18n.getMessage('storageSwitchFailed');
}

// The way back writes this browser's whole local copy over browser sync; what
// another browser saved there since is overwritten. The date comes from the
// note the departing browser left; a failing read costs the date, not the
// question.
export async function wayBackText(S, i18n, formatDate) {
	let left = null;
	try { left = await S.note(); } catch { left = null; }
	return (left && left.movedAt)
		? i18n.getMessage('storageSwitchToSyncConfirmSince').replace('{date}', formatDate(left.movedAt))
		: i18n.getMessage('storageSwitchToSyncConfirm');
}
