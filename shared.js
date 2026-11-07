// Helpers shared by the board page (app.html) and the background service worker.
// Loaded with <script> in app.html and importScripts() in background.js.

const APP_URL = chrome.runtime.getURL('app.html');
const APP_TITLE = 'Reflection Board';
const EXTENSION_ORIGIN = chrome.runtime.getURL('');

// Identify the board tab by URL rather than title, so a web page titled
// "Reflection Board" is never mistaken for it. Saved files may come from an
// install with a different extension id, so for those we also accept any
// extension's app.html carrying the board's title.
function isBoardTab(tab) {
    if (!tab || !tab.url) return false;
    if (tab.url.startsWith(APP_URL)) return true;
    return tab.url.startsWith('chrome-extension://') && tab.url.includes('/app.html') && tab.title === APP_TITLE;
}

// Any page belonging to this extension (board, tab switcher, ...).
function isOwnPage(url) {
    return typeof url === 'string' && url.startsWith(EXTENSION_ORIGIN);
}

// Favicon for any page URL, served by the browser (needs the "favicon" permission).
function getFaviconUrl(pageUrl, size = 32) {
    const url = new URL(chrome.runtime.getURL('_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', size.toString());
    return url.toString();
}

// Saved layout format (JSON files, internal save and autosave):
//   [{ windowId, title, tabs: [{ id, title, url, windowId, groupId }] }, ...]
// `groups` is an array of tab arrays, one per window.
function serializeTabGroups(groups, titles) {
    return groups.map(group => {
        if (!group || !group.length) return null;
        const windowId = group[0].windowId;
        return {
            windowId,
            title: titles[windowId] || '',
            tabs: group.map(tab => ({
                id: tab.id,
                title: tab.title,
                url: tab.url,
                windowId: tab.windowId,
                groupId: tab.groupId || null,
            })),
        };
    }).filter(Boolean);
}

// Tab screenshots for the full preview, kept in IndexedDB (shared by the board
// and the service worker). Keyed by tab id; each record is
// { url, blob, at } where `url` is the address the screenshot shows.
const PreviewStore = (() => {
    let dbPromise = null;
    function open() {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const req = indexedDB.open('tab-previews', 1);
                req.onupgradeneeded = () => req.result.createObjectStore('shots');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
        return dbPromise;
    }
    async function run(mode, fn) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('shots', mode);
            const req = fn(tx.objectStore('shots'));
            tx.oncomplete = () => resolve(req ? req.result : undefined);
            tx.onerror = () => reject(tx.error);
        });
    }
    return {
        get: (tabId) => run('readonly', s => s.get(tabId)),
        put: (tabId, record) => run('readwrite', s => s.put(record, tabId)),
        delete: (tabId) => run('readwrite', s => s.delete(tabId)),
        clear: () => run('readwrite', s => s.clear()),
    };
})();
