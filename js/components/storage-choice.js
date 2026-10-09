// The three ways settings travel, as the sync section shows them (onboarding
// design §3, §4). Pure: the panel renders, this decides. No Lit import.

// The mapping is total. It reads the switch, not syncEnabled(): a stale consent
// still shows "Über gestura.eu", with the reconfirm row. The fourth combination
// - browser sync on AND gestura.eu on - is a half-finished switch or a race
// between two tabs; it shows gestura.eu with the repair line.
export function cardFor(area, enabled) {
	if (enabled) return { card: 'eu', repair: area === 'sync' };
	return { card: area === 'local' ? 'local' : 'browser', repair: false };
}

// What activating card `to` does while `from` is active. One dialog per change
// at most; the panel runs the plan.
export function planFor(from, to) {
	if (from === to) return 'none';
	if (to === 'eu') return 'onboard';
	if (from === 'eu') return to === 'browser' ? 'off-then-browser' : 'off';
	return to === 'local' ? 'to-local' : 'to-browser';
}
