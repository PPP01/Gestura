import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Lit components need a browser to run, so no other test loads them - and a
// syntax error in one (a parameter redeclared by a const, say) passes the whole
// suite and takes the options page down at load. Parsing each is cheap and is the
// one thing that can be checked here: `node --check` on the source as a module.
const jsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
const files = readdirSync(join(jsDir, 'components')).filter(f => f.endsWith('.js'))
	.map(f => join('components', f));

describe('component modules parse', () => {
	for (const rel of files) {
		it(rel.split(sep).join('/'), () => {
			const source = readFileSync(join(jsDir, rel), 'utf8');
			let error = '';
			try {
				execFileSync(process.execPath, ['--input-type=module', '--check'], { input: source, stdio: ['pipe', 'pipe', 'pipe'] });
			} catch (e) {
				error = String(e.stderr || e.message).split('\n').slice(0, 6).join('\n');
			}
			expect(error).toBe('');
		});
	}
});
