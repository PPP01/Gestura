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
	it("siteMenus defaults to empty diff structure with search as default menu", () => {
		expect(DEFAULT_SETTINGS.siteMenus).toEqual({ disabled: [], edited: {}, custom: {}, domains: {}, order: [], flags: {}, defaultMenuId: "search" });
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
	it("menuOpenBehavior defaults to 'standard' (left=same tab, right=new tab)", () => {
		expect(DEFAULT_SETTINGS.menuOpenBehavior).toBe("standard");
	});
	it("customMenu is the private own-menu action; siteMenu covers the website menus (contextual default)", () => {
		expect(globalThis.GestureConstants.ACTION_DEFAULTS.customMenu).toEqual({ ownMenu: null });
		expect(globalThis.GestureConstants.ACTION_DEFAULTS.siteMenu).toEqual({ mode: "contextual", menuId: "", fork: null });
		expect(globalThis.GestureConstants.ACTION_KEYS.siteMenu).toBe("siteMenusTitle");
		expect(globalThis.GestureConstants.LOCAL_ACTIONS.has("siteMenu")).toBe(true);
	});
});
