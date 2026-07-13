(function (root) {
	function buildSwitcherMenus(customMenus, currentId, fallbackName = '') {
		return Object.entries(customMenus || {})
			.filter(([id, m]) => id !== currentId && (!m || m.showInSwitcher !== false))
			.map(([id, m]) => ({ id, name: (m && m.name) ? m.name : fallbackName }));
	}
	const api = { buildSwitcherMenus };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseMenuSwitcher = api;
})(typeof self !== 'undefined' ? self : globalThis);
