import { describe, it, expect, beforeAll } from 'vitest';

let C;

beforeAll(async () => {
	// gesture-visual.js ist ein Content-Skript und hängt seine Ausgänge an window.
	// Für die reine Farbrechnung reicht ein Fenster-Ersatz; DOM wird erst in den
	// Methoden angefasst, nicht beim Laden.
	globalThis.window = globalThis;
	await import('../js/gesture-visual.js');
	C = globalThis.GestureTrailColors;
});

describe('hexToRgba', () => {
	it('liest sechsstelliges Hex', () => {
		expect(C.hexToRgba('#4285f4')).toEqual({ r: 66, g: 133, b: 244, a: 1 });
	});
	it('liest die Kurzform', () => {
		expect(C.hexToRgba('#f0a')).toEqual({ r: 255, g: 0, b: 170, a: 1 });
	});
	it('liest die Deckkraft aus achtstelligem Hex', () => {
		expect(C.hexToRgba('#4285f480').a).toBeCloseTo(128 / 255, 5);
	});
	it('lehnt ab, was kein Hex ist', () => {
		// Der Farbwähler kann auch oklch() liefern - dann bleibt der Verlauf
		// zweistufig statt falsch.
		expect(C.hexToRgba('oklch(0.7 0.2 250)')).toBe(null);
		expect(C.hexToRgba('rgb(1,2,3)')).toBe(null);
		expect(C.hexToRgba('#12345')).toBe(null);
		expect(C.hexToRgba(null)).toBe(null);
	});
});

describe('midColor', () => {
	const hue = (css) => Number(css.match(/hsla\(([\d.]+)/)[1]);

	it('mischt Blau und Rosa zu einem kräftigen Violett, nicht zu Grau', () => {
		// Der gerade RGB-Weg ergäbe hier ein stumpfes Grau-Violett. Über den
		// Farbkreis landet die Mitte bei rund 274 Grad - dem Ton, der den Verlauf
		// ausmacht.
		const mid = C.midColor('#4285f4', '#ec4899');
		expect(hue(mid)).toBeGreaterThan(265);
		expect(hue(mid)).toBeLessThan(285);
		// Sattheit bleibt oben: eine graue Mitte hätte hier einen kleinen Wert.
		expect(Number(mid.match(/,\s*([\d.]+)%/)[1])).toBeGreaterThan(60);
	});

	it('nimmt den kürzeren Weg über den Farbkreis', () => {
		// Rot (0) nach Violett (270): der kurze Weg führt über Magenta zu 315,
		// der lange über Grün zu 135. Ohne die Umschlagsregel käme Grün heraus -
		// eine Farbe, die in keiner der beiden Vorgaben vorkommt.
		expect(hue(C.midColor('#ff0000', '#8000ff'))).toBeCloseTo(315, 0);
	});

	it('mittelt die Deckkraft', () => {
		const mid = C.midColor('#ff000000', '#ff0000ff');
		expect(Number(mid.match(/,\s*([\d.]+)\)$/)[1])).toBeCloseTo(0.5, 2);
	});

	it('liefert null, wenn eine Farbe kein Hex ist', () => {
		expect(C.midColor('#ff0000', 'oklch(0.7 0.2 250)')).toBe(null);
	});

	it('bleibt bei zwei gleichen Farben bei deren Ton', () => {
		expect(hue(C.midColor('#4285f4', '#4285f4'))).toBeCloseTo(217, 0);
	});
});
