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
		'.gitignore',
		'*.zip', '*.xpi',
	],
	build: { overwriteDest: true },
	sign: { channel: 'listed' },
};
