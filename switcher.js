// Tab switcher fallback window (switcher.html), opened by background.js on
// pages where the in-page overlay can't run (chrome:// pages, web store, new
// tab page, PDFs) or when the page doesn't have keyboard focus.
// Same controls as the overlay: arrows move, Enter switches, Esc / clicking
// away cancels, click a row to pick it.

const listEl = document.getElementById('list');
let items = [];
let cursor = 0;
let done = false;
let hadFocus = false;

function send(message) {
    return chrome.runtime.sendMessage(message).catch(() => { });
}

function finish(type, extra = {}) {
    if (done) return;
    done = true;
    send({ type, ...extra });
}

function move(step) {
    if (!done) send({ type: 'switcher_move', step });
}

function hostOf(url) {
    try { return new URL(url).hostname || url.split(':')[0] + '://'; } catch (e) { return ''; }
}

function render() {
    listEl.replaceChildren();
    items.forEach((item, i) => {
        const li = document.createElement('li');
        li.dataset.tabId = item.id;
        const icon = document.createElement('img');
        icon.src = item.icon || getFaviconUrl(item.url, 16);
        icon.alt = '';
        const title = document.createElement('span');
        title.className = 'title';
        title.textContent = (item.audible ? '🔊 ' : '') + item.title;
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = hostOf(item.url) + (item.discarded ? ' · unloaded' : '');
        li.append(icon, title, meta);
        li.addEventListener('click', () => finish('switcher_commit', { index: i }));
        listEl.appendChild(li);
    });
    highlight();
}

function highlight() {
    Array.from(listEl.children).forEach((li, i) => li.classList.toggle('current', i === cursor));
    const cur = listEl.children[cursor];
    if (cur) cur.scrollIntoView({ block: 'nearest' });
}

window.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowDown':
            move(1);
            break;
        case 'ArrowRight':
        case 'ArrowUp':
            move(-1);
            break;
        case 'Enter':
            finish('switcher_commit');
            break;
        case 'Escape':
            finish('switcher_cancel');
            break;
    }
}, true);

window.addEventListener('focus', () => { hadFocus = true; });
// Clicking away from the switcher cancels it.
window.addEventListener('blur', () => {
    if (hadFocus) finish('switcher_cancel');
});

chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === 'switcher_update') {
        cursor = message.cursor;
        highlight();
    } else if (message.type === 'switcher_icons') {
        for (const li of listEl.children) {
            const src = (message.icons || {})[li.dataset.tabId];
            if (src) li.querySelector('img').src = src;
        }
    }
});

send({ type: 'switcher_ready' }).then((state) => {
    if (!state) {
        window.close();
        return;
    }
    items = state.items;
    cursor = state.cursor;
    render();
    if (document.hasFocus()) hadFocus = true;
});
