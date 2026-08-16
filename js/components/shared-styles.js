import { css, unsafeCSS } from '../../js/lib/lit-all.min.js';

function getStylesheetText(href) {
	try {
		for (const sheet of document.styleSheets) {
			if (sheet.href && sheet.href.endsWith(href)) {
				return [...sheet.cssRules].map(r => r.cssText).join('\n');
			}
		}
	} catch (e) {
	}
	return '';
}

export const commonStyles = css`
	${unsafeCSS(getStylesheetText('common.css'))}
`;

export const optionStyles = css`
	${unsafeCSS(getStylesheetText('option.css'))}
`;

// Segmented tab bar used to split a manager component into top-level views
// (engine-manager: Text/Bild, site-menu-manager: Menüs/Einstellungen).
export const tabStyles = css`
	.type-switch {
		display: flex;
		gap: 4px;
		padding: 3px;
		border-radius: 8px;
		background: var(--bg-tertiary);
	}

	.type-tab {
		border: none;
		background: transparent;
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 500;
		padding: 5px 12px;
		border-radius: 6px;
		cursor: pointer;
		transition: background-color 0.15s ease, color 0.15s ease;
	}

	.type-tab:hover {
		color: var(--text-primary);
	}

	.type-tab.active {
		background: var(--card-bg);
		color: var(--accent-color);
		box-shadow: 0 0 0 0.75px var(--border-color);
	}
`;