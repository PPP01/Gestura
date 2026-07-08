import { describe, it, expect } from "vitest";
import "../js/favicon-util.js";

const { monogramLetter, colorForName, monogramDataUri, parseIconLinks, pickBestIconHref } =
	globalThis.FlowMouseFavicon;

describe("monogramLetter", () => {
	it("returns the uppercased first letter", () => {
		expect(monogramLetter("DuckDuckGo")).toBe("D");
		expect(monogramLetter("ebay")).toBe("E");
	});
	it("skips leading whitespace/symbols to the first alphanumeric", () => {
		expect(monogramLetter("  ~ brave")).toBe("B");
		expect(monogramLetter("360 Search")).toBe("3");
	});
	it("falls back to '?' for empty/blank names", () => {
		expect(monogramLetter("")).toBe("?");
		expect(monogramLetter("   ")).toBe("?");
	});
});

describe("colorForName", () => {
	it("is deterministic and a 6-digit hex", () => {
		expect(colorForName("Brave")).toMatch(/^#[0-9a-f]{6}$/);
		expect(colorForName("Brave")).toBe(colorForName("Brave"));
	});
});

describe("monogramDataUri", () => {
	it("returns an inline svg data uri containing the letter", () => {
		const uri = monogramDataUri("Perplexity");
		expect(uri.startsWith("data:image/svg+xml")).toBe(true);
		expect(decodeURIComponent(uri)).toContain(">P<");
	});
});

describe("parseIconLinks", () => {
	const html = `<head>
		<link rel="stylesheet" href="/a.css">
		<link rel="icon" href="/favicon.ico">
		<link rel="shortcut icon" href="favicon-16.png" sizes="16x16">
		<link rel="apple-touch-icon" href="https://cdn.example.com/touch.png" sizes="180x180">
		<link REL="ICON" sizes="any" href="/icon.svg">
	</head>`;

	it("extracts only icon links and resolves hrefs against the base url", () => {
		const links = parseIconLinks(html, "https://example.com/page");
		expect(links.map(l => l.href)).toEqual([
			"https://example.com/favicon.ico",
			"https://example.com/favicon-16.png",
			"https://cdn.example.com/touch.png",
			"https://example.com/icon.svg",
		]);
	});
	it("parses sizes (missing=0, NxN=N, any=9999)", () => {
		const links = parseIconLinks(html, "https://example.com/page");
		expect(links.map(l => l.size)).toEqual([0, 16, 180, 9999]);
	});
	it("returns [] when there are no icon links", () => {
		expect(parseIconLinks("<head><title>x</title></head>", "https://e.com/")).toEqual([]);
	});
});

describe("pickBestIconHref", () => {
	it("prefers the smallest icon at or above the target size", () => {
		const links = [{ href: "a", size: 16 }, { href: "b", size: 32 }, { href: "c", size: 180 }];
		expect(pickBestIconHref(links, 32)).toBe("b");
	});
	it("falls back to the largest when none reach the target", () => {
		expect(pickBestIconHref([{ href: "a", size: 16 }, { href: "b", size: 20 }], 32)).toBe("b");
	});
	it("uses the first when sizes are unknown", () => {
		expect(pickBestIconHref([{ href: "a", size: 0 }, { href: "b", size: 0 }], 32)).toBe("a");
	});
	it("returns null for an empty list", () => {
		expect(pickBestIconHref([], 32)).toBeNull();
	});
});
