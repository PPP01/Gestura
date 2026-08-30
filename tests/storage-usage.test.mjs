import { describe, it, expect } from 'vitest';
import '../js/storage-usage.js';
const S = globalThis.FlowMouseStorageUsage;

describe('usageOf', () => {
	it('zählt Schlüssel und Wert zusammen', () => {
		// 'k' = 1 Byte, JSON.stringify({a:1}) = '{"a":1}' = 7 Bytes
		expect(S.usageOf('k', { a: 1 }, 8192).bytes).toBe(8);
	});

	it('zählt UTF-8-Bytes, nicht Zeichen', () => {
		// 'ü' ist ein Zeichen, aber zwei Bytes; der String steht in Anführungszeichen
		const plain = S.usageOf('k', 'uu', 8192).bytes;
		const umlaut = S.usageOf('k', 'üü', 8192).bytes;
		expect(umlaut).toBe(plain + 2);
	});

	it('gibt den Deckel unverändert zurück', () => {
		expect(S.usageOf('k', {}, 8192).quota).toBe(8192);
	});

	it('rechnet den Prozentwert als ganze Zahl', () => {
		const r = S.usageOf('siteMenus', 'x'.repeat(4000), 8192);
		expect(Number.isInteger(r.percent)).toBe(true);
		expect(r.percent).toBeGreaterThan(45);
		expect(r.percent).toBeLessThan(55);
	});

	it('meldet nicht 100 Prozent, solange noch ein Byte frei ist', () => {
		// 8156 von 8192 sind 99,56 Prozent - naiv gerundet 100, obwohl es passt.
		// Diese Zahl entsteht real beim vierten Schritt der Test-Bundles.
		const value = 'x'.repeat(8156 - 'siteMenus'.length - 2); // -2 für die Anführungszeichen
		const r = S.usageOf('siteMenus', value, 8192);
		expect(r.bytes).toBe(8156);
		expect(r.percent).toBe(99);
	});

	it('meldet über 100, wenn der Deckel wirklich überschritten ist', () => {
		const value = 'x'.repeat(9000);
		const r = S.usageOf('k', value, 8192);
		expect(r.bytes).toBeGreaterThan(8192);
		expect(r.percent).toBeGreaterThan(100);
	});

	it('meldet genau 100 bei exakt vollem Deckel', () => {
		const value = 'x'.repeat(8192 - 'k'.length - 2);
		expect(S.usageOf('k', value, 8192).percent).toBe(100);
	});
});

describe('remainingEntries', () => {
	const menuA = { name: 'A', items: [{ id: 'x', action: 'back' }] };
	const menuB = { name: 'B', items: [{ id: 'y', action: 'back' }, { id: 'z', action: 'forward' }] };

	it('teilt den freien Platz durch den Durchschnitt der vorhandenen Einträge', () => {
		const avg = (JSON.stringify(menuA).length + JSON.stringify(menuB).length) / 2;
		expect(S.remainingEntries(avg * 3, [menuA, menuB], 1001)).toBe(3);
	});

	it('greift auf den Rückfallwert zurück, wenn es noch keine Einträge gibt', () => {
		expect(S.remainingEntries(3003, [], 1001)).toBe(3);
	});

	it('rundet ab - eine halbe Passung ist keine', () => {
		expect(S.remainingEntries(1500, [], 1001)).toBe(1);
	});

	it('liefert 0 bei keinem oder negativem freien Platz', () => {
		expect(S.remainingEntries(0, [], 1001)).toBe(0);
		expect(S.remainingEntries(-500, [], 1001)).toBe(0);
	});

	it('führt die gemessenen Rückfallwerte mit', () => {
		expect(S.AVG_FALLBACK.menu).toBe(1001);
		expect(S.AVG_FALLBACK.engine).toBe(797);
	});
});
