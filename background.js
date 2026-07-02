// background.js - Speechify Extension Background Service Worker

// 1. Create Context Menu and set Side Panel Behavior on Installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "speechify-read-selection",
    title: "Read Selection with Speechify",
    contexts: ["selection"]
  });

  // Open the side panel when clicking the extension's toolbar icon
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("Error setting panel behavior:", error));
});

// 2. Handle Context Menu Click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "speechify-read-selection" && tab && tab.id !== undefined) {
    // Send a message to the content script on the active tab to start reading
    chrome.tabs.sendMessage(tab.id, { 
      action: "start_reading", 
      text: info.selectionText 
    }).catch((error) => {
      console.warn("Could not send message to tab. Injecting content script first...", error);
      // In case the content script is not yet injected or active, we can execute it manually
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/content.js"]
      }).then(() => {
        // Dynamically inject CSS on script execution fallback
        chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ["content/content.css"]
        }).catch(err => console.warn("Failed to inject CSS:", err));

        // Retry sending the message
        chrome.tabs.sendMessage(tab.id, { 
          action: "start_reading", 
          text: info.selectionText 
        });
      }).catch(err => console.error("Script injection failed:", err));
    });
  }
});

// 3. Listen for Messages from Content Script or Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "open_side_panel" && sender.tab && sender.tab.windowId) {
    chrome.sidePanel.open({ windowId: sender.tab.windowId })
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error("Error opening side panel:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response
  }
});
