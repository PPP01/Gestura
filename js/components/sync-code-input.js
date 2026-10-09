// The code field's rules and the code's shapes, shared by the sync panel and
// the onboarding wizard - one strict validation, one masking, one file.
// No Lit import.

export const CODE_ERRORS = {
	prefix: 'euSyncCodeErrorPrefix',
	charset: 'euSyncCodeErrorCharset',
	length: 'euSyncCodeErrorLength',
	padding: 'euSyncCodeErrorPadding',
	checksum: 'euSyncCodeErrorChecksum',
};

// Valid only for a code that parses - prefix, alphabet, length, checksum. A
// wrong character or prefix is said at once; a checksum typo only once the code
// is complete. "Too short" is never said while typing: the grey button says it.
export async function checkDraft(value) {
	const parsed = await window.GesturaSyncCode.parse(value);
	if (parsed.secret) return { valid: true, error: '' };
	const early = parsed.error === 'charset' || (parsed.error === 'prefix' && value.trim().length >= 3);
	const say = early || parsed.error === 'padding' || parsed.error === 'checksum';
	return { valid: false, error: say ? CODE_ERRORS[parsed.error] : '' };
}

// The first two groups and the last stay readable - enough to tell two codes
// apart - the rest is dots, group for group, so the shape does not change.
export function maskCode(code) {
	const parts = code.split('-');
	if (parts.length <= 3) return code;
	return parts.map((p, i) => (i < 2 || i === parts.length - 1) ? p : '•'.repeat(p.length)).join('-');
}

// A blob and an <a download> - no downloads permission. The header line says
// what the file is, a year from now.
export function saveCodeFile(i18n, code) {
	const header = i18n.getMessage('euSyncSecretFileHeader').replace('{date}', new Date().toISOString().slice(0, 10));
	const blob = new Blob([header + '\n\n' + code + '\n'], { type: 'text/plain' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = 'gestura-sync-secret.txt';
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// The lock's sentence with "hier" set apart, so the panel can make it bold: a
// change removes the profiles HERE - with no way back without the old code
// (design §2: never promise a way back that does not exist).
export function lockText(i18n, n, key) {
	const msg = key ? i18n.getMessage(key)
		: n === 1 ? i18n.getMessage('euSyncCodeSwitchLockedOne')
		: i18n.getMessage('euSyncCodeSwitchLockedMany').replace('{n}', String(n));
	const [before, after = ''] = msg.split('{here}');
	return { before, here: i18n.getMessage('euSyncCodeSwitchHere'), after };
}
