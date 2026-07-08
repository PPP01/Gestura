// ff:release — bump the version, then sign + submit the Firefox build to AMO.
//
// Credentials: reads WEB_EXT_API_KEY (JWT issuer) and WEB_EXT_API_SECRET from the
// environment. If either is missing, it prompts for it interactively (paste when
// asked; the secret is not echoed). Credentials are passed to web-ext only via the
// environment — never on the command line — so they don't land in shell history.
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

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

run('npm run ff:bump');
run('npm run ff:sign');
