import { describe, it, expect } from 'vitest';
import '../js/menu-patterns.js';
const { addSiteToMenuPatterns, siteToPattern, pageToPattern, nameUrlMismatch } = globalThis.FlowMouseMenuPatterns;

describe('siteToPattern', () => {
  it('builds *host* from a url', () => {
    expect(siteToPattern('https://www.github.com/foo')).toBe('*www.github.com*');
  });
  it('returns null for invalid url', () => {
    expect(siteToPattern('not a url')).toBeNull();
  });
});
describe('pageToPattern', () => {
  it('keeps the path but drops query and fragment', () => {
    expect(pageToPattern('https://www.amazon.de/dp/B0XYZ?keywords=foo&qid=1#top'))
      .toBe('*www.amazon.de/dp/B0XYZ*');
  });
  it('trims trailing slashes so the pattern also matches the slash-less url', () => {
    expect(pageToPattern('https://example.com/shop/')).toBe('*example.com/shop*');
  });
  it('falls back to the domain pattern on the site root', () => {
    expect(pageToPattern('https://example.com/')).toBe('*example.com*');
    expect(pageToPattern('https://example.com')).toBe('*example.com*');
  });
  it('lowercases the host but leaves the path case alone', () => {
    expect(pageToPattern('https://WWW.Example.COM/Shop/Neu')).toBe('*www.example.com/Shop/Neu*');
  });
  it('returns null for invalid url', () => {
    expect(pageToPattern('not a url')).toBeNull();
  });
});
describe('addSiteToMenuPatterns', () => {
  const base = { m1: { name: 'Coding', items: [], patterns: ['*php.net*'] } };
  it('appends a new pattern', () => {
    const { menus, added } = addSiteToMenuPatterns(base, 'm1', 'https://github.com/x');
    expect(added).toBe('*github.com*');
    expect(menus.m1.patterns).toEqual(['*php.net*', '*github.com*']);
    expect(base.m1.patterns).toEqual(['*php.net*']); // original untouched (immutability)
  });
  it('dedups (no double add)', () => {
    const { menus, added } = addSiteToMenuPatterns(base, 'm1', 'https://php.net/x');
    expect(added).toBeNull();
    expect(menus.m1.patterns).toEqual(['*php.net*']);
  });
  it('initializes patterns when absent', () => {
    const { menus } = addSiteToMenuPatterns({ m2: { name: 'X', items: [] } }, 'm2', 'https://a.com/');
    expect(menus.m2.patterns).toEqual(['*a.com*']);
  });
  it('no-op for unknown menu', () => {
    const { menus, added } = addSiteToMenuPatterns(base, 'nope', 'https://a.com/');
    expect(added).toBeNull();
    expect(menus).toBe(base);
  });
});

describe('nameUrlMismatch', () => {
  it('returns null when the name is not domain-shaped', () => {
    expect(nameUrlMismatch('Posteingang', 'https://mail.google.com/mail/u/0/#inbox')).toBe(null);
  });
  it('returns null when name and host are the same domain', () => {
    expect(nameUrlMismatch('Spiegel.de', 'https://spiegel.de/')).toBe(null);
  });
  it('ignores a www prefix on either side', () => {
    expect(nameUrlMismatch('Spiegel.de', 'https://www.spiegel.de/')).toBe(null);
    expect(nameUrlMismatch('www.spiegel.de', 'https://spiegel.de/')).toBe(null);
  });
  it('accepts a subdomain of the named domain', () => {
    expect(nameUrlMismatch('Spiegel.de', 'https://magazin.spiegel.de/')).toBe(null);
  });
  it('reports both domains when they differ', () => {
    expect(nameUrlMismatch('Spiegel.de', 'https://spon.de')).toEqual({ name: 'spiegel.de', url: 'spon.de' });
  });
  it('strips a scheme and path the user typed into the name', () => {
    expect(nameUrlMismatch('https://amazon.de/gp', 'https://alibaba.cn')).toEqual({ name: 'amazon.de', url: 'alibaba.cn' });
  });
  it('returns null for a multi-word name that merely contains a dot', () => {
    expect(nameUrlMismatch('Spiegel.de lesen', 'https://spon.de')).toBe(null);
  });
  it('returns null when the last label is not alphabetic', () => {
    expect(nameUrlMismatch('192.168.1.1', 'https://spon.de')).toBe(null);
  });
  it('returns null for an unparseable or placeholder url', () => {
    expect(nameUrlMismatch('amazon.de', '')).toBe(null);
    expect(nameUrlMismatch('amazon.de', 'https://www.{domain}/cart')).toBe(null);
  });
});
