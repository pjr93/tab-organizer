# Greetings

Welcome to a simple tab organizer! This app reflects the state of windows and tabs in your browser session, allowing you to manage your windows and tabs easier. In other words, whatever tabs and windows are opened in your browser will automatically appear in the main app

# Install

To install, here are the instructions:

1) First, download the zip file by clicking on the green code button near the top of the page and click download ZIP. Download it to a nice location.

2) Unpack the .zip file to a folder which will contain the app. (It should unpack to a folder "tab-organizer". You want it all to be contained)

3) Depending on your version of chromium navigate (type/ copy paste the relevant link below to your address bar) to either:

- brave://extensions
- chrome://extensions
- edge://extensions
- whateverChromiumBrowserYouHave://extensions

4) In the top right corner, turn on Developer mode

5) In the top left corner, click load unpacked, then find the folder which contains the app (wherever you unpacked your zip to). MAKE SURE to pick the folder which directly contains manifest.json (i.e. when you enter the folder, manifest.json should be there. Depending on your extraction method, the folder may contain another folder which THEN contains the app)

6) Enjoy!

## Update

1) Download the ZIP and unpack in same way you did above. The ZIP should be in the same location and you should unpack the folder in the exact same way (that way the folder structure is preserved)

2) go to the relevant extension page as in step 3) above, find the Tab Organizer extension from the list and click the refresh button. Your app should be updated now!

# How to use

First, you are going to want to click the extensions button on the toolbar (the puzzle icon) and find Tab Organizer. Click the pin icon to pin it

Then when you click the symbol for Tab Organizer, it will bring you to the main app page.

Each main box is a window. Each sub item is a tab. 

## Navigation

Simply hover over and right click on a tab to instantly be brought to it! The board's own tab always shows in green, and the page is called "Reflection Board".

You can always navigate back to it by clicking the icon on the toolbar at the top, or with `Alt+Shift+Home`.

### Tab switcher

`Alt+Shift` + any arrow key opens the tab switcher, a list of your recently used tabs (most recent at the top, the Reflection Board included), like Alt+Tab. It works on any page, whether or not the board is open.

- `Alt+Shift+Left` / `Alt+Shift+Down` opens it on the previous tab; `Alt+Shift+Right` / `Alt+Shift+Up` on the current one.
- It appears on top of the page you're on, with a green banner reading "keyboard input is captured": while it's up, your keys and clicks go to the switcher, not the page.
- Use the arrow keys to move the highlight (Left/Down = older, Right/Up = newer). You can let go of Alt+Shift.
- Press **Enter** to switch to the highlighted tab, or click a row. Esc or clicking outside the list cancels.
- Only the tab you actually switch to moves to the front of the list.
- On pages extensions aren't allowed to draw on (chrome:// pages, the web store, the new tab page, PDFs), or while you're typing in the address bar, the list opens in a small separate window instead and works the same way. (There, only Alt+Shift+Left/Right open it.)

"view history in app" checkbox: when checked, switching activates the tab inside its window but keeps you where you were (e.g. on the board, so you can watch the highlight move). When unchecked, the tab's window comes to the front.

Note for Windows: `Alt+Shift` is also Windows' default shortcut for changing keyboard language. If you have more than one input language and it gets in the way, change the extension's shortcuts at `chrome://extensions/shortcuts` (or your browser's equivalent). Alt+Shift+Up/Down are handled inside pages rather than as browser shortcuts (Chrome allows an extension only four suggested shortcuts), so they can't be changed there.

## Tab icons and previews

A 🔊 next to a tab means it's playing sound and 🔇 means it's muted. Click the icon to mute or unmute without leaving the board.

"full preview" checkbox: hovering a tab shows a screenshot of it at 1/8 of its real size (so it keeps the tab's shape), labelled with when it was taken. Screenshots are taken shortly after you view a tab, right before you leave it with the switcher or the board button/hotkey, and every 30 seconds for the tab you're looking at, so they show the tab roughly as you left it (e.g. a paused video). A tab is never loaded just to preview it, so a tab you haven't viewed since turning this on (e.g. one restored unloaded) shows no picture until you visit it. Browser-internal pages (chrome://, the web store) can't be previewed. The extension asks for access to all websites for this feature and for drawing the tab switcher over pages; screenshots stay on your computer.

## Creating tabs and windows

You can create a new tab by hovering the mouse and clicking the "+" button at the bottom right corner. You can close a tab by hovering over the tab until the "x" button appears and then you can click it.

You can also close an entire window by clicking the "x" at the top right corner of the main box.

You can open a new window by clicking the "+" outside of all the other windows.

Drag a window's ⠿ handle (top-left corner of its box) onto another box to move it there: the left half of a box drops before it, the right half after it. The browser has no window order of its own, so the board remembers this order itself; saves and autosaves keep it, and restoring recreates the windows in that order.

Click the title box in a window to name it. Names are kept while the window stays open (including when the board is reloaded) and are included in saves.

## Drag and drop features

You can rearrange tabs within a box and it will also change the order of the tab in the main browser UI. Click, Shift+click and Ctrl+click select several tabs to drag together.

You can drag a tab between windows by moving them to a different box

If you drag a tab outside of all the boxes, it will open that tab in a new window. It will not focus to that window, but of course you can right click on it to get immediately to the new window and its first tab.

## Saving and loading

There are two kinds of save states: **internal** and **JSON file**. Both save every window, its tabs and its title.

- **Save (Internal)** / `Ctrl+S`: keeps one snapshot in the browser's extension storage (each save overwrites the previous one).
- **autosave** checkbox: saves your session automatically about 10 seconds after tabs or windows change, into its own slot (it never overwrites your Ctrl+S save). When the browser starts, the last autosave is kept as "Autosave from previous browser session", so a fresh empty session can't overwrite it.
- **Load (Internal)**: opens a list of the available internal saves (manual, autosave, previous session) with their time and size. Choosing one replaces your open tabs with it.
- **Save JSON**: downloads `tab_layout.json`. I recommend saving it in the app's "saved-tabs" folder. The download icon on each window box saves just that window.
- **Upload JSON**: replaces your open tabs with the windows in a saved file.
- **Add JSON**: opens the windows from a saved file alongside the tabs you already have.

When loading, the saved windows are created first and only then are your old tabs closed, so a bad file won't wipe your session. Restored tabs are created unloaded: they appear immediately but each page only loads when you first open it.

WARNING: some browser-internal pages (e.g. brave://extensions) can't be reopened by extensions. Any tab that can't be restored is skipped and you'll be told how many; the list is in the console (F12).

Doing a save then an upload at least once will cache that folder location (at least unless you download or upload something else).


# To do

- add persistences to chosen tabs. I.e. on load it keeps some of your tabs
- why does the favicon url flicker on upload?
- group tabs by parent host url. It should be a hotkey and button and then on right click it expands so that you can right click again to navigate