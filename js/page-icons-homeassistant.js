(function (root) {
	// Home Assistant specifics for page-icons.js.
	//
	// Dashboards live at /<dashboard>/<view>, and the sidebar draws one entry,
	// /<dashboard>, for all of its views - so a view may borrow that icon. The
	// settings pages are different: every /config/<section> is its own page, and
	// the sidebar's /config entry is the settings gear, which would otherwise
	// be painted onto every settings link whose own icon is not on screen.
	const FlowMouseHomeAssistantIcons = {
		id: 'homeassistant',
		applies(rootNode) {
			return !!(rootNode && typeof rootNode.querySelector === 'function'
				&& rootNode.querySelector('home-assistant'));
		},
		allowPrefix(anchorPath) {
			return anchorPath !== '/' && anchorPath !== '/config';
		},
	};
	if (root.FlowMousePageIcons) root.FlowMousePageIcons.providers.push(FlowMouseHomeAssistantIcons);
	const api = FlowMouseHomeAssistantIcons;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	root.FlowMouseHomeAssistantIcons = api;
})(typeof self !== 'undefined' ? self : globalThis);
