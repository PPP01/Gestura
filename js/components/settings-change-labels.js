import { displayName } from './action-labels.js';
import { settingsStore } from '../settings-store.js';

// The names settings-changes.js asks for, from i18n and the registries. Kept apart
// from that module so it stays free of window globals and can be tested as it is;
// kept apart from the dialog so the dialog does not have to know about menus.
//
// Every lookup falls back to the plain key: a name that cannot be resolved (an id
// from a newer Gestura, a chain deleted meanwhile) is still a line the person can
// read, and a throw here would take the whole preview with it.
export function makeChangeLabels() {
	const attempt = (fn, fallback) => { try { return fn() || fallback; } catch { return fallback; } };
	return {
		gesture: (group, key, entry) => (entry && entry.action
			? `${key} → ${attempt(() => displayName(entry.action, entry), entry.action)}`
			: key),
		menu: (id) => attempt(() => {
			const base = window.FlowMouseMenuModel.getBaseMenu(
				window.FlowMouseMenuCatalog.SITE_MENU_CATALOG, settingsStore.current.siteMenus, id);
			return base && (base.name || (base.nameKey && window.i18n.getMessage(base.nameKey)));
		}, id),
		engine: (id) => attempt(() => window.FlowMouseEngineCatalogApi.getEngine(id).name, id),
		option: (path) => path,
	};
}
