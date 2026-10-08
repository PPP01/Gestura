import { canonicalText } from './text-diff.js';

// What differs between two settings objects, in terms a person recognises:
// "gesture ↓→ was changed", "menu Wikipedia was added". Pure - the names come
// from the caller (`labels`), because they live in i18n and the registries.
//
// Works on whatever the preview shows: sync-shaped export objects, so the
// device-local keys are not there to begin with. The export envelope is skipped.
//
// Result: [{ area, items: [{ kind: 'added'|'removed'|'changed', name, from?, to? }] }],
// areas in the fixed order below, empty ones left out.
//
// labels = {
//   gesture(group, key, entry)  the display name of a gesture or drag entry
//   menu(id)                    the name of a built-in website menu
//   engine(id)                  the name of a built-in search engine
//   option(path)                the label of a setting, e.g. 'trailWidth'
// }

const ENVELOPE = new Set(['gesturaSettings', '_version']);
const GESTURE_RECORDS = ['mouseGestures', 'wheelGestures', 'specialGestures'];
const GESTURE_LISTS = { textDragGestures: 'direction', linkDragGestures: 'direction', imageDragGestures: 'direction' };
const MENU_OPTIONS = ['menuAppend', 'customMenuSwitcher', 'customMenuTheme', 'menuOpenBehavior'];
const SHOWN_VALUE_MAX = 60;

const same = (a, b) => canonicalText(a) === canonicalText(b);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sortedUnion = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
const obj = (v) => (isPlain(v) ? v : {});

// Long values (custom CSS, a pasted URL) would bury the line they belong to.
function shown(v) {
	const s = typeof v === 'string' ? v : JSON.stringify(v);
	return s.length > SHOWN_VALUE_MAX ? `${s.slice(0, SHOWN_VALUE_MAX - 1)}…` : String(s);
}

// Entries of an object keyed by identity.
function recordItems(before, after, nameOf) {
	const items = [];
	for (const key of sortedUnion(before, after)) {
		const inB = Object.hasOwn(before, key);
		const inA = Object.hasOwn(after, key);
		if (inB && inA) {
			if (!same(before[key], after[key])) items.push({ kind: 'changed', name: nameOf(key, after[key]) });
		} else {
			items.push({ kind: inA ? 'added' : 'removed', name: nameOf(key, inA ? after[key] : before[key]) });
		}
	}
	return items;
}

// An array of entries, each carrying its own identity in `field`.
function listItems(before, after, field, nameOf) {
	const index = (list) => Object.fromEntries((Array.isArray(list) ? list : []).filter(e => e && e[field] !== undefined).map(e => [e[field], e]));
	return recordItems(index(before), index(after), nameOf);
}

// A setting that changed, without saying how: for parts whose value is a list or
// a record that would not fit on a line.
const optionChanged = (labels, path) => ({ kind: 'changed', name: labels.option(path) });

// Everything else, depth first: a plain value shows old and new, a container is
// looked into, an array of primitives is a set and lists its elements.
function flatItems(path, before, after, labels) {
	if (same(before, after)) return [];
	if (isPlain(before) && isPlain(after)) {
		return sortedUnion(before, after).flatMap(k => flatItems(`${path}.${k}`, before[k], after[k], labels));
	}
	const isSet = (v) => Array.isArray(v) && v.every(e => e === null || typeof e !== 'object');
	if (isSet(before ?? []) && isSet(after ?? []) && (Array.isArray(before) || Array.isArray(after))) {
		const b = new Set(before || []);
		const a = new Set(after || []);
		return [...new Set([...b, ...a])].map(String).sort()
			.filter(e => b.has(e) !== a.has(e))
			.map(e => ({ kind: a.has(e) ? 'added' : 'removed', name: `${labels.option(path)}: ${e}` }));
	}
	const primitive = (v) => v === undefined || v === null || typeof v !== 'object';
	const item = { kind: 'changed', name: labels.option(path) };
	if (primitive(before) && primitive(after)) { item.from = shown(before ?? null); item.to = shown(after ?? null); }
	return [item];
}

export function describeChanges(before, after, labels) {
	const b = obj(before);
	const a = obj(after);
	const keys = sortedUnion(b, a).filter(k => !ENVELOPE.has(k));
	const areas = { gestures: [], menus: [], engines: [], settings: [] };

	for (const key of keys) {
		if (same(b[key], a[key])) continue;
		if (GESTURE_RECORDS.includes(key)) {
			areas.gestures.push(...recordItems(obj(b[key]), obj(a[key]), (k, e) => labels.gesture(key, k, e)));
		} else if (key in GESTURE_LISTS) {
			areas.gestures.push(...listItems(b[key], a[key], GESTURE_LISTS[key], (k, e) => labels.gesture(key, k, e)));
		} else if (key === 'actionChains') {
			areas.gestures.push(...recordItems(obj(b[key]), obj(a[key]), (id, e) => (e && e.name) || id));
		} else if (key === 'siteMenus') {
			const sb = obj(b[key]);
			const sa = obj(a[key]);
			areas.menus.push(...recordItems(obj(sb.custom), obj(sa.custom), (id, e) => (e && e.name) || id));
			areas.menus.push(...recordItems(obj(sb.edited), obj(sa.edited), id => labels.menu(id)));
			for (const k of sortedUnion(sb, sa)) {
				if (k !== 'custom' && k !== 'edited' && !same(sb[k], sa[k])) areas.menus.push(optionChanged(labels, `siteMenus.${k}`));
			}
		} else if (MENU_OPTIONS.includes(key)) {
			areas.menus.push(...flatItems(key, b[key], a[key], labels));
		} else if (key === 'searchEngines') {
			const eb = obj(b[key]);
			const ea = obj(a[key]);
			areas.engines.push(...listItems(eb.custom, ea.custom, 'id', (id, e) => (e && e.name) || id));
			areas.engines.push(...recordItems(obj(eb.overrides), obj(ea.overrides), id => labels.engine(id)));
			for (const k of sortedUnion(eb, ea)) {
				if (k !== 'custom' && k !== 'overrides' && !same(eb[k], ea[k])) areas.engines.push(optionChanged(labels, `searchEngines.${k}`));
			}
		} else {
			areas.settings.push(...flatItems(key, b[key], a[key], labels));
		}
	}
	return Object.entries(areas).filter(([, items]) => items.length).map(([area, items]) => ({ area, items }));
}
