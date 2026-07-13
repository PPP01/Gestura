import './lib/lit-config.js';
import { LitElement, html, css } from './lib/lit-all.min.js';

const CUSTOM_CSS_CACHE_KEY = 'fm:customCss';

class FmContextMenu extends LitElement {
	static shadowRootOptions = { ...LitElement.shadowRootOptions, mode: 'closed' };

	static properties = {
		_items: { state: true },
		_switcher: { state: true },
		_switcherOpen: { state: true },
		_customCss: { state: true },
		preview: { type: Boolean },
		previewItems: { attribute: false },
		previewCss: { attribute: false },
	};

	static styles = css`
		:host {
			display: block;
			user-select: none;
		}

		.fm-ctx-root {
			font-family: 'Segoe UI', sans-serif;
			font-size: 12.5px;
			line-height: 19px;
			color: #1d1d1f;
			display: flex;
			flex-direction: column;
			width: max-content;
			min-width: 160px;
			max-width: 340px;
		}
		.fm-ctx-root.loaded {
			width: auto;
			max-width: 343px;
		}
		.fm-ctx-list {
			list-style: none;
			margin: 0;
			padding: 4px 0;
		}
		.fm-ctx-body {
			position: relative;
		}
		.fm-ctx-root--footer .fm-ctx-body {
			display: flex;
			flex-direction: column;
			justify-content: flex-end;
		}

		.fm-ctx-item {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 4px 12px;
			min-height: 16px;
			cursor: default;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.fm-ctx-item:hover,
		.fm-ctx-item:focus-visible {
			background: rgba(0, 0, 0, 0.08);
		}

		.fm-ctx-icon {
			width: 16px;
			height: 16px;
			flex-shrink: 0;
			display: flex;
			align-items: center;
			justify-content: center;
		}

		.fm-ctx-icon img {
			width: 16px;
			height: 16px;
			object-fit: contain;
			border-radius: 3px;
		}

		.fm-ctx-label {
			flex: 1;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.fm-ctx-item--active .fm-ctx-label {
			font-weight: 600;
		}

		.fm-ctx-time {
			flex-shrink: 0;
			opacity: 0.45;
			font-size: 0.9em;
			padding-inline-start: 8px;
			text-autospace: normal;
		}

		.fm-ctx-sep {
			height: 1px;
			margin: 4px 10px;
			background: rgba(0, 0, 0, 0.1);
		}

		.fm-ctx-item--empty {
			margin-block: 1px;
			pointer-events: none;
			opacity: 0.35;
			justify-content: center;
		}

		.fm-ctx-bar {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 6px 12px;
			font-weight: 600;
			white-space: nowrap;
			background: rgba(41, 98, 255, 0.07);
		}
		.fm-ctx-root--header .fm-ctx-bar {
			border-bottom: 1px solid rgba(0, 0, 0, 0.06);
		}
		.fm-ctx-root--footer .fm-ctx-bar {
			border-top: 1px solid rgba(0, 0, 0, 0.06);
		}
		.fm-ctx-bar--switchable {
			cursor: default;
		}
		.fm-ctx-bar--switchable:hover,
		.fm-ctx-bar--switchable:focus-visible {
			background: rgba(41, 98, 255, 0.13);
		}
		.fm-ctx-bar-name {
			flex: 1;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.fm-ctx-bar-chevron {
			flex-shrink: 0;
			opacity: 0.55;
			font-size: 0.9em;
		}
		.fm-ctx-switcher {
			position: absolute;
			left: 0;
			min-width: 100%;
			width: max-content;
			max-width: 343px;
			margin: 0;
			padding: 4px 0;
			list-style: none;
			z-index: 2;
			background: #ffffff;
			box-shadow: 0 4px 16px rgba(0, 0, 0, 0.20);
			border-radius: 6px;
		}
		.fm-ctx-switcher--header { top: 0; }
		.fm-ctx-switcher--footer { bottom: 0; }
		.fm-ctx-switch-item {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 4px 12px;
			cursor: default;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.fm-ctx-switch-item:hover,
		.fm-ctx-switch-item:focus-visible {
			background: rgba(0, 0, 0, 0.08);
		}
		@media (prefers-color-scheme: dark) {
			.fm-ctx-root { color: #e5e5e7; }
			.fm-ctx-bar {
				background: rgba(120, 160, 255, 0.13);
			}
			.fm-ctx-root--header .fm-ctx-bar { border-bottom-color: rgba(255, 255, 255, 0.08); }
			.fm-ctx-root--footer .fm-ctx-bar { border-top-color: rgba(255, 255, 255, 0.08); }
			.fm-ctx-bar--switchable:hover,
			.fm-ctx-bar--switchable:focus-visible {
				background: rgba(120, 160, 255, 0.22);
			}
			.fm-ctx-switcher {
				background: #232326;
			}
			.fm-ctx-switch-item:hover,
			.fm-ctx-switch-item:focus-visible {
				background: rgba(255, 255, 255, 0.1);
			}
		}

		@media (prefers-color-scheme: dark) {
			.fm-ctx-item:hover,
			.fm-ctx-item:focus-visible {
				background: rgba(255, 255, 255, 0.1);
			}
			.fm-ctx-sep {
				background: rgba(255, 255, 255, 0.1);
			}
		}
	`;

	#menuId = null;
	#rtf = null;
	#dimensionsSent = false;
	#scrollToBottom = false;

	constructor() {
		super();
		this._items = null;
		this._switcher = null;
		this._switcherOpen = false;
		this.preview = false;
		this.previewItems = null;
		this.previewCss = '';
		this._customCss = this.#readCachedCustomCss();

		const params = new URLSearchParams(location.search);
		this.#menuId = params.get('id');
		const dir = params.get('dir') || 'ltr';
		const lang = params.get('lang') || '';
		this.#scrollToBottom = params.get('bottom') === '1';

		if (!this.hasAttribute('preview')) {
			document.documentElement.dir = dir;
			if (lang) document.documentElement.lang = lang;
		}

		try {
			this.#rtf = new Intl.RelativeTimeFormat(lang || undefined, { style: 'narrow', numeric: 'always' });
		} catch {
			this.#rtf = new Intl.RelativeTimeFormat(undefined, { style: 'narrow', numeric: 'always' });
		}
	}

	connectedCallback() {
		super.connectedCallback();
		if (this.preview) {
			this._items = Array.isArray(this.previewItems) ? this.previewItems : [];
			return;
		}
		window.addEventListener('contextmenu', this.#preventDefault, true);
		window.addEventListener('keydown', this.#onKeyDown, true);
		window.addEventListener('message', this.#onWindowMessage);
		this.#fetchItems();
		this.#loadCustomCss();
	}

	// Live item updates pushed straight from the content script (e.g. lazy
	// favicons). Security model: only accept messages from our creating parent
	// frame, and gate on the random menuId. The menuId is an unguessable
	// capability token the host page cannot obtain — the menu lives in a CLOSED
	// shadow root, so the iframe element/URL (which carries the id) is unreachable
	// from page script, and the id is otherwise only exchanged over chrome.runtime
	// and postMessage targeted at this window (never page-observable). Origin
	// validation is not usable here: the content script posts from the page's
	// window (page origin), and the iframe's origin is dynamic (use_dynamic_url).
	// Even a forged message could at most alter display: Lit escapes all output
	// and clicks run the content script's real items by index.
	#onWindowMessage = (e) => {
		if (e.source !== window.parent) return;
		const d = e.data;
		if (d && d.__gestura === 'ctxItems' && d.menuId === this.#menuId && Array.isArray(d.items)) {
			this._items = d.items;
			if ('switcher' in d) this._switcher = d.switcher ?? null;
		}
	};

	async #loadCustomCss() {
		try {
			const { customCss } = await chrome.storage.sync.get({ customCss: '' });
			const value = customCss || '';
			if (value !== this._customCss) {
				this._customCss = value;
				this.#writeCachedCustomCss(value);
			}
		} catch (e) {
			console.error('[FlowMouse] custom CSS load failed:', e);
		}
	}

	#readCachedCustomCss() {
		try {
			return localStorage.getItem(CUSTOM_CSS_CACHE_KEY) || '';
		} catch {
			return '';
		}
	}

	#writeCachedCustomCss(value) {
		try {
			if (value) {
				localStorage.setItem(CUSTOM_CSS_CACHE_KEY, value);
			} else {
				localStorage.removeItem(CUSTOM_CSS_CACHE_KEY);
			}
		} catch {
		}
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		if (this.preview) return;
		window.removeEventListener('contextmenu', this.#preventDefault, true);
		window.removeEventListener('keydown', this.#onKeyDown, true);
		window.removeEventListener('message', this.#onWindowMessage);
	}

	#preventDefault = (e) => e.preventDefault();

	#fetchItems() {
		chrome.runtime.sendMessage({ action: 'ctxMenuFetch', menuId: this.#menuId }, (response) => {
			if (chrome.runtime.lastError || !response?.items) {
				this.#close();
				return;
			}
			this._items = response.items;
			this._switcher = response.switcher ?? null;
		});
	}

	updated(changedProperties) {
		if (this.preview) {
			if (changedProperties.has('previewItems')) {
				this._items = Array.isArray(this.previewItems) ? this.previewItems : [];
			}
			return;
		}
		if (changedProperties.has('_items') || changedProperties.has('_switcher') || changedProperties.has('_switcherOpen')) {
			this.#measureAndReport();
		}
	}

	#measureAndReport() {
		if (this._items === null) return;
		const root = this.renderRoot.querySelector('.fm-ctx-root');
		if (!root) return;

		const hasSwitcher = !!this._switcher;
		// Switcher-less menus keep the original one-shot behaviour.
		if (this.#dimensionsSent && !hasSwitcher) return;

		const firstReport = !this.#dimensionsSent;

		// The open selection is an absolute overlay; grow the body to its size so
		// the overlay is never clipped. When closed (or absent) the body is just
		// the items and the overlay floats over them without resizing the output.
		const body = this.renderRoot.querySelector('.fm-ctx-body');
		const overlay = this.renderRoot.querySelector('.fm-ctx-switcher');
		if (body) {
			if (overlay) {
				body.style.minHeight = Math.ceil(overlay.offsetHeight) + 'px';
				body.style.minWidth = Math.ceil(overlay.offsetWidth) + 'px';
			} else {
				body.style.minHeight = '';
				body.style.minWidth = '';
			}
		}

		const sendDimensions = (width, height) => {
			this.#dimensionsSent = true;
			root.classList.add('loaded');
			chrome.runtime.sendMessage({
				action: 'ctxMenuDimensions',
				menuId: this.#menuId,
				width,
				height,
			});
			if (firstReport) {
				if (this.#scrollToBottom) {
					requestAnimationFrame(() => { document.documentElement.scrollTop = document.documentElement.scrollHeight; });
				}
				window.focus();
				window.addEventListener('blur', this.#close);
			}
		};

		// Re-measure once per layout change; ResizeObserver would loop if kept.
		const resizeObserver = new ResizeObserver((entries) => {
			const entry = entries[entries.length - 1];
			const size = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : entry.borderBoxSize;
			resizeObserver.disconnect();
			sendDimensions(Math.ceil(size.inlineSize) + 1, Math.ceil(size.blockSize));
		});
		resizeObserver.observe(root, { box: 'border-box' });

		const rect = root.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) {
			resizeObserver.disconnect();
			sendDimensions(Math.ceil(rect.width) + 1, Math.ceil(rect.height));
		}
	}

	#getMenuItems() {
		return [...this.renderRoot.querySelectorAll('li[role="menuitem"]')];
	}

	#onKeyDown = (e) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			if (this._switcherOpen) { this._switcherOpen = false; return; }
			this.#close();
			return;
		}

		const items = this.#getMenuItems();
		if (!items.length) return;

		let delta = 0;
		if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) delta = 1;
		else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) delta = -1;

		if (delta) {
			e.preventDefault();
			const active = this.renderRoot.activeElement;
			const cur = items.indexOf(active);
			const next = cur === -1 ? (delta > 0 ? 0 : items.length - 1) : (cur + delta + items.length) % items.length;
			items[next].focus();
			return;
		}

		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			const active = this.renderRoot.activeElement;
			if (active?.dataset.switchId != null) { this.#switchTo(active.dataset.switchId); return; }
			const index = active?.dataset.index;
			if (index != null) this.#selectItem(Number(index));
		}
	};

	#selectItem(index) {
		if (this.preview) return;
		if (Number.isFinite(index)) {
			chrome.runtime.sendMessage({ action: 'ctxMenuSelect', menuId: this.#menuId, index });
		}
	}

	#toggleSwitcher = (e) => {
		e.stopPropagation();
		if (!this._switcher?.menus?.length) return;
		this._switcherOpen = !this._switcherOpen;
	};

	#switchTo(id) {
		if (this.preview) return;
		this._switcherOpen = false;
		chrome.runtime.sendMessage({ action: 'ctxMenuSwitch', menuId: this.#menuId, id });
	}

	#close = () => {
		if (this.preview) return;
		chrome.runtime.sendMessage({ action: 'ctxMenuClose', menuId: this.#menuId });
	};

	#formatTime(timestamp) {
		const diffSec = Math.round((timestamp - Date.now()) / 1000);
		const abs = Math.abs(diffSec);
		if (abs < 60) return this.#rtf.format(diffSec || -1, 'second');
		if (abs < 3600) return this.#rtf.format(Math.round(diffSec / 60), 'minute');
		if (abs < 86400) return this.#rtf.format(Math.round(diffSec / 3600), 'hour');
		if (abs < 2592000) return this.#rtf.format(Math.round(diffSec / 86400), 'day');
		if (abs < 31536000) return this.#rtf.format(Math.round(diffSec / 2592000), 'month');
		return this.#rtf.format(Math.round(diffSec / 31536000), 'year');
	}

	#chevron(position) {
		const down = '▾', up = '▴';
		if (position === 'footer') return this._switcherOpen ? down : up;
		return this._switcherOpen ? up : down;
	}

	render() {
		if (this._items === null) return '';

		const customCss = this.preview ? (this.previewCss || '') : this._customCss;
		const sw = this._switcher;
		const position = sw?.position === 'footer' ? 'footer' : 'header';
		const hasMenus = !!sw?.menus?.length;

		const bar = sw ? html`
			<div class="fm-ctx-bar${hasMenus ? ' fm-ctx-bar--switchable' : ''}"
				role=${hasMenus ? 'button' : 'presentation'}
				tabindex=${hasMenus ? '0' : '-1'}
				aria-expanded=${this._switcherOpen ? 'true' : 'false'}
				@click=${this.#toggleSwitcher}
				@keydown=${(e) => { if ((e.key === 'Enter' || e.key === ' ') && hasMenus) { e.preventDefault(); this.#toggleSwitcher(e); } }}
			>
				<span class="fm-ctx-bar-name">${sw.name || ''}</span>
				${hasMenus ? html`<span class="fm-ctx-bar-chevron">${this.#chevron(position)}</span>` : ''}
			</div>
		` : '';

		const overlay = (sw && this._switcherOpen && hasMenus) ? html`
			<ul class="fm-ctx-switcher fm-ctx-switcher--${position}" role="menu">
				${sw.menus.map(m => html`
					<li class="fm-ctx-switch-item" role="menuitem" tabindex="-1" data-switch-id=${m.id}
						@click=${(e) => { e.stopPropagation(); this.#switchTo(m.id); }}
					>
						<span class="fm-ctx-label">${m.name || ''}</span>
					</li>
				`)}
			</ul>
		` : '';

		const list = html`
			<ul class="fm-ctx-list" role="menu">
				${!this._items.length ? html`
					<li class="fm-ctx-item fm-ctx-item--empty" aria-disabled="true">
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-off-icon lucide-circle-off"><path d="m2 2 20 20"/><path d="M8.35 2.69A10 10 0 0 1 21.3 15.65"/><path d="M19.08 19.08A10 10 0 1 1 4.92 4.92"/></svg>
					</li>
				` : ''}
				${this._items.map((item, i) => {
					if (item === 'separator') {
						return html`<li class="fm-ctx-sep" role="separator"></li>`;
					}
					return html`
						<li
							class="fm-ctx-item${item.active ? ' fm-ctx-item--active' : ''}"
							role="menuitem"
							tabindex="-1"
							data-index=${i}
							@click=${() => this.#selectItem(i)}
							@mouseup=${(e) => { if (e.buttons === 0 && (e.button === 0 || e.button === 2)) this.#selectItem(i); }}
						>
							<span class="fm-ctx-icon">
								${item.icon ? html`<img src="${item.icon}" alt="" draggable="false">` : ''}
							</span>
							<span class="fm-ctx-label">${item.label || ''}</span>
							${item.time ? html`<span class="fm-ctx-time">${this.#formatTime(item.time)}</span>` : ''}
						</li>
					`;
				})}
			</ul>
		`;

		return html`
			${customCss ? html`<style>${customCss}</style>` : ''}
			<div class="fm-ctx-root fm-ctx-root--${position}">
				${position === 'header' ? bar : ''}
				<div class="fm-ctx-body">
					${list}
					${overlay}
				</div>
				${position === 'footer' ? bar : ''}
			</div>
		`;
	}
}

customElements.define('fm-context-menu', FmContextMenu);