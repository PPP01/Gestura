// The one shape a settings blob has to have to get into this extension - and
// the one place that decides it. Three doors lead in: a file the user picked, a
// state downloaded from gestura.eu, and the export read backwards. They used to
// have one and a half validators between them (#importSettings checked that
// enableGesture existed; the sync had nothing), which is exactly the kind of
// asymmetry a crafted file looks for.
//
// The rules are contract, not preference - docs/gestura-eu-api.md, "Settings
// exchange format".
(function (root) {
	'use strict';

	const FORMAT_FIELD = 'gesturaSettings';
	const FORMAT_VERSION = 1;
	// The local settings ceiling (storage-move design §3) - the same number the
	// façade enforces on save, so what can be stored can be exported and imported.
	// The 512 KiB payload cap of the contract is a limit on the ENVELOPE as
	// transmitted; compression sits between the two.
	const MAX_BYTES = 1024 * 1024;

	// Rejected anywhere in the tree, at any depth. A settings entry the user
	// literally named "constructor" cannot travel through a file as a result -
	// that is the right side to be wrong on, and R1's bridge already treats such
	// an id as hostile-but-harmless for the same reason.
	const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

	// Never exported, never imported. The first two live in chrome.storage.local
	// and hold the consent and the sync secret: a file that could set them could
	// turn the integration on or hand this browser a foreign locator. The third is
	// a local timestamp that changes on every save.
	const NEVER = new Set(['euIntegration', 'euSync', 'lastSyncTime']);

	// Facts about THIS device or the state of THIS browser's UI, not settings
	// (storage-move design §7). Excluded from the sync payload, kept in file
	// exports, and taken from the local copy when a sync state is adopted.
	const DEVICE_LOCAL = new Set([
		'theme', 'language', 'macLinuxHintDismissed', 'edgeGestureConflict',
		'navCollapsed', 'engineManagerLocalOnly', 'sectionAdvanced',
	]);

	const defaults = () => root.GestureConstants.DEFAULT_SETTINGS;

	function allowedKeys(opts) {
		const forSync = !!(opts && opts.forSync);
		return Object.keys(defaults()).filter(k => !NEVER.has(k) && !(forSync && DEVICE_LOCAL.has(k)));
	}

	// Against the shape of the key's own default: object vs array vs primitive
	// type. Used at the top level and, for RECORD_KEYS below, one level deeper.
	function sameShape(value, def) {
		if (Array.isArray(def)) return Array.isArray(value);
		if (def === null) return true;
		if (def !== null && typeof def === 'object') {
			return value !== null && typeof value === 'object' && !Array.isArray(value);
		}
		return typeof value === typeof def;
	}

	// Keys whose CHILD NAMES are part of the format rather than user data, so the
	// default describes a shape for each of them and it can be checked. This is
	// where generic checking has to stop being generic: DEFAULT_SETTINGS.siteMenus
	// has the fixed children `custom`, `edited`, `order` …, while
	// DEFAULT_SETTINGS.mouseGestures is keyed by gesture patterns - its default
	// entries are DATA, and "fill in what is missing from the default" would
	// resurrect every gesture the user deleted. actionChains has an empty default
	// and therefore describes nothing.
	//
	// Checking these matters because consumers rely on them: engine-registry.js
	// iterates searchEngines.custom, and `for (const c of {})` throws. A settings
	// object whose containers have the wrong type is not a cosmetic problem - it
	// takes out the search engines on every page load.
	const RECORD_KEYS = new Set([
		'gestureTriggerButtons', 'siteMenus', 'searchEngines',
		'menuAppend', 'customMenuSwitcher', 'wheelGestures', 'specialGestures',
	]);

	// Repairs the offending CHILD rather than discarding the whole key: one
	// mistyped `custom` should not cost the user their overrides and their order
	// as well. Children the default does not describe pass through untouched -
	// they are the user's own menu ids, engine ids and domains.
	function conformRecord(value, def) {
		const out = { ...value };
		const repaired = [];
		for (const [child, childDef] of Object.entries(def)) {
			if (!(child in out) || sameShape(out[child], childDef)) continue;
			out[child] = structuredClone(childDef);
			repaired.push(child);
		}
		return { value: out, repaired };
	}

	// Stored settings are a handful of levels deep. Far beyond that a file is not
	// a settings file, and JSON.parse - iterative - would hand it over intact for
	// structuredClone and JSON.stringify to overflow the stack on. So the one
	// walk that runs before anything is copied is iterative, carries the depth,
	// and refuses at a number rather than wherever the engine's stack ends.
	const MAX_DEPTH = 64;

	// The pre-walk: null when the tree is fine, else the reason it is not.
	function scanTree(root) {
		const stack = [[root, 0]];
		while (stack.length) {
			const [value, depth] = stack.pop();
			if (!value || typeof value !== 'object') continue;
			if (depth >= MAX_DEPTH) return 'too-deep';
			if (Array.isArray(value)) {
				for (const item of value) stack.push([item, depth + 1]);
				continue;
			}
			for (const key of Object.keys(value)) {
				if (FORBIDDEN.has(key)) return 'forbidden-key';
				stack.push([value[key], depth + 1]);
			}
		}
		return null;
	}

	function buildExport(settings, extVersion, opts) {
		const out = { [FORMAT_FIELD]: FORMAT_VERSION, _version: extVersion || '' };
		for (const key of allowedKeys(opts)) {
			if (settings && settings[key] !== undefined) out[key] = settings[key];
		}
		return out;
	}

	function exportText(settings, extVersion) {
		return JSON.stringify(buildExport(settings, extVersion), null, 2);
	}

	// Pre-2.4 exports carried `gestures` + `customGestures` + `customGestureUrls`
	// instead of `mouseGestures`. Lifted out of options-page.js's #importSettings
	// unchanged: the sync download needs the same migration for the same files,
	// and two copies of a migration are one copy too many.
	const isLegacyShape = (obj) => !!(obj.customGestures || obj.gestures) && !obj.mouseGestures;

	function migrateLegacy(obj) {
		if (!isLegacyShape(obj)) return obj;
		const { DEFAULT_GESTURES } = root.GestureConstants;
		const merged = { ...(obj.gestures || DEFAULT_GESTURES), ...(obj.customGestures || {}) };
		const urls = obj.customGestureUrls || {};
		const mouseGestures = {};
		for (const [pattern, action] of Object.entries(merged)) {
			if (action === null) continue;
			mouseGestures[pattern] = urls[pattern] ? { action, customUrl: urls[pattern] } : { action };
		}
		const out = { ...obj, mouseGestures };
		delete out.gestures;
		delete out.customGestures;
		delete out.customGestureUrls;
		return out;
	}

	const fail = (error) => ({ ok: false, error, legacy: false, settings: null, dropped: [], retyped: [], exportObj: null, json: '' });

	// `opts.json === false` leaves the preview text out: the hash path needs the
	// object only, and the indented text is the most expensive thing made here.
	function validate(input, opts) {
		let raw = input;
		if (typeof input === 'string') {
			if (new TextEncoder().encode(input).length > MAX_BYTES) return fail('too-large');
			try { raw = JSON.parse(input); } catch { return fail('not-json'); }
		}
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('not-object');

		// Before anything is copied, spread or merged. A tree too deep to be
		// settings is answered like a file that holds none.
		const bad = scanTree(raw);
		if (bad === 'forbidden-key') return fail('forbidden-key');
		if (bad) return fail('not-settings');

		const hasFormat = Object.prototype.hasOwnProperty.call(raw, FORMAT_FIELD);
		if (hasFormat && raw[FORMAT_FIELD] !== FORMAT_VERSION) return fail('unknown-format');

		// A missing format field is not "legacy" by itself: the export of every
		// version before this one is {...settings, _version} and nothing in it is
		// converted. `legacy` is what the preview turns into "converted as it is
		// written", so it is true exactly when a conversion happens.
		const legacy = !hasFormat && isLegacyShape(raw);
		const source = legacy ? migrateLegacy(raw) : raw;
		const forSync = !!(opts && opts.forSync);
		const allowed = new Set(allowedKeys({ forSync }));
		const settings = structuredClone(defaults());
		// The seven from the local copy, when a sync state is applied. A device that
		// never chose stays on the defaults; one that did keeps its choice. Only a
		// local value of the right shape is taken - storage can hold anything.
		if (forSync) {
			const local = (opts.local && typeof opts.local === 'object') ? opts.local : {};
			for (const k of DEVICE_LOCAL) {
				if (k in local && sameShape(local[k], defaults()[k])) settings[k] = structuredClone(local[k]);
			}
		}
		const dropped = [];
		const retyped = [];
		let kept = 0;

		for (const [key, value] of Object.entries(source)) {
			if (key === FORMAT_FIELD || key === '_version') continue;
			// Skipped in silence, not reported: `dropped` is what the preview calls
			// "unknown to Gestura", and these three are keys Gestura defines itself.
			// Every older export carries lastSyncTime, so reporting it would put a
			// warning about nothing on every legitimate file.
			if (NEVER.has(key)) continue;
			// A sync payload from a client that still carried them: skipped in
			// silence, like NEVER - Gestura knows these keys, it just does not take
			// them from a sync state.
			if (forSync && DEVICE_LOCAL.has(key)) continue;
			if (!allowed.has(key)) { dropped.push(key); continue; }
			if (!sameShape(value, defaults()[key])) { retyped.push(key); continue; }
			if (RECORD_KEYS.has(key)) {
				const fixed = conformRecord(value, defaults()[key]);
				settings[key] = fixed.value;
				// Named as `searchEngines.custom`, so the preview says which part was
				// reset rather than pointing at the whole branch.
				for (const child of fixed.repaired) retyped.push(`${key}.${child}`);
			} else {
				settings[key] = value;
			}
			kept++;
		}

		// A file that contributed nothing is not a settings file - it is a JSON
		// document that happened to parse. Saying so beats writing the defaults
		// over the user's settings and calling it an import.
		if (!kept) return fail('not-settings');

		// One object, handed out as well as stringified: what a caller writes,
		// uploads or hashes is provably what its preview showed.
		const exportObj = buildExport(settings, raw._version, { forSync });
		return {
			ok: true,
			error: null,
			legacy,
			settings,
			dropped,
			retyped,
			exportObj,
			json: (opts && opts.json === false) ? '' : JSON.stringify(exportObj, null, 2),
		};
	}

	// The exit door. What leaves this browser - the file export, the sync
	// upload - is validated like what enters it: the receiving side repairs a
	// malformed container and warns, so the sending side has to show the same
	// repair, or "exactly what will be transferred" is not what arrives.
	function validatedExport(settings, extVersion, opts) {
		return validate(buildExport(settings, extVersion, opts), opts);
	}

	// What the "changed since last upload" hint compares. The extension version is
	// excluded deliberately - updating Gestura is not a change to the settings -
	// and so are the device-local keys, or a theme change would offer an upload
	// that carries nothing. Idempotent on an object that already lacks them.
	async function hashOf(exportObj) {
		const EU = root.FlowMouseEuIntegration;
		const copy = { ...exportObj };
		delete copy._version;
		for (const k of DEVICE_LOCAL) delete copy[k];
		return EU.hash64(EU.canonicalize(copy));
	}

	const api = {
		FORMAT_FIELD, FORMAT_VERSION, MAX_BYTES, MAX_DEPTH, FORBIDDEN, NEVER, RECORD_KEYS, DEVICE_LOCAL,
		allowedKeys, buildExport, exportText, validatedExport, validate, hashOf, migrateLegacy, conformRecord,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSettingsSchema = api;
})(typeof self !== 'undefined' ? self : globalThis);
