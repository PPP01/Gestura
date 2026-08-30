importScripts('menu-patterns.js');
importScripts('menu-catalog.js');
importScripts('menu-model.js');
importScripts('search-url.js');
importScripts('favicon-util.js');

const isEdge = navigator.userAgent.includes('Edg/') || navigator.userAgent.includes('EdgA/');

const GLOBAL_MUTE_KEY = 'flowmouse_global_mute_state';

const ctxMenuSessions = new Map();

class Bookmarks {
	static #ROOT_IDS = new Set(['0', 'root________']);

	static #pathSegment(node) {
		if (node.folderType) return `System:${node.folderType}:${node.syncing}`;
		return `User:${node.title}`;
	}

	static #samePath(a, b) {
		return a.length === b.length && a.every((segment, i) => segment === b[i]);
	}

	static *#walk(nodes, depth = 0, ancestorPath = []) {
		for (const node of nodes) {
			if (!node.children) continue;
			if (Bookmarks.#ROOT_IDS.has(node.id)) {
				yield* Bookmarks.#walk(node.children, depth, ancestorPath);
				continue;
			}
			const path = [...ancestorPath, Bookmarks.#pathSegment(node)];
			yield { node, depth, path };
			yield* Bookmarks.#walk(node.children, depth + 1, path);
		}
	}

	static async pathOf(nodeId) {
		const segments = [];
		let currentId = nodeId;
		while (currentId && !Bookmarks.#ROOT_IDS.has(currentId)) {
			try {
				const [node] = await chrome.bookmarks.get(currentId);
				segments.push(Bookmarks.#pathSegment(node));
				currentId = node.parentId;
			} catch {
				break;
			}
		}
		return segments.reverse();
	}

	static async listFolders() {
		const tree = await chrome.bookmarks.getTree();
		const folders = [];
		for (const { node, depth, path } of Bookmarks.#walk(tree)) {
			folders.push({
				id: node.id,
				title: node.title,
				depth,
				linkCount: node.children.filter(c => c.url).length,
				path,
			});
		}
		return folders;
	}

	static async listLinks(folderId) {
		const nodes = await chrome.bookmarks.getChildren(folderId);
		return nodes
			.filter(n => n.url)
			.map(n => ({ title: n.title, url: n.url, date: n.dateAdded }));
	}

	static async #isFolder(id) {
		try {
			const [node] = await chrome.bookmarks.get(id);
			return !!node && !node.url;
		} catch {
			return false;
		}
	}

	static async resolveFolder(folderId) {
		if (!folderId) return null;
		const { id, path } = typeof folderId === 'string' ? { id: folderId } : folderId;
		const hasPath = Array.isArray(path) && path.length > 0;
		if (!id && !hasPath) return null;

		{
			const idExists = id ? await Bookmarks.#isFolder(id) : false;
			if (idExists) {
				if (!hasPath) return id;
				if (Bookmarks.#samePath(await Bookmarks.pathOf(id), path)) {
					return id;
				}
			}

			if (hasPath) {
				const tree = await chrome.bookmarks.getTree();
				for (const folder of Bookmarks.#walk(tree)) {
					if (Bookmarks.#samePath(folder.path, path)) return folder.node.id;
				}
			}

			return idExists ? id : null;
		}
	}

	static async addLink({ title, url, folderId }) {
		const bookmark = { title, url };
		const parentId = await Bookmarks.resolveFolder(folderId);
		if (parentId) bookmark.parentId = parentId;

		const existing = (await chrome.bookmarks.search({ url })).filter(b => b.url === url);
		const isDuplicate = bookmark.parentId
			? existing.some(b => b.parentId === bookmark.parentId)
			: existing.length > 0;
		if (isDuplicate) return null;

		return await chrome.bookmarks.create(bookmark);
	}
}

function sortAndClamp(items, sortOrder, maxItems, titleKey = 'title') {
	if (sortOrder && sortOrder !== 'default') {
		if (sortOrder === 'default_desc') {
			items = items.slice().reverse();
		} else {
			const [field, dir] = sortOrder.split('_');
			const asc = dir === 'asc';
			items = items.slice().sort((a, b) => {
				let va, vb;
				if (field === 'name') {
					va = (a[titleKey] || '').toLowerCase();
					vb = (b[titleKey] || '').toLowerCase();
					return asc ? va.localeCompare(vb) : vb.localeCompare(va);
				}
				va = a[field] || 0;
				vb = b[field] || 0;
				return asc ? va - vb : vb - va;
			});
		}
	}
	if (maxItems > 0 && items.length > maxItems) {
		items = items.slice(0, maxItems);
	}
	return items;
}

chrome.tabs.onCreated.addListener((tab) => {
	chrome.storage.session.get([GLOBAL_MUTE_KEY], (items) => {
		if (items[GLOBAL_MUTE_KEY]) {
			if (tab.id) {
				chrome.tabs.update(tab.id, { muted: true });
			}
		}
	});
});

function asyncMessageHandler(asyncHandler) {
	return (message, sender, sendResponse) => {
		asyncHandler(message, sender)
			.then(sendResponse)
			.catch((error) => {
				console.error('Error handling message:', message, error);
				sendResponse({ success: false, error: error.message });
			});
		return true;
	};
}

const CONTENT_ACTIONS = new Set([
	'scrollUp', 'scrollDown', 'scrollLeft', 'scrollRight', 'scrollToTop', 'scrollToBottom', 'scrollToLeftEdge', 'scrollToRightEdge',
	'stopLoading', 'copyUrl', 'copyTitle', 'copyTitleAndUrl', 'printPage', 'sendCustomEvent',
	'simulateKey', 'pasteClipboard', 'pasteContent', 'searchClipboard', 'searchLink',
	'menuShowTabs', 'menuRecentlyClosed', 'menuShowBookmarks',
	'customMenu', 'siteMenu',
]);

async function createTabAtPosition(sender, position, extraOpts = {}) {
	if (!sender.tab) {
		return await chrome.tabs.create({ active: true, ...extraOpts });
	}
	const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
	const createOpts = { active: true, windowId: sender.tab.windowId, ...extraOpts };
	switch (position) {
		case 'right': createOpts.index = sender.tab.index + 1; break;
		case 'left': createOpts.index = sender.tab.index; break;
		case 'first': createOpts.index = 0; break;
		case 'last':
		default: createOpts.index = tabs.length; break;
	}
	return await chrome.tabs.create(createOpts);
}

async function openInNewWindow(url, focused = true, incognito = false) {
	const createOpts = { focused, incognito };
	if (url) createOpts.url = url;
	const win = await chrome.windows.create(createOpts);
	return win.tabs[0];
}

async function getSenderWindow(sender) {
	if (sender.tab?.windowId != null) {
		return await chrome.windows.get(sender.tab.windowId);
	}
	return await chrome.windows.getCurrent();
}

function replaceUrlPlaceholders(template, tab) {
	const rawUrl = tab?.url || '';
	const raw = {
		tabUrl: rawUrl,
		tabTitle: tab?.title || '',
		tabDomain: '',
	};
	if (rawUrl) {
		try {
			raw.tabDomain = new URL(rawUrl).hostname;
		} catch { }
	}
	return (template || '').replace(/\{(tabUrl|tabTitle|tabDomain)(?::(raw))?\}/g, (_, key, mod) => {
		const val = raw[key] || '';
		return mod ? val : encodeURIComponent(val);
	});
}

let _offscreenCreating = null;

async function ensureOffscreen() {
	if (!chrome.offscreen) {
		throw new Error('chrome.offscreen API is not available in this browser');
	}
	if (await chrome.offscreen.hasDocument()) {
		return;
	}
	if (_offscreenCreating) {
		return _offscreenCreating;
	}
	_offscreenCreating = chrome.offscreen.createDocument({
		url: 'pages/offscreen.html',
		reasons: ['IFRAME_SCRIPTING'],
		justification: 'Run user-defined search-link transform scripts in an isolated sandbox',
	}).catch((e) => {
		// Swallow benign "only one offscreen document" race error
		if (!e?.message?.includes('single offscreen document')) throw e;
	}).finally(() => {
		_offscreenCreating = null;
	});
	return _offscreenCreating;
}

let _transformIdCounter = 0;

async function handleAction(request, sender) {
	switch (request.action) {
		case 'getFavicon':
			return { success: true, icon: await resolveFavicon(request.url) };

		case 'back':
			if (sender.tab?.id) {
				await chrome.tabs.goBack(sender.tab.id).catch(() => { });
			}
			return { success: true };

		case 'forward':
			if (sender.tab?.id) {
				await chrome.tabs.goForward(sender.tab.id).catch(() => { });
			}
			return { success: true };

		case 'urlLevelUp':
			if (sender.tab?.id && sender.tab.url) {
				const u = new URL(sender.tab.url);
				const newPath = u.pathname.replace(/\/([^/]+)\/?$/, '');
				if (newPath !== u.pathname) {
					await chrome.tabs.update(sender.tab.id, { url: u.origin + newPath });
				}
			}
			return { success: true };

		case 'urlToRoot':
			if (sender.tab?.id && sender.tab.url) {
				const u = new URL(sender.tab.url);
				if (u.pathname !== '/' || u.search || u.hash) {
					await chrome.tabs.update(sender.tab.id, { url: u.origin });
				}
			}
			return { success: true };

		case 'refresh':
			if (sender.tab?.id) {
				await chrome.tabs.reload(sender.tab.id, { bypassCache: !!request.hardReload });
			}
			return { success: true };

		case 'closeTab': {
			if (sender.tab?.id) {
				if (request.skipPinned && sender.tab.pinned) {
					return { success: true };
				}
				const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
				const currentPos = tabs.findIndex(t => t.id === sender.tab.id);
				const afterClose = request.afterClose || 'default';

				if (request.keepWindow && tabs.length === 1) {
					await chrome.tabs.create({ active: true, windowId: sender.tab.windowId });
				}

				if (afterClose !== 'default' && tabs.length > 1 && currentPos !== -1) {
					let targetPos;
					if (afterClose === 'left') {
						targetPos = currentPos > 0 ? currentPos - 1 : tabs.length - 1;
					} else if (afterClose === 'right') {
						targetPos = currentPos < tabs.length - 1 ? currentPos + 1 : 0;
					}
					if (targetPos !== undefined) {
						await chrome.tabs.update(tabs[targetPos].id, { active: true });
					}
				}

				await chrome.tabs.remove(sender.tab.id);
			}
			return { success: true };
		}

		case 'closeWindow':
			if (sender.tab?.windowId) {
				await chrome.windows.remove(sender.tab.windowId);
			}
			return { success: true };

		case 'closeBrowser': {
			const windows = await chrome.windows.getAll({});
			for (const win of windows) {
				await chrome.windows.remove(win.id);
			}
			return { success: true };
		}

		case 'restoreTab':
			if (sender.tab?.incognito) return { success: false };
			await chrome.sessions.restore(null).catch(() => { });
			return { success: true };

		case 'newTab': {
			const active = request.active !== false;
			const position = request.position || 'last';
			if (position === 'newWindow') {
				await openInNewWindow(undefined, active, sender.tab?.incognito);
			} else {
				await createTabAtPosition(sender, position, { active });
			}
			return { success: true };
		}

		case 'openTabAtPosition': {
			if (sender.tab && request.incognito && !sender.tab.incognito) {
				const granted = await requestPermission(['incognito'], sender.tab.windowId);
				if (granted) {
					await chrome.windows.create({ incognito: true, url: request.url });
				}
				return { success: true };
			}

			const position = request.position || 'right';
			const active = request.active !== false;

			if (position === 'newWindow') {
				await openInNewWindow(request.url, active, sender.tab?.incognito);
			} else if (position === 'current' && sender.tab) {
				await chrome.tabs.update(sender.tab.id, { url: request.url, active });
			} else {
				await createTabAtPosition(sender, position, {
					url: request.url,
					active,
					openerTabId: sender.tab?.id,
				});
			}
			return { success: true };
		}

		case 'openIncognitoTabs': {
			const urls = request.urls || [];
			const queries = request.queries || [];
			if (!sender.tab || (urls.length === 0 && queries.length === 0)) return { success: true };
			if (sender.tab.incognito) {
				for (const url of urls) {
					await chrome.tabs.create({ url, windowId: sender.tab.windowId });
				}
				for (const query of queries) {
					const tab = await chrome.tabs.create({ windowId: sender.tab.windowId });
					await chrome.search.query({ text: query, tabId: tab.id });
				}
			} else {
				const granted = await requestPermission(['incognito'], sender.tab.windowId);
				if (granted) {
					const newWin = await chrome.windows.create({ incognito: true, url: urls.length > 0 ? urls : undefined });
					if (newWin) {
						for (const query of queries) {
							const tab = await chrome.tabs.create({ windowId: newWin.id });
							await chrome.search.query({ text: query, tabId: tab.id });
						}
					}
				}
			}
			return { success: true };
		}

		case 'systemSearch': {
			if (sender.tab) {
				if (request.incognito && !sender.tab.incognito) {
					const granted = await requestPermission(['incognito'], sender.tab.windowId);
					if (granted) {
						const newWin = await chrome.windows.create({ incognito: true });
						if (newWin && newWin.tabs && newWin.tabs.length > 0) {
							await chrome.search.query({ text: request.query, tabId: newWin.tabs[0].id });
						}
					}
					return { success: true };
				}

				const position = request.position || 'right';
				const active = request.active !== false;

				if (position === 'newWindow') {
					const newTab = await openInNewWindow(undefined, active, sender.tab?.incognito);
					await chrome.search.query({ text: request.query, tabId: newTab.id });
				} else if (position === 'current') {
					await chrome.search.query({ text: request.query, tabId: sender.tab.id });
				} else {
					const newTab = await createTabAtPosition(sender, position, {
						url: 'about:blank',
						active,
						openerTabId: sender.tab.id,
					});
					if (newTab) {
						await chrome.search.query({ text: request.query, tabId: newTab.id });
					}
				}
			}
			return { success: true };
		}

		case 'saveImage':
			if (request.url) {
				requestPermission(['downloads', 'pageCapture'], sender.tab?.windowId ?? null).then(async (granted) => {
					if (!granted) return;

					if (request.url.startsWith('data:')) {
						{
							await chrome.downloads.download({
								url: request.url,
								filename: request.filename || null,
								saveAs: false
							});
						}
						return;
					}

					const imageUrl = request.url;

					{
						const sourceTabId = sender.tab?.id ?? null;
						if (!sourceTabId) {
							return;
						}

						const MHTML_MAX_RETRIES = 2;
						const MHTML_RETRY_DELAY = 500;
						try {
							let mhtmlBlob;
							for (let i = 0; i <= MHTML_MAX_RETRIES; i++) {
								try {
									mhtmlBlob = await chrome.pageCapture.saveAsMHTML({ tabId: sourceTabId });
									if (mhtmlBlob) break;
								} catch (e) {
									if (i >= MHTML_MAX_RETRIES) throw e;
									await new Promise(r => setTimeout(r, MHTML_RETRY_DELAY));
								}
							}
							const mhtmlText = await mhtmlBlob.text();

							const resource = findResourceInMhtml(mhtmlText, imageUrl);

							if (resource && resource.dataUrl) {
								const filename = getFilename(imageUrl, resource.type);
								await chrome.downloads.download({
									url: resource.dataUrl,
									filename: filename,
									saveAs: false
								});
							} else {
								notifyDownloadError(sourceTabId);
							}
						} catch (e) {
							console.error('MHTML capture failed:', e?.name, e?.message || e);
							notifyDownloadError(sourceTabId);
						}
					}
				});
			}
			return { success: true };

		case 'saveAsMhtml':
			if (sender.tab?.id) {
				requestPermission(['downloads', 'pageCapture'], sender.tab.windowId).then(async (granted) => {
					if (!granted) return;

					const MHTML_MAX_RETRIES = 2;
					const MHTML_RETRY_DELAY = 500;
					try {
						let mhtmlBlob;
						for (let i = 0; i <= MHTML_MAX_RETRIES; i++) {
							try {
								mhtmlBlob = await chrome.pageCapture.saveAsMHTML({ tabId: sender.tab.id });
								if (mhtmlBlob) break;
							} catch (e) {
								if (i >= MHTML_MAX_RETRIES) throw e;
								await new Promise(r => setTimeout(r, MHTML_RETRY_DELAY));
							}
						}

						const reader = new FileReader();
						const dataUrl = await new Promise((resolve, reject) => {
							reader.onload = () => resolve(reader.result);
							reader.onerror = () => reject(reader.error);
							reader.readAsDataURL(mhtmlBlob);
						});

						const title = (sender.tab.title || 'page').replace(/[<>:"/\\|?*]+/g, '_').substring(0, 200);
						const filename = title + '.mhtml';

						await chrome.downloads.download({
							url: dataUrl,
							filename: filename,
							saveAs: true
						});
					} catch (e) {
						console.error('MHTML save failed:', e);
					}
				});
			}
			return { success: true };

		case 'closeOtherTabs': {
			if (sender.tab) {
				const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
				const targetTabs = tabs
					.filter(tab => tab.id !== sender.tab.id && !(request.skipPinned && tab.pinned));

				if (request.preserveTab) {
					await Promise.all(targetTabs.filter(tab => !tab.discarded).map(tab => chrome.tabs.discard(tab.id)));
				} else {
					const tabsToRemove = targetTabs.map(tab => tab.id);
					if (tabsToRemove.length > 0) {
						await chrome.tabs.remove(tabsToRemove);
					}
				}
			}
			return { success: true };
		}

		case 'closeRightTabs': {
			if (sender.tab) {
				const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
				const targetTabs = tabs
					.filter(tab => tab.index > sender.tab.index && !(request.skipPinned && tab.pinned));

				if (request.preserveTab) {
					await Promise.all(targetTabs.filter(tab => !tab.discarded).map(tab => chrome.tabs.discard(tab.id)));
				} else {
					const tabsToRemove = targetTabs.map(tab => tab.id);
					if (tabsToRemove.length > 0) {
						await chrome.tabs.remove(tabsToRemove);
					}
				}
			}
			return { success: true };
		}

		case 'closeLeftTabs': {
			if (sender.tab) {
				const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
				const targetTabs = tabs
					.filter(tab => tab.index < sender.tab.index && !(request.skipPinned && tab.pinned));

				if (request.preserveTab) {
					await Promise.all(targetTabs.filter(tab => !tab.discarded).map(tab => chrome.tabs.discard(tab.id)));
				} else {
					const tabsToRemove = targetTabs.map(tab => tab.id);
					if (tabsToRemove.length > 0) {
						await chrome.tabs.remove(tabsToRemove);
					}
				}
			}
			return { success: true };
		}

		case 'refreshAllTabs': {
			const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
			for (const tab of tabs) {
				await chrome.tabs.reload(tab.id, { bypassCache: !!request.hardReload });
			}
			return { success: true };
		}

		case 'stopAllLoading': {
			{
				const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
				await Promise.all(tabs.map(tab => {
					if (isRestrictedUrl(tab.url)) return;
					return chrome.scripting.executeScript({
						target: { tabId: tab.id, allFrames: true },
						func: () => window.stop(),
						injectImmediately: true,
					}).catch(() => {
					});
				}));
			}
			return { success: true };
		}

		case 'closeAllTabs': {
			const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
			const tabsToRemove = tabs
				.filter(tab => !(request.skipPinned && tab.pinned))
				.map(tab => tab.id);
			if (tabsToRemove.length > 0) {
				const remainingTabs = tabs.length - tabsToRemove.length;
				if (remainingTabs === 0) {
					await chrome.tabs.create({ active: true, windowId: sender.tab.windowId });
				}
				await chrome.tabs.remove(tabsToRemove);
			}
			return { success: true };
		}

		case 'switchLeftTab': {
			if (sender.tab) {
				const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
				const currentPos = tabs.findIndex(t => t.id === sender.tab.id);
				if (currentPos === -1) return { success: true };
				if (request.noWrap && currentPos === 0) return { success: true };
				const prevPos = currentPos > 0 ? currentPos - 1 : tabs.length - 1;
				if (request.moveTab) {
					await chrome.tabs.move(sender.tab.id, { index: tabs[prevPos].index });
				} else {
					await chrome.tabs.update(tabs[prevPos].id, { active: true });
				}
			}
			return { success: true };
		}

		case 'switchRightTab': {
			if (sender.tab) {
				const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
				const currentPos = tabs.findIndex(t => t.id === sender.tab.id);
				if (currentPos === -1) return { success: true };
				if (request.noWrap && currentPos === tabs.length - 1) return { success: true };
				const nextPos = currentPos < tabs.length - 1 ? currentPos + 1 : 0;
				if (request.moveTab) {
					await chrome.tabs.move(sender.tab.id, { index: tabs[nextPos].index });
				} else {
					await chrome.tabs.update(tabs[nextPos].id, { active: true });
				}
			}
			return { success: true };
		}

		case 'switchFirstTab': {
			if (sender.tab) {
				const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
				if (tabs.length > 0) {
					if (request.moveTab) {
						await chrome.tabs.move(sender.tab.id, { index: 0 });
					} else {
						await chrome.tabs.update(tabs[0].id, { active: true });
					}
				}
			}
			return { success: true };
		}

		case 'switchLastTab': {
			if (sender.tab) {
				const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
				if (tabs.length > 0) {
					if (request.moveTab) {
						await chrome.tabs.move(sender.tab.id, { index: -1 });
					} else {
						await chrome.tabs.update(tabs[tabs.length - 1].id, { active: true });
					}
				}
			}
			return { success: true };
		}

		case 'switchLastActiveTab': {
			if (sender.tab) {
				const tabs = (await chrome.tabs.query({ windowId: sender.tab.windowId, active: false }))
					.filter(t => !t.hidden);
				if (tabs.length > 0) {
					const lastActiveTab = tabs.reduce((acc, cur) => acc.lastAccessed > cur.lastAccessed ? acc : cur);
					await chrome.tabs.update(lastActiveTab.id, { active: true });
				}
			}
			return { success: true };
		}

		case 'togglePinTab': {
			if (sender.tab?.id) {
				const tab = await chrome.tabs.get(sender.tab.id);
				await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
			}
			return { success: true };
		}

		case 'moveTabToNewWindow':
			if (sender.tab?.id) {
				await chrome.windows.create({ tabId: sender.tab.id, incognito: sender.tab.incognito });
			}
			return { success: true };

		case 'newWindow':
			await openInNewWindow(undefined, request.focused !== false);
			return { success: true };

		case 'newIncognito':
			await chrome.windows.create({ incognito: true });
			return { success: true };

		case 'addToBookmarks':
			if (sender.tab) {
				requestPermission(['bookmarks'], sender.tab.windowId).then(async (granted) => {
					if (!granted) return;
					await Bookmarks.addLink({
						title: sender.tab.title,
						url: sender.tab.url,
						folderId: request.folderId,
					});
				});
			}
			return { success: true };

		case 'toggleFullscreen': {
			const win = await getSenderWindow(sender);
			if (win.state === 'fullscreen') {
				const storageKey = `flowmouse_fullscreen_prev_state_${win.id}`;
				const items = await chrome.storage.session.get([storageKey]);
				const prevState = items[storageKey] || 'normal';
				await chrome.windows.update(win.id, { state: prevState });
				await chrome.storage.session.remove(storageKey);
			} else {
				const storageKey = `flowmouse_fullscreen_prev_state_${win.id}`;
				await chrome.storage.session.set({ [storageKey]: win.state });
				await chrome.windows.update(win.id, { state: 'fullscreen' });
			}
			return { success: true };
		}

		case 'toggleMaximize': {
			const win = await getSenderWindow(sender);
			const newState = win.state === 'maximized' ? 'normal' : 'maximized';
			await chrome.windows.update(win.id, { state: newState });
			return { success: true };
		}

		case 'minimize': {
			const win = await getSenderWindow(sender);
			await chrome.windows.update(win.id, { state: 'minimized' });
			return { success: true };
		}

		case 'zoomIn':
		case 'zoomOut': {
			if (!sender.tab?.id) return { success: false };
			const currentZoom = await chrome.tabs.getZoom(sender.tab.id);
			const direction = request.action === 'zoomIn' ? 1 : -1;
			let newZoom;
			if (request.zoomMode === 'fixed') {
				const delta = (request.zoomDelta || 10) / 100;
				newZoom = currentZoom + delta * direction;
			} else {
				const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
				if (direction === 1) {
					newZoom = ZOOM_LEVELS.find(z => z > currentZoom + 0.005) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
				} else {
					newZoom = [...ZOOM_LEVELS].reverse().find(z => z < currentZoom - 0.005) ?? ZOOM_LEVELS[0];
				}
			}
			newZoom = Math.min(5, Math.max(0.25, newZoom));
			await chrome.tabs.setZoom(sender.tab.id, newZoom);
			return { success: true };
		}

		case 'resetZoom': {
			if (!sender.tab?.id) return { success: false };
			const resetLevel = request.resetZoomLevel;
			const zoomFactor = resetLevel > 0 ? resetLevel / 100 : 0;
			await chrome.tabs.setZoom(sender.tab.id, zoomFactor);
			return { success: true };
		}

		case 'openCustomUrl': {
			let url = replaceUrlPlaceholders(request.customUrl, sender.tab);
			if (url) {
				const protocolRegex = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

				url = url.trim();

				if (!protocolRegex.test(url)) {
					url = 'http://' + url;
				}

				if (sender.tab && request.incognito && !sender.tab.incognito) {
					const granted = await requestPermission(['incognito'], sender.tab.windowId);
					if (granted) {
						await chrome.windows.create({ incognito: true, url });
					}
					return { success: true };
				}

				const pos = request.position || 'last';
				const act = request.active !== false;
				if (pos === 'newWindow') {
					await openInNewWindow(url, act, sender.tab?.incognito);
				} else if (pos === 'current' && sender.tab) {
					await chrome.tabs.update(sender.tab.id, { url });
				} else {
					await createTabAtPosition(sender, pos, { url, active: act });
				}
			}
			return { success: true };
		}

		case 'sendExtensionMessage': {
			const targetId = (request.extensionId || '').trim();
			if (targetId) {
				let message = {};
				try {
					message = JSON.parse(request.message || '{}');
				} catch { }
				await chrome.runtime.sendMessage(targetId, message);
			}
			return { success: true };
		}

		case 'openDownloads':
			{
				await chrome.tabs.create({ url: 'chrome://downloads', active: true, windowId: sender.tab.windowId });
			}
			return { success: true };

		case 'openHistory':
			{
				await chrome.tabs.create({ url: 'chrome://history', active: true, windowId: sender.tab.windowId });
			}
			return { success: true };

		case 'openExtensions':
			{
				await chrome.tabs.create({ url: 'chrome://extensions', active: true, windowId: sender.tab.windowId });
			}
			return { success: true };

		case 'viewPageSource': {
			if (sender.tab?.url) {
				const url = 'view-source:' + sender.tab.url;
				const pos = request.position || 'right';
				if (pos === 'newWindow') {
					await openInNewWindow(url, request.active !== false, sender.tab?.incognito);
				} else if (pos === 'current' && sender.tab) {
					await chrome.tabs.update(sender.tab.id, { url });
				} else {
					const active = request.active !== false;
					await createTabAtPosition(sender, pos, { url, active });
				}
			}
			return { success: true };
		}

		case 'duplicateTab':
			if (sender.tab?.id) {
				await chrome.tabs.duplicate(sender.tab.id);
			}
			return { success: true };

		case 'toggleMuteTab': {
			if (sender.tab?.id) {
				const tab = await chrome.tabs.get(sender.tab.id);
				await chrome.tabs.update(tab.id, { muted: !tab.mutedInfo.muted });
			}
			return { success: true };
		}

		case 'toggleMuteAllTabs': {
			const sessionItems = await chrome.storage.session.get([GLOBAL_MUTE_KEY]);
			const isMuted = sessionItems[GLOBAL_MUTE_KEY];
			const newState = !isMuted;

			await chrome.storage.session.set({ [GLOBAL_MUTE_KEY]: newState });
			const tabs = await chrome.tabs.query({});
			for (const tab of tabs) {
				await chrome.tabs.update(tab.id, { muted: newState });
			}
			return { success: true };
		}

		case 'openOptionsPage': {
			const optionsUrl = chrome.runtime.getURL('pages/options.html');
			const targetUrl = optionsUrl + (request.hash || '');

			chrome.tabs.create({ url: targetUrl });

			return { success: true };
		}

		case 'requestPermission':
			const granted = await requestPermission(request.permissions, sender.tab?.windowId ?? null);
			return { success: true, granted };

		case 'addSiteToMenu': {
			const menuId = request.menuId;
			const url = sender.tab?.url;
			if (!menuId || !url) return { success: false };
			const pattern = self.FlowMouseMenuPatterns.siteToPattern(url);
			const cur = await new Promise(res => chrome.storage.sync.get(['siteMenus'], items => res(items.siteMenus || {})));
			const { siteMenus, added } = self.FlowMouseMenuModel.addPatternToMenu(
				self.FlowMouseMenuCatalog.SITE_MENU_CATALOG, cur, menuId, pattern);
			if (added) await chrome.storage.sync.set({ siteMenus });
			return { success: true, added };
		}

		case 'gestureStateUpdate':
			if (sender.tab?.id) {
				await chrome.tabs.sendMessage(sender.tab.id, {
					action: 'gestureStateUpdate',
					active: request.active
				}).catch(() => {
				});
			}
			return { success: true };

		case 'pauseGesture':
			if (sender.tab?.id) {
				await chrome.tabs.sendMessage(sender.tab.id, {
					action: 'pauseGesture'
				}).catch(() => {});
			}
			return { success: true };

		case 'areaSelect':
			if (sender.tab?.id) {
				await chrome.tabs.sendMessage(sender.tab.id, {
					action: 'areaSelectEnter',
					warnThreshold: request.warnThreshold,
					textUrl: request.textUrl,
					operationInterval: request.operationInterval,
				}).catch(() => {});
			}
			return { success: true };

		case 'areaSelectExit':
			if (sender.tab?.id) {
				await chrome.tabs.sendMessage(sender.tab.id, {
					action: 'areaSelectExit',
				}).catch(() => {});
			}
			return { success: true };

		case 'areaSelectUpdate':
			if (sender.tab?.id) {
				await chrome.tabs.sendMessage(sender.tab.id, {
					action: 'areaSelectUpdate',
					frameId: sender.frameId ?? 0,
					links: request.links,
				}).catch(() => {});
			}
			return { success: true };

		case 'areaSelectBatchOpen': {
			const urls = request.urls;
			const interval = Math.max(0, Math.min(60000, (parseFloat(request.operationInterval) || 0) * 1000));
			if (urls?.length && sender.tab) {
				let openerTabId = sender.tab.id;
				const baseIndex = sender.tab.index + 1;
				for (let i = 0; i < urls.length; i++) {
					if (i > 0 && interval > 0) {
						await new Promise(r => setTimeout(r, interval));
					}
					if (openerTabId != null) {
						try {
							await chrome.tabs.get(openerTabId);
						} catch {
							openerTabId = undefined;
						}
					}
					await chrome.tabs.create({
						url: urls[i],
						active: false,
						windowId: sender.tab.windowId,
						index: baseIndex + i,
						openerTabId,
					});
				}
			}
			return { success: true };
		}

		case 'gestureHudUpdate':
			if (sender.tab?.id) {
				await chrome.tabs.sendMessage(sender.tab.id, {
					action: 'gestureHudUpdate',
					data: request.data
				}).catch(() => {
				});
			}
			return { success: true };

		case 'gestureScrollUpdate':
			if (sender.tab?.id) {
				await chrome.tabs.sendMessage(sender.tab.id, {
					action: 'gestureScrollUpdate',
					data: request.data
				}).catch(() => {
				});
			}
			return { success: true };

		case 'getTabList': {
			if (sender.tab) {
				const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
				let mapped = tabs.map(t => ({
					id: t.id,
					title: t.title,
					url: t.url,
					favIconUrl: t.favIconUrl,
					active: t.active,
					index: t.index,
					lastAccess: t.lastAccessed,
				}));
				mapped = sortAndClamp(mapped, request.sortOrder, request.maxItems);
				return { success: true, tabs: mapped };
			}
			return { success: false };
		}

		case 'switchToTab':
			if (request.tabId) {
				await chrome.tabs.update(request.tabId, { active: true });
			}
			return { success: true };

		case 'restoreSession':
			if (request.sessionId) {
				await chrome.sessions.restore(request.sessionId).catch(() => {});
			}
			return { success: true };

		case 'getRecentlyClosedTabs': {
			const maxItems = request.maxItems ?? 12;
			const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
			let tabs = [];
			for (const session of sessions) {
				if (session.tab) {
					tabs.push({
						sessionId: session.tab.sessionId,
						title: session.tab.title,
						url: session.tab.url,
						favIconUrl: session.tab.favIconUrl,
						lastModified: session.lastModified,
					});
				} else if (session.window) {
					for (const tab of session.window.tabs || []) {
						tabs.push({
							sessionId: tab.sessionId,
							title: tab.title,
							url: tab.url,
							favIconUrl: tab.favIconUrl,
							lastModified: session.lastModified,
						});
					}
				}
			}
			if (maxItems > 0 && tabs.length > maxItems) {
				tabs = tabs.slice(0, maxItems);
			}
			tabs = sortAndClamp(tabs, request.sortOrder, 0);
			return { success: true, tabs };
		}

		case 'getBookmarks': {
			const granted = await requestPermission(['bookmarks'], sender.tab?.windowId);
			if (!granted) return { success: false };
			try {
				const folderId = await Bookmarks.resolveFolder(request.folderId) ?? '1';
				const links = await Bookmarks.listLinks(folderId);
				return { success: true, bookmarks: sortAndClamp(links, request.sortOrder, request.maxItems) };
			} catch (error) {
				console.error('Failed to get bookmarks:', error);
				return { success: false, bookmarks: [] };
			}
		}

		case 'getBookmarkFolders': {
			const granted = await requestPermission(['bookmarks'], sender.tab?.windowId);
			if (!granted) return { success: false, folders: [] };
			try {
				return { success: true, folders: await Bookmarks.listFolders() };
			} catch (error) {
				console.error('Failed to get bookmark folders:', error);
				return { success: false, folders: [] };
			}
		}


		case 'ctxMenuPrepare': {
			const { menuId } = request;
			if (!menuId) return { success: false };
			ctxMenuSessions.set(menuId, {
				tabId: sender.tab?.id,
				frameId: sender.frameId ?? 0,
				latest: undefined, // most recent items (fetch always returns these)
				waiters: [],
			});
			return { success: true };
		}

		case 'ctxMenuSetItems': {
			const session = ctxMenuSessions.get(request.menuId);
			if (!session) return { success: false };
			session.latest = request.items;
			if ('switcher' in request) session.latestSwitcher = request.switcher;
			const waiters = session.waiters;
			session.waiters = [];
			waiters.forEach((r) => r());
			return { success: true };
		}

		case 'ctxMenuFetch': {
			const session = ctxMenuSessions.get(request.menuId);
			if (!session) return { items: [], switcher: null };
			// Return the latest items; if none have been set yet, wait for the first.
			if (session.latest !== undefined) return { items: session.latest, switcher: session.latestSwitcher ?? null };
			await new Promise((r) => { session.waiters.push(r); setTimeout(r, 10000); });
			return { items: session.latest ?? null, switcher: session.latestSwitcher ?? null };
		}

		case 'ctxMenuDimensions': {
			const session = ctxMenuSessions.get(request.menuId);
			if (!session) return;
			chrome.tabs.sendMessage(session.tabId, {
				action: 'ctxMenuDimensions',
				menuId: request.menuId,
				width: request.width,
				height: request.height,
			}, { frameId: session.frameId }).catch(() => {});
			return { success: true };
		}

		case 'ctxMenuSelect': {
			const session = ctxMenuSessions.get(request.menuId);
			if (!session) return;
			chrome.tabs.sendMessage(session.tabId, {
				action: 'ctxMenuSelect',
				menuId: request.menuId,
				index: request.index,
				button: request.button || 0,
			}, { frameId: session.frameId }).catch(() => {});
			ctxMenuSessions.delete(request.menuId);
			return { success: true };
		}

		case 'ctxMenuSwitch': {
			const session = ctxMenuSessions.get(request.menuId);
			if (!session) return;
			chrome.tabs.sendMessage(session.tabId, {
				action: 'ctxMenuSwitch',
				menuId: request.menuId,
				id: request.id,
			}, { frameId: session.frameId }).catch(() => {});
			return { success: true };
		}

		case 'ctxMenuClose': {
			const session = ctxMenuSessions.get(request.menuId);
			if (!session) return;
			chrome.tabs.sendMessage(session.tabId, {
				action: 'ctxMenuClose',
				menuId: request.menuId,
			}, { frameId: session.frameId }).catch(() => {});
			ctxMenuSessions.delete(request.menuId);
			return { success: true };
		}

		case 'ctxMenuCleanup': {
			const session = ctxMenuSessions.get(request.menuId);
			if (session) session.setItems(null);
			ctxMenuSessions.delete(request.menuId);
			return { success: true };
		}

		case 'runTransform': {
			if (typeof request.code !== 'string') {
				return { ok: false, error: 'no code' };
			}
			if (!chrome.offscreen) {
				// No offscreen document API (e.g. Firefox): the transform can't run.
				// Signal the caller to skip it and search with the raw selection.
				return { ok: false, unsupported: true };
			}
			await ensureOffscreen();
			const transformId = 'ft-' + (++_transformIdCounter);
			const replyPromise = new Promise((resolve) => {
				const timeout = setTimeout(() => {
					resolve({ ok: false, error: 'timeout' });
				}, 1500);
				chrome.runtime.sendMessage({
					target: 'offscreen',
					type: 'fm-transform',
					id: transformId,
					code: request.code,
					selection: request.selection || '',
					clipboard: request.clipboard || '',
				}).then((reply) => {
					clearTimeout(timeout);
					resolve(reply ?? { ok: false, error: 'no reply' });
				}).catch((e) => {
					clearTimeout(timeout);
					resolve({ ok: false, error: String(e?.message || e) });
				});
			});
			return replyPromise;
		}

		case 'actionChain': {
			const steps = request.steps;
			if (!steps?.length) return { success: true };
			const windowId = sender.tab?.windowId;

			const sleep = (ms) => new Promise(r => setTimeout(r, ms));

			for (const step of steps) {
				if (step.action === 'delay') {
					await sleep(step.delayMs || 500);
					continue;
				}

				const [activeTab] = await chrome.tabs.query({ active: true, windowId });
				if (!activeTab) continue;

				if (CONTENT_ACTIONS.has(step.action)) {
					await chrome.tabs.sendMessage(activeTab.id, {
						action: 'executeLocalAction',
						stepAction: step.action,
						stepConfig: step
					}).catch(() => {});
					if (steps.indexOf(step) < steps.length - 1) {
						await sleep(100);
					}
				} else {
					await handleAction(step, { tab: activeTab });
				}
			}
			return { success: true };
		}

		case 'importFromSite':
			return await importFromSite(request, sender);

		case 'importInline':
			return await importInline(request, sender);

		case 'importResult':
			return await reportImportResult(request);
	}
}

// Hand-off to the options page: stash the parsed JSON in session storage and
// open/focus the options page, which picks it up in #checkPendingImport().
// Shared by both import paths (fetched href, and inline hand-off).
async function stashPendingImport(json, url, sender) {
	await chrome.storage.session.set({
		// tabId/frameId reisen mit, damit die Optionsseite der auslösenden Seite
		// hinterher melden kann, was aus der Übergabe geworden ist. Sie stehen hier
		// und nicht in der gespeicherten Menü-Definition: eine Tab-ID ist kein
		// Herkunftsnachweis, sie ist nach dem nächsten Neustart bedeutungslos.
		pendingImport: {
			json, url, ts: Date.now(),
			tabId: sender && sender.tab ? sender.tab.id : null,
			frameId: sender && typeof sender.frameId === 'number' ? sender.frameId : 0,
		},
	});
	await openOptionsPage('');
	return { success: true };
}

// Der Rückweg: die Optionsseite darf chrome.tabs nicht anfassen, der Worker schon.
// Gezielt an den Frame, der die Übergabe ausgelöst hat - ohne frameId bekämen alle
// Frames der Seite das Ereignis, auch fremde Werbe-iframes.
//
// Scheitert der Versand, ist das kein Fehler: der Tab kann geschlossen oder
// weiternavigiert sein. Die Seite darf sich ohnehin nicht darauf verlassen, dass
// die Meldung kommt (siehe docs/index-import-rueckmeldung.md).
async function reportImportResult(request) {
	const tabId = request && request.tabId;
	if (typeof tabId !== 'number') return { success: false, error: 'No tab' };
	try {
		await chrome.tabs.sendMessage(
			tabId,
			{ action: 'gesturaImportResult', result: request.result || {} },
			{ frameId: typeof request.frameId === 'number' ? request.frameId : 0 },
		);
	} catch {
		return { success: false, error: 'Tab unreachable' };
	}
	return { success: true };
}

// Operator-button import (<a rel="gestura-menu">): content.js already verified the
// click was trusted and the link is same-origin with the page; here we re-derive the
// page origin from sender.tab.url as defense in depth, fetch the JSON with a byte cap
// (mirrors menu-exchange.js's LIMITS.blobMax so an oversized/malicious response never
// reaches storage), and hand off to the options page. Validation of the JSON itself
// happens later, in <menu-import-dialog> (trusted extension context), not here.
const IMPORT_FROM_SITE_MAX_BYTES = 100 * 1024;

async function importFromSite(request, sender) {
	let url;
	try {
		url = new URL(request.url);
	} catch {
		return { success: false, error: 'Invalid URL' };
	}
	if (!/^https?:$/.test(url.protocol)) {
		return { success: false, error: 'Unsupported protocol' };
	}

	const pageUrl = sender.url || sender.tab?.url;
	if (pageUrl) {
		try {
			if (new URL(pageUrl).origin !== url.origin) {
				return { success: false, error: 'Cross-origin import blocked' };
			}
		} catch { }
	}

	try {
		const ctl = new AbortController();
		const timeout = setTimeout(() => ctl.abort(), 8000);
		let res;
		try {
			res = await fetch(url.href, { signal: ctl.signal, credentials: 'omit', redirect: 'follow' });
		} finally {
			clearTimeout(timeout);
		}
		if (!res.ok) return { success: false, error: 'Fetch failed: ' + res.status };

		const text = await res.text();
		if (new TextEncoder().encode(text).length > IMPORT_FROM_SITE_MAX_BYTES) {
			return { success: false, error: 'Response too large' };
		}
		const json = JSON.parse(text);

		return await stashPendingImport(json, url.href, sender);
	} catch (e) {
		return { success: false, error: String(e?.message || e) };
	}
}

// Inline hand-off (<[data-gestura-inline]> + 'gestura:import', see js/content.js):
// the page hands over JSON it fetched itself, so the extension performs no request
// and there is no origin to compare. The byte cap is re-checked here as defense in
// depth — a runtime message can originate outside the content script — and the
// parse happens in this trusted context, never in the page's.
const IMPORT_INLINE_MAX_BYTES = 1024 * 1024; // mirrors LIMITS.bundleBlobMax in js/menu-exchange.js

async function importInline(request, sender) {
	const text = request && request.json;
	if (typeof text !== 'string' || !text) return { success: false, error: 'Missing payload' };
	if (new TextEncoder().encode(text).length > IMPORT_INLINE_MAX_BYTES) {
		return { success: false, error: 'Payload too large' };
	}
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		return { success: false, error: 'Invalid JSON' };
	}
	return await stashPendingImport(json, sender.url || sender.tab?.url || '', sender);
}

// ---- Favicon resolution (cross-browser; replaces Chrome-only /_favicon/) ----
// Fetches the site's own favicon once (parsing <link rel="icon">, then
// /favicon.ico), stores it as a data URL in storage.local, and serves from cache.
const FAVICON_CACHE_KEY = 'faviconCache';
const FAVICON_TTL_HIT = 1000 * 60 * 60 * 24 * 30; // 30 days
const FAVICON_TTL_MISS = 1000 * 60 * 60 * 24 * 3; // 3 days (retry sooner)
const FAVICON_MAX_BYTES = 60000;
const faviconInflight = new Map();

function faviconFetch(url, ms) {
	const ctl = new AbortController();
	const t = setTimeout(() => ctl.abort(), ms || 4000);
	return fetch(url, { signal: ctl.signal, credentials: 'omit', redirect: 'follow' })
		.catch(() => null)
		.finally(() => clearTimeout(t));
}

function bytesToBase64(bytes) {
	let bin = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
	}
	return btoa(bin);
}

async function faviconToDataUrl(url) {
	const res = await faviconFetch(url);
	if (!res || !res.ok) return null;
	const ct = (res.headers.get('content-type') || '').toLowerCase().split(';')[0];
	if (ct && !ct.startsWith('image/')) return null; // reject HTML error pages
	const buf = await res.arrayBuffer().catch(() => null);
	if (!buf || !buf.byteLength || buf.byteLength > FAVICON_MAX_BYTES) return null;
	const mime = ct && ct.startsWith('image/') ? ct : 'image/x-icon';
	return `data:${mime};base64,${bytesToBase64(new Uint8Array(buf))}`;
}

async function faviconFetchFresh(origin) {
	// 1) parse the page head for <link rel="icon">
	const res = await faviconFetch(origin + '/');
	if (res && res.ok) {
		const html = (await res.text().catch(() => '')).slice(0, 50000);
		const links = self.FlowMouseFavicon.parseIconLinks(html, origin + '/');
		const best = self.FlowMouseFavicon.pickBestIconHref(links, 32);
		if (best) {
			const icon = await faviconToDataUrl(best);
			if (icon) return icon;
		}
	}
	// 2) fallback: /favicon.ico
	return await faviconToDataUrl(origin + '/favicon.ico');
}

async function resolveFavicon(pageUrl) {
	let origin;
	try { origin = new URL(pageUrl).origin; } catch { return null; }
	if (!/^https?:$/.test(new URL(origin).protocol)) return null;

	const store = await chrome.storage.local.get(FAVICON_CACHE_KEY);
	const cache = store[FAVICON_CACHE_KEY] || {};
	const hit = cache[origin];
	const now = Date.now();
	if (hit && (now - hit.ts) < (hit.icon ? FAVICON_TTL_HIT : FAVICON_TTL_MISS)) {
		return hit.icon;
	}

	if (faviconInflight.has(origin)) return faviconInflight.get(origin);
	const job = (async () => {
		let icon = null;
		try { icon = await faviconFetchFresh(origin); } catch { icon = null; }
		try {
			const fresh = (await chrome.storage.local.get(FAVICON_CACHE_KEY))[FAVICON_CACHE_KEY] || {};
			fresh[origin] = { icon, ts: Date.now() };
			await chrome.storage.local.set({ [FAVICON_CACHE_KEY]: fresh });
		} catch { }
		return icon;
	})().finally(() => faviconInflight.delete(origin));
	faviconInflight.set(origin, job);
	return job;
}

chrome.runtime.onMessage.addListener(asyncMessageHandler(async (request, sender) => {
	if (request.useActiveTab && sender.tab) {
		const [activeTab] = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
		if (activeTab) {
			sender = { ...sender, tab: activeTab };
		}
	}

	return await handleAction(request, sender);
}));

chrome.runtime.onInstalled.addListener((details) => {
	function compareVersions(a, b) {
		const partsA = a.split('.').map(Number);
		const partsB = b.split('.').map(Number);
		for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
			const segA = partsA[i] || 0;
			const segB = partsB[i] || 0;
			if (segA !== segB) return segA > segB ? 1 : -1;
		}
		return 0;
	}

	if (details.reason === 'install') {
		chrome.tabs.create({
			url: chrome.runtime.getURL('pages/tutorial.html'),
			active: true
		});
	}

	if (details.reason === 'update' && details.previousVersion) {
		if (details.previousVersion.startsWith('1.1')) {
			chrome.storage.sync.get(['imageDragGestures'], (items) => {
				const gestures = items.imageDragGestures;
				if (Array.isArray(gestures)) {
					let changed = false;
					const newGestures = gestures.map(g => {
						if (g.action === 'customSearch') {
							changed = true;
							return {
								...g,
								action: 'imageSearch',
								engine: 'custom',
							};
						}
						return g;
					});

					if (changed) {
						chrome.storage.sync.set({ imageDragGestures: newGestures });
					}
				}
			});
		}

		function migrateScrollAmount() {
			chrome.storage.sync.get(['scrollAmount', 'scrollSmoothness', 'mouseGestures'], (items) => {
				if (items.scrollAmount === undefined && items.scrollSmoothness === undefined) return;

				const mouseGestures = items.mouseGestures || {};
				const scrollDistance = items.scrollAmount;

				if (scrollDistance !== undefined) {
					for (const config of Object.values(mouseGestures)) {
						if ((config.action === 'scrollUp' || config.action === 'scrollDown') && config.scrollDistance === undefined) {
							config.scrollDistance = Number(scrollDistance);
						}
					}
				}

				chrome.storage.sync.set({ mouseGestures }, () => {
					chrome.storage.sync.remove(['scrollAmount', 'scrollSmoothness']);
				});
			});
		}

		chrome.storage.sync.get(['gestures', 'customGestures', 'customGestureUrls', 'mouseGestures'], (items) => {
			if (items.mouseGestures && Object.keys(items.mouseGestures).length > 0) {
				migrateScrollAmount();
				return;
			}
			if (!items.customGestures && !items.customGestureUrls && !items.gestures) {
				migrateScrollAmount();
				return;
			}

			const LEGACY_DEFAULT_GESTURES = {
				'←': 'back', '→': 'forward', '↑': 'scrollUp', '↓': 'scrollDown',
				'↓→': 'closeTab', '←↑': 'restoreTab', '→↑': 'newTab', '→↓': 'refresh',
				'↑←': 'switchLeftTab', '↑→': 'switchRightTab', '↓←': 'stopLoading',
				'←↓': 'closeAllTabs', '↑↓': 'scrollToBottom', '↓↑': 'scrollToTop',
				'←→': 'closeTab', '→←': 'restoreTab',
			};
			const baseGestures = items.gestures || LEGACY_DEFAULT_GESTURES;
			const customGestures = items.customGestures || {};
			const customGestureUrls = items.customGestureUrls || {};
			const merged = { ...baseGestures, ...customGestures };

			const mouseGestures = {};
			for (const [pattern, action] of Object.entries(merged)) {
				if (action === null) continue;
				const entry = { action };
				if (customGestureUrls[pattern]) entry.customUrl = customGestureUrls[pattern];
				mouseGestures[pattern] = entry;
			}

			chrome.storage.sync.remove(['gestures', 'customGestures', 'customGestureUrls'], () => {
				chrome.storage.sync.set({ mouseGestures }, () => {
					migrateScrollAmount();
				});
			});
		});

		chrome.storage.sync.get(['enableAdvancedSettings', 'sectionAdvanced'], (items) => {
			if (items.sectionAdvanced !== undefined || items.enableAdvancedSettings === undefined) {
				return;
			}

			if (items.enableAdvancedSettings === true) {
				chrome.storage.sync.set({
					sectionAdvanced: { basic: true, drag: true }
				}, () => {
					chrome.storage.sync.remove(['enableAdvancedSettings']);
				});
			} else {
				chrome.storage.sync.set({
					sectionAdvanced: {}
				}, () => {
					chrome.storage.sync.remove(['enableAdvancedSettings']);
				});
			}
		});

		if (details.previousVersion.startsWith('1.2')) {
			const isMacOrLinux = /Mac|Linux/i.test(navigator.platform);
			if (isMacOrLinux) {
				chrome.storage.sync.set({ macLinuxHintDismissed: true });
			}
		}

		if (compareVersions(details.previousVersion, '2.0.2') <= 0) {
			chrome.storage.sync.set({ enableSuggestedGestures: false });
		}

		chrome.storage.sync.get(['mouseGestures', 'wheelGestures', 'specialGestures', 'actionChains'], (items) => {
			const updates = {};
			let changed = false;

			if (items.mouseGestures) {
				const mg = structuredClone(items.mouseGestures);
				for (const [pattern, config] of Object.entries(mg)) {
					if (config.action === 'copyUrl' && config.includeTitle) {
						config.action = 'copyTitleAndUrl';
						delete config.includeTitle;
						changed = true;
					}
				}
				if (changed) updates.mouseGestures = mg;
			}

			if (items.wheelGestures) {
				const wg = structuredClone(items.wheelGestures);
				let wgChanged = false;
				for (const config of Object.values(wg)) {
					if (config.action === 'copyUrl' && config.includeTitle) {
						config.action = 'copyTitleAndUrl';
						delete config.includeTitle;
						wgChanged = true;
					}
				}
				if (wgChanged) { updates.wheelGestures = wg; changed = true; }
			}

			if (items.specialGestures) {
				const sg = structuredClone(items.specialGestures);
				let sgChanged = false;
				for (const config of Object.values(sg)) {
					if (config.action === 'copyUrl' && config.includeTitle) {
						config.action = 'copyTitleAndUrl';
						delete config.includeTitle;
						sgChanged = true;
					}
				}
				if (sgChanged) { updates.specialGestures = sg; changed = true; }
			}

			if (items.actionChains) {
				const ac = structuredClone(items.actionChains);
				let acChanged = false;
				for (const chain of Object.values(ac)) {
					if (!chain.steps) continue;
					for (const step of chain.steps) {
						if (step.action === 'copyUrl' && step.includeTitle) {
							step.action = 'copyTitleAndUrl';
							delete step.includeTitle;
							acChanged = true;
						}
					}
				}
				if (acChanged) { updates.actionChains = ac; changed = true; }
			}

			if (changed) chrome.storage.sync.set(updates);
		});
	}


	{
		async function reinjectContentScripts(dispose) {
			const contentScript = chrome.runtime.getManifest().content_scripts[0];
			const tabs = await chrome.tabs.query({});
			for (const tab of tabs) {
				if (isRestrictedUrl(tab.url)) continue;
				try {
					if (dispose) {
						await chrome.scripting.executeScript({
							target: { tabId: tab.id, allFrames: contentScript.all_frames },
							func: () => window.dispatchEvent(new CustomEvent('flowmouse:dispose', { detail: { extensionId: chrome.runtime.id } })),
						});
					}
					await chrome.scripting.executeScript({
						target: { tabId: tab.id, allFrames: contentScript.all_frames },
						files: contentScript.js,
					});
				} catch {
				}
			}
		}

		if (details.reason === 'install' || (details.reason === 'update' && compareVersions(details.previousVersion, '1.50') > 0)) {
			reinjectContentScripts(details.reason === 'update');
		}
	}
});



const MENU_ID_REFRESH = 'flowmouse-need-refresh';
const MENU_ID_RESTRICTED = 'flowmouse-restricted';
const MENU_ID_BLACKLIST = 'flowmouse-blacklist-toggle';
const MENU_ID_OPTIONS = 'flowmouse-open-options';
const MENU_ID_SITEMENU = 'flowmouse-open-sitemenu';
const MENU_ID_ADD_PARENT = 'flowmouse-add-site-parent';
const MENU_ID_ASSIGN_PARENT = 'flowmouse-assign-site-parent';
const MENU_ID_ASSIGN_CLEAR = 'flowmouse-assign-clear';
const CTX_ADD_PREFIX = 'flowmouse-add-site::';   // + menuId (Seite/Bild)
const CTX_ADD_LINK_PREFIX = 'flowmouse-add-link::';   // + menuId (Link)
const CTX_REMOVE_PREFIX = 'flowmouse-remove-site::';   // + menuId (Seite/Bild)
const CTX_ASSIGN_PREFIX = 'flowmouse-assign-site::';   // + menuId

function menuDisplayName(m) {
	// m = Eintrag aus listActiveMenus (hat .id, .def)
	const def = m.def || {};
	return def.name || getMsg(def.nameKey, '') || m.id;
}

function activeSiteMenus() {
	const sm = self._siteMenusCache || {};
	return self.FlowMouseMenuModel.listActiveMenus(self.FlowMouseMenuCatalog.SITE_MENU_CATALOG, sm);
}

function matchingSiteMenuIds(url) {
	if (!url) return [];
	const mp = self.FlowMouseSearchUrl.matchesPatterns;
	return activeSiteMenus()
		.filter(m => (m.def.patterns || []).length && mp(url, m.def.patterns))
		.map(m => m.id);
}

// Löst die Zuordnung einer Seite: entfernt aus allen aktiven Menüs die Muster,
// die auf url passen, und gibt sie zusammen mit den geänderten siteMenus
// zurück. Die Muster sind die Basis fürs Umhängen auf ein anderes Menü.
function detachSitePatterns(siteMenus, url) {
	const catalog = self.FlowMouseMenuCatalog.SITE_MENU_CATALOG;
	const mp = self.FlowMouseSearchUrl.matchesPatterns;
	const model = self.FlowMouseMenuModel;
	const ids = model.listActiveMenus(catalog, siteMenus).map(m => m.id);
	let sm = siteMenus;
	const patterns = [];
	for (const id of ids) {
		for (const p of model.patternsMatchingUrl(catalog, sm, id, url, mp)) {
			if (!patterns.includes(p)) patterns.push(p);
			({ siteMenus: sm } = model.removePatternFromMenu(catalog, sm, id, p));
		}
	}
	return { siteMenus: sm, patterns };
}

let fileSchemeAllowed = false;
chrome.extension.isAllowedFileSchemeAccess().then(v => { fileSchemeAllowed = v; });

function isRestrictedUrl(url) {
	if (!url) return true;

	if (url.startsWith(chrome.runtime.getURL(''))) {
		return false;
	}

	if (url.startsWith('file:')) {
		return !fileSchemeAllowed;
	}

	const restrictedProtocols = ['chrome:', 'chrome-extension:', 'moz-extension:', 'about:', 'edge:', 'view-source:', 'devtools:'];
	for (const protocol of restrictedProtocols) {
		if (url.startsWith(protocol)) return true;
	}

	{
		if (url.startsWith('https://chrome.google.com/webstore') ||
			url.startsWith('https://chromewebstore.google.com') ||
			(isEdge && url.startsWith('https://microsoftedge.microsoft.com/addons'))) {
			return true;
		}
	}

	return false;
}

async function isContentScriptLoaded(tabId) {
	try {
		const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
		return response && response.pong === true;
	} catch (e) {
		return false;
	}
}

function getMsg(key, fallback) {
	try {
		if (typeof key !== 'string') {
			return fallback
		}
		const msg = chrome.i18n.getMessage(key);
		return msg || fallback;
	} catch (e) {
		return fallback;
	}
}

function createBlacklistMenu(isInBlacklist) {
	const title = isInBlacklist
		? chrome.i18n.getMessage('menuRemoveFromBlacklist')
		: chrome.i18n.getMessage('menuAddToBlacklist');
	chrome.contextMenus.create({
		id: MENU_ID_BLACKLIST,
		title: title,
		contexts: ['all']
	}, () => { chrome.runtime.lastError; });
}

function createRefreshMenu() {
	const title = chrome.i18n.getMessage('menuNeedRefresh');
	chrome.contextMenus.create({
		id: MENU_ID_REFRESH,
		title: title,
		contexts: ['all']
	}, () => { chrome.runtime.lastError; });
}

function createRestrictedMenu() {
	const title = chrome.i18n.getMessage('menuRestricted');
	chrome.contextMenus.create({
		id: MENU_ID_RESTRICTED,
		title: title,
		contexts: ['all']
	}, () => { chrome.runtime.lastError; });
}

function updateBadge(tabId, status) {
	if (status === 'normal') {
		chrome.action.setBadgeText({ tabId: tabId, text: '' });
	} else if (status === 'restricted') {
		chrome.action.setBadgeText({ tabId: tabId, text: '!' });
		chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: '#FFA500' });
	} else if (status === 'needRefresh') {
		chrome.action.setBadgeText({ tabId: tabId, text: '!' });
		chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: '#4285f4' });
	}
}

// Aufbau-Generation: chrome.tabs.onUpdated und onActivated können sich
// überlappen, und updateMenuForTab hat mehrere await-Punkte. Ohne Guard baut
// ein älterer Lauf nach dem removeAll() eines jüngeren weiter auf und
// hinterlässt Einträge aus der vorigen Seite (z. B. ein „Zu Menü X
// hinzufügen“ über den frisch erzeugten Einträgen).
let menuBuildSeq = 0;

async function updateMenuForTab(tab) {
	const tabId = tab.id;
	const url = tab.url;
	const status = tab.status;
	const gen = ++menuBuildSeq;
	const stale = () => gen !== menuBuildSeq;

	// Immer zuerst alles wegräumen; unten in fester Reihenfolge neu aufbauen.
	// removeAll() statt Buchführung über erzeugte IDs: die dynamischen
	// „…::<menuId>“-Einträge überlebten sonst einen Neustart des Service
	// Workers, weil die ID-Liste nur im Worker-Speicher lag.
	await chrome.contextMenus.removeAll();
	if (stale()) return;

	if (status === 'loading') {
		updateBadge(tabId, 'normal');
		return;
	}

	const items = await chrome.storage.sync.get(['showRestrictedNotice', 'blacklist', 'enableBlacklistContextMenu', 'enableBlacklist', 'enableSiteMenus', 'enableContextMenu', 'ctxMenuAddSite', 'ctxMenuAssignSite', 'ctxMenuSiteMenu', 'ctxMenuSiteMenuMode', 'ctxMenuSiteMenuId', 'ctxMenuOptions', 'siteMenuAddAsk', 'siteMenus']);
	if (stale()) return;
	self._siteMenusCache = items.siteMenus || {};

	// Kontextmenü-Feature aus → gar kein FlowMouse-Eintrag im Rechtsklick-Menü.
	if (items.enableContextMenu === false) {
		updateBadge(tabId, 'normal');
		return;
	}

	const blacklistEnabled = items.enableBlacklist !== false;
	const siteMenusOn = items.enableSiteMenus !== false;
	const showNotice = items.showRestrictedNotice !== false;
	let hostname = null;
	try {
		if (url) hostname = new URL(url).hostname;
	} catch (e) {
	}
	const restricted = isRestrictedUrl(url);
	const isBlacklistedHost = blacklistEnabled && hostname && Array.isArray(items.blacklist) && items.blacklist.includes(hostname);
	const pageOk = !!hostname && !restricted && !isBlacklistedHost;

	// Reihenfolge im Rechtsklick-Menü:
	// 1) Optionen  2) Gesten-Toggle  3) Hinweis  4) Website-Menü öffnen
	// 5) Zu Menü hinzufügen  6) Website-Menü für diese Seite festlegen

	// 1) Optionen
	if (items.ctxMenuOptions !== false) {
		chrome.contextMenus.create({
			id: MENU_ID_OPTIONS,
			title: getMsg('menuOptions', 'Options'),
			contexts: ['all']
		}, () => { chrome.runtime.lastError; });
	}

	// 2) Gesten für aktuelle Seite deaktivieren/aktivieren
	if (blacklistEnabled && items.enableBlacklistContextMenu && hostname && !restricted) {
		createBlacklistMenu(isBlacklistedHost);
	}

	// 3) Hinweis bei eingeschränkten / nicht geladenen Seiten (+ Badge)
	let badge = 'normal';
	if (isBlacklistedHost) {
		badge = 'normal';
	} else if (restricted) {
		if (showNotice) {
			createRestrictedMenu();
			badge = 'restricted';
		}
	} else if (hostname) {
		const loaded = await isContentScriptLoaded(tabId);
		if (stale()) return;
		if (!loaded && showNotice) {
			createRefreshMenu();
			badge = 'needRefresh';
		}
	}

	// 4) Website-Menü öffnen
	if (pageOk && siteMenusOn && items.ctxMenuSiteMenu !== false) {
		chrome.contextMenus.create({
			id: MENU_ID_SITEMENU,
			title: getMsg('menuOpenSiteMenu', 'Website menu'),
			contexts: ['all']
		}, () => { chrome.runtime.lastError; });
	}

	// 5) Zu einem Website-Menü hinzufügen bzw. wieder daraus entfernen
	if (pageOk && siteMenusOn && items.ctxMenuAddSite !== false) {
		const matches = matchingSiteMenuIds(url);
		const active = activeSiteMenus();

		// Pro Menü zwei Einträge, die einander ausschließen: Chrome blendet den
		// Link-Eintrag nur beim Rechtsklick auf einen Link ein, den Seiten-Eintrag
		// nur sonst. Nötig, weil der Seiten-Eintrag auf „entfernen“ kippt, sobald
		// die Seite schon im Menü steht — der Zielort eines Links aber beim Aufbau
		// des Menüs noch unbekannt ist und dort weiterhin „hinzufügen“ gelten muss.
		const addEntries = (m, parentId) => {
			const name = menuDisplayName(m);
			const has = !!self.FlowMouseMenuModel.findLinkInMenu(
				self.FlowMouseMenuCatalog.SITE_MENU_CATALOG, self._siteMenusCache, m.id, url);
			const named = (key, fallback) => getMsg(key, fallback).replace('{NAME}', name);
			const parent = parentId ? { parentId } : {};
			chrome.contextMenus.create({
				...parent,
				id: (has ? CTX_REMOVE_PREFIX : CTX_ADD_PREFIX) + m.id,
				// Im Untermenü tragen die Kinder sonst nur den Menünamen; ein
				// „entfernen“ muss dort aber ausgeschrieben stehen.
				title: (has || !parentId) ? named(has ? 'menuRemoveSiteFromNamed' : 'menuAddSiteToNamed', has ? 'Remove from menu' : 'Add to menu') : name,
				contexts: ['page', 'image']
			}, () => { chrome.runtime.lastError; });
			chrome.contextMenus.create({
				...parent,
				id: CTX_ADD_LINK_PREFIX + m.id,
				title: parentId ? name : named('menuAddSiteToNamed', 'Add to menu'),
				contexts: ['link']
			}, () => { chrome.runtime.lastError; });
		};

		if (matches.length === 1) {
			addEntries(active.find(x => x.id === matches[0]), null);
		} else if (items.siteMenuAddAsk !== false) {
			chrome.contextMenus.create({
				id: MENU_ID_ADD_PARENT,
				title: getMsg('menuAddSiteToMenu', 'Add this site to menu'),
				contexts: ['page', 'link', 'image']
			}, () => { chrome.runtime.lastError; });
			for (const m of active) addEntries(m, MENU_ID_ADD_PARENT);
		} else {
			// Nicht fragen: still ins exklusive Standard-Menü (falls aktiv)
			const dm = self._siteMenusCache.defaultMenuId || '';
			const m = dm ? active.find(x => x.id === dm) : null;
			if (m) addEntries(m, null);
		}
	}

	// 6) Website-Menü für diese Seite festlegen bzw. bestehende Zuordnung
	//    umhängen/entfernen. Anders als 5) legt das nur ein Muster an — kein
	//    Link-Eintrag im Menü.
	if (pageOk && siteMenusOn && items.ctxMenuAssignSite !== false) {
		const active = activeSiteMenus();
		const assigned = matchingSiteMenuIds(url);
		if (assigned.length) {
			// Zugeordnet: Untermenü zum Umhängen auf ein anderes Menü + Entfernen.
			const cur = active.find(x => x.id === assigned[0]);
			chrome.contextMenus.create({
				id: MENU_ID_ASSIGN_PARENT,
				title: getMsg('menuAssignedToNamed', 'Assigned to: {NAME}').replace('{NAME}', menuDisplayName(cur)),
				contexts: ['all']
			}, () => { chrome.runtime.lastError; });
			const others = active.filter(m => !assigned.includes(m.id));
			for (const m of others) {
				chrome.contextMenus.create({
					id: CTX_ASSIGN_PREFIX + m.id,
					parentId: MENU_ID_ASSIGN_PARENT,
					title: menuDisplayName(m),
					contexts: ['all']
				}, () => { chrome.runtime.lastError; });
			}
			if (others.length) {
				chrome.contextMenus.create({
					id: MENU_ID_ASSIGN_PARENT + '-sep',
					parentId: MENU_ID_ASSIGN_PARENT,
					type: 'separator',
					contexts: ['all']
				}, () => { chrome.runtime.lastError; });
			}
			chrome.contextMenus.create({
				id: MENU_ID_ASSIGN_CLEAR,
				parentId: MENU_ID_ASSIGN_PARENT,
				title: getMsg('menuAssignClear', 'Remove assignment'),
				contexts: ['all']
			}, () => { chrome.runtime.lastError; });
		} else if (active.length) {
			chrome.contextMenus.create({
				id: MENU_ID_ASSIGN_PARENT,
				title: getMsg('menuAssignSiteToMenu', 'Set website menu for this page'),
				contexts: ['all']
			}, () => { chrome.runtime.lastError; });
			for (const m of active) {
				chrome.contextMenus.create({
					id: CTX_ASSIGN_PREFIX + m.id,
					parentId: MENU_ID_ASSIGN_PARENT,
					title: menuDisplayName(m),
					contexts: ['all']
				}, () => { chrome.runtime.lastError; });
			}
		}
	}

	updateBadge(tabId, badge);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if ((changeInfo.status === 'loading' || changeInfo.status === 'complete') && tab.active) {
		updateMenuForTab(tab);
	}
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
	try {
		const tab = await chrome.tabs.get(activeInfo.tabId);
		updateMenuForTab(tab);
	} catch (e) {
	}
});

async function openOptionsPage(hash) {
	const optionsUrl = chrome.runtime.getURL('pages/options.html');
	const targetUrl = optionsUrl + (hash || '');
	const tabs = await chrome.tabs.query({});
	const existingTab = tabs.find(t => t.url && t.url.startsWith(optionsUrl));
	if (existingTab) {
		await chrome.tabs.update(existingTab.id, { url: targetUrl, active: true });
		await chrome.windows.update(existingTab.windowId, { focused: true });
	} else {
		chrome.tabs.create({ url: targetUrl });
	}
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	if (info.menuItemId === MENU_ID_REFRESH) {
		if (tab && tab.id) {
			chrome.tabs.reload(tab.id);
		}
	} else if (info.menuItemId === MENU_ID_BLACKLIST) {
		if (tab && tab.url) {
			try {
				const hostname = new URL(tab.url).hostname;
				if (!hostname) return;
				const storageItems = await chrome.storage.sync.get(['blacklist']);
				let blacklist = storageItems.blacklist || [];
				if (blacklist.includes(hostname)) {
					blacklist = blacklist.filter(d => d !== hostname);
				} else {
					blacklist = [...blacklist, hostname];
				}
				await chrome.storage.sync.set({ blacklist });
			} catch (e) {
			}
		}
	} else if (info.menuItemId === MENU_ID_RESTRICTED) {
		await openOptionsPage('#restricted-notice');
	} else if (info.menuItemId === MENU_ID_OPTIONS) {
		await openOptionsPage('');
	} else if (info.menuItemId === MENU_ID_SITEMENU) {
		if (!tab || !tab.id) return;
		const cfg = await chrome.storage.sync.get(['ctxMenuSiteMenuMode', 'ctxMenuSiteMenuId']);
		const menuId = cfg.ctxMenuSiteMenuId || '';
		const config = (cfg.ctxMenuSiteMenuMode === 'standard' && menuId) ? { mode: 'standard', menuId } : { mode: 'contextual' };
		chrome.tabs.sendMessage(tab.id, { action: 'openSiteMenuOverlay', config }, { frameId: info.frameId || 0 })
			.catch(() => {});
	} else if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith(CTX_REMOVE_PREFIX)) {
		// Nur im Seiten-/Bild-Kontext vorhanden, dort gibt es keine linkUrl.
		if (!tab || !tab.url) return;
		const menuId = info.menuItemId.slice(CTX_REMOVE_PREFIX.length);
		const cur = await new Promise(res => chrome.storage.sync.get(['siteMenus'], it => res(it.siteMenus || {})));
		const { siteMenus, removed } = self.FlowMouseMenuModel.removeLinkFromMenu(
			self.FlowMouseMenuCatalog.SITE_MENU_CATALOG, cur, menuId, tab.url);
		if (!removed) return;
		self._siteMenusCache = siteMenus;
		await chrome.storage.sync.set({ siteMenus });
	} else if (typeof info.menuItemId === 'string' &&
			(info.menuItemId.startsWith(CTX_ADD_PREFIX) || info.menuItemId.startsWith(CTX_ADD_LINK_PREFIX))) {
		if (!tab || !tab.url) return;
		const isLink = !!info.linkUrl;
		const menuId = info.menuItemId.slice((isLink ? CTX_ADD_LINK_PREFIX : CTX_ADD_PREFIX).length);
		const url = info.linkUrl || tab.url;
		const cur = await new Promise(res => chrome.storage.sync.get(['siteMenus'], it => res(it.siteMenus || {})));
		self._siteMenusCache = cur;

		// Beim Link-Eintrag kann das Ziel längst im Menü stehen — der Eintrag wird
		// aufgebaut, bevor feststeht, worauf geklickt wird. Ohne diese Prüfung
		// erschiene der Titel-Dialog und das Ergebnis verschwände wortlos.
		const catalog = self.FlowMouseMenuCatalog.SITE_MENU_CATALOG;
		if (self.FlowMouseMenuModel.findLinkInMenu(catalog, cur, menuId, url)) {
			const m = activeSiteMenus().find(x => x.id === menuId);
			chrome.tabs.sendMessage(tab.id, {
				action: 'ctxToast',
				text: getMsg('menuLinkAlreadyInMenu', 'Already in menu “{NAME}”').replace('{NAME}', m ? menuDisplayName(m) : menuId),
			}, { frameId: info.frameId || 0 }).catch(() => {});
			return;
		}

		const matches = matchingSiteMenuIds(tab.url);
		// Muster nur nachtragen, wenn die Seite noch nicht ohnehin genau auf
		// dieses Menü zeigt. Der Titel wird immer erfragt.
		const addPattern = !(matches.length === 1 && matches[0] === menuId);

		let label = null;
		try {
			const resp = await chrome.tabs.sendMessage(tab.id,
				{ action: 'ctxCollectMenuLabel', url, isLink },
				{ frameId: info.frameId || 0 });
			if (resp && resp.cancelled) return;
			if (resp && resp.label) label = resp.label;
		} catch (e) { /* Content nicht verfügbar → Fallback */ }
		if (!label) label = isLink ? url : (tab.title || url);

		let { siteMenus } = self.FlowMouseMenuModel.addLinkToMenu(catalog, cur, menuId, { label, url });
		if (addPattern) {
			const pat = self.FlowMouseMenuPatterns.siteToPattern(tab.url);
			({ siteMenus } = self.FlowMouseMenuModel.addPatternToMenu(catalog, siteMenus, menuId, pat));
		}
		await chrome.storage.sync.set({ siteMenus });
	} else if (info.menuItemId === MENU_ID_ASSIGN_CLEAR) {
		if (!tab || !tab.url) return;
		const cur = await chrome.storage.sync.get(['siteMenus']);
		const { siteMenus, patterns } = detachSitePatterns(cur.siteMenus || {}, tab.url);
		if (!patterns.length) return;
		self._siteMenusCache = siteMenus;
		await chrome.storage.sync.set({ siteMenus });
	} else if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith(CTX_ASSIGN_PREFIX)) {
		if (!tab || !tab.url) return;
		const menuId = info.menuItemId.slice(CTX_ASSIGN_PREFIX.length);
		const catalog = self.FlowMouseMenuCatalog.SITE_MENU_CATALOG;
		const cur = await chrome.storage.sync.get(['siteMenus']);
		const model = self.FlowMouseMenuModel;

		// Bestehende Zuordnung → Muster unverändert umhängen (ohne Dialog).
		// Keine Zuordnung → Muster im Dialog bestätigen/bearbeiten lassen.
		let { siteMenus, patterns } = detachSitePatterns(cur.siteMenus || {}, tab.url);
		if (!patterns.length) {
			const domainPattern = self.FlowMouseMenuPatterns.siteToPattern(tab.url);
			if (!domainPattern) return;
			const pagePattern = self.FlowMouseMenuPatterns.pageToPattern(tab.url) || domainPattern;
			let pattern = domainPattern;
			try {
				const resp = await chrome.tabs.sendMessage(tab.id,
					{ action: 'ctxCollectPattern', domainPattern, pagePattern },
					{ frameId: info.frameId || 0 });
				if (resp && resp.cancelled) return;
				if (resp && resp.pattern) pattern = resp.pattern;
			} catch (e) { /* Content nicht verfügbar → ganze Domain ungefragt übernehmen */ }
			patterns = [pattern];
		}
		for (const p of patterns) {
			({ siteMenus } = model.addPatternToMenu(catalog, siteMenus, menuId, p));
		}
		self._siteMenusCache = siteMenus;
		await chrome.storage.sync.set({ siteMenus });
	}
});

chrome.storage.onChanged.addListener((changes, namespace) => {
	if (namespace === 'sync') {
		if (changes.showRestrictedNotice || changes.language || changes.enableBlacklistContextMenu || changes.blacklist || changes.enableBlacklist ||
			changes.enableSiteMenus || changes.enableContextMenu || changes.ctxMenuAddSite || changes.ctxMenuAssignSite || changes.ctxMenuSiteMenu ||
			changes.ctxMenuSiteMenuMode || changes.ctxMenuSiteMenuId || changes.ctxMenuOptions || changes.siteMenuAddAsk || changes.siteMenus) {
			chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
				if (tabs[0]) {
					updateMenuForTab(tabs[0]);
				}
			});
		}
	}
});

function getFilename(url, mimeType) {
	let filename = null;

	if (url && !url.startsWith('data:')) {
		try {
			const urlObj = new URL(url);
			const pathname = urlObj.pathname;
			const name = pathname.substring(pathname.lastIndexOf('/') + 1);
			if (name && name.length > 0 && name.length < 255) {
				filename = decodeURIComponent(name);
			}
		} catch (e) {
		}
	}

	if (!filename) {
		filename = 'image';
	}

	if (mimeType) {
		const safeMime = mimeType.split(';')[0].trim().toLowerCase();
		const mimeMap = {
			'image/jpeg': '.jpg',
			'image/jpg': '.jpg',
			'image/png': '.png',
			'image/gif': '.gif',
			'image/webp': '.webp',
			'image/bmp': '.bmp',
			'image/svg+xml': '.svg',
			'image/x-icon': '.ico',
			'image/vnd.microsoft.icon': '.ico',
			'image/avif': '.avif',
			'image/jxl': '.jxl',
			'image/tiff': '.tiff'
		};

		const ext = mimeMap[safeMime];
		if (ext) {
			if (!/\.[a-zA-Z0-9]+$/i.test(filename)) {
				filename += ext;
			}
		} else if (safeMime.startsWith('image/')) {
			const subType = safeMime.split('/')[1];
			if (subType && /^[a-z0-9]+$/i.test(subType) && subType.length < 10) {
				if (!/\.[a-zA-Z0-9]+$/i.test(filename)) {
					filename += '.' + subType;
				}
			}
		}
	}

	return filename;
}

function findResourceInMhtml(mhtmlContent, targetUrl) {
	if (!mhtmlContent || !targetUrl) return null;

	const boundaryMatch = mhtmlContent.match(/Content-Type:\s*multipart\/related;[\s\S]*?boundary="?([^";\r\n]+)"?/i);
	if (!boundaryMatch) return null;

	const boundary = '--' + boundaryMatch[1];

	const parts = mhtmlContent.split(boundary);

	for (const part of parts) {
		if (!part || part.trim() === '--') continue;

		const headerEndIndex = part.indexOf('\r\n\r\n');
		if (headerEndIndex === -1) continue;

		const headersRaw = part.substring(0, headerEndIndex);
		const bodyRaw = part.substring(headerEndIndex + 4);

		const locationMatch = headersRaw.match(/Content-Location:\s*([^\r\n]+)/i);
		if (locationMatch) {
			const location = locationMatch[1].trim();

			if (location === targetUrl) {
				const typeMatch = headersRaw.match(/Content-Type:\s*([^\r\n;]+)/i);
				const encodingMatch = headersRaw.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);

				const type = typeMatch ? typeMatch[1].trim() : 'application/octet-stream';
				const encoding = encodingMatch ? encodingMatch[1].trim().toLowerCase() : 'binary';

				let dataUrl = null;

				if (encoding === 'base64') {
					const cleanBody = bodyRaw.replace(/[\r\n\s]+/g, '');
					dataUrl = `data:${type};base64,${cleanBody}`;
				} else if (encoding === 'quoted-printable') {
					let decoded = bodyRaw.replace(/=(?:\r\n|\r|\n)/g, '');

					decoded = decoded.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
						return String.fromCharCode(parseInt(hex, 16));
					});

					const base64 = btoa(decoded);
					dataUrl = `data:${type};base64,${base64}`;
				}

				return {
					type,
					encoding,
					dataUrl
				};
			}
		}
	}

	return null;
}

async function notifyDownloadError(tabId) {
	if (tabId) {
		await chrome.tabs.sendMessage(tabId, { action: 'showDownloadError' }).catch(() => { });
	}
}

async function requestPermission(permissions, windowId) {
	if (permissions.includes('incognito')) {
		const isAllowed = await chrome.extension.isAllowedIncognitoAccess();
		if (isAllowed) return true;
	} else {
		const hasPermission = await chrome.permissions.contains({ permissions: permissions });
		if (hasPermission) return true;
	}

	return new Promise((resolve) => {
		const permUrl = chrome.runtime.getURL(`pages/permission.html?permissions=${permissions.join(',')}`);

		const checkGranted = async () => {
			if (permissions.includes('incognito')) {
				return await chrome.extension.isAllowedIncognitoAccess();
			}
			return await chrome.permissions.contains({ permissions: permissions });
		};

		const openAsTab = async () => {
			const tab = await chrome.tabs.create({ url: permUrl, active: true });
			const onTabRemoved = async (tabId) => {
				if (tabId === tab.id) {
					chrome.tabs.onRemoved.removeListener(onTabRemoved);
					resolve(await checkGranted());
				}
			};
			chrome.tabs.onRemoved.addListener(onTabRemoved);
		};

		const openPermissionWindow = async (winOptions) => {
			try {
				const popupWindow = await chrome.windows.create({
					url: permUrl,
					type: 'popup',
					width: 340,
					height: 380,
					left: winOptions?.left,
					top: winOptions?.top,
					focused: true
				});

				if (!popupWindow) {
					await openAsTab();
					return;
				}

				const onRemoved = async (closedWindowId) => {
					if (closedWindowId === popupWindow.id) {
						chrome.windows.onRemoved.removeListener(onRemoved);
						resolve(await checkGranted());
					}
				};
				chrome.windows.onRemoved.addListener(onRemoved);
			} catch (e) {
				try {
					await openAsTab();
				} catch (e2) {
					console.error('Failed to open permission popup:', e2);
					resolve(false);
				}
			}
		};

		if (windowId) {
			chrome.windows.get(windowId).then((win) => {
				const width = 340;
				const height = 380;
				const left = Math.round(win.left + (win.width - width) / 2);
				const top = Math.round(win.top + (win.height - height) / 2);
				openPermissionWindow({ left, top });
			}).catch(() => {
				openPermissionWindow(null);
			});
		} else {
			openPermissionWindow(null);
		}
	});
}
