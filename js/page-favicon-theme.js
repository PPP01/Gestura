// Swaps the extension-page favicon between the light (teal hand) and dark
// (white hand) variant so it reads well on both light and dark tab strips /
// pinned tabs. Uses JS instead of <link media="(prefers-color-scheme)"> because
// Chrome's media-conditioned favicon switching has known bugs. Runs on every
// extension page that includes it; updates live when the browser theme changes.
(function () {
	'use strict';

	const LIGHT = 'icons/icon48.png';      // teal hand — reads on light tab strips
	const DARK = 'icons/icon48-dark.png';  // white hand — reads on dark tab strips

	function apply(isDark) {
		const href = chrome.runtime.getURL(isDark ? DARK : LIGHT);
		let link = document.querySelector('link[rel~="icon"]');
		if (!link) {
			link = document.createElement('link');
			link.rel = 'icon';
			(document.head || document.documentElement).appendChild(link);
		}
		link.href = href;
	}

	const mq = window.matchMedia('(prefers-color-scheme: dark)');
	apply(mq.matches);
	mq.addEventListener('change', (e) => apply(e.matches));
})();
