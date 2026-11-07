// Tab switcher page, opened by background.js in a small popup window.
// The background owns the state (items + cursor); this page only displays it
// and reports keys. Releasing Alt commits the highlighted tab.

const listEl = document.getElementById('list');
let items = [];
let cursor = 0;
let done = false;          // a commit/cancel has been sent
let altConfirmed = false;  // we've seen an event proving Alt is still held
let fallbackTimer = null;
let hadFocus = false;

function send(message) {
    return chrome.runtime.sendMessage(message).catch(() => { });
}

function finish(type, extra = {}) {
    if (done) return;
    done = true;
    clearTimeout(fallbackTimer);
    send({ type, ...extra });
}

function move(step) {
    if (!done) send({ type: 'switcher_move', step });
}

function hostOf(url) {
    try { return new URL(url).hostname; } catch (e) { return ''; }
}

function render() {
    listEl.replaceChildren();
    items.forEach((item, i) => {
        const li = document.createElement('li');
        const icon = document.createElement('img');
        icon.src = getFaviconUrl(item.url, 16);
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

// If Alt was released before this page could see any key event, we would
// never get its keyup. Until an event proves Alt is still held, commit after
// a short pause instead of waiting forever.
function armFallback() {
    clearTimeout(fallbackTimer);
    if (!altConfirmed) fallbackTimer = setTimeout(() => finish('switcher_commit'), 1500);
}

function noteModifiers(e) {
    if (e.altKey) {
        altConfirmed = true;
        clearTimeout(fallbackTimer);
    }
}

window.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    noteModifiers(e);
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

window.addEventListener('keyup', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Alt released (or any key released while Alt is no longer down): switch.
    if (e.key === 'Alt' || !e.altKey) {
        finish('switcher_commit');
        return;
    }
    noteModifiers(e);
}, true);

window.addEventListener('focus', () => { hadFocus = true; });
// Clicking away from the switcher cancels it.
window.addEventListener('blur', () => {
    if (hadFocus) finish('switcher_cancel');
});

chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'switcher_update') {
        cursor = message.cursor;
        highlight();
        armFallback();
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
    armFallback();
});
