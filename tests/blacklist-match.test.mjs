import { describe, it, expect } from 'vitest';
import '../js/blacklist-match.js';
const { parse, normalize } = globalThis.GesturaBlacklist;

describe('normalize', () => {
	it('keeps a bare host', () => {
		expect(normalize('example.com')).toBe('example.com');
	});

	// The regression the first design draft would have shipped: new URL() drops a
	// port that is its scheme's default, so parsing under https:// turned
	// example.com:443 into example.com — a request for one port silently widened
	// into a block on the whole host.
	it('keeps an explicit default port', () => {
		expect(normalize('example.com:443')).toBe('example.com:443');
		expect(normalize('example.com:80')).toBe('example.com:80');
	});

	it('strips the scheme', () => {
		expect(normalize('http://localhost:3001/galaxy-patrol.html'))
			.toBe('localhost:3001/galaxy-patrol.html');
	});

	it('lowercases the host but not the path', () => {
		expect(normalize('EXAMPLE.com')).toBe('example.com');
		expect(normalize('example.com/Games')).toBe('example.com/Games');
	});

	it('drops a trailing slash, and treats a lone slash as no path', () => {
		expect(normalize('example.com/a/b/')).toBe('example.com/a/b');
		expect(normalize('example.com/')).toBe('example.com');
	});

	it('drops query and fragment', () => {
		expect(normalize('example.com/a?q=1#f')).toBe('example.com/a');
	});

	it('handles an IPv6 host', () => {
		expect(normalize('[::1]:3000')).toBe('[::1]:3000');
	});

	it('rejects junk', () => {
		expect(normalize('')).toBe(null);
		expect(normalize('   ')).toBe(null);
		expect(normalize(null)).toBe(null);
		expect(normalize('example.com:abc')).toBe(null);
		expect(normalize('example.com:99999')).toBe(null);
	});

	it('is idempotent', () => {
		expect(normalize(normalize('HTTPS://Example.com:443/A/'))).toBe('example.com:443/A');
	});
});

describe('parse', () => {
	it('splits an entry into its three parts', () => {
		expect(parse('localhost:3001/games')).toEqual({ host: 'localhost', port: '3001', path: '/games' });
	});

	it('reports absent parts as empty strings', () => {
		expect(parse('example.com')).toEqual({ host: 'example.com', port: '', path: '' });
	});

	it('returns null for junk', () => {
		expect(parse('')).toBe(null);
		expect(parse(null)).toBe(null);
	});
});
