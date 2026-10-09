// Every settings branch that can realistically grow past a quota, named the way
// the user sees it named elsewhere in the page. Three of them - the three the
// data section shows rows for - were mapped; the rest printed their internal
// identifier into a sentence, and `customCss` reaches this dialog for real: it
// is capped at 7500 CHARACTERS, which non-ASCII plus JSON escaping pushes past
// 8192 BYTES. Anything still unmapped gets an honest generic rather than a
// variable name.
const BRANCH_LABELS = {
	siteMenus: 'siteMenusTitle',
	searchEngines: 'sectionSearchEngines',
	mouseGestures: 'basicSettings',
	textDragGestures: 'textDragGestures',
	linkDragGestures: 'linkDragGestures',
	imageDragGestures: 'imageDragGestures',
	wheelGestures: 'wheelGestures',
	specialGestures: 'specialGestures',
	customCss: 'customCss',
	blacklist: 'blacklist',
};

export function branchLabel(i18n, key) {
	return i18n.getMessage(BRANCH_LABELS[key] || 'storageBranchOther');
}

// The tokens a refusal message supports, in one place: the dialog's title and
// the switch's refusal notice both fill the same three, from the same shape.
export function fillRefusal(i18n, key, res) {
	return i18n.getMessage(key)
		.replace('{branch}', branchLabel(i18n, res.branch))
		.replace('{used}', String(res.bytes))
		.replace('{total}', String(res.quota));
}
