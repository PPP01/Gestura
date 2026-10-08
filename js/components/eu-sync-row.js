// What one row of the sync panel says and offers. A pure function, so the rules
// can be tested without a DOM - the panel only maps the answer to markup.
//
// `local` is this browser's record of the state (GesturaSyncLocal.states[id]),
// `base` what it last agreed on with it (GesturaSyncBase summary, `{ hash }`),
// `currentHash` the hash of the settings as they are now ('' until computed).
export function rowModel({ state, local, activeState, base, currentHash }) {
	const active = activeState === state.stateId;
	// The hint belongs to the ACTIVE state only. Every other state differs from
	// the current settings by definition - another one was adopted or uploaded
	// since - and saying so on each of them reads as "you changed something".
	const changed = !!(active && local && local.lastUploadHash && currentHash && local.lastUploadHash !== currentHash);
	// Merging means taking over what the state gained since this browser last
	// agreed with it. While the server still holds the payload the base names
	// there is nothing to take; local changes go up with Upload, not Merge.
	const serverMoved = !!(base && state.meta && state.meta.payloadHash && state.meta.payloadHash !== base.hash);
	return {
		active,
		changed,
		serverMoved,
		// An adopted state has an entry but no upload date.
		neverUploadedHere: !(local && local.lastUploadDate),
		// For the active state this browser already holds what it agreed on:
		// Download would only throw local work away, Upload is the one way to push
		// local changes (hence only with the hint), and Merge only pays off once the
		// server has moved. Delete is always there and not listed.
		offers: {
			merge: serverMoved,
			download: !active,
			upload: !active || changed,
		},
	};
}
