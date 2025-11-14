


chrome.action.onClicked.addListener(() => {
  const appUrl = chrome.runtime.getURL("app.html");

  // Query all tabs with the app.html URL
  chrome.tabs.query({ url: appUrl }, (tabs) => {
    if (tabs.length > 0) {
      // If app.html tab exists, focus that tab and bring its window to front
      const tab = tabs[0];
      chrome.tabs.update(tab.id, { active: true }, () => {
        chrome.windows.update(tab.windowId, { focused: true });
      });
    } else {
      // No existing app.html tab, create a new one
      chrome.windows.getAll({ populate: true }, (windows) => {
        chrome.storage.local.set({ windows }, () => {
          chrome.tabs.create({ url: appUrl });
        });
      });
    }
  });
});

function notifyAppPages() {
  chrome.tabs.query({ url: chrome.runtime.getURL("app.html") }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: "sync_browser_state" }, response => { // only really runs when
        if (chrome.runtime.lastError) {
          console.warn("Message not delivered to tabId", tab.id, chrome.runtime.lastError.message);
        } else {
          console.log("Message successfully sent to tabId", tab.id);
        }
      });
    }
  });
}

chrome.tabs.onCreated.addListener(notifyAppPages);
chrome.tabs.onRemoved.addListener(notifyAppPages);
chrome.tabs.onMoved.addListener(notifyAppPages);
chrome.tabs.onAttached.addListener(notifyAppPages);
chrome.tabs.onDetached.addListener(notifyAppPages);
chrome.tabs.onUpdated.addListener(notifyAppPages);
chrome.windows.onCreated.addListener(notifyAppPages);
chrome.windows.onRemoved.addListener(notifyAppPages);

async function handleActiveTabChange(activeInfo) {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    const appUrl = chrome.runtime.getURL("app.html");
    // Only send update if NOT app.html
    if (!tab.url.startsWith(appUrl)) {
      chrome.tabs.query({ url: appUrl }, (tabs) => {
        for (const t of tabs) {
          chrome.tabs.sendMessage(t.id, {
            type: "active_tab_changed",
            tabId: tab.id
          });
        }
      });
    }
  } catch (e) {
    console.warn("Failed to handle active tab change", e);
  }
}

chrome.tabs.onActivated.addListener(handleActiveTabChange);

let listenerActive = true
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "toggleListener") {
    if (message.active && !listenerActive) {
      chrome.tabs.onCreated.addListener(notifyAppPages);
      chrome.tabs.onRemoved.addListener(notifyAppPages);
      chrome.tabs.onMoved.addListener(notifyAppPages);
      chrome.tabs.onAttached.addListener(notifyAppPages);
      chrome.tabs.onDetached.addListener(notifyAppPages);
      chrome.tabs.onUpdated.addListener(notifyAppPages);
      chrome.windows.onCreated.addListener(notifyAppPages);
      chrome.windows.onRemoved.addListener(notifyAppPages);
      chrome.tabs.onActivated.addListener(handleActiveTabChange);
      listenerActive = true;

    } else if (!message.active && listenerActive) {
      chrome.tabs.onCreated.removeListener(notifyAppPages);
      chrome.tabs.onRemoved.removeListener(notifyAppPages);
      chrome.tabs.onMoved.removeListener(notifyAppPages);
      chrome.tabs.onAttached.removeListener(notifyAppPages);
      chrome.tabs.onDetached.removeListener(notifyAppPages);
      chrome.tabs.onUpdated.removeListener(notifyAppPages);
      chrome.windows.onCreated.removeListener(notifyAppPages);
      chrome.windows.onRemoved.removeListener(notifyAppPages);
      chrome.tabs.onActivated.removeListener(handleActiveTabChange);
      listenerActive = false;

    } else {

    }
  }
  return true; // For async sendResponse if needed
});