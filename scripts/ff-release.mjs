// ff:release — sign the Firefox build at AMO, then attach the signed xpi to the
// GitHub release that already carries this version's Chrome package.
//
// One version means one release holding every browser's package, so this script
// does NOT bump: the version comes from `main` through the merge and has to stay
// put, or the xpi lands on a release that does not exist. Pass --bump only to
// escape a burnt number — AMO refuses a version it has already signed, and that
// costs the number on every browser, not just Firefox.
//
// The release has to exist before this runs: it is opened by release.yml when the
// `v<version>` tag is pushed from `main`. That is checked up front — signing is
// irreversible, so a missing tag must cost nothing.
//
// Credentials: reads WEB_EXT_API_KEY (JWT issuer) and WEB_EXT_API_SECRET from the
// environment. If either is missing, it prompts for it interactively (paste when
// asked; the secret is not echoed). Credentials are passed to web-ext only via the
// environment — never on the command line — so they don't land in shell history.
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync, readdirSync, statSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO = 'PPP01/Gestura';
const ARTIFACTS = 'web-ext-artifacts';

const manifestUrl = new URL('../manifest.json', import.meta.url);
const version = JSON.parse(readFileSync(manifestUrl, 'utf8')).version;
if (!version) {
	console.error('ff:release: no "version" in manifest.json');
	process.exit(1);
}

const args = process.argv.slice(2);
const bump = args.includes('--bump');

// --- Pre-flight: nothing here has touched AMO yet. ---
// Signing consumes the version number for good, so whatever can be known
// beforehand is checked beforehand. It sits ahead of the credential prompt on
// purpose: no reason to make someone paste a secret into a run that cannot end
// well.
function preflight(message, hint) {
	console.error(`ff:release: ${message}`);
	console.error('Nothing has been signed — fix this and run ff:release again.');
	console.error(`  ${hint}`);
	process.exit(1);
}

const ghMissing = spawnSync('gh --version', { shell: true, stdio: 'ignore' }).status !== 0;

if (bump) {
	// --bump leaves the shared version line, so by definition no release exists for
	// the number it picks. There is nothing to check for, only something to warn about.
	console.log(`ff:release: --bump — taking the next version instead of ${version} from main.`);
	console.log('ff:release: no release will exist for it; attach the xpi by hand afterwards.');
} else if (ghMissing) {
	preflight('the GitHub CLI (gh) is not available here, so the signed xpi could not be attached to the release.',
		'install gh — or, if that is what you want, sign alone with: npm run ff:sign');
} else if (spawnSync(`gh release view v${version} --repo ${REPO}`, { shell: true, stdio: 'ignore' }).status !== 0) {
	preflight(`there is no release v${version} to attach to — the tag has not been pushed from main.`,
		`git push gestura v${version}   # release.yml opens the release, then run ff:release again`);
} else {
	console.log(`ff:release: release v${version} is there — signing that version as it stands (use --bump to override).`);
}

// One readline interface for all prompts — creating a second one on stdin after
// closing the first would not receive further input.
let rl;
function ask(query, { hidden = false } = {}) {
	rl ??= createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		if (hidden) {
			process.stdout.write(query);
			rl._writeToOutput = () => { }; // suppress echo of the pasted secret
		}
		rl.question(hidden ? '' : query, (answer) => {
			if (hidden) {
				delete rl._writeToOutput; // restore default echo for any later prompt
				process.stdout.write('\n');
			}
			resolve(answer.trim());
		});
	});
}

let key = process.env.WEB_EXT_API_KEY;
let secret = process.env.WEB_EXT_API_SECRET;

if (!key) key = await ask('AMO API key (JWT issuer, z. B. user:12345:678): ');
if (!secret) secret = await ask('AMO API secret (wird nicht angezeigt): ', { hidden: true });
if (rl) rl.close();

if (!key || !secret) {
	console.error('ff:release: API key und secret sind erforderlich.');
	process.exit(1);
}

process.env.WEB_EXT_API_KEY = key;
process.env.WEB_EXT_API_SECRET = secret;

function run(command) {
	const result = spawnSync(command, { stdio: 'inherit', env: process.env, shell: true });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

if (bump) run('npm run ff:bump');

// Noted before signing so the xpi can be identified by age afterwards. Older
// downloads and builds live in the same directory — picking "the newest xpi"
// unconditionally would happily grab one of those.
const signStart = Date.now();
run('npm run ff:sign');

// --- Everything past this point runs AFTER a successful signature. ---
// Signing is the expensive, non-repeatable half: AMO has now consumed this
// version number. Whatever fails below is a failed *upload*, which is free to
// retry by hand — so it must never read as "the release failed", or someone will
// re-run ff:release and burn the next number too.

function fail(message, hint) {
	console.error('');
	console.error(`ff:release: ${message}`);
	console.error(`The xpi IS signed — do NOT re-run ff:release, that would burn version ${version}.`);
	console.error('Finish by hand:');
	console.error(`  ${hint}`);
	process.exit(1);
}

// web-ext names the signed file after the add-on, not after us. Take the xpi it
// just wrote — anything older than this run is a leftover — and give it the name
// the release convention expects.
const signed = existsSync(ARTIFACTS)
	? readdirSync(ARTIFACTS)
		.filter((f) => f.endsWith('.xpi'))
		.map((f) => ({ f, mtime: statSync(join(ARTIFACTS, f)).mtimeMs }))
		.filter((e) => e.mtime >= signStart)
		.sort((a, b) => b.mtime - a.mtime)[0]?.f
	: undefined;

if (!signed) {
	fail(`no freshly signed .xpi in ${ARTIFACTS}/ — web-ext reported success but wrote nothing.`,
		`gh release upload v${version} <path-to-xpi> --repo ${REPO} --clobber`);
}

const asset = `gestura-${version}-firefox.xpi`;
const assetPath = join(ARTIFACTS, asset);
if (signed !== asset) renameSync(join(ARTIFACTS, signed), assetPath);
console.log(`ff:release: signed package -> ${assetPath}`);

const uploadHint = `gh release upload v${version} ${assetPath} --repo ${REPO} --clobber`;

// Both were settled in the pre-flight for a normal run; they are still checked
// here because --bump skips that, and because the release could in principle have
// gone away while AMO was reviewing.
if (spawnSync('gh --version', { shell: true, stdio: 'ignore' }).status !== 0) {
	fail('the GitHub CLI (gh) is not available here.', uploadHint);
}

if (spawnSync(`gh release view v${version} --repo ${REPO}`, { shell: true, stdio: 'ignore' }).status !== 0) {
	fail(`there is no release v${version} to attach to — push the tag from main first.`,
		`git push gestura v${version}   # then: ${uploadHint}`);
}

if (spawnSync(uploadHint, { shell: true, stdio: 'inherit' }).status !== 0) {
	fail('uploading the xpi to the release failed.', uploadHint);
}

console.log('');
console.log(`ff:release: done — ${asset} is attached to release v${version}.`);
