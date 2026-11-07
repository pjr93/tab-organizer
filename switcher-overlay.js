// Tab switcher overlay, drawn inside the current page.
// Runs as a content script in every page (and is loaded by the board).
//
// Keyboard focus stays in the page, so the overlay responds instantly.
// - Alt+Shift+Left/Right are browser shortcuts handled by background.js;
//   Alt+Shift+Up/Down are caught here and forwarded, since Chrome allows only
//   four suggested extension shortcuts.
// - While the overlay is shown: arrows move the highlight, Enter switches,
//   Esc / clicking outside / leaving the page cancels. All key and mouse input
//   is captured so it doesn't reach the page; the banner says so.
(() => {
    if (window.__tabSwitcherOverlayLoaded) return;
    window.__tabSwitcherOverlayLoaded = true;

    const BOARD_GREEN = 'green'; // same colour as the board's own tile

    let active = false;
    let done = false;
    let host = null;
    let listEl = null;
    let items = [];
    let cursor = 0;

    function send(message) {
        try {
            chrome.runtime.sendMessage(message).catch(() => { });
        } catch (e) { /* extension reloaded; nothing to talk to */ }
    }

    function finish(type, extra = {}) {
        if (!active || done) return;
        done = true;
        hide();
        send({ type, ...extra });
    }

    function hostOf(url) {
        try { return new URL(url).hostname || url.split(':')[0] + '://'; } catch (e) { return ''; }
    }

    const CSS = `
        :host { all: initial; }
        .backdrop {
            position: fixed; inset: 0; z-index: 2147483647;
            background: rgba(0, 0, 0, 0.35);
            display: flex; align-items: flex-start; justify-content: center;
            font-family: sans-serif;
        }
        .panel {
            margin-top: 12vh; width: 520px; max-width: calc(100vw - 32px);
            background: #111111; color: white;
            border: 2px solid ${BOARD_GREEN}; border-radius: 10px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
            overflow: hidden;
        }
        .banner {
            display: flex; align-items: center; gap: 10px;
            padding: 10px 14px; background: ${BOARD_GREEN}; color: white;
            font-weight: bold; font-size: 15px;
        }
        .dot { width: 10px; height: 10px; border-radius: 50%; background: white; animation: pulse 1s infinite ease-in-out; }
        @keyframes pulse { 50% { opacity: 0.3; } }
        .hint { padding: 6px 14px; font-size: 12px; color: #aaa; border-bottom: 1px solid #333; }
        ul { list-style: none; margin: 0; padding: 6px; max-height: 60vh; overflow-y: auto; }
        li {
            display: flex; align-items: center; gap: 10px;
            height: 36px; padding: 0 10px; margin-bottom: 6px;
            border: 2px solid transparent; border-radius: 8px;
            background: #1E1E1E; cursor: pointer;
            font-family: Georgia, 'Times New Roman', Times, serif; font-size: 15px;
        }
        li.current { border-color: #2196F3; background: #16324a; }
        img { width: 16px; height: 16px; flex: 0 0 auto; }
        img:not([src]) { visibility: hidden; }
        .title { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .meta { flex: 0 0 auto; color: #888; font-size: 12px; font-family: sans-serif; }
    `;

    function applyStyles(root) {
        try {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(CSS);
            root.adoptedStyleSheets = [sheet];
        } catch (e) {
            const style = document.createElement('style');
            style.textContent = CSS;
            root.appendChild(style);
        }
    }

    function render() {
        host = document.createElement('tab-switcher-overlay');
        const root = host.attachShadow({ mode: 'closed' });
        applyStyles(root);

        const backdrop = document.createElement('div');
        backdrop.className = 'backdrop';
        backdrop.addEventListener('mousedown', (e) => {
            if (e.target === backdrop) finish('switcher_cancel');
        });

        const panel = document.createElement('div');
        panel.className = 'panel';
        const banner = document.createElement('div');
        banner.className = 'banner';
        const dot = document.createElement('span');
        dot.className = 'dot';
        banner.append(dot, 'Tab switcher: keyboard input is captured');
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = 'Arrow keys to move · Enter to switch · Esc to cancel · click to pick';
        listEl = document.createElement('ul');

        items.forEach((item, i) => {
            const li = document.createElement('li');
            li.dataset.tabId = item.id;
            const icon = document.createElement('img');
            icon.alt = '';
            if (item.icon) icon.src = item.icon;
            const title = document.createElement('span');
            title.className = 'title';
            title.textContent = (item.audible ? '🔊 ' : '') + item.title;
            const meta = document.createElement('span');
            meta.className = 'meta';
            meta.textContent = hostOf(item.url) + (item.discarded ? ' · unloaded' : '');
            li.append(icon, title, meta);
            li.addEventListener('mousedown', (e) => { e.preventDefault(); finish('switcher_commit', { index: i }); });
            listEl.appendChild(li);
        });

        panel.append(banner, hint, listEl);
        backdrop.appendChild(panel);
        root.appendChild(backdrop);
        (document.documentElement || document.body).appendChild(host);
        highlight();
    }

    function highlight() {
        if (!listEl) return;
        Array.from(listEl.children).forEach((li, i) => li.classList.toggle('current', i === cursor));
        const cur = listEl.children[cursor];
        if (cur) cur.scrollIntoView({ block: 'nearest' });
    }

    function setIcons(icons) {
        if (!listEl) return;
        for (const li of listEl.children) {
            const src = icons[li.dataset.tabId];
            if (src) li.querySelector('img').src = src;
        }
    }

    function hide() {
        if (host) host.remove();
        host = null;
        listEl = null;
        active = false;
    }

    function show(newItems, newCursor) {
        hide();
        items = newItems;
        cursor = newCursor;
        active = true;
        done = false;
        // Focus inside an iframe means its key events don't reach this document;
        // pull focus back to the top page so Enter/Esc/arrows reach the overlay.
        const focused = document.activeElement;
        if (focused && (focused.tagName === 'IFRAME' || focused.tagName === 'FRAME')) focused.blur();
        render();
    }

    // ---- input handling (capture phase, registered at document_start) ----
    function isAltShiftOnly(e) {
        return e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey;
    }

    function onKey(e) {
        if (!active) {
            // Alt+Shift+Up/Down opens the switcher (Left/Right are browser shortcuts).
            if (e.type === 'keydown' && isAltShiftOnly(e) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                send({ type: 'switcher_open_request', step: e.key === 'ArrowDown' ? 1 : -1 });
            }
            return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.type !== 'keydown') return;
        switch (e.key) {
            case 'ArrowLeft':
            case 'ArrowDown':
                send({ type: 'switcher_move', step: 1 });
                break;
            case 'ArrowRight':
            case 'ArrowUp':
                send({ type: 'switcher_move', step: -1 });
                break;
            case 'Enter':
                finish('switcher_commit');
                break;
            case 'Escape':
                finish('switcher_cancel');
                break;
        }
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('keypress', (e) => {
        if (active) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);

    // Keep the page from reacting to clicks/scrolls meant for the overlay.
    for (const type of ['click', 'mouseup', 'contextmenu', 'wheel']) {
        window.addEventListener(type, (e) => {
            if (active && host && !e.composedPath().includes(host)) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }, { capture: true, passive: false });
    }

    // Leaving the page cancels.
    window.addEventListener('blur', () => finish('switcher_cancel'));
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) finish('switcher_cancel');
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message) return;
        if (message.type === 'overlay_show') {
            // Without keyboard focus (e.g. typing in the address bar) Enter and
            // the arrows wouldn't reach us; let background.js use the window.
            if (!document.hasFocus()) {
                sendResponse({ ok: false });
                return;
            }
            show(message.items, message.cursor);
            sendResponse({ ok: true });
        } else if (message.type === 'switcher_update') {
            if (active) {
                cursor = message.cursor;
                highlight();
            }
        } else if (message.type === 'switcher_icons') {
            if (active) setIcons(message.icons || {});
        } else if (message.type === 'overlay_hide') {
            done = true;
            hide();
        }
    });
})();
