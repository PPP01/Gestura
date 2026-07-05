// Bump the manifest.json version for a new Firefox fork release.
// AMO refuses to re-sign an already-signed version, so bump before every sign.
// Preserves file formatting by rewriting only the version string.
//   - 2-part upstream version (e.g. "2.2") starts a fork patch series -> "2.2.1"
//   - otherwise the last segment is incremented          "2.2.1" -> "2.2.2"
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../manifest.json', import.meta.url);
const text = readFileSync(file, 'utf8');
const match = text.match(/"version":\s*"([^"]+)"/);
if (!match) {
	console.error('bump-manifest: "version" not found in manifest.json');
	process.exit(1);
}

const parts = match[1].split('.').map((n) => parseInt(n, 10) || 0);
if (parts.length < 3) {
	while (parts.length < 3) parts.push(0);
	parts[2] += 1;
} else {
	parts[parts.length - 1] += 1;
}
const next = parts.join('.');

writeFileSync(file, text.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`));
console.log(`manifest version: ${match[1]} -> ${next}`);
