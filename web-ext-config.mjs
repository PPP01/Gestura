// web-ext configuration for the Firefox fork build (firefox-build branch).
// Consumed by the ff:* npm scripts. Keeps dev/meta files out of the package
// so the built .xpi contains only the extension runtime.
export default {
	// Glob patterns (minimatch), relative to the source dir.
	ignoreFiles: [
		'tests', 'tests/**',
		'docs', 'docs/**',
		'scripts', 'scripts/**',
		'node_modules', 'node_modules/**',
		'web-ext-artifacts', 'web-ext-artifacts/**',
		'package.json', 'package-lock.json',
		'web-ext-config.mjs',
		'updates.json',
		'README.md', 'README.zh_CN.md',
		'CHANGELOG.md', 'CHANGELOG.zh_CN.md',
		'FORK-NOTES.md', 'THIRD_PARTY_LICENSES.md',
		'CLAUDE.md',
		// README/store screenshots, promo tiles and Lucide source SVGs. None are
		// referenced by the extension at runtime (UI icons are inlined in
		// js/icons.js; manifest icons live in icons/), so keep them out of the xpi.
		'assets', 'assets/**',
		// The JS-transform sandbox runs in a chrome.offscreen document, an API
		// Firefox lacks. These files are never loaded here and are the only source
		// of `new Function` in the package — dropping them removes the dead code
		// (and the AMO linter warning) entirely.
		'js/offscreen.js',
		'js/transform-runner.js',
		'js/transform-sandbox.js',
		'pages/offscreen.html',
		'pages/transform-sandbox.html',
		'.gitignore',
		'*.zip', '*.xpi',
	],
	build: { overwriteDest: true },
	// AMO requires a license (built-in SPDX slug) on every listed version. web-ext
	// only forwards it via --amo-metadata, whose JSON is merged into the version
	// object. scripts/amo-metadata.json pins GPL-3.0-only (AMO's built-in slug for
	// "GNU GPL v3.0"; it has no -or-later variant). The file is excluded from the xpi.
	sign: { channel: 'listed', amoMetadata: 'scripts/amo-metadata.json' },
};
