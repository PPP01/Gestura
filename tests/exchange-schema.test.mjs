import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import '../js/menu-exchange.js';
const X = globalThis.FlowMouseMenuExchange;

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'exchange-schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

describe('exchange-schema.json', () => {
	it('is valid JSON with a $schema and title', () => {
		expect(schema.$schema).toBeTruthy();
		expect(schema.title).toMatch(/gestura/i);
	});
	it('x-gestura metadata matches menu-exchange constants (no drift)', () => {
		expect(schema['x-gestura'].formatVersion).toBe(X.CURRENT_FORMAT_VERSION);
		expect(schema['x-gestura'].types).toEqual(X.FORMAT_TYPES);
		expect(schema['x-gestura'].allowedMenuItemActions.sort()).toEqual(X.ALLOWED_MENU_ITEM_ACTIONS.slice().sort());
		expect(schema['x-gestura'].limits).toEqual(X.LIMITS);
	});
	it('declares the bundle wrapper', () => {
		expect(schema['x-gestura'].types.bundle).toBe('gesturaBundle');
		expect(schema.$defs.bundle).toBeTruthy();
		expect(schema.$defs.bundle.properties.gesturaBundle.const).toBe(X.CURRENT_FORMAT_VERSION);
		expect(schema.$defs.bundle.properties.entries.maxItems).toBe(X.LIMITS.bundleEntriesMax);
		expect(schema.oneOf).toContainEqual({ $ref: '#/$defs/bundle' });
	});
});
