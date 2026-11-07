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

`Alt+Shift+Left` / `Alt+Shift+Right`: step through your recently used tabs, like Alt+Tab. Left goes to older tabs, Right comes back toward newer ones. About a second after your last press (or as soon as you switch tabs some other way) the tab you landed on moves to the front of the list. This works whether or not the board is open.

"view history in app" checkbox: when checked, the history hotkeys switch tabs inside their windows but keep you on the board, so you can watch the highlight move. When unchecked, they bring the tab's window to the front.

You can change any of these shortcuts at `chrome://extensions/shortcuts` (or your browser's equivalent).

## Creating tabs and windows

You can create a new tab by hovering the mouse and clicking the "+" button at the bottom right corner. You can close a tab by hovering over the tab until the "x" button appears and then you can click it.

You can also close an entire window by clicking the "x" at the top right corner of the main box.

You can open a new window by clicking the "+" outside of all the other windows.

Click the title box in a window to name it. Names are kept while the window stays open (including when the board is reloaded) and are included in saves.

## Drag and drop features

You can rearrange tabs within a box and it will also change the order of the tab in the main browser UI. Click, Shift+click and Ctrl+click select several tabs to drag together.

You can drag a tab between windows by moving them to a different box

If you drag a tab outside of all the boxes, it will open that tab in a new window. It will not focus to that window, but of course you can right click on it to get immediately to the new window and its first tab.

## Saving and loading

There are two kinds of save states: **internal** and **JSON file**. Both save every window, its tabs and its title.

- **Save (Internal)** / `Ctrl+S`: keeps one snapshot in the browser's extension storage (each save overwrites the previous one).
- **Load (Internal)**: asks for confirmation, then replaces your open tabs with that snapshot.
- **Save JSON**: downloads `tab_layout.json`. I recommend saving it in the app's "saved-tabs" folder. The download icon on each window box saves just that window.
- **Upload JSON**: replaces your open tabs with the windows in a saved file.
- **Add JSON**: opens the windows from a saved file alongside the tabs you already have.

When loading, the saved windows are created first and only then are your old tabs closed, so a bad file won't wipe your session. Restored tabs are created unloaded: they appear immediately but each page only loads when you first open it.

WARNING: some browser-internal pages (e.g. brave://extensions) can't be reopened by extensions. Any tab that can't be restored is skipped and you'll be told how many; the list is in the console (F12).

Doing a save then an upload at least once will cache that folder location (at least unless you download or upload something else).


# To do

- add persistences to chosen tabs. I.e. on load it keeps some of your tabs
- allow movement of windows like tabs
- why does the favicon url flicker on upload?
- group tabs by parent host url. It should be a hotkey and button and then on right click it expands so that you can right click again to navigate