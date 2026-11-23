// Reattach after extension updates without reloading the page or losing drafts.
export async function recoverOpenChatGPTPages(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' })
  await Promise.allSettled(tabs.map(async (tab) => {
    if (tab.id === undefined || tab.discarded) return
    try {
      const response: unknown = await chrome.tabs.sendMessage(tab.id, { type: 'GPFC_PING' })
      if (response && typeof response === 'object' && 'ok' in response && response.ok === true) return
    } catch {
      // A stale content script loses its extension context after an update.
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
  }))
}
