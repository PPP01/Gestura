// The three-way merge of two browsers' settings against a stored base
// (docs/superpowers/specs/2026-09-04-sync-reconciliation-design.md).
//
// Pure: no chrome.*, no DOM, no i18n. Loaded as a classic script on the
// options page and imported by vitest. Its one dependency is
// FlowMouseEuIntegration.canonicalize, for the reuse key of a conflict.
//
// MERGE_MAP is the decision this file exists for: every synced key of
// DEFAULT_SETTINGS gets exactly one kind, declared, never inferred. A new key
// without an entry fails tests/settings-merge.test.mjs - deliberately, because
// silently treating a record-shaped key as one opaque scalar would turn every
// future menu-shaped feature into an all-or-nothing conflict.
(function (root) {
	'use strict';

	// The seven keys the storage-move design (§7) keeps out of the sync payload.
	// Listed here so the partition test can prove nothing falls between the maps.
	const DEVICE_LOCAL = [
		'theme', 'language', 'macLinuxHintDismissed', 'edgeGestureConflict',
		'navCollapsed', 'engineManagerLocalOnly', 'sectionAdvanced',
	];

	// Kinds (spec §4):
	//   scalar      the key as a whole; one value, compared deeply
	//   record      object of entries, identity = the child's own name
	//   keyed-list  array of entries, identity = a named field in each item
	//   set         array of primitives, identity = the element itself; never asks
	//   order       an array of ids that is presentation order, not data; never asks
	//   container   fixed children, each with its own kind
	// `both: true` marks a record/keyed-list whose ids are generated, so a
	// conflict may be answered with "keep both" and the incoming copy gets a
	// fresh id with `idPrefix`.
	const MERGE_MAP = {
		enableDragFeatures: 'scalar',
		enableAreaSelect: 'scalar',
		enableSearchEngines: 'scalar',
		enableSiteMenus: 'scalar',
		enableBlacklist: 'scalar',
		enableContextMenu: 'scalar',
		enableGesture: 'scalar',
		gestureTriggerButtons: { kind: 'container', children: {
			right: 'scalar', middle: 'scalar', side1: 'scalar', side2: 'scalar', penRight: 'scalar',
		} },
		enableHUD: 'scalar',
		enableSuggestedGestures: 'scalar',
		enableTrail: 'scalar',
		showTrailOrigin: 'scalar',
		enableTrailSmooth: 'scalar',
		enableGestureCustomization: 'scalar',
		mouseGestures: 'record',
		enableTextDrag: 'scalar',
		textDragIgnoreInput: 'scalar',
		textDropIgnoreInput: 'scalar',
		enableImageDrag: 'scalar',
		enableLinkDrag: 'scalar',
		linkDropIgnoreInput: 'scalar',
		textDragGestures: { kind: 'keyed-list', key: 'direction' },
		linkDragGestures: { kind: 'keyed-list', key: 'direction' },
		imageDragGestures: { kind: 'keyed-list', key: 'direction' },
		hudBgColor: 'scalar',
		hudTextColor: 'scalar',
		hudBlurRadius: 'scalar',
		enableHudShadow: 'scalar',
		trailColor: 'scalar',
		trailColorEnd: 'scalar',
		enableTrailGradient: 'scalar',
		showTrailArrow: 'scalar',
		enableTrailGlow: 'scalar',
		trailWidth: 'scalar',
		customCss: 'scalar',
		distanceThreshold: 'scalar',
		gestureTurnTolerance: 'scalar',
		showRestrictedNotice: 'scalar',
		enableWheelGestures: 'scalar',
		wheelGestures: 'record',
		enableSpecialGestures: 'scalar',
		specialGestures: 'record',
		areaSelectModifierKey: 'scalar',
		areaSelectTextUrl: 'scalar',
		areaSelectWarnThreshold: 'scalar',
		areaSelectDelay: 'scalar',
		actionChains: { kind: 'record', both: true, idPrefix: 'chain_' },
		siteMenus: { kind: 'container', children: {
			disabled: 'set',
			edited: 'record',
			custom: { kind: 'record', both: true, idPrefix: 'menu_' },
			domains: 'record',
			// Declared after `custom`: the order rule drops ids whose custom entry
			// this merge deleted, and containers merge their children in this order.
			order: { kind: 'order', of: 'custom' },
			flags: 'record',
			defaultMenuId: 'scalar',
		} },
		menuAppend: { kind: 'container', children: {
			enabled: 'scalar',
			items: { kind: 'keyed-list', key: 'id' },
		} },
		customMenuSwitcher: { kind: 'container', children: { enabled: 'scalar', position: 'scalar' } },
		customMenuTheme: 'scalar',
		menuOpenBehavior: 'scalar',
		searchEngines: { kind: 'container', children: {
			overrides: 'record',
			hidden: 'set',
			custom: { kind: 'keyed-list', key: 'id', both: true, idPrefix: 'engine_' },
			order: { kind: 'order', of: 'custom' },
		} },
		blacklist: 'set',
		enableBlacklistContextMenu: 'scalar',
		ctxMenuAddSite: 'scalar',
		ctxMenuAssignSite: 'scalar',
		ctxMenuSiteMenu: 'scalar',
		ctxMenuSiteMenuMode: 'scalar',
		ctxMenuSiteMenuId: 'scalar',
		ctxMenuOptions: 'scalar',
		siteMenuAddAsk: 'scalar',
	};

	// A map entry is either a kind name or an object with `kind`.
	function spec(raw) {
		return typeof raw === 'string' ? { kind: raw } : raw;
	}

	// A copy of deepEqual in js/settings-store.js, which is an ES module with
	// chrome.* access and does not export it. "Changed" must mean here exactly
	// what it means there; tests/settings-merge.test.mjs pins the behaviour.
	function deepEqual(a, b) {
		if (a === b) return true;
		if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
		if (Array.isArray(a) !== Array.isArray(b)) return false;
		const ka = Object.keys(a);
		const kb = Object.keys(b);
		if (ka.length !== kb.length) return false;
		for (const k of ka) {
			if (!kb.includes(k) || !deepEqual(a[k], b[k])) return false;
		}
		return true;
	}

	const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
	const arr = (v) => (Array.isArray(v) ? v : []);
	const union = (...lists) => [...new Set(lists.flat())];
	const get = (o, k) => (isObj(o) ? o[k] : undefined);

	// The one decision table (spec §5), shared by every kind. `undefined` is
	// absence, so the ten rows and the trivial combinations fall out of three
	// comparisons:
	//   local == remote           nothing to decide (rows: all equal, both made
	//                             the same change, both created the same entry)
	//   local == base             only remote moved: take theirs, or delete
	//   remote == base            only local moved: keep mine (also a deletion)
	//   none of the above         both moved: ask
	// A conflict carries the local value, so `result` is complete before apply().
	function mergeEntry(b, l, r) {
		if (deepEqual(l, r)) return { value: l, status: 'unchanged' };
		if (deepEqual(l, b)) return r === undefined ? { value: undefined, status: 'deleted' } : { value: r, status: 'taken' };
		if (deepEqual(r, b)) return { value: l, status: 'uploaded' };
		return { value: l, status: 'conflict' };
	}

	// What an answer is remembered under across a 412 retry (spec §3): the same
	// question again gets the same key, a question whose `theirs` moved does not.
	function conflictKey(path, id, mine, theirs) {
		const C = root.FlowMouseEuIntegration.canonicalize;
		return [path, id, C(mine === undefined ? null : mine), C(theirs === undefined ? null : theirs)].join('\u0000');
	}

	function pushConflict(ctx, path, id, kind, s, l, r) {
		ctx.conflicts.push({
			path, id, kind, mine: l, theirs: r,
			// Both needs two values to keep; a deletion against an edit has one.
			canKeepBoth: !!(s.both && l !== undefined && r !== undefined),
			key: conflictKey(path, id, l, r),
		});
	}

	function count(ctx, status) {
		if (status in ctx.summary) ctx.summary[status]++;
	}

	function mergeScalar(ctx, path, s, b, l, r) {
		const e = mergeEntry(b, l, r);
		if (e.status === 'conflict') pushConflict(ctx, path, '', 'scalar', s, l, r);
		else count(ctx, e.status);
		return e.value;
	}

	function mergeRecord(ctx, path, s, b, l, r) {
		const B = isObj(b) ? b : {};
		const L = isObj(l) ? l : {};
		const R = isObj(r) ? r : {};
		const out = {};
		for (const id of union(Object.keys(L), Object.keys(R), Object.keys(B))) {
			const e = mergeEntry(B[id], L[id], R[id]);
			if (e.status === 'conflict') pushConflict(ctx, path, id, 'record', s, L[id], R[id]);
			else count(ctx, e.status);
			if (e.value !== undefined) out[id] = e.value;
		}
		return out;
	}

	// Fixed children, each by its own kind, in the declared order - so a sibling
	// declared later (`order`) can see what the merge did to one declared
	// earlier (`custom`). A child the map does not name is merged as a scalar:
	// with newer-version payloads refused (spec §3) it can only come from this
	// browser's own storage.
	function mergeContainer(ctx, path, s, b, l, r) {
		const B = isObj(b) ? b : {};
		const L = isObj(l) ? l : {};
		const R = isObj(r) ? r : {};
		const out = {};
		const sib = { spec: s, b: B, l: L, r: R, out };
		for (const child of union(Object.keys(s.children), Object.keys(L), Object.keys(R), Object.keys(B))) {
			const cs = spec(s.children[child] || 'scalar');
			const v = mergeValue(ctx, path + '.' + child, cs, B[child], L[child], R[child], sib);
			if (v !== undefined) out[child] = v;
		}
		return out;
	}

	function mergeValue(ctx, path, s, b, l, r, sib) {
		// A key nobody has is not an empty record, it is nothing: no entry in the
		// result, nothing counted.
		if (b === undefined && l === undefined && r === undefined) return undefined;
		switch (s.kind) {
			case 'scalar': return mergeScalar(ctx, path, s, b, l, r);
			case 'record': return mergeRecord(ctx, path, s, b, l, r);
			case 'container': return mergeContainer(ctx, path, s, b, l, r);
			default: throw new Error('settings-merge: unknown kind ' + s.kind);
		}
	}

	// base, local, remote: settings objects (validated, sync shape). Keys outside
	// MERGE_MAP - the format field, _version, device-local keys - are ignored on
	// the way in and absent on the way out.
	function merge(base, local, remote) {
		const ctx = { conflicts: [], summary: { taken: 0, uploaded: 0, deleted: 0, unchanged: 0 } };
		const result = {};
		for (const [key, raw] of Object.entries(MERGE_MAP)) {
			const v = mergeValue(ctx, key, spec(raw), get(base, key), get(local, key), get(remote, key), null);
			if (v !== undefined) result[key] = v;
		}
		return { result, conflicts: ctx.conflicts, summary: ctx.summary };
	}

	const api = { MERGE_MAP, DEVICE_LOCAL, spec, deepEqual, mergeEntry, merge };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSettingsMerge = api;
})(typeof self !== 'undefined' ? self : globalThis);
