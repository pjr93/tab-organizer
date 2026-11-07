// Tab switcher overlay, drawn inside the current page.
// Runs as a content script in every page (and is loaded by the board).
//
// Because keyboard focus never leaves the page, this script can see Alt being
// released, which a separate window opened mid-keypress cannot. It also keeps
// track of the Alt key passively at all times (without blocking anything), so
// on a quick tap, where Alt is already up by the time background.js asks for
// the overlay, it switches immediately.
//
// While the overlay is shown, all key and mouse input is captured so it does
// not reach the page; the banner says so.
(() => {
    if (window.__tabSwitcherOverlayLoaded) return;
    window.__tabSwitcherOverlayLoaded = true;

    // ---- passive Alt tracking ----
    let altHeld = false;
    let lastKeyAt = 0;
    function track(e) {
        lastKeyAt = Date.now();
        if (e.key === 'Alt') altHeld = e.type === 'keydown';
        else altHeld = e.altKey;
    }

    // ---- overlay state ----
    let active = false;
    let done = false;
    let host = null;
    let listEl = null;
    let items = [];
    let cursor = 0;
    let fallbackTimer = null;

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
        try { return new URL(url).hostname; } catch (e) { return ''; }
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
            border: 2px solid #2196F3; border-radius: 10px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
            overflow: hidden;
        }
        .banner {
            display: flex; align-items: center; gap: 10px;
            padding: 10px 14px; background: #2196F3; color: white;
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
        hint.textContent = 'Release Alt to switch · Alt+Shift+← older / → newer (or ↑ ↓) · Enter to switch · Esc to cancel · click to pick';
        listEl = document.createElement('ul');

        items.forEach((item, i) => {
            const li = document.createElement('li');
            if (item.favIconUrl && /^(https?|data):/.test(item.favIconUrl)) {
                const icon = document.createElement('img');
                icon.src = item.favIconUrl;
                icon.alt = '';
                icon.addEventListener('error', () => icon.remove());
                li.appendChild(icon);
            }
            const title = document.createElement('span');
            title.className = 'title';
            title.textContent = (item.audible ? '🔊 ' : '') + item.title;
            const meta = document.createElement('span');
            meta.className = 'meta';
            meta.textContent = hostOf(item.url) + (item.discarded ? ' · unloaded' : '');
            li.append(title, meta);
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

    function hide() {
        clearTimeout(fallbackTimer);
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
        // pull focus back to the top page so we see the Alt release.
        const focused = document.activeElement;
        if (focused && (focused.tagName === 'IFRAME' || focused.tagName === 'FRAME')) focused.blur();

        render();

        const recentKeys = Date.now() - lastKeyAt < 1500;
        if (recentKeys && !altHeld) {
            // Quick tap: Alt was already released before we got here.
            setTimeout(() => finish('switcher_commit'), 0);
        } else if (!recentKeys) {
            // We haven't seen the keys (e.g. focus was in an iframe), so we can't
            // tell whether Alt is still down: switch after a pause unless a key
            // event shows it is.
            fallbackTimer = setTimeout(() => finish('switcher_commit'), 1500);
        }
    }

    // ---- input handling (capture phase, registered at document_start) ----
    function onKey(e) {
        track(e);
        if (!active) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.altKey) clearTimeout(fallbackTimer);
        if (e.type === 'keydown') {
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
        } else if (e.type === 'keyup') {
            if (e.key === 'Alt' || !e.altKey) finish('switcher_commit');
        }
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('keypress', (e) => {
        if (active) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);

    // Keep page from reacting to clicks/scrolls meant for the overlay.
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
            // Without keyboard focus (e.g. typing in the address bar) we would
            // never see Alt released; let background.js use the window instead.
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
        } else if (message.type === 'overlay_hide') {
            done = true;
            hide();
        }
    });
})();
