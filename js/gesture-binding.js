// Resolves a recognised gesture pattern to the binding that should run.
//
// The recognizer can produce repeated directions (↓↓). A repeated pattern with
// no entry of its own falls back to the pattern with every repeat collapsed
// (↓↓→ → ↓→), so nothing changes for anyone who never binds one. An entry whose
// action is 'none' is an entry: it blocks the fallback.
(function (root) {
	'use strict';

	function collapse(pattern) {
		return String(pattern || '').replace(/(.)\1+/g, '$1');
	}

	// lookup(pattern) returns the binding for a pattern, or undefined/null when
	// the pattern has no entry. What a binding is belongs to the caller: a
	// mouse-gesture entry, or a list of drag-gesture configs.
	function resolve(rawPattern, lookup) {
		const raw = typeof rawPattern === 'string' ? rawPattern : '';
		const direct = raw ? lookup(raw) : undefined;
		if (direct != null) return { rawPattern: raw, effectivePattern: raw, binding: direct };
		const collapsed = collapse(raw);
		if (collapsed !== raw) {
			const fallback = lookup(collapsed);
			if (fallback != null) return { rawPattern: raw, effectivePattern: collapsed, binding: fallback };
		}
		return { rawPattern: raw, effectivePattern: raw, binding: undefined };
	}

	// The pattern HUD suggestions are computed from: the raw one while some
	// active pattern directly extends it, else the collapsed one. No fallback is
	// applied for that check - a disabled ↓↓→ must not hide the ↓→ suggestions.
	function suggestionBase(rawPattern, patterns, isActive) {
		const raw = typeof rawPattern === 'string' ? rawPattern : '';
		for (const p of patterns) {
			if (p.length > raw.length && p.startsWith(raw) && isActive(p)) return raw;
		}
		return collapse(raw);
	}

	const api = { collapse, resolve, suggestionBase };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GestureBinding = api;
})(typeof self !== 'undefined' ? self : globalThis);
