const { DEFAULT_SETTINGS } = window.GestureConstants;
const Storage = window.GesturaSettingsStorage;

// 10.4: storage can hold anything. `p in storedMG` throws for a string or a
// number - inside the load promise, which then never resolves. A non-object is
// "nothing stored", which is what the normalisation already does with {}.
export function reorderMouseGestures(storedMG) {
	if (!storedMG || typeof storedMG !== 'object' || Array.isArray(storedMG)) return {};
	const defaultOrder = Object.keys(DEFAULT_SETTINGS.mouseGestures || {});
	const ordered = {};
	for (const p of defaultOrder) {
		if (p in storedMG) ordered[p] = storedMG[p];
	}
	for (const p of Object.keys(storedMG)) {
		if (!(p in ordered)) ordered[p] = storedMG[p];
	}
	return ordered;
}

export function normalizeSetting(key, value) {
	if (key === 'mouseGestures' && value) {
		return reorderMouseGestures(value);
	}
	if (key === 'wheelGestures' && value) {
		return {
			...structuredClone(DEFAULT_SETTINGS.wheelGestures || {}),
			...value,
		};
	}
	if (key === 'specialGestures' && value) {
		return {
			...structuredClone(DEFAULT_SETTINGS.specialGestures || {}),
			...value,
		};
	}
	// Gespeicherte siteMenus aus aelteren Staenden kennen neue Felder
	// (flags, defaultMenuId) nicht - Defaults untermischen.
	if (key === 'siteMenus' && value) {
		return {
			...structuredClone(DEFAULT_SETTINGS.siteMenus || {}),
			...value,
		};
	}
	return value;
}

function deepEqual(obj1, obj2) {
	if (obj1 === obj2) return true;
	if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
		return false;
	}
	if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;
	const keys1 = Object.keys(obj1);
	const keys2 = Object.keys(obj2);
	if (keys1.length !== keys2.length) return false;
	for (const key of keys1) {
		if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) {
			return false;
		}
	}
	return true;
}

// The shape test of js/eu-settings-schema.js, copied for the same reason the
// façade copies the byte formula: this module runs in the popup, where the
// schema is not loaded. Object vs array vs primitive type, against the default.
function sameShape(value, def) {
	if (Array.isArray(def)) return Array.isArray(value);
	if (def === null) return true;
	if (typeof def === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
	return typeof value === typeof def;
}

// The typed refusal the façade returns when a write would not fit. The options
// page turns it into the dialog with the three ways out; every other caller
// skips its own generic message when this is true, so the user sees one answer.
export function isStorageFull(res) {
	return !!res && (res.error === 'branch-full' || res.error === 'total-full');
}

function emit(name, detail) {
	if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
	window.dispatchEvent(new CustomEvent(name, { detail }));
}

class SettingsStore {
	#current = structuredClone(DEFAULT_SETTINGS);
	#listeners = [];
	#listening = false;
	#resetting = false;
	#loaded = false;
	#loadPromise = null;

	constructor() {
		this.#loadPromise = this.#load();
	}

	get current() { this.#assertLoaded(); return this.#current; }

	async waitForLoad() {
		return await this.#loadPromise;
	}

	#assertLoaded() {
		if (!this.#loaded) throw new Error('SettingsStore not initialized');
	}

	async #load() {
		if (!this.#listening) {
			Storage.onChanged((changes) => this.handleExternalChange(changes));
			this.#listening = true;
		}
		const items = await Storage.get(DEFAULT_SETTINGS);
		this.#current = structuredClone(DEFAULT_SETTINGS);
		for (const [key, value] of Object.entries(items)) {
			// 10.1, on load: a stored value whose shape the reader does not
			// recognise leaves the default standing rather than being spread into
			// it. Nothing is written back - the value stays in storage for a
			// reader that does recognise it.
			if (sameShape(value, DEFAULT_SETTINGS[key])) this.#current[key] = value;
		}
		for (const key of ['mouseGestures', 'wheelGestures', 'specialGestures', 'siteMenus']) {
			this.#current[key] = normalizeSetting(key, this.#current[key]);
		}
		this.#loaded = true;
		return this.#current;
	}

	async save(patch = {}) {
		this.#assertLoaded();
		const now = new Date().toISOString();
		// Snapshot what a failed write would otherwise leave mutated: patched keys
		// plus lastSyncTime, which every save touches. A refused or failed write
		// must be a no-op on #current, or a retried save (e.g. after re-editing a
		// selection) sees data from the failed attempt as if it had already landed.
		const previous = {};
		for (const key of Object.keys(patch)) previous[key] = this.#current[key];
		previous.lastSyncTime = this.#current.lastSyncTime;
		Object.assign(this.#current, patch, { lastSyncTime: now });

		const res = await Storage.set(this.#current);
		if (res.ok) {
			// onChange() fires for EXTERNAL changes only - by design, so a component
			// does not react to its own write. The sync panel needs the other half:
			// its "changed since last upload" hint has to notice a save made on this
			// very page. A window event carries that without changing what onChange
			// means to its existing listeners.
			emit('gestura:settings-saved');
			return res;
		}
		if (res.error === 'write') console.error('Settings save failed:', res);
		for (const key of Object.keys(previous)) this.#current[key] = previous[key];
		if (isStorageFull(res)) emit('gestura:storage-full', res);
		return res;
	}

	// The defaults written as VALUES, not a clear(): a clear would take
	// euIntegration, euSync, settingsArea and faviconCache with it in state
	// 'local', and in state 'sync' a removed key is what makes another browser
	// fall back to its defaults (10.1) - which is exactly the propagation a reset
	// wants, and which writing the values achieves through what is there rather
	// than through what is missing. This is the upstream v2.3.1 behaviour.
	async reset() {
		this.#assertLoaded();
		this.#resetting = true;
		try {
			const res = await Storage.set(structuredClone(DEFAULT_SETTINGS));
			if (res.ok) this.#current = structuredClone(DEFAULT_SETTINGS);
			return res;
		} finally {
			this.#resetting = false;
		}
	}

	handleExternalChange(changes) {
		if (!this.#loaded || this.#resetting) return { changed: {}, hasChange: false };
		let changed = {};
		let hasChange = false;

		for (const [key, storageChange] of Object.entries(changes)) {
			// 10.1: absence is not "default". A key missing from an external change,
			// or a value whose shape this reader does not recognise, leaves the
			// local copy standing. Reset propagates by writing the defaults as
			// values, so nothing legitimate is lost here - and a future change of
			// what storage.sync holds cannot wipe an older Gestura's settings.
			const newValue = storageChange.newValue;
			if (newValue === undefined || !(key in DEFAULT_SETTINGS) || !sameShape(newValue, DEFAULT_SETTINGS[key])) continue;

			const normalized = normalizeSetting(key, newValue);
			if (!deepEqual(this.#current[key], normalized)) {
				this.#current[key] = normalized;
				changed[key] = normalized;
				hasChange = true;
			}
		}

		if (hasChange) this.#notifyExternal(changed);
		return { changed, hasChange };
	}

	onChange(fn) {
		this.#listeners.push(fn);
		return () => {
			const i = this.#listeners.indexOf(fn);
			if (i >= 0) this.#listeners.splice(i, 1);
		};
	}

	#notifyExternal(changed) {
		this.#listeners.forEach(fn => fn(changed, this.#current));
	}
}

export const settingsStore = new SettingsStore();
