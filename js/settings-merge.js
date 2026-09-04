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
			// The spec this entry was merged under, kept rather than re-derived
			// from `path` in apply(): one walk over MERGE_MAP instead of two that
			// have to agree.
			spec: s,
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

	// A set is a record whose entries are their own names: presence is the
	// value. mergeEntry then never conflicts - an element present on both sides
	// is equal, one present on one side alone is either newly added or was
	// deleted from the base - and the summary comes out of the same table.
	function mergeSet(ctx, path, s, b, l, r) {
		const B = new Set(arr(b));
		const L = new Set(arr(l));
		const R = new Set(arr(r));
		const out = [];
		for (const x of union(arr(l), arr(r), arr(b))) {
			const e = mergeEntry(B.has(x) ? x : undefined, L.has(x) ? x : undefined, R.has(x) ? x : undefined);
			count(ctx, e.status);
			if (e.value !== undefined) out.push(x);
		}
		return out;
	}

	// The ids a record or keyed-list holds - for the order rule's "does this
	// entry still exist".
	function idsOf(s, value) {
		if (s.kind === 'keyed-list') return arr(value).map(it => (isObj(it) ? it[s.key] : undefined)).filter(id => typeof id === 'string');
		return isObj(value) ? Object.keys(value) : [];
	}

	// Spec §4: the same three-way rule as everything else, then the other
	// side's ids appended, then ids whose entry this merge deleted dropped.
	// Deleted = existed in the `of` sibling on some side, absent from the merged
	// sibling. Catalogue ids are never in `custom`, so never dropped.
	function mergeOrder(ctx, path, s, b, l, r, sib) {
		const B = arr(b);
		const L = arr(l);
		const R = arr(r);
		const chosen = deepEqual(R, B) ? L : R;
		const other = chosen === L ? R : L;
		let gone = new Set();
		if (sib && s.of) {
			const os = spec(sib.spec.children[s.of]);
			const existed = union(idsOf(os, sib.b[s.of]), idsOf(os, sib.l[s.of]), idsOf(os, sib.r[s.of]));
			const kept = new Set(idsOf(os, sib.out[s.of]));
			gone = new Set(existed.filter(id => !kept.has(id)));
		}
		const out = [];
		for (const id of [...chosen, ...other]) {
			if (!gone.has(id) && !out.includes(id)) out.push(id);
		}
		const sameL = deepEqual(out, L);
		const sameR = deepEqual(out, R);
		count(ctx, sameL && sameR ? 'unchanged' : sameL ? 'uploaded' : sameR ? 'taken' : 'uploaded');
		return out;
	}

	function toMap(s, value) {
		const m = {};
		for (const it of arr(value)) {
			if (isObj(it) && typeof it[s.key] === 'string') m[it[s.key]] = it;
		}
		return m;
	}

	// A record keyed by a field inside each item, written back as an array:
	// remote items in their sequence, local-only items appended. The array's
	// own order carries no meaning - `searchEngines.order` does that job.
	function mergeKeyedList(ctx, path, s, b, l, r) {
		const B = toMap(s, b);
		const L = toMap(s, l);
		const R = toMap(s, r);
		const out = [];
		for (const id of union(Object.keys(R), Object.keys(L), Object.keys(B))) {
			const e = mergeEntry(B[id], L[id], R[id]);
			if (e.status === 'conflict') pushConflict(ctx, path, id, 'keyed-list', s, L[id], R[id]);
			else count(ctx, e.status);
			if (e.value !== undefined) out.push(e.value);
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
			case 'set': return mergeSet(ctx, path, s, b, l, r);
			case 'order': return mergeOrder(ctx, path, s, b, l, r, sib);
			case 'keyed-list': return mergeKeyedList(ctx, path, s, b, l, r);
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

	// --- apply -------------------------------------------------------------------

	function freshId(prefix, existing) {
		let id;
		do {
			id = prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
		} while (existing.has(id));
		return id;
	}

	// "Reading" from state "office" arrives as "Reading (office)" - spec §7.
	function suffixName(entry, stateName) {
		if (!isObj(entry) || typeof entry.name !== 'string') return entry;
		return { ...entry, name: `${entry.name} (${stateName || '2'})` };
	}

	// mine/theirs on a conflict are the caller's own local/remote objects,
	// passed straight through by mergeRecord/mergeScalar/mergeKeyedList -
	// never merge()'s to copy. apply() promises not to mutate its inputs, so
	// every value it writes into `out` has to be its own copy, not an alias.
	function cloneValue(v) {
		return v === undefined ? undefined : structuredClone(v);
	}

	// The object holding the last path segment, created on the way if missing.
	function parentOf(obj, path) {
		const parts = path.split('.');
		let o = obj;
		for (let i = 0; i < parts.length - 1; i++) {
			if (!isObj(o[parts[i]])) o[parts[i]] = {};
			o = o[parts[i]];
		}
		return [o, parts[parts.length - 1]];
	}

	// result: what merge() returned (holds `mine` for every conflict).
	// choices: { [conflict.key]: 'mine' | 'theirs' | 'both' }; missing = 'mine'.
	// Never mutates; returns the final object for validation, preview and upload.
	function apply(result, conflicts, choices, opts) {
		const out = structuredClone(result);
		const stateName = (opts && opts.stateName) || '';
		for (const c of conflicts || []) {
			const choice = (choices && choices[c.key]) || 'mine';
			const s = c.spec;
			const [parent, last] = parentOf(out, c.path);
			const keep = choice === 'theirs' ? c.theirs : c.mine;
			const both = choice === 'both' && c.canKeepBoth;

			if (c.kind === 'scalar') {
				if (keep === undefined) delete parent[last];
				else parent[last] = cloneValue(keep);
				continue;
			}
			if (c.kind === 'record') {
				const rec = isObj(parent[last]) ? parent[last] : (parent[last] = {});
				if (keep === undefined) delete rec[c.id];
				else rec[c.id] = cloneValue(keep);
				if (both) rec[freshId(s.idPrefix, new Set(Object.keys(rec)))] = suffixName(cloneValue(c.theirs), stateName);
				continue;
			}
			// keyed-list: replace in place, delete in place, append the copy.
			const list = arr(parent[last]).slice();
			const idx = list.findIndex(it => isObj(it) && it[s.key] === c.id);
			if (keep === undefined) {
				if (idx >= 0) list.splice(idx, 1);
			} else if (idx >= 0) {
				list[idx] = cloneValue(keep);
			} else {
				list.push(cloneValue(keep));
			}
			if (both) {
				const id = freshId(s.idPrefix, new Set(list.map(it => (isObj(it) ? it[s.key] : ''))));
				list.push({ ...suffixName(cloneValue(c.theirs), stateName), [s.key]: id });
			}
			parent[last] = list;
		}
		return out;
	}

	// Spec §3, step 7b-7d: upload, then the local write, then the base - in that
	// order and in no other. Written the other way round - local first, base
	// second, upload last - a 412 would leave behind a base whose payload is the
	// merged result and whose hash matches nothing on the server; the next pass
	// would then find local == base for every entry, conclude that only the
	// remote side moved, and take theirs everywhere: every local change silently
	// overwritten. Upload first, and a refused upload has cost nothing.
	//
	// The order lives here, in the pure module, and not only in the panel that
	// runs it, because here it can be tested in Node without a DOM. The three
	// steps are injected:
	//
	//   upload()                  the server's answer, or a falsy value if the
	//                             upload was refused (412) or failed. Nothing
	//                             else runs then - neither the local settings
	//                             nor the base are written.
	//   applySettings(recordBase) performs the local write and resolves truthy
	//                             on success; calls `recordBase` once the write
	//                             has succeeded, and never before.
	//   recordBase()              writeBase(answer): the base, under the hash
	//                             this very upload returned. It does not exist
	//                             before the upload succeeded and writes at most
	//                             once.
	//
	// The base write is handed INTO applySettings rather than run after it
	// returned, because the caller's write path reloads the page immediately
	// after its own after-save hook: the base has to be stored inside that hook,
	// while the save is known to have succeeded and the page is still there. A
	// local write that fails runs no hook, calls no `recordBase`, and leaves no
	// base - the second half of the same invariant.
	//
	// Returns { ok: true, answer } or { ok: false, reason: 'upload' | 'apply' }.
	async function commitOrder({ upload, applySettings, writeBase }) {
		const answer = await upload();
		if (!answer) return { ok: false, reason: 'upload' };
		let written = false;
		const recordBase = async () => {
			if (written) return false;
			written = true;
			await writeBase(answer);
			return true;
		};
		const applied = await applySettings(recordBase);
		if (!applied) return { ok: false, reason: 'apply' };
		return { ok: true, answer };
	}

	const api = { MERGE_MAP, DEVICE_LOCAL, spec, deepEqual, mergeEntry, merge, apply, commitOrder };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSettingsMerge = api;
})(typeof self !== 'undefined' ? self : globalThis);
