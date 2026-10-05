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

	it('punycodes and case-folds a non-ASCII host', () => {
		expect(normalize('bücher.de')).toBe('xn--bcher-kva.de');
		expect(normalize('BÜCHER.de')).toBe(normalize('bücher.de'));
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

const { matches, matchingEntries, evaluate, pathMatches } = globalThis.GesturaBlacklist;

describe('pathMatches', () => {
	it('an empty entry path matches anything', () => {
		expect(pathMatches('/anything', '')).toBe(true);
	});
	it('matches itself and what is below it', () => {
		expect(pathMatches('/games', '/games')).toBe(true);
		expect(pathMatches('/games/pong', '/games')).toBe(true);
	});
	// The whole reason the rule needs no wildcard syntax: the boundary is the
	// path separator, so /games cannot swallow /gameszone.
	it('breaks at the separator', () => {
		expect(pathMatches('/gameszone', '/games')).toBe(false);
		expect(pathMatches('/gam', '/games')).toBe(false);
	});
	it('is case-sensitive', () => {
		expect(pathMatches('/Games', '/games')).toBe(false);
	});
});

describe('matches', () => {
	it('a bare host matches every port and path — the compatibility guarantee', () => {
		expect(matches('http://localhost:8080/x', 'localhost')).toBe(true);
		expect(matches('https://localhost/y/z', 'localhost')).toBe(true);
	});
	it('a different host never matches', () => {
		expect(matches('http://127.0.0.1/x', 'localhost')).toBe(false);
	});
	it('a port entry matches only that port', () => {
		expect(matches('http://localhost:3000/x', 'localhost:3000')).toBe(true);
		expect(matches('http://localhost:8080/x', 'localhost:3000')).toBe(false);
	});
	it('compares effective ports, so a default port entry works', () => {
		expect(matches('https://example.com/x', 'example.com:443')).toBe(true);
		expect(matches('http://example.com/x', 'example.com:443')).toBe(false);
		expect(matches('http://example.com/x', 'example.com:80')).toBe(true);
		expect(matches('https://example.com/x', 'example.com:80')).toBe(false);
	});
	it('a path entry matches the page and what is below it', () => {
		const e = 'localhost:3001/galaxy-patrol.html';
		expect(matches('http://localhost:3001/galaxy-patrol.html', e)).toBe(true);
		expect(matches('http://localhost:3001/galaxy-patrol.html?x=1#t', e)).toBe(true);
		expect(matches('http://localhost:3001/galaxy-patrol.html.bak', e)).toBe(false);
	});
	it('returns false for junk instead of throwing', () => {
		expect(matches('not a url', 'example.com')).toBe(false);
		expect(matches('https://example.com/', '')).toBe(false);
	});
});

describe('matchingEntries', () => {
	// The popup may only act when the bare host is the ONLY reason the page is
	// blocked, so it needs all matches, not the first one — and the answer must
	// not depend on the order the user happened to add entries in.
	it('returns every match, in list order, regardless of insertion order', () => {
		const url = 'http://example.com/path/deep';
		expect(matchingEntries(url, ['example.com', 'example.com/path']))
			.toEqual(['example.com', 'example.com/path']);
		expect(matchingEntries(url, ['example.com/path', 'example.com']))
			.toEqual(['example.com/path', 'example.com']);
	});
	it('returns an empty array when nothing matches', () => {
		expect(matchingEntries('http://other.com/', ['example.com'])).toEqual([]);
		expect(matchingEntries('http://other.com/', null)).toEqual([]);
	});
	// An imported duplicate must not defeat the "bare host is the only reason"
	// check: two entries that both normalize to the same bare host collapse to
	// one, so callers still see the single-entry case they need to recognize.
	it('deduplicates entries that normalize to the same thing', () => {
		expect(matchingEntries('http://example.com/', ['example.com', 'example.com']))
			.toEqual(['example.com']);
		expect(matchingEntries('http://example.com/', ['example.com', 'EXAMPLE.com']))
			.toEqual(['example.com']);
	});
});

describe('evaluate', () => {
	const loc = (hostname, port, protocol, ancestorOrigin) =>
		({ hostname, port, protocol, ancestorOrigin });

	it('a host or port entry blocks the origin outright', () => {
		expect(evaluate(loc('localhost', '3001', 'http:'), ['localhost']).originBlocked).toBe(true);
		expect(evaluate(loc('localhost', '3001', 'http:'), ['localhost:3001']).originBlocked).toBe(true);
	});
	it('a port entry for another port does not', () => {
		expect(evaluate(loc('localhost', '3001', 'http:'), ['localhost:8080']).originBlocked).toBe(false);
	});
	it('a path entry is collected instead of blocking the origin', () => {
		const r = evaluate(loc('localhost', '3001', 'http:'), ['localhost:3001/g']);
		expect(r.originBlocked).toBe(false);
		expect(r.pathEntries.map(e => e.path)).toEqual(['/g']);
	});
	it('collects a path entry whose port is absent', () => {
		const r = evaluate(loc('localhost', '3001', 'http:'), ['localhost/g']);
		expect(r.pathEntries.map(e => e.path)).toEqual(['/g']);
	});
	it('drops a path entry meant for another port or host', () => {
		expect(evaluate(loc('localhost', '8080', 'http:'), ['localhost:3001/g']).pathEntries).toEqual([]);
		expect(evaluate(loc('localhost', '3001', 'http:'), ['example.com/g']).pathEntries).toEqual([]);
	});
	it('skips junk entries without throwing', () => {
		expect(evaluate(loc('localhost', '3001', 'http:'), ['', null, 'localhost']).originBlocked).toBe(true);
	});

	// A frame inside a blocked page is blocked too. ancestorOrigins carries scheme,
	// host and port but no path, so a path entry cannot reach in — that is issue #7,
	// deliberately out of scope, and this pins the behaviour so it is a decision
	// rather than an accident.
	it('blocks a frame whose outermost ancestor matches a host or port entry', () => {
		expect(evaluate(loc('ads.net', '', 'https:', 'https://blocked.com/deep'), ['blocked.com']).originBlocked).toBe(true);
		expect(evaluate(loc('ads.net', '', 'https:', 'http://localhost:3001'), ['localhost:3001']).originBlocked).toBe(true);
	});
	it('does not block a frame for a path entry on its ancestor', () => {
		expect(evaluate(loc('ads.net', '', 'https:', 'http://localhost:3001'), ['localhost:3001/g']).originBlocked).toBe(false);
	});
	it('ignores an unrelated ancestor', () => {
		expect(evaluate(loc('ads.net', '', 'https:', 'https://other.com'), ['blocked.com']).originBlocked).toBe(false);
	});
});
