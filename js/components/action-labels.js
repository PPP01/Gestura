import { getChainLabel } from './chain-panel.js';
import { getGestureMenuLabel } from './gesture-menu-config.js';
import { settingsStore } from '../settings-store.js';

// Wie ein Eintrag heißt, an einer Stelle. Die Regel gilt für die Zeile im
// Menü-Editor, den Dialogkopf und den Auslöser der Aktionsauswahl gleichermaßen
// — solange sie an drei Stellen stand, zeigten dieselbe Zeile und ihr Dialog
// verschiedene Namen. Content-Skripte haben ihre eigene Fassung in content.js,
// weil sie keine ES-Module laden können.

// Die reine Aktionsbezeichnung, ohne Rücksicht auf den Eintrag.
export function actionName(action) {
	return window.i18n.getMessage(window.GestureConstants.ACTION_KEYS[action]) || action;
}

// Der Name, den ein Eintrag ohne eigenen `customName` trägt.
export function fallbackName(action, cfg) {
	if (cfg?.labelKey) {
		const m = window.i18n.getMessage(cfg.labelKey);
		if (m) return m;
	}
	if (action === 'actionChain') return getChainLabel(cfg?.chainId);
	if (action === 'customMenu' || action === 'siteMenu') return getGestureMenuLabel(cfg, action);
	if (action === 'addSiteToMenu') return siteMenuName(cfg?.menuId) || window.i18n.getMessage('actionAddSiteToMenu');
	if (action === 'searchLink') {
		const name = window.FlowMouseEngineRegistry.resolveMenuItemLink(
			window.FlowMouseEngineCatalogApi.ENGINE_CATALOG,
			settingsStore.current.searchEngines,
			cfg,
		)?.name;
		if (name) return name;
	}
	return actionName(action);
}

export function displayName(action, cfg) {
	return cfg?.customName || fallbackName(action, cfg);
}

// Ein Name in Domainform, der eine andere Domain nennt als das Ziel, ist einen
// Hinweis wert — mehr nicht: erlaubt bleibt er. Zeile und Aktionsauswahl fragen
// hier, damit der Rahmen der Zeile und das Symbol darin nicht auseinanderlaufen.
export function domainMismatch(action, cfg, name = displayName(action, cfg)) {
	if (action !== 'openCustomUrl') return null;
	return window.FlowMouseMenuPatterns.nameUrlMismatch(name, cfg?.customUrl || '');
}

// Der Name des Menüs, dem `addSiteToMenu` die Seite hinzufügt.
export function siteMenuName(menuId) {
	if (!menuId) return null;
	const base = window.FlowMouseMenuModel.getBaseMenu(
		window.FlowMouseMenuCatalog.SITE_MENU_CATALOG, settingsStore.current.siteMenus, menuId);
	if (!base) return null;
	return base.name || (base.nameKey && window.i18n.getMessage(base.nameKey)) || null;
}
