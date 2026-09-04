// An in-memory chrome.storage with the two areas the façade selects between.
// `get` accepts the four key shapes chrome accepts (null, string, array, object
// of defaults); every write dispatches onChanged with its namespace, synchronously,
// which is how the façade's area cache is exercised without a browser.
//
// Three ONE-SHOT hooks, each cleared the moment it fires:
// - `hooks.onSet(name, obj)` runs inside the next set(), after the write and before
//   its onChanged: the switchTo() race test lands a write in storage.sync while
//   the first copy is in flight.
// - `hooks.beforeGetReturns()` runs inside the next get(), AFTER the snapshot is
//   taken and BEFORE it is returned: the load() race test lets a newer write land
//   while a read is still in flight.
// - `hooks.failNext = { area, op, after }` makes the (after+1)-th matching get(),
//   set() or remove() throw before it changes anything (get: before it reads
//   anything): the fault-injection tests of switchTo() fail one write at a time,
//   and settings-storage's own pre-check read can be failed the same way.
export function fakeChromeStorage() {
	const areas = { sync: new Map(), local: new Map() };
	const listeners = new Set();
	const hooks = { onSet: null, beforeGetReturns: null, failNext: null };
	const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

	function emit(changes, name) {
		for (const fn of [...listeners]) fn(changes, name);
	}

	function maybeFail(name, op) {
		const f = hooks.failNext;
		if (!f || f.area !== name || f.op !== op) return;
		if (f.after > 0) { f.after--; return; }
		hooks.failNext = null;
		throw new Error(`injected failure: ${name}.${op}`);
	}

	function makeArea(name) {
		const m = areas[name];
		return {
			QUOTA_BYTES_PER_ITEM: 8192,
			QUOTA_BYTES: 102400,
			async get(keys) {
				maybeFail(name, 'get');
				const out = {};
				if (keys === null || keys === undefined) {
					for (const [k, v] of m) out[k] = clone(v);
				} else {
					if (typeof keys === 'string') keys = [keys];
					if (Array.isArray(keys)) {
						for (const k of keys) if (m.has(k)) out[k] = clone(m.get(k));
					} else {
						for (const [k, def] of Object.entries(keys)) out[k] = m.has(k) ? clone(m.get(k)) : clone(def);
					}
				}
				if (hooks.beforeGetReturns) {
					const hook = hooks.beforeGetReturns;
					hooks.beforeGetReturns = null;
					await hook();
				}
				return out;
			},
			async set(obj) {
				maybeFail(name, 'set');
				const changes = {};
				for (const [k, v] of Object.entries(obj)) {
					changes[k] = { oldValue: clone(m.get(k)), newValue: clone(v) };
					m.set(k, clone(v));
				}
				if (hooks.onSet) {
					const hook = hooks.onSet;
					hooks.onSet = null;
					await hook(name, obj);
				}
				emit(changes, name);
			},
			async remove(keys) {
				maybeFail(name, 'remove');
				const changes = {};
				for (const k of (Array.isArray(keys) ? keys : [keys])) {
					if (!m.has(k)) continue;
					changes[k] = { oldValue: clone(m.get(k)) };
					m.delete(k);
				}
				if (Object.keys(changes).length) emit(changes, name);
			},
			async clear() {
				const changes = {};
				for (const [k, v] of m) changes[k] = { oldValue: clone(v) };
				m.clear();
				emit(changes, name);
			},
		};
	}

	const chrome = {
		storage: {
			sync: makeArea('sync'),
			local: makeArea('local'),
			onChanged: {
				addListener: (fn) => listeners.add(fn),
				removeListener: (fn) => listeners.delete(fn),
			},
		},
		runtime: { lastError: null },
	};

	return {
		chrome,
		hooks,
		emit,
		// Raw access for assertions: what is REALLY in an area, unfiltered.
		raw: (name) => Object.fromEntries(areas[name]),
		// Empties both areas WITHOUT dispatching and drops any armed hook - a test
		// fixture, not a user action.
		clear: () => {
			areas.sync.clear();
			areas.local.clear();
			hooks.onSet = null;
			hooks.beforeGetReturns = null;
			hooks.failNext = null;
		},
		listenerCount: () => listeners.size,
	};
}
