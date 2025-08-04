// In background.js

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
    chrome.tabs.sendMessage(tab.id, { type: "sync_browser_state" }, response => {
      if (chrome.runtime.lastError) {
        console.warn("Message not delivered to tabId", tab.id, chrome.runtime.lastError.message);
      } else {
        console.log("Message successfully sent to tabId", tab.id);
      }
    });
  }
});

}

chrome.tabs.onCreated.addListener(() => notifyAppPages());
chrome.tabs.onRemoved.addListener(() => notifyAppPages());
chrome.tabs.onMoved.addListener(() => notifyAppPages());
chrome.tabs.onAttached.addListener(() => notifyAppPages());
chrome.tabs.onDetached.addListener(() => notifyAppPages());
chrome.tabs.onUpdated.addListener(() => notifyAppPages());
chrome.windows.onCreated.addListener(() => notifyAppPages());
chrome.windows.onRemoved.addListener(() => notifyAppPages());