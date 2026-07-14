import { describe, it, expect, beforeAll } from "vitest";

let DEFAULT_SETTINGS;

beforeAll(async () => {
	// constants.js is a browser IIFE that assigns to window.GestureConstants
	// and also sets window.litDisableBundleWarning = true.
	// Provide a minimal window shim so it runs under Node/Vitest.
	globalThis.window = globalThis;
	await import("../js/constants.js");
	DEFAULT_SETTINGS = globalThis.GestureConstants.DEFAULT_SETTINGS;
});

describe("DEFAULT_SETTINGS", () => {
	it("siteMenus defaults to empty diff structure", () => {
		expect(DEFAULT_SETTINGS.siteMenus).toEqual({ disabled: [], edited: {}, custom: {}, domains: {}, order: [], flags: {} });
	});
	it("customMenus key is gone", () => {
		expect(DEFAULT_SETTINGS).not.toHaveProperty("customMenus");
	});
	it("searchEngines defaults to empty diff structure", () => {
		expect(DEFAULT_SETTINGS.searchEngines).toEqual({ overrides: {}, hidden: [], custom: [], order: [] });
	});
	it("customMenuTheme defaults to 'auto'", () => {
		expect(DEFAULT_SETTINGS.customMenuTheme).toBe("auto");
	});
	it("menuAppend defaults to disabled with brave/google/perplexity searches", () => {
		expect(DEFAULT_SETTINGS.menuAppend.enabled).toBe(false);
		expect(DEFAULT_SETTINGS.menuAppend.items.map(i => i.engineId)).toEqual(["brave", "google", "perplexity"]);
		for (const it of DEFAULT_SETTINGS.menuAppend.items) {
			expect(it.action).toBe("searchLink");
			expect(it.id).toBeTruthy();
		}
	});
	it("customMenu action defaults to the search menu as contextual fallback", () => {
		expect(globalThis.GestureConstants.ACTION_DEFAULTS.customMenu.fallbackMenuId).toBe("search");
	});
});
