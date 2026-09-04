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

	const api = { MERGE_MAP, DEVICE_LOCAL, spec, deepEqual };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSettingsMerge = api;
})(typeof self !== 'undefined' ? self : globalThis);
