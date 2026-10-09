// The onboarding wizard's decisions, without a DOM (design §6) - the way
// commitOrder in js/settings-merge.js keeps the merge's write order testable.
// No Lit import.

// Every request the wizard makes carries the token of its attempt; an answer
// that comes back after a cancel, a restart or a close is dropped.
export function createGeneration() {
	let current = 0;
	return {
		next: () => ++current,
		isCurrent: (t) => t === current,
	};
}

// What another tab could have changed under an open wizard. The profile map is
// not part of it: listing prunes it, and that is no setup.
export function sameSetup(a, b) {
	return a.enabled === b.enabled
		&& a.secret === b.secret
		&& JSON.stringify(a.consent) === JSON.stringify(b.consent);
}

// The one euSync write of a finished onboarding. Way A: the new code with its
// first profile as the only and active one. Another code without an upload
// (Way B): the map belongs to the old code and goes with it. The kept code:
// map and active profile stay as they are.
export function buildPatch({ opened, code, consent, uploaded, lastUploadHash = '' }) {
	const patch = { enabled: true, consent, secret: code };
	if (uploaded) {
		patch.states = { [uploaded.stateId]: { name: uploaded.name, lastUploadHash, lastUploadDate: uploaded.date } };
		patch.activeState = uploaded.stateId;
	} else if (code !== opened.secret) {
		patch.states = {};
		patch.activeState = '';
	}
	return patch;
}

// What a cancel has to delete so nothing is left behind (§6). An upload still
// in flight is deleted only once it has settled: a DELETE sent beside it can
// reach the server first, and the PUT would then create the profile after all.
// Never a target without a stateId - deleteStates() without one deletes every
// profile under the code.
export function cleanupTarget({ uploaded, inFlight }) {
	const pick = uploaded || inFlight;
	if (!pick || typeof pick.stateId !== 'string' || !pick.stateId) return null;
	return { when: uploaded ? 'now' : 'settled', secret: pick.secret, origin: pick.origin, stateId: pick.stateId };
}

const same = (a, b) => a.area === b.area && sameSetup(a.euSync, b.euSync);

// Finishing, in exactly this order:
// 1. Re-read euSync AND the area: if another tab set sync up, changed the code
//    or moved the storage since the wizard opened, stop and store nothing.
// 2. ONE write of euSync. It is the commit point, and from it on toSync()
//    refuses - so the race of §3 cannot start a switch back to browser sync.
// 3. The area to local, judged by area() - never by the switch's own answer:
//    a failed second copy can still leave the browser switched. Not landed:
//    report 'switch' and leave (sync, enabled) as it is. That is the state the
//    panel's repair line handles, and nothing is written back: a rollback would
//    be a read-merge-write without compare-and-swap and could erase another
//    tab's change made in that window.
// 4. The base. A failed base write means "no base", which only delays Sync.
export async function finishOnboarding(steps) {
	const { opened, reread, writeSync, patch, switchToLocal, writeBase } = steps;
	let now;
	try {
		now = await reread();
	} catch {
		return { ok: false, reason: 'write' };
	}
	if (!same(opened, now)) return { ok: false, reason: 'other-tab' };
	try {
		await writeSync(patch);
	} catch {
		return { ok: false, reason: 'write' };
	}
	// steps.area() each time, not a destructured copy: where the browser is
	// after the switch is the one question that decides.
	if (steps.area() === 'sync') {
		try { await switchToLocal(); } catch { /* judged below */ }
		if (steps.area() !== 'local') return { ok: false, reason: 'switch' };
	}
	if (writeBase) {
		try { await writeBase(); } catch { /* "no base" - Sync after the next activate */ }
	}
	return { ok: true };
}
