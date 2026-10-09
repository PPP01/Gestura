import { describe, it, expect } from 'vitest';
import { switchArea, refusalText, wayBackText } from '../js/components/storage-area-switch.js';

const fakeS = (answer, landedArea, note = null, seen = []) => {
	let area = 'sync';
	return {
		switchTo: async (target, reason) => { seen.push([target, reason]); area = landedArea ?? (answer.ok ? target : area); return answer; },
		area: () => area,
		note: async () => { if (note instanceof Error) throw note; return note; },
	};
};
const i18n = { getMessage: k => ({
	storageSwitchRefusedBranch: 'B {branch} {used} {total}',
	storageSwitchRefusedTotal: 'T {used} {total}',
	storageSwitchRefusedTier2: 'TIER2',
	storageSwitchFailed: 'FAILED',
	storageSwitchToSyncConfirm: 'BACK',
	storageSwitchToSyncConfirmSince: 'BACK since {date}',
	siteMenusTitle: 'Menus',
	storageBranchOther: 'Other',
}[k] ?? k) };

describe('switchArea', () => {
	it('landed, no refusal, on success', async () => {
		expect(await switchArea(fakeS({ ok: true }), 'local')).toEqual({ landed: true, refusal: null });
	});
	it('ok:false but the area moved anyway counts as landed (failed rollback)', async () => {
		expect(await switchArea(fakeS({ ok: false, error: 'write' }, 'local'), 'local')).toEqual({ landed: true, refusal: null });
	});
	it('passes the reason on - it decides the note other browsers read', async () => {
		const seen = [];
		await switchArea(fakeS({ ok: true }, null, null, seen), 'local', 'gestura.eu');
		await switchArea(fakeS({ ok: true }, null, null, seen), 'local');
		expect(seen).toEqual([['local', 'gestura.eu'], ['local', 'local']]);
	});
	it('refused: not landed, refusal carried', async () => {
		const res = { ok: false, error: 'branch-full', branch: 'siteMenus', bytes: 9000, quota: 8192 };
		expect(await switchArea(fakeS(res, 'sync'), 'local')).toEqual({ landed: false, refusal: res });
	});
});

describe('refusalText', () => {
	it.each([
		[{ error: 'branch-full', branch: 'siteMenus', bytes: 9000, quota: 8192 }, 'B Menus 9000 8192'],
		[{ error: 'total-full', branch: '', bytes: 200000, quota: 102400 }, 'T 200000 102400'],
		[{ error: 'tier2-enabled' }, 'TIER2'],
		[{ error: 'write' }, 'FAILED'],
	])('%o', (res, want) => { expect(refusalText(i18n, res)).toBe(want); });
});

describe('wayBackText', () => {
	it('names the date the other browser left', async () => {
		expect(await wayBackText(fakeS({ ok: true }, null, { movedAt: '2026-01-02' }), i18n, d => `<${d}>`)).toBe('BACK since <2026-01-02>');
	});
	it('without a note, or with a failing read, asks without a date', async () => {
		expect(await wayBackText(fakeS({ ok: true }), i18n, d => d)).toBe('BACK');
		expect(await wayBackText(fakeS({ ok: true }, null, new Error('x')), i18n, d => d)).toBe('BACK');
	});
});
