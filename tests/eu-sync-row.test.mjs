import { describe, it, expect } from 'vitest';
import { rowModel } from '../js/components/eu-sync-row.js';

const ID = '0123456789abcdef0123456789abcdef';
const state = (payloadHash = 'srv') => ({ stateId: ID, meta: { payloadHash } });
const local = (over = {}) => ({ name: 'Work', lastUploadHash: 'h1', lastUploadDate: '2026-10-01T00:00:00Z', ...over });
const model = (over = {}) => rowModel({
	state: state(), local: local(), activeState: '', base: { hash: 'srv' }, currentHash: 'h1', ...over,
});

describe('a state that is not the active one', () => {
	it('offers Download and Upload, and never claims the settings changed', () => {
		const m = model({ currentHash: 'something-else' });
		expect(m.active).toBe(false);
		expect(m.changed).toBe(false);
		expect(m.offers).toMatchObject({ download: true, upload: true });
	});

	it('never offers Merge - its base belongs to a time it was active', () => {
		expect(model().offers.merge).toBe(false);
		expect(model({ state: state('moved') }).offers.merge).toBe(false);
	});
});

describe('the active state', () => {
	const active = (over = {}) => model({ activeState: ID, ...over });

	it('hides Download', () => {
		expect(active().offers.download).toBe(false);
	});

	it('offers Upload only once the local settings differ from the last agreement', () => {
		expect(active().offers.upload).toBe(false);
		const changed = active({ currentHash: 'edited' });
		expect(changed.changed).toBe(true);
		expect(changed.offers.upload).toBe(true);
	});

	it('does not say "changed" before the current hash is known', () => {
		expect(active({ currentHash: '' }).changed).toBe(false);
	});

	it('offers Merge when the server moved, independent of local changes', () => {
		expect(active({ state: state('moved') }).offers.merge).toBe(true);
		expect(active({ state: state('moved'), currentHash: 'edited' }).offers.merge).toBe(true);
	});

	it('offers no Merge while the server holds the base, or without a base', () => {
		expect(active().offers.merge).toBe(false);
		expect(active({ base: undefined, state: state('moved') }).offers.merge).toBe(false);
	});
});

describe('renaming', () => {
	it('is offered on any readable state, active or not', () => {
		expect(model().offers.rename).toBe(true);
		expect(model({ activeState: ID }).offers.rename).toBe(true);
		expect(model({ state: { ...state(), broken: true } }).offers.rename).toBe(false);
	});
});

describe('where the state came from', () => {
	it('says it was never uploaded from here until an upload date is on record', () => {
		expect(model({ local: undefined }).neverUploadedHere).toBe(true);
		// Adopted, not uploaded: an entry exists, but without a date.
		expect(model({ local: local({ lastUploadDate: '' }) }).neverUploadedHere).toBe(true);
		expect(model().neverUploadedHere).toBe(false);
	});
});
