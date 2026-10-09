import { describe, it, expect } from 'vitest';
import { createGeneration, sameSetup, buildPatch, cleanupTarget, finishOnboarding } from '../js/components/sync-onboarding-flow.js';

const OFF = { enabled: false, consent: null, secret: '', states: {}, activeState: '' };
const PATCH = { enabled: true, consent: { version: 2, date: 'd' }, secret: 'GS1-NEW' };

// A recorder for the steps, as tests/settings-merge.test.mjs does for commitOrder.
// `state` is what storage holds; writeSync changes it, reread reports it.
function harness({ area = 'sync', landed = 'local', failWrite = false, failBase = false, base = true, meddle = null } = {}) {
	const log = [];
	const state = { euSync: { ...OFF }, area };
	const steps = {
		opened: { euSync: { ...OFF }, area },
		reread: async () => { log.push('reread'); if (meddle) meddle(state, log); return { euSync: { ...state.euSync }, area: state.area }; },
		writeSync: async (p) => { log.push(['write', p]); if (failWrite) throw new Error('w'); state.euSync = { ...state.euSync, ...p }; },
		patch: PATCH,
		area: () => state.area,
		switchToLocal: async () => { log.push('switch'); state.area = landed; },
		writeBase: base ? async () => { log.push('base'); if (failBase) throw new Error('b'); } : null,
	};
	return { steps, log, state };
}

describe('finishOnboarding (spec §6)', () => {
	it('re-read, one write, switch, base - in that order', async () => {
		const { steps, log } = harness();
		expect(await finishOnboarding(steps)).toEqual({ ok: true });
		expect(log).toEqual(['reread', ['write', PATCH], 'switch', 'base']);
	});
	it('skips the switch when the area is already local', async () => {
		const { steps, log } = harness({ area: 'local' });
		expect(await finishOnboarding(steps)).toEqual({ ok: true });
		expect(log).toEqual(['reread', ['write', PATCH], 'base']);
	});
	it('another tab set sync up meanwhile: stops before writing anything', async () => {
		const { steps, log } = harness({ meddle: (s) => { s.euSync = { ...OFF, enabled: true, secret: 'GS1-OTHER', consent: { version: 2, date: 'x' } }; } });
		expect(await finishOnboarding(steps)).toEqual({ ok: false, reason: 'other-tab' });
		expect(log).toEqual(['reread']);
	});
	it('another tab only changed the code: stops as well', async () => {
		const { steps } = harness({ meddle: (s) => { s.euSync = { ...OFF, secret: 'GS1-OTHER' }; } });
		expect((await finishOnboarding(steps)).reason).toBe('other-tab');
	});
	it('another tab moved the storage area: stops as well (spec §6 re-reads both)', async () => {
		const { steps, log } = harness({ area: 'local', meddle: (s) => { s.area = 'sync'; } });
		expect(await finishOnboarding(steps)).toEqual({ ok: false, reason: 'other-tab' });
		expect(log).toEqual(['reread']);
	});
	it('the euSync write fails: nothing else happens', async () => {
		const { steps, log } = harness({ failWrite: true });
		expect(await finishOnboarding(steps)).toEqual({ ok: false, reason: 'write' });
		expect(log).toEqual(['reread', ['write', PATCH]]);
	});
	it('a failed re-read is a failed finish, nothing written', async () => {
		const { steps, log } = harness();
		steps.reread = async () => { log.push('reread'); throw new Error('storage'); };
		expect(await finishOnboarding(steps)).toEqual({ ok: false, reason: 'write' });
		expect(log).toEqual(['reread']);
	});
	it('the switch does not land: the repairable (sync, enabled) state stays, nothing is written back, no base', async () => {
		const { steps, log, state } = harness({ landed: 'sync' });
		expect(await finishOnboarding(steps)).toEqual({ ok: false, reason: 'switch' });
		expect(log).toEqual(['reread', ['write', PATCH], 'switch']);
		expect(state.euSync.enabled).toBe(true);
		expect(state.euSync.secret).toBe('GS1-NEW');
	});
	it('the switch throws but the area moved: counts as landed', async () => {
		const { steps, log, state } = harness();
		steps.switchToLocal = async () => { log.push('switch'); state.area = 'local'; throw new Error('noted:false'); };
		expect(await finishOnboarding(steps)).toEqual({ ok: true });
	});
	it('a failed base write is harmless', async () => {
		const { steps } = harness({ failBase: true });
		expect(await finishOnboarding(steps)).toEqual({ ok: true });
	});
	it('Way B has no base to write', async () => {
		const { steps, log } = harness({ base: false });
		expect(await finishOnboarding(steps)).toEqual({ ok: true });
		expect(log).toEqual(['reread', ['write', PATCH], 'switch']);
	});
	it('the kept-code path (stale consent, browser sync on) switches and keeps the map', async () => {
		const kept = { enabled: true, consent: { version: 1, date: 'old' }, secret: 'GS1-KEPT', states: { a: {} }, activeState: 'a' };
		const { steps, log, state } = harness();
		state.euSync = { ...kept };
		steps.opened = { euSync: kept, area: 'sync' };
		steps.patch = buildPatch({ opened: kept, code: 'GS1-KEPT', consent: { version: 2, date: 'd' }, uploaded: null });
		steps.writeBase = null;
		expect(await finishOnboarding(steps)).toEqual({ ok: true });
		expect(log).toEqual(['reread', ['write', { enabled: true, consent: { version: 2, date: 'd' }, secret: 'GS1-KEPT' }], 'switch']);
		expect(state.euSync.states).toEqual({ a: {} });
		expect(state.euSync.activeState).toBe('a');
	});
});

describe('buildPatch', () => {
	const consent = { version: 2, date: 'd' };
	it('Way A: the new code, the uploaded profile as the only and active one', () => {
		const p = buildPatch({ opened: { ...OFF, secret: 'GS1-OLD', states: { x: {} } }, code: 'GS1-NEW', consent,
			uploaded: { stateId: 's1', name: 'Büro', date: 't' }, lastUploadHash: 'h' });
		expect(p).toEqual({ enabled: true, consent, secret: 'GS1-NEW',
			states: { s1: { name: 'Büro', lastUploadHash: 'h', lastUploadDate: 't' } }, activeState: 's1' });
	});
	it('Way B with another code: the old map goes with the old code', () => {
		expect(buildPatch({ opened: { ...OFF, secret: 'GS1-OLD', states: { x: {} }, activeState: 'x' }, code: 'GS1-NEW', consent, uploaded: null }))
			.toEqual({ enabled: true, consent, secret: 'GS1-NEW', states: {}, activeState: '' });
	});
	it('the kept code: map and active profile are not touched', () => {
		expect(buildPatch({ opened: { ...OFF, secret: 'GS1-KEPT', states: { x: {} }, activeState: 'x' }, code: 'GS1-KEPT', consent, uploaded: null }))
			.toEqual({ enabled: true, consent, secret: 'GS1-KEPT' });
	});
});

describe('cleanupTarget (cancel leaves nothing behind)', () => {
	const t = { secret: 'S', origin: 'O', stateId: 's1' };
	it('nothing uploaded, nothing in flight: nothing to delete', () => {
		expect(cleanupTarget({ uploaded: null, inFlight: null })).toBe(null);
	});
	it('an acknowledged upload is deleted now', () => {
		expect(cleanupTarget({ uploaded: t, inFlight: null })).toEqual({ when: 'now', ...t });
	});
	it('an upload still in flight is deleted once it settled - a DELETE racing the PUT could land first', () => {
		expect(cleanupTarget({ uploaded: null, inFlight: t })).toEqual({ when: 'settled', ...t });
	});
	it('never a target without a stateId - that would delete every profile under the code', () => {
		expect(cleanupTarget({ uploaded: { ...t, stateId: '' }, inFlight: null })).toBe(null);
		expect(cleanupTarget({ uploaded: null, inFlight: { ...t, stateId: undefined } })).toBe(null);
	});
});

describe('createGeneration', () => {
	it('an answer whose token is no longer current is dropped', () => {
		const g = createGeneration();
		const t1 = g.next();
		expect(g.isCurrent(t1)).toBe(true);
		const t2 = g.next();            // cancelled / restarted / closed
		expect(g.isCurrent(t1)).toBe(false);
		expect(g.isCurrent(t2)).toBe(true);
	});
});

describe('sameSetup', () => {
	it('compares switch, code and consent - not the profile map', () => {
		expect(sameSetup(OFF, { ...OFF, states: { x: {} } })).toBe(true);
		expect(sameSetup(OFF, { ...OFF, enabled: true })).toBe(false);
		expect(sameSetup(OFF, { ...OFF, consent: { version: 2, date: 'x' } })).toBe(false);
	});
});

describe('cleanupTarget after a failed upload', () => {
	const t = { secret: 'S', origin: 'O', stateId: 's1' };
	it('a PUT that errored may still have landed: cancel deletes its id now', () => {
		expect(cleanupTarget({ uploaded: null, inFlight: null, failed: t })).toEqual({ when: 'now', ...t });
	});
	it('still never without a stateId', () => {
		expect(cleanupTarget({ uploaded: null, inFlight: null, failed: { ...t, stateId: '' } })).toBe(null);
	});
});
