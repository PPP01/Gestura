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
	const MAX_BYTES = 512 * 1024;

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

	const defaults = () => root.GestureConstants.DEFAULT_SETTINGS;

	function allowedKeys() {
		return Object.keys(defaults()).filter(k => !NEVER.has(k));
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

	function hasForbiddenKey(value) {
		if (!value || typeof value !== 'object') return false;
		if (Array.isArray(value)) return value.some(hasForbiddenKey);
		for (const key of Object.keys(value)) {
			if (FORBIDDEN.has(key)) return true;
			if (hasForbiddenKey(value[key])) return true;
		}
		return false;
	}

	function buildExport(settings, extVersion) {
		const out = { [FORMAT_FIELD]: FORMAT_VERSION, _version: extVersion || '' };
		for (const key of allowedKeys()) {
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
	function migrateLegacy(obj) {
		if (!(obj.customGestures || obj.gestures) || obj.mouseGestures) return obj;
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

	const fail = (error) => ({ ok: false, error, legacy: false, settings: null, dropped: [], retyped: [], json: '' });

	function validate(input) {
		let raw = input;
		if (typeof input === 'string') {
			if (new TextEncoder().encode(input).length > MAX_BYTES) return fail('too-large');
			try { raw = JSON.parse(input); } catch { return fail('not-json'); }
		}
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('not-object');

		// Before anything is copied, spread or merged.
		if (hasForbiddenKey(raw)) return fail('forbidden-key');

		const legacy = !Object.prototype.hasOwnProperty.call(raw, FORMAT_FIELD);
		if (!legacy && raw[FORMAT_FIELD] !== FORMAT_VERSION) return fail('unknown-format');

		const source = legacy ? migrateLegacy(raw) : raw;
		const allowed = new Set(allowedKeys());
		const settings = structuredClone(defaults());
		const dropped = [];
		const retyped = [];
		let kept = 0;

		for (const [key, value] of Object.entries(source)) {
			if (key === FORMAT_FIELD || key === '_version') continue;
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

		return {
			ok: true,
			error: null,
			legacy,
			settings,
			dropped,
			retyped,
			json: JSON.stringify(buildExport(settings, raw._version), null, 2),
		};
	}

	// What the "changed since last upload" hint compares. The extension version
	// is excluded deliberately: updating Gestura is not a change to the settings,
	// and including it would make the hint appear for everybody after every
	// update.
	async function hashOf(exportObj) {
		const EU = root.FlowMouseEuIntegration;
		const copy = { ...exportObj };
		delete copy._version;
		return EU.hash64(EU.canonicalize(copy));
	}

	const api = {
		FORMAT_FIELD, FORMAT_VERSION, MAX_BYTES, FORBIDDEN, NEVER, RECORD_KEYS,
		allowedKeys, buildExport, exportText, validate, hashOf, migrateLegacy, conformRecord,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.GesturaSettingsSchema = api;
})(typeof self !== 'undefined' ? self : globalThis);
